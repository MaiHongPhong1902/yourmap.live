'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Store session dạng file JSON — mỗi session là một file trong DATA_DIR.
 * Zero native dependency, chạy y hệt trên Linux/Windows, dễ backup/di chuyển.
 *
 * Ghi an toàn: ghi ra file tạm rồi rename (atomic trên cùng volume) để tránh
 * file hỏng nếu tiến trình chết giữa chừng.
 */
class SessionStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  _file(token) {
    // token do client sinh (chỉ [0-9a-z]); vẫn làm sạch để chặn path traversal.
    const safe = String(token).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) return null;
    return path.join(this.dataDir, safe + '.json');
  }

  get(token) {
    const f = this._file(token);
    if (!f) return null;
    try {
      const raw = fs.readFileSync(f, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /** Ghi đè toàn bộ session. */
  put(token, session) {
    const f = this._file(token);
    if (!f) throw new Error('invalid token');
    const tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(session), 'utf8');
    fs.renameSync(tmp, f);
    return session;
  }

  /** Vá (merge nông) một session đã tồn tại. Trả về session mới hoặc null nếu không có. */
  patch(token, patch) {
    const cur = this.get(token);
    if (!cur) return null;
    const next = Object.assign({}, cur, patch);
    this.put(token, next);
    return next;
  }

  delete(token) {
    const f = this._file(token);
    if (!f) return;
    try { fs.unlinkSync(f); } catch (e) { /* đã không còn */ }
  }

  list() {
    let files = [];
    try { files = fs.readdirSync(this.dataDir); } catch (e) { return []; }
    const out = [];
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const token = name.slice(0, -5);
      const s = this.get(token);
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * Dọn session đã hết hạn. Giữ lại tới `graceMs` sau expiresAt để người dùng
   * vẫn thấy màn hình "đã hết hạn" thay vì "không tìm thấy". Trả về số file đã xóa.
   *
   * `onRemove(session)` (tuỳ chọn) được gọi trước khi xóa mỗi session — dùng để
   * dọn tài nguyên liên quan (vd: ảnh bản đồ đã upload) tránh rò rỉ đĩa.
   */
  prune(now, graceMs, onRemove) {
    let removed = 0;
    for (const s of this.list()) {
      if (s.expiresAt && now > s.expiresAt + graceMs) {
        if (typeof onRemove === 'function') { try { onRemove(s); } catch (e) { /* bỏ qua */ } }
        this.delete(s.token);
        removed++;
      }
    }
    return removed;
  }
}

module.exports = { SessionStore };
