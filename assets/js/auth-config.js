// ============================================================
// auth-config.js — CẤU HÌNH XÁC THỰC
//
// ⚠️  BẢO MẬT QUAN TRỌNG:
//   - KHÔNG đưa file này lên Git / chia sẻ công khai
//   - Thêm auth-config.js vào .gitignore ngay bây giờ
//   - Xác thực thực sự nên chuyển sang backend
//     (xem README_SECURITY.md để biết hướng dẫn)
//
// File này CHỈ là giải pháp tạm thời cho môi trường nội bộ
// không có backend. Bất kỳ ai mở DevTools đều đọc được.
// ============================================================

window.APP_AUTH = {
  users: {
    "admin":   { pass: "admin123", role: "admin",  name: "admin"   },
    "nldanh":  { pass: "123", role: "nldanh",  name: "nldanh"  },
    "tqson":   { pass: "123", role: "tqson",   name: "tqson"   },
    "vtynhi":  { pass: "123", role: "vtynhi",  name: "vtynhi"  },
    "lkhoan":  { pass: "123", role: "lkhoan",  name: "lkhoan"  },
    "nhhanh":  { pass: "123", role: "nhhanh",  name: "nhhanh"  },
  },

  // URL Google Apps Script — thay bằng URL deploy của bạn
  apiUrl: "https://script.google.com/macros/s/AKfycbwgqi-N-LzK0uUu6r7HngAMVRSblJ-qAoFp6PDHyLVN4-bwRuZLRfhZkuOAs5bfIpKN/exec",
};
