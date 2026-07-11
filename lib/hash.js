'use strict';

/**
 * cyrb53 — mirror NGUYÊN VĂN hàm _hash trong frontend
 * (Chia sẻ vị trí bản đồ.dc.html). Node có Math.imul sẵn nên phép toán
 * cho ra kết quả y hệt bản trình duyệt, dùng để xác thực owner token / mật khẩu.
 */
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

module.exports = { cyrb53 };
