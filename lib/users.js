'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Kho người dùng dạng file JSON đơn giản (data/users.json).
 * Cấu trúc: { users: { [id]: {id, username, passHash, createdAt} },
 *             names: { [usernameLower]: id } }
 * Quy mô nhỏ nên đọc/ghi toàn bộ file mỗi lần thay đổi là đủ.
 */
class UserStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'users.json');
    this._load();
  }

  _load() {
    try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { this.db = { users: {}, names: {} }; }
    if (!this.db.users) this.db.users = {};
    if (!this.db.names) this.db.names = {};
  }

  _save() {
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  static normName(name) {
    return String(name || '').trim().toLowerCase();
  }

  findByName(name) {
    const id = this.db.names[UserStore.normName(name)];
    return id ? this.db.users[id] : null;
  }

  getById(id) {
    return this.db.users[id] || null;
  }

  /** Tạo user mới. Ném lỗi nếu tên đã tồn tại. */
  create(username, passHash) {
    const norm = UserStore.normName(username);
    if (this.db.names[norm]) throw new Error('exists');
    const id = 'u' + crypto.randomBytes(9).toString('hex');
    const user = { id, username: String(username).trim(), passHash, createdAt: Date.now() };
    this.db.users[id] = user;
    this.db.names[norm] = id;
    this._save();
    return user;
  }
}

module.exports = { UserStore };
