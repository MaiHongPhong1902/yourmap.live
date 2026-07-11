'use strict';

/**
 * Backend cho "Chia sẻ vị trí bản đồ".
 *
 * Chạy cross-platform (Linux/Windows) chỉ với Node.js >= 18.
 *  - Serve frontend tĩnh (file .dc.html, support.js, ảnh bản đồ, ảnh upload).
 *  - REST API tạo/đọc session, upload ảnh bản đồ.
 *  - WebSocket đồng bộ realtime giữa các thiết bị khác nhau (thay cho
 *    BroadcastChannel vốn chỉ hoạt động trong cùng một trình duyệt).
 *
 * Cấu hình qua biến môi trường:
 *  - PORT           (mặc định 3000)
 *  - HOST           (mặc định 0.0.0.0)
 *  - DATA_DIR       (mặc định ./data)     — nơi lưu file JSON của session
 *  - UPLOAD_DIR     (mặc định ./uploads)  — nơi lưu ảnh bản đồ đã upload
 *  - MAX_UPLOAD_MB  (mặc định 10)         — giới hạn dung lượng ảnh upload
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const { SessionStore } = require('./lib/store');
const { cyrb53 } = require('./lib/hash');

// ----------------------------------------------------------------------------
// Cấu hình
// ----------------------------------------------------------------------------
const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '10', 10);
const HTML_FILE = 'Chia sẻ vị trí bản đồ.dc.html';

const PRUNE_INTERVAL_MS = 5 * 60 * 1000;      // dọn dẹp mỗi 5 phút
const PRUNE_GRACE_MS = 24 * 60 * 60 * 1000;   // giữ 24h sau khi hết hạn

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const store = new SessionStore(DATA_DIR);

// ----------------------------------------------------------------------------
// Tiện ích
// ----------------------------------------------------------------------------
function isOwnerToken(session, ownerToken) {
  if (!session || !ownerToken) return false;
  return cyrb53(String(ownerToken)) === session.ownerTokenHash;
}

/** Chỉ giữ đúng các trường hợp lệ khi client tạo session (không tin dữ liệu thô). */
function sanitizeIncomingSession(body) {
  if (!body || typeof body !== 'object') return null;
  const token = typeof body.token === 'string' ? body.token.replace(/[^a-zA-Z0-9_-]/g, '') : '';
  if (!token || !body.ownerTokenHash) return null;
  return {
    token,
    ownerTokenHash: String(body.ownerTokenHash),
    mapImage: typeof body.mapImage === 'string' ? body.mapImage : null,
    mapW: Number(body.mapW) || 0,
    mapH: Number(body.mapH) || 0,
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    edges: Array.isArray(body.edges) ? body.edges : [],
    ownerPos: body.ownerPos || null,
    ownerLocked: !!body.ownerLocked,
    createdAt: Number(body.createdAt) || Date.now(),
    expiresAt: body.expiresAt ? Number(body.expiresAt) : null,
    hasPassword: !!body.hasPassword,
    passwordHash: body.passwordHash ? String(body.passwordHash) : null,
    status: body.status === 'ended' ? 'ended' : 'active',
  };
}

// ----------------------------------------------------------------------------
// Express app
// ----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' })); // đủ chỗ cho mapImage dạng data URL (fallback)

// Upload ảnh bản đồ ------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ({
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
      })[file.mimetype] || '.bin';
      const name = 'map_' + Date.now().toString(36) + '_' +
        Math.floor(Math.random() * 1e9).toString(36) + ext;
      cb(null, name);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file ảnh'));
  },
});

// --- API --------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'map-share', time: Date.now() });
});

// Tạo session (client sinh token + ownerToken để giữ nguyên cơ chế link).
app.post('/api/sessions', (req, res) => {
  const sess = sanitizeIncomingSession(req.body);
  if (!sess) return res.status(400).json({ error: 'invalid session payload' });
  store.put(sess.token, sess);
  res.status(201).json({ ok: true, token: sess.token });
});

// Đọc session (public — người xem ở thiết bị khác dùng để nạp lần đầu).
app.get('/api/sessions/:token', (req, res) => {
  const sess = store.get(req.params.token);
  if (!sess) return res.status(404).json({ error: 'not found' });
  res.json(sess);
});

// Cập nhật session (chỉ owner). Dùng làm đường dự phòng ngoài WebSocket.
app.put('/api/sessions/:token', (req, res) => {
  const sess = store.get(req.params.token);
  if (!sess) return res.status(404).json({ error: 'not found' });
  const ot = req.get('x-owner-token');
  if (!isOwnerToken(sess, ot)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const patch = {};
  if ('nodes' in b) patch.nodes = Array.isArray(b.nodes) ? b.nodes : [];
  if ('edges' in b) patch.edges = Array.isArray(b.edges) ? b.edges : [];
  if ('ownerPos' in b) patch.ownerPos = b.ownerPos || null;
  if ('ownerLocked' in b) patch.ownerLocked = !!b.ownerLocked;
  if ('status' in b) patch.status = b.status === 'ended' ? 'ended' : 'active';
  const next = store.patch(req.params.token, patch);
  broadcast(req.params.token, { type: 'graph', nodes: next.nodes, edges: next.edges }, null);
  res.json({ ok: true });
});

// Upload ảnh bản đồ → trả về URL tương đối để lưu vào session (tránh phình JSON).
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.status(201).json({ url: '/uploads/' + req.file.filename, size: req.file.size });
});

// --- File tĩnh --------------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(ROOT, HTML_FILE)));
app.get('/support.js', (req, res) => res.sendFile(path.join(ROOT, 'support.js')));
app.use('/maps', express.static(path.join(ROOT, 'maps'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

// Xử lý lỗi upload (multer) và lỗi chung.
app.use((err, req, res, next) => {
  if (err) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(code).json({ error: err.message || 'error' });
  }
  next();
});

// ----------------------------------------------------------------------------
// HTTP + WebSocket server
// ----------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Mỗi token → tập các socket đang kết nối.
const rooms = new Map();

function roomOf(token) {
  let set = rooms.get(token);
  if (!set) { set = new Set(); rooms.set(token, set); }
  return set;
}

/** Gửi msg tới mọi socket cùng token, trừ `except`. */
function broadcast(token, msg, except) {
  const set = rooms.get(token);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) {
    if (ws === except) continue;
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); } catch (e) { /* bỏ qua socket lỗi */ }
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  const { pathname, query } = url.parse(req.url, true);
  if (pathname !== '/ws') { socket.destroy(); return; }
  const token = String(query.token || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!token) { socket.destroy(); return; }
  const session = store.get(token);
  if (!session) { socket.destroy(); return; }
  const isOwner = isOwnerToken(session, query.ot);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.token = token;
    ws.isOwner = isOwner;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  const token = ws.token;
  roomOf(token).add(ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    // owner/graph/end chỉ được chấp nhận từ kết nối có owner token hợp lệ.
    // Điều này chặt hơn bản BroadcastChannel gốc (nơi tab nào cũng gửi được).
    const privileged = msg.type === 'owner' || msg.type === 'graph' || msg.type === 'end';
    if (privileged && !ws.isOwner) return;

    // Lưu trạng thái mới nhất để người vào sau (GET) nhận được bản cập nhật.
    if (msg.type === 'owner') {
      store.patch(token, { ownerPos: msg.pos || null, ownerLocked: !!msg.locked });
    } else if (msg.type === 'graph') {
      store.patch(token, {
        nodes: Array.isArray(msg.nodes) ? msg.nodes : [],
        edges: Array.isArray(msg.edges) ? msg.edges : [],
      });
    } else if (msg.type === 'end') {
      store.patch(token, { status: 'ended' });
    }

    broadcast(token, msg, ws);
  });

  const cleanup = () => {
    const set = rooms.get(token);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(token);
    }
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// ----------------------------------------------------------------------------
// Dọn session hết hạn định kỳ
// ----------------------------------------------------------------------------
const pruneTimer = setInterval(() => {
  const n = store.prune(Date.now(), PRUNE_GRACE_MS);
  if (n) console.log(`[prune] đã xóa ${n} session hết hạn`);
}, PRUNE_INTERVAL_MS);
pruneTimer.unref();

// ----------------------------------------------------------------------------
// Khởi động + tắt gọn gàng
// ----------------------------------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`Map-Share backend đang chạy tại http://${HOST}:${PORT}`);
  console.log(`  DATA_DIR   = ${DATA_DIR}`);
  console.log(`  UPLOAD_DIR = ${UPLOAD_DIR}`);
});

function shutdown(sig) {
  console.log(`\nNhận ${sig}, đang tắt…`);
  clearInterval(pruneTimer);
  for (const ws of wss.clients) { try { ws.close(); } catch (e) {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server };
