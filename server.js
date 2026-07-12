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
 *  - ALLOWED_ORIGINS (mặc định trống)     — allowlist Origin cho WebSocket (chống
 *                                           CSWSH); trống = cho phép mọi origin
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const { SessionStore } = require('./lib/store');
const { cyrb53 } = require('./lib/hash');
const { Auth, TOKEN_TTL_MS } = require('./lib/auth');
const { UserStore } = require('./lib/users');
const { RateLimiter } = require('./lib/ratelimit');

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

// Danh sách Origin được phép mở WebSocket (chống CSWSH). Để trống = cho phép mọi
// origin (giữ nguyên hành vi cũ, tiện cho nhúng iframe). Đặt vd:
//   ALLOWED_ORIGINS="https://map.example.com,https://app.example.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const PRUNE_INTERVAL_MS = 5 * 60 * 1000;      // dọn dẹp mỗi 5 phút
const PRUNE_GRACE_MS = 24 * 60 * 60 * 1000;   // giữ 24h sau khi hết hạn

// Giới hạn kích thước dữ liệu session để tránh nhồi dữ liệu khổng lồ (DoS/đầy đĩa).
const MAX_NODES = 5000;
const MAX_EDGES = 20000;
const MAX_LABELS = 2000;
const MAX_MAPIMAGE_LEN = 4_000_000; // ~4MB cho data URL dự phòng (nằm trong giới hạn JSON 16MB)
const WS_MAX_PAYLOAD = 2 * 1024 * 1024; // 2MB mỗi message WebSocket

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const store = new SessionStore(DATA_DIR);
const users = new UserStore(DATA_DIR);
const auth = new Auth(DATA_DIR);
const AUTH_COOKIE = 'ms_auth';

// Chặn brute-force: giới hạn số lần thử đăng nhập/đăng ký theo IP.
const authLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

// ----------------------------------------------------------------------------
// Tiện ích
// ----------------------------------------------------------------------------
/** So sánh chuỗi kiểu constant-time để giảm rò rỉ thời gian. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

function isOwnerToken(session, ownerToken) {
  if (!session || !ownerToken || !session.ownerTokenHash) return false;
  return safeEqual(cyrb53(String(ownerToken)), session.ownerTokenHash);
}

/** Cắt mảng an toàn: chỉ nhận Array, giới hạn số phần tử. */
function capArray(v, max) {
  if (!Array.isArray(v)) return [];
  return v.length > max ? v.slice(0, max) : v;
}

/** Chỉ giữ đúng các trường hợp lệ khi client tạo session (không tin dữ liệu thô). */
function sanitizeIncomingSession(body) {
  if (!body || typeof body !== 'object') return null;
  const token = typeof body.token === 'string' ? body.token.replace(/[^a-zA-Z0-9_-]/g, '') : '';
  if (!token || !body.ownerTokenHash) return null;
  // mapImage: chấp nhận URL tương đối (/uploads/…) hoặc data URL nhỏ; chặn chuỗi khổng lồ.
  let mapImage = typeof body.mapImage === 'string' ? body.mapImage : null;
  if (mapImage && mapImage.length > MAX_MAPIMAGE_LEN) return null;
  return {
    token,
    ownerTokenHash: String(body.ownerTokenHash),
    // ownerToken gốc lưu để chủ sở hữu (đã đăng nhập) mở lại link owner từ dashboard.
    // KHÔNG bao giờ trả trong GET công khai.
    ownerToken: typeof body.ownerToken === 'string' ? body.ownerToken.slice(0, 200) : null,
    mapImage,
    mapW: Number(body.mapW) || 0,
    mapH: Number(body.mapH) || 0,
    nodes: capArray(body.nodes, MAX_NODES),
    edges: capArray(body.edges, MAX_EDGES),
    labels: capArray(body.labels, MAX_LABELS),
    ownerPos: body.ownerPos || null,
    ownerLocked: !!body.ownerLocked,
    createdAt: Number(body.createdAt) || Date.now(),
    expiresAt: body.expiresAt ? Number(body.expiresAt) : null,
    hasPassword: !!body.hasPassword,
    passwordHash: body.passwordHash ? String(body.passwordHash) : null,
    status: body.status === 'ended' ? 'ended' : 'active',
    name: typeof body.name === 'string' ? body.name.slice(0, 80) : '',
  };
}

/**
 * Kiểm tra Origin của yêu cầu WebSocket. Trả về true nếu được phép.
 * - Không cấu hình ALLOWED_ORIGINS → cho phép tất cả (tương thích ngược).
 * - Không có header Origin (client không phải trình duyệt) → cho phép.
 * - Có Origin → phải nằm trong allowlist.
 */
function originAllowed(req) {
  if (ALLOWED_ORIGINS.length === 0) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

/** Xóa ảnh bản đồ đã upload gắn với session (nếu là file trong UPLOAD_DIR). */
function removeSessionUpload(session) {
  const img = session && session.mapImage;
  if (typeof img !== 'string' || !img.startsWith('/uploads/')) return;
  const base = path.basename(img); // chống path traversal
  if (!base || base === '.' || base === '..') return;
  const f = path.join(UPLOAD_DIR, base);
  if (path.dirname(path.resolve(f)) !== path.resolve(UPLOAD_DIR)) return;
  try { fs.unlinkSync(f); } catch (e) { /* đã không còn */ }
}

/** Số người xem đang kết nối realtime cho một token (socket không phải owner). */
function viewerCountOf(token) {
  const set = rooms.get(token);
  if (!set) return 0;
  let n = 0;
  for (const ws of set) if (!ws.isOwner && ws.readyState === ws.OPEN) n++;
  return n;
}

// ---- cookie / auth helpers ----
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

function setAuthCookie(req, res, token) {
  const parts = [
    AUTH_COOKIE + '=' + encodeURIComponent(token),
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    'Max-Age=' + Math.floor(TOKEN_TTL_MS / 1000),
  ];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(req, res) {
  res.setHeader('Set-Cookie', AUTH_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/** Trả về user hiện tại (từ cookie) hoặc null. */
function currentUser(req) {
  const token = parseCookies(req)[AUTH_COOKIE];
  const uid = auth.verify(token, Date.now());
  if (!uid) return null;
  return users.getById(uid);
}

function publicUser(u) { return u ? { id: u.id, username: u.username } : null; }

// ----------------------------------------------------------------------------
// Express app
// ----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // sau nginx: đọc đúng X-Forwarded-Proto
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

// --- Auth ---------------------------------------------------------------------
function validCreds(b) {
  const username = (b && typeof b.username === 'string') ? b.username.trim() : '';
  const password = (b && typeof b.password === 'string') ? b.password : '';
  if (username.length < 3 || username.length > 40) return null;
  if (password.length < 6 || password.length > 200) return null;
  return { username, password };
}

function tooManyAttempts(req, res) {
  if (!authLimiter.allow(req.ip)) {
    res.status(429).json({ error: 'Quá nhiều lần thử. Vui lòng chờ vài phút rồi thử lại.' });
    return true;
  }
  return false;
}

app.post('/api/auth/register', (req, res) => {
  if (tooManyAttempts(req, res)) return;
  const c = validCreds(req.body);
  if (!c) return res.status(400).json({ error: 'Tên đăng nhập ≥ 3 ký tự và mật khẩu ≥ 6 ký tự.' });
  if (users.findByName(c.username)) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' });
  const user = users.create(c.username, auth.hashPassword(c.password));
  setAuthCookie(req, res, auth.sign(user.id, Date.now()));
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  if (tooManyAttempts(req, res)) return;
  const c = validCreds(req.body);
  if (!c) return res.status(400).json({ error: 'Thông tin đăng nhập không hợp lệ.' });
  const user = users.findByName(c.username);
  if (!user || !auth.verifyPassword(c.password, user.passHash)) {
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }
  setAuthCookie(req, res, auth.sign(user.id, Date.now()));
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: publicUser(currentUser(req)) });
});

// --- Quản lý phiên của người dùng (cần đăng nhập) -----------------------------
app.get('/api/my/sessions', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const list = store.list()
    .filter((s) => s.ownerUserId === u.id)
    .map((s) => ({
      token: s.token,
      name: s.name || '',
      createdAt: s.createdAt || 0,
      expiresAt: s.expiresAt || null,
      status: s.status || 'active',
      expired: !!(s.expiresAt && Date.now() > s.expiresAt),
      nodes: (s.nodes || []).length,
      viewers: viewerCountOf(s.token),
      ownerToken: s.ownerToken || null, // chỉ trả cho chủ sở hữu (route này đã xác thực)
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ sessions: list });
});

app.patch('/api/sessions/:token/manage', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const sess = store.get(req.params.token);
  if (!sess) return res.status(404).json({ error: 'not found' });
  if (sess.ownerUserId !== u.id) return res.status(403).json({ error: 'forbidden' });
  const patch = {};
  if (typeof req.body.name === 'string') patch.name = req.body.name.slice(0, 80);
  if (req.body.status === 'ended') patch.status = 'ended';
  else if (req.body.status === 'active') patch.status = 'active'; // dùng lại phiên đã kết thúc
  // Cho phép đặt/bỏ hạn khi dùng lại phiên.
  if ('expiresAt' in req.body) {
    patch.expiresAt = req.body.expiresAt == null ? null : (Number(req.body.expiresAt) || null);
  }
  // Kích hoạt lại mà phiên đã quá hạn và client không đặt hạn mới → bỏ hạn để dùng được ngay.
  if (patch.status === 'active' && !('expiresAt' in req.body) &&
      sess.expiresAt && Date.now() > sess.expiresAt) {
    patch.expiresAt = null;
  }
  const next = store.patch(req.params.token, patch);
  if (patch.status === 'ended') broadcast(req.params.token, { type: 'end' }, null);
  if (patch.status === 'active') broadcast(req.params.token, { type: 'reopen' }, null);
  res.json({ ok: true, name: next.name, status: next.status, expiresAt: next.expiresAt });
});

app.delete('/api/sessions/:token', (req, res) => {
  const u = currentUser(req);
  const sess = store.get(req.params.token);
  if (!sess) return res.status(404).json({ error: 'not found' });
  const isOwnerUser = u && sess.ownerUserId === u.id;
  const isOwnerTok = isOwnerToken(sess, req.get('x-owner-token'));
  if (!isOwnerUser && !isOwnerTok) return res.status(403).json({ error: 'forbidden' });
  broadcast(req.params.token, { type: 'end' }, null);
  removeSessionUpload(sess);
  store.delete(req.params.token);
  res.json({ ok: true });
});

// Tạo session (client sinh token + ownerToken để giữ nguyên cơ chế link).
app.post('/api/sessions', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Bạn cần đăng nhập để tạo phiên.' });
  const sess = sanitizeIncomingSession(req.body);
  if (!sess) return res.status(400).json({ error: 'invalid session payload' });
  const prev = store.get(sess.token);
  const existed = !!prev;
  // Chủ sở hữu gán từ tài khoản đăng nhập (không tin body). Không cho chiếm phiên của người khác.
  if (existed && prev.ownerUserId && prev.ownerUserId !== u.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  sess.ownerUserId = u.id;
  if (existed && prev.name && !sess.name) sess.name = prev.name; // giữ tên đã đặt
  // Nếu chủ phiên thay ảnh bản đồ, dọn ảnh upload cũ để tránh mồ côi trên đĩa.
  if (existed && prev.mapImage && prev.mapImage !== sess.mapImage) {
    removeSessionUpload(prev);
  }
  store.put(sess.token, sess);
  // Nếu là cập nhật (chủ phiên chỉnh sửa lại ở màn tạo phiên), phát realtime
  // cho người xem đang kết nối để họ thấy ngay đồ thị / vị trí mới nhất.
  if (existed) {
    broadcast(sess.token, { type: 'graph', nodes: sess.nodes, edges: sess.edges, labels: sess.labels }, null);
    broadcast(sess.token, { type: 'owner', pos: sess.ownerPos, locked: sess.ownerLocked }, null);
    if (sess.status === 'ended') broadcast(sess.token, { type: 'end' }, null);
  }
  res.status(201).json({ ok: true, token: sess.token });
});

// Đọc session (public — người xem ở thiết bị khác dùng để nạp lần đầu).
app.get('/api/sessions/:token', (req, res) => {
  const sess = store.get(req.params.token);
  if (!sess) return res.status(404).json({ error: 'not found' });
  const pub = Object.assign({}, sess);
  // Xác thực owner ở phía server (constant-time) và chỉ trả về cờ boolean —
  // KHÔNG lộ ownerTokenHash. cyrb53 là hash nhanh (~53-bit); nếu lộ hash, kẻ tấn
  // công có thể brute-force/giả mạo owner token và chiếm phiên.
  pub.isOwner = isOwnerToken(sess, req.query.ot);
  delete pub.ownerUserId; delete pub.passwordHash; delete pub.ownerToken; delete pub.ownerTokenHash;
  res.json(pub);
});

// Cập nhật session (chỉ owner). Dùng làm đường dự phòng ngoài WebSocket.
app.put('/api/sessions/:token', (req, res) => {
  const sess = store.get(req.params.token);
  if (!sess) return res.status(404).json({ error: 'not found' });
  const ot = req.get('x-owner-token');
  if (!isOwnerToken(sess, ot)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const patch = {};
  if ('nodes' in b) patch.nodes = capArray(b.nodes, MAX_NODES);
  if ('edges' in b) patch.edges = capArray(b.edges, MAX_EDGES);
  if ('labels' in b) patch.labels = capArray(b.labels, MAX_LABELS);
  if ('ownerPos' in b) patch.ownerPos = b.ownerPos || null;
  if ('ownerLocked' in b) patch.ownerLocked = !!b.ownerLocked;
  if ('status' in b) patch.status = b.status === 'ended' ? 'ended' : 'active';
  const next = store.patch(req.params.token, patch);
  broadcast(req.params.token, { type: 'graph', nodes: next.nodes, edges: next.edges, labels: next.labels }, null);
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
app.use('/vendor', express.static(path.join(ROOT, 'vendor'), { maxAge: '7d' }));
app.use('/maps', express.static(path.join(ROOT, 'maps'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));
// Lab thử nghiệm thư viện bản đồ miễn phí (Leaflet + OSM + OSRM + Nominatim).
app.use('/labs', express.static(path.join(ROOT, 'labs'), { maxAge: '5m' }));

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
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

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
  if (!originAllowed(req)) { socket.destroy(); return; }
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
      const p = {
        nodes: capArray(msg.nodes, MAX_NODES),
        edges: capArray(msg.edges, MAX_EDGES),
      };
      if (Array.isArray(msg.labels)) p.labels = capArray(msg.labels, MAX_LABELS);
      store.patch(token, p);
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
  const n = store.prune(Date.now(), PRUNE_GRACE_MS, removeSessionUpload);
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
