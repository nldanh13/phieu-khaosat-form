// ============================================================
// CẤU HÌNH XÁC THỰC — CHỈNH SỬA FILE NÀY ĐỂ THÊM/SỬA TÀI KHOẢN
// KHÔNG đưa file này lên Git / chia sẻ công khai
// ============================================================

window.APP_AUTH = {
  // Danh sách tài khoản: { pass: "...", role: "admin"|"dtv", name: "..." }
  users: {
    "admin": { pass: "admin123", role: "admin", name: "Admin" },
    "dtv1":  { pass: "dtv123",   role: "dtv",   name: "Điều tra viên 1" },
    "dtv2":  { pass: "dtv123",   role: "dtv",   name: "Điều tra viên 2" },
  },

  // URL Google Apps Script — thay bằng URL deploy của bạn
  apiUrl: "https://script.google.com/macros/s/AKfycbzLuQkgOe541D1HpS8CImWcDwG26kJ2_EqqeXwxGDA5X3z8Cdxdy77sw8rCwI3x3vXI/exec",
};
