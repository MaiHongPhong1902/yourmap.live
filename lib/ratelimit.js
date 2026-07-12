'use strict';

/**
 * Rate limiter cửa sổ trượt, trong bộ nhớ (không thêm dependency).
 * Đủ để chặn brute-force đăng nhập / spam trên một tiến trình đơn.
 *
 * Dùng:
 *   const limiter = new RateLimiter({ windowMs: 60000, max: 10 });
 *   if (!limiter.allow(ip)) -> 429
 *
 * Bộ nhớ được dọn định kỳ để không phình theo số IP đã thấy.
 */
class RateLimiter {
  constructor({ windowMs = 60000, max = 30 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map(); // key -> number[] (timestamps)
    // Dọn các key hết hạn mỗi windowMs; unref để không giữ tiến trình sống.
    this._timer = setInterval(() => this._sweep(Date.now()), windowMs);
    if (this._timer.unref) this._timer.unref();
  }

  /** Trả về true nếu request được phép, false nếu vượt ngưỡng. */
  allow(key, now = Date.now()) {
    if (!key) key = 'unknown';
    const cutoff = now - this.windowMs;
    let arr = this.hits.get(key);
    if (!arr) { arr = []; this.hits.set(key, arr); }
    // Bỏ các mốc thời gian đã ra khỏi cửa sổ.
    while (arr.length && arr[0] <= cutoff) arr.shift();
    if (arr.length >= this.max) return false;
    arr.push(now);
    return true;
  }

  _sweep(now) {
    const cutoff = now - this.windowMs;
    for (const [key, arr] of this.hits) {
      while (arr.length && arr[0] <= cutoff) arr.shift();
      if (arr.length === 0) this.hits.delete(key);
    }
  }

  stop() { clearInterval(this._timer); }
}

module.exports = { RateLimiter };
