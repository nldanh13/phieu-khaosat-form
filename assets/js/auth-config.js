// ============================================================
// CẤU HÌNH XÁC THỰC — CHỈNH SỬA FILE NÀY ĐỂ THÊM/SỬA TÀI KHOẢN
// KHÔNG đưa file này lên Git / chia sẻ công khai
// ============================================================

window.APP_AUTH = {
  // Danh sách tài khoản: { pass: "...", role: "admin"|"dtv", name: "..." }
  users: {
    "admin": { pass: "123", role: "nldanh", name: "Admin" },
    "dtv1":  { pass: "123",   role: "tqson",   name: "Điều tra viên 1" },
    "dtv2":  { pass: "123",   role: "vtyn",   name: "Điều tra viên 2" },
    "dtv3":  { pass: "123",   role: "lkhoan",   name: "Điều tra viên 3" },
    "dtv4":  { pass: "123",   role: "nhhanh",   name: "Điều tra viên 4" },
  },

  // URL Google Apps Script — thay bằng URL deploy của bạn
  apiUrl: "https://script.google.com/macros/s/AKfycbzLuQkgOe541D1HpS8CImWcDwG26kJ2_EqqeXwxGDA5X3z8Cdxdy77sw8rCwI3x3vXI/exec",
};
