// ============================================================
// CẤU HÌNH XÁC THỰC — CHỈNH SỬA FILE NÀY ĐỂ THÊM/SỬA TÀI KHOẢN
// KHÔNG đưa file này lên Git / chia sẻ công khai
// ============================================================

window.APP_AUTH = {
  // Danh sách tài khoản: { pass: "...", role: "admin"|"dtv", name: "..." }
  users: {
    "nldanh":  { pass: "123", role: "nldanh",  name: "nldanh"  },
    "tqson":   { pass: "123", role: "tqson",   name: "tqson"   },
    "vtynhi":  { pass: "123", role: "vtynhi",  name: "vtynhi"  },
    "lkhoan":  { pass: "123", role: "lkhoan",  name: "lkhoan"  },
    "nhhanh":  { pass: "123", role: "nhhanh",  name: "nhhanh"  },
  },

  // URL Google Apps Script — thay bằng URL deploy của bạn
  apiUrl: "https://script.google.com/macros/s/AKfycbzLuQkgOe541D1HpS8CImWcDwG26kJ2_EqqeXwxGDA5X3z8Cdxdy77sw8rCwI3x3vXI/exec",
};
