'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Xác thực gọn nhẹ, không thêm dependency:
 *  - Băm mật khẩu bằng scrypt (built-in) + salt ngẫu nhiên.
 *  - Token phiên đăng nhập dạng stateless, ký HMAC-SHA256 (không cần lưu server).
 *  - Secret đọc từ env AUTH_SECRET, nếu không có thì sinh & lưu vào data/.authsecret.
 */

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

function loadSecret(dataDir) {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const f = path.join(dataDir, '.authsecret');
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch (e) {
    const s = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(f, s, { mode: 0o600 }); } catch (e2) { /* vẫn dùng được trong RAM */ }
    return s;
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class Auth {
  constructor(dataDir) {
    this.secret = loadSecret(dataDir);
  }

  // ---- mật khẩu ----
  hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, 32);
    return salt.toString('hex') + ':' + hash.toString('hex');
  }

  verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
    const [saltHex, hashHex] = stored.split(':');
    try {
      const salt = Buffer.from(saltHex, 'hex');
      const expected = Buffer.from(hashHex, 'hex');
      const actual = crypto.scryptSync(String(password), salt, expected.length);
      return crypto.timingSafeEqual(expected, actual);
    } catch (e) { return false; }
  }

  // ---- token phiên đăng nhập ----
  sign(userId, nowMs) {
    const exp = nowMs + TOKEN_TTL_MS;
    const payload = b64url(userId + '.' + exp);
    const sig = b64url(crypto.createHmac('sha256', this.secret).update(payload).digest());
    return payload + '.' + sig;
  }

  /** Trả về userId nếu token hợp lệ & chưa hết hạn, ngược lại null. */
  verify(token, nowMs) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const good = b64url(crypto.createHmac('sha256', this.secret).update(payload).digest());
    if (sig.length !== good.length) return null;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    } catch (e) { return null; }
    let decoded;
    try { decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
    catch (e) { return null; }
    const i = decoded.lastIndexOf('.');
    if (i < 0) return null;
    const userId = decoded.slice(0, i);
    const exp = Number(decoded.slice(i + 1));
    if (!userId || !exp || nowMs > exp) return null;
    return userId;
  }
}

module.exports = { Auth, TOKEN_TTL_MS };
