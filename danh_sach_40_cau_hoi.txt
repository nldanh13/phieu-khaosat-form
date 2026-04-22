window.HADS_DATA = [
  {
    id: 1, t: "A",
    q: "Tôi cảm thấy căng thẳng hoặc bồn chồn:",
    opts: ["Không bao giờ (0)", "Đôi khi (1)", "Thường xuyên (2)", "Hầu hết lúc (3)"]
  },
  {
    id: 2, t: "D",
    q: "Tôi vẫn thưởng thức được những điều từng làm tôi thích thú:",
    opts: ["Vẫn như trước (0)", "Chỉ một ít (1)", "Không nhiều như trước (2)", "Chắc chắn không (3)"]
  },
  {
    id: 3, t: "A",
    q: "Tôi có cảm giác sợ hãi như thể có điều gì xấu sắp xảy ra:",
    opts: ["Hoàn toàn không (0)", "Một chút nhưng không lo (1)", "Đúng vậy và khá lo (2)", "Chắc chắn và rất nhiều (3)"]
  },
  {
    id: 4, t: "D",
    q: "Tôi có thể cười và nhìn thấy mặt vui của sự việc:",
    opts: ["Thường xuyên như trước (0)", "Thỉnh thoảng (1)", "Không nhiều lắm (2)", "Hoàn toàn không (3)"]
  },
  {
    id: 5, t: "A",
    q: "Đầu óc tôi căng thẳng với những mối lo:",
    opts: ["Thỉnh thoảng (0)", "Thỉnh thoảng nhưng không thường (1)", "Thường xuyên (2)", "Hầu hết lúc (3)"]
  },
  {
    id: 6, t: "D",
    q: "Tôi cảm thấy vui vẻ:",
    opts: ["Thường xuyên (0)", "Đôi khi (1)", "Không thường xuyên (2)", "Hoàn toàn không (3)"]
  },
  {
    id: 7, t: "A",
    q: "Tôi có thể ngồi thư giãn và thoải mái:",
    opts: ["Chắc chắn (0)", "Thường thì có (1)", "Không thường xuyên (2)", "Hoàn toàn không thể (3)"]
  },
  {
    id: 8, t: "D",
    q: "Tôi cảm thấy như mình đang chậm lại:",
    opts: ["Hoàn toàn không (0)", "Đôi khi (1)", "Thường xuyên (2)", "Hầu hết lúc (3)"]
  },
  {
    id: 9, t: "A",
    q: "Tôi có cảm giác lo lắng / sợ hãi:",
    opts: ["Hoàn toàn không (0)", "Đôi khi (1)", "Thường xuyên (2)", "Rất thường xuyên (3)"]
  },
  {
    id: 10, t: "D",
    q: "Tôi không còn quan tâm đến bề ngoài của mình:",
    opts: ["Vẫn như trước (0)", "Ít quan tâm hơn (1)", "Không để tâm nhiều (2)", "Hoàn toàn không (3)"]
  },
  {
    id: 11, t: "A",
    q: "Tôi cảm thấy bồn chồn như thể phải đứng dậy và vận động:",
    opts: ["Hoàn toàn không (0)", "Không nhiều (1)", "Khá nhiều (2)", "Thực sự rất nhiều (3)"]
  },
  {
    id: 12, t: "D",
    q: "Tôi mong chờ những điều thú vị sắp xảy ra:",
    opts: ["Như tôi thường làm (0)", "Ít hơn trước (1)", "Chắc chắn ít hơn (2)", "Hầu như không bao giờ (3)"]
  },
  {
    id: 13, t: "A",
    q: "Tôi đột nhiên có cảm giác hoảng loạn:",
    opts: ["Hoàn toàn không (0)", "Không thường xuyên (1)", "Thường xuyên (2)", "Rất thường xuyên (3)"]
  },
  {
    id: 14, t: "D",
    q: "Tôi tìm thấy niềm vui trong cuốn sách hay hoặc chương trình TV:",
    opts: ["Thường xuyên (0)", "Đôi khi (1)", "Không thường xuyên (2)", "Hiếm khi (3)"]
  },
];

// ── PSQI câu 5b–5j — vấn đề giấc ngủ ───────────────────────
// Mỗi câu dùng thang: Không (0) / <1/tuần (1) / 1–2/tuần (2) / ≥3/tuần (3)
window.PSQI5_ITEMS = [
  "5b. Thức giấc giữa đêm hoặc thức dậy quá sớm",
  "5c. Phải dậy đi vệ sinh",
  "5d. Không thở thoải mái",
  "5e. Ho hoặc ngáy to",
  "5f. Cảm thấy quá lạnh",
  "5g. Cảm thấy quá nóng",
  "5h. Có ác mộng",
  "5i. Bị đau nhức",
  "5j. Lý do khác",
];

// ── Hài lòng sau phẫu thuật — Likert 1–5 ───────────────────
window.HL_ITEMS = [
  "Kiểm soát đau sau phẫu thuật",
  "Chăm sóc của điều dưỡng",
  "Thông tin được cung cấp trước và sau mổ",
  "Khả năng vận động sau mổ",
  "Kết quả phẫu thuật tổng thể",
];

// ── AIS-5 (Athens Insomnia Scale — 5 items) ──────────────────
// Thang điểm 0–3 mỗi câu; tổng 0–15; >4 = rối loạn giấc ngủ
window.AIS5_ITEMS = [
  {
    id: 1,
    label: "Khởi phát giấc ngủ",
    desc: "Thời gian để ngủ sau khi tắt đèn",
    opts: ["Không vấn đề (0)", "Chậm nhẹ (1)", "Chậm rõ (2)", "Rất chậm / không ngủ (3)"]
  },
  {
    id: 2,
    label: "Thức giấc giữa đêm",
    desc: "Tỉnh giấc nhiều lần trong đêm",
    opts: ["Không vấn đề (0)", "Nhẹ (1)", "Đáng kể (2)", "Nghiêm trọng / không ngủ (3)"]
  },
  {
    id: 3,
    label: "Thức dậy sớm",
    desc: "Dậy sớm hơn mong muốn",
    opts: ["Không (0)", "Hơi sớm (1)", "Sớm rõ (2)", "Rất sớm / không ngủ (3)"]
  },
  {
    id: 4,
    label: "Tổng thời gian ngủ",
    desc: "Cảm nhận về thời lượng ngủ",
    opts: ["Đủ (0)", "Hơi thiếu (1)", "Thiếu rõ (2)", "Rất thiếu / không ngủ (3)"]
  },
  {
    id: 5,
    label: "Chất lượng giấc ngủ",
    desc: "Độ sâu và sự thoải mái của giấc ngủ",
    opts: ["Tốt (0)", "Hơi kém (1)", "Kém (2)", "Rất kém / không ngủ (3)"]
  },
];

// ── Nguyên nhân lo âu trước phẫu thuật (multi-select) ────────
window.NGUYEN_NHAN_LO_AU = [
  "Không lo lắng",
  "Sợ đau sau mổ",
  "Sợ biến chứng hoặc tử vong",
  "Lo ngại kết quả phẫu thuật",
  "Lo về chi phí điều trị",
  "Lo về mất khả năng lao động",
  "Lý do gia đình – xã hội khác",
];

// ── Nguyên nhân rối loạn giấc ngủ (multi-select) ─────────────
window.NGUYEN_NHAN_RLGN = [
  "Đau vùng tổn thương",
  "Tiếng ồn bệnh viện",
  "Lo lắng về phẫu thuật",
  "Môi trường nằm viện không quen",
  "Triệu chứng khác (tiểu đêm, khó thở...)",
];
