window.APP_AUTH = {
  users: {
    "nldanh":  { pass: "123", role: "nldanh",  name: "nldanh"  },
    "tqson":   { pass: "123", role: "tqson",   name: "tqson"   },
    "vtynhi":  { pass: "123", role: "vtynhi",  name: "vtynhi"  },
    "lkhoan":  { pass: "123", role: "lkhoan",  name: "lkhoan"  },
    "nhhanh":  { pass: "123", role: "nhhanh",  name: "nhhanh"  },
  },

  // URL Google Apps Script — thay bằng URL deploy của bạn
  apiUrl: "https://script.google.com/macros/s/AKfycbwgqi-N-LzK0uUu6r7HngAMVRSblJ-qAoFp6PDHyLVN4-bwRuZLRfhZkuOAs5bfIpKN/exec",
};

// ── Cấu hình Google Form Bước 2 ─────────────────────────────
// Sau khi tạo Google Form, điền 2 thông tin bên dưới:
window.APP_FORM = {

  // 1. URL Google Form (bỏ ?usp=... ở cuối nếu có)
  //    Ví dụ: "https://docs.google.com/forms/d/e/1FAIpQLSe.../viewform"
  baseUrl: "https://docs.google.com/forms/d/e/1FAIpQLSfzzM-ORkD_Q9nAB4At09Rq5DTmpkqJF0REjz7HescAo6_fag/viewform",

  // 2. Entry ID của câu hỏi "Mã phiếu" trong form
  //    Cách lấy: Mở form → xem trước → nhập thử vào ô Mã phiếu → Next
  //              Copy URL → tìm đoạn "entry.XXXXXXXX=..."
  //    Ví dụ: "entry.1234567890"
  maPhieuEntryId: "entry.1025507863",

};
