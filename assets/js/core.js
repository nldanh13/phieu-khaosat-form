// ── Config ──────────────────────────────────────────────────────────────────
    // API Google Apps Script
    const API_URL = "https://script.google.com/macros/s/AKfycbzLuQkgOe541D1HpS8CImWcDwG26kJ2_EqqeXwxGDA5X3z8Cdxdy77sw8rCwI3x3vXI/exec";

    function buildApiUrl(action = "", params = {}) {
      const url = new URL(API_URL);
      if (action) url.searchParams.set("action", action);
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, value);
        }
      });
      return url.toString();
    }

    async function apiGet(action = "", params = {}) {
      const res = await fetch(buildApiUrl(action, params));
      let data = null;
      try {
        data = await res.json();
      } catch {
        throw new Error("API trả về dữ liệu không hợp lệ");
      }
      if (!res.ok) throw new Error(data?.error || ("Lỗi " + res.status));
      return data;
    }

    async function apiPost(payload) {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        throw new Error("API trả về dữ liệu không hợp lệ");
      }
      if (!res.ok || !data?.success) throw new Error(data?.error || ("Lỗi " + res.status));
      return data;
    }

    // Demo users (trong thực tế nên dùng backend auth)
    const USERS = {
      "admin": { pass: "admin123", role: "admin", name: "Admin" },
      "dtv1": { pass: "dtv123", role: "dtv", name: "Điều tra viên 1" },
      "dtv2": { pass: "dtv123", role: "dtv", name: "Điều tra viên 2" },
    };

    let currentUser = null;
    let currentStep = 1;
    let currentMaPhieu = null;
    let danhSachCache = [];

    // ── Auth ─────────────────────────────────────────────────────────────────────
    function doLogin() {
      const u = document.getElementById("inp-user").value.trim();
      const p = document.getElementById("inp-pass").value;
      const el = document.getElementById("login-alert");
      if (!USERS[u] || USERS[u].pass !== p) {
        el.textContent = "Sai tên đăng nhập hoặc mật khẩu.";
        el.classList.remove("hidden");
        return;
      }
      currentUser = { username: u, ...USERS[u] };
      el.classList.add("hidden");
      showScreen("dash");
      loadDanhSach();
    }

    function showScreen(name) {
      document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
      document.getElementById("screen-" + name).classList.add("active");
      document.getElementById("btn-dash").style.display = (name !== "dash") ? "inline-block" : "none";
      document.getElementById("btn-new-top").style.display = (name === "dash") ? "inline-block" : "none";
      if (name === "new") {
        currentMaPhieu = genMaPhieu();
        currentStep = 1;
        buildStep1(); buildStep2(); buildStep3();
        showStep(1);
      }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────
    function genMaPhieu() {
      return "PK" + Date.now().toString(36).toUpperCase().slice(-6);
    }
    function showLoading(v) {
      document.getElementById("loading").classList.toggle("show", v);
    }
    function showAlert(id, msg, type) {
      const el = document.getElementById(id);
      el.textContent = msg;
      el.className = "alert alert-" + type;
    }
    function hideAlert(id) {
      document.getElementById(id).className = "alert hidden";
    }

    // ── Dashboard ─────────────────────────────────────────────────────────────────
    async function loadDanhSach() {
      showAlert("dash-alert", "Đang tải dữ liệu từ Google Sheets...", "info");
      try {
        danhSachCache = await apiGet("danh-sach");
        renderDashboard(danhSachCache);
        hideAlert("dash-alert");
      } catch (e) {
        showAlert("dash-alert", "Không kết nối được API. Kiểm tra URL hoặc thử lại. (" + e.message + ")", "error");
      }
    }

    function renderDashboard(list) {
      document.getElementById("s-total").textContent = list.length;
      document.getElementById("s-b1").textContent = list.filter(p => !p.buoc || p.buoc <= 1).length;
      document.getElementById("s-b2").textContent = list.filter(p => p.buoc === 2).length;
      document.getElementById("s-done").textContent = list.filter(p => p.buoc >= 3).length;
      const el = document.getElementById("phieu-list");
      if (!list.length) { el.innerHTML = '<div class="empty">Chưa có phiếu nào.</div>'; return; }
      el.innerHTML = list.slice().reverse().map(p =>
        `<div class="phieu-item">
      <div class="phieu-name">${p.ho_ten || "(Chưa có tên)"}</div>
      <div class="phieu-meta">
        <span class="badge badge-gray">${p.ma_phieu}</span>
        <span class="badge badge-blue">${p.ngay_thu_thap || ""}</span>
        ${p.gioi_tinh ? `<span class="badge badge-gray">${p.gioi_tinh}</span>` : ""}
        ${p.loai_pt ? `<span class="badge badge-amber">${p.loai_pt}</span>` : ""}
      </div>
    </div>`
      ).join("");
    }

    // ── Form Steps ────────────────────────────────────────────────────────────────
    function showStep(n) {
      currentStep = n;
      ["step1", "step2", "step3"].forEach((id, i) => {
        document.getElementById(id).style.display = (i + 1 === n) ? "block" : "none";
      });
      ["tab1", "tab2", "tab3"].forEach((id, i) => {
        document.getElementById(id).className = "step-item" + (i + 1 === n ? " active" : i + 1 < n ? " done" : "");
      });
      document.getElementById("btn-prev").style.display = n > 1 ? "inline-block" : "none";
      document.getElementById("btn-next").style.display = n < 3 ? "inline-block" : "none";
      document.getElementById("btn-finish").style.display = n === 3 ? "inline-block" : "none";
      document.getElementById("footer-info").textContent = `Bước ${n}/3 — Mã phiếu: ${currentMaPhieu}`;
    }

    async function nextStep() {
      if (await saveCurrentStep()) showStep(currentStep + 1);
    }
    function prevStep() { showStep(currentStep - 1); }
    async function finishForm() {
      if (await saveCurrentStep()) {
        showAlert("form-alert", `Phiếu ${currentMaPhieu} đã lưu hoàn thành!`, "success");
        setTimeout(() => { showScreen("dash"); loadDanhSach(); }, 1500);
      }
    }

    async function saveCurrentStep() {
      showLoading(true);
      try {
        const data = collectStep(currentStep);
        data.ma_phieu = currentMaPhieu;
        data.buoc = currentStep;
        data.dieu_tra_vien = currentUser?.name || "";
        await apiPost(data);
        showLoading(false);
        return true;
      } catch (e) {
        showLoading(false);
        showAlert("form-alert", "Lỗi lưu dữ liệu: " + e.message, "error");
        return false;
      }
    }

    function collectStep(n) {
      const get = id => { const el = document.getElementById(id); return el ? el.value : ""; };
      const getInt = id => { const el = document.getElementById(id); return el ? parseInt(el.value) || 0 : 0; };
      const getFloat = id => { const el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; };
      const radio = name => { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? parseInt(el.value) : ""; };

      if (n === 1) return {
        ho_ten: get("f_ten"), so_ho_so: get("f_hoSo"),
        ngay_sinh: get("f_ngaySinh"), gioi_tinh: get("f_gioi"),
        nghe_nghiep: get("f_ngheNghiep"), dia_chi: get("f_diaChi"),
        hoc_van: get("f_hocVan"), dan_toc: get("f_danToc"),
        ngay_nhap_vien: get("f_ngayNhapVien"), ngay_pt_du_kien: get("f_ngayPT"),
        can_nang: get("f_canNang"), chieu_cao: get("f_chieuCao"),
        chan_doan: get("f_chanDoan"), loai_pt: get("f_loaiPT"),
        vung_pt: get("f_vungPT"), pp_pt: get("f_ppPT"), vo_cam: get("f_voCam"),
        vas_nhap_vien: getInt("f_vasNhap"),
      };

      if (n === 2) {
        const d = {};
        for (let i = 1; i <= 14; i++) d[`hads_${i}`] = radio(`hads_${i}`);
        d.psqi1 = get("f_psqi1"); d.psqi3 = get("f_psqi3");
        d.psqi2 = getFloat("f_psqi2"); d.psqi4 = getFloat("f_psqi4");
        d.psqi5a = radio("psqi5a_r") !== "" ? radio("psqi5a_r") : getInt("f_psqi5a");
        d.psqi6 = getInt("f_psqi6"); d.psqi7 = getInt("f_psqi7");
        d.psqi8 = getInt("f_psqi8"); d.psqi9 = getInt("f_psqi9");
        for (let i = 0; i < 9; i++) d[`psqi_5_${i}`] = radio(`psqi_5_${i}`);
        return d;
      }

      if (n === 3) return {
        ngay_pt_thuc: get("f_ngayPTthuc"), tg_pt: get("f_tgPT"),
        pp_pt_thuc: get("f_ppPTthuc"), vo_cam_thuc: get("f_voCamThuc"),
        mat_mau: get("f_matMau"), truyen_mau: get("f_truyenMau"),
        vas1: getInt("f_vas1"), vas2: getInt("f_vas2"), vas3: getInt("f_vas3"),
        van_dong: get("f_vanDong"), kha_nang_vd: get("f_khanangVD"),
        bien_chung: get("f_bienChung"), tg_nam_vien: get("f_tgNamVien"),
        hl_0: radio("hl_0"), hl_1: radio("hl_1"), hl_2: radio("hl_2"),
        hl_3: radio("hl_3"), hl_4: radio("hl_4"),
        nhan_xet: get("f_nhanXet"),
      };
    }

    // ── Build Steps HTML ──────────────────────────────────────────────────────────
    function buildStep1() {
      document.getElementById("step1").innerHTML = `
  <div class="card">
    <div class="card-title">A1. Thông tin hành chính</div>
    <div class="form-row"><div class="form-group"><label>Họ và tên bệnh nhân</label><input id="f_ten" placeholder="Nguyễn Văn A"></div><div class="form-group"><label>Số hồ sơ bệnh án</label><input id="f_hoSo" placeholder="HS-2024-001"></div></div>
    <div class="form-row"><div class="form-group"><label>Ngày sinh</label><input type="date" id="f_ngaySinh"></div><div class="form-group"><label>Giới tính</label><select id="f_gioi"><option value="">Chọn...</option><option>Nam</option><option>Nữ</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Nghề nghiệp</label><input id="f_ngheNghiep"></div><div class="form-group"><label>Địa chỉ (tỉnh/TP)</label><input id="f_diaChi"></div></div>
    <div class="form-row"><div class="form-group"><label>Trình độ học vấn</label><select id="f_hocVan"><option value="">Chọn...</option><option>&lt;THCS</option><option>THCS</option><option>THPT</option><option>CĐ/ĐH</option><option>Sau ĐH</option></select></div><div class="form-group"><label>Dân tộc</label><input id="f_danToc" placeholder="Kinh, Khác..."></div></div>
    <div class="form-row"><div class="form-group"><label>Ngày nhập viện</label><input type="date" id="f_ngayNhapVien"></div><div class="form-group"><label>Ngày phẫu thuật dự kiến</label><input type="date" id="f_ngayPT"></div></div>
  </div>
  <div class="card">
    <div class="card-title">A2. Nhân trắc</div>
    <div class="form-row"><div class="form-group"><label>Cân nặng (kg)</label><input type="number" id="f_canNang" placeholder="60" oninput="calcBMI()"></div><div class="form-group"><label>Chiều cao (cm)</label><input type="number" id="f_chieuCao" placeholder="165" oninput="calcBMI()"></div></div>
    <div id="bmi-display" style="font-size:12px;color:var(--text-muted);margin-top:4px;"></div>
  </div>
  <div class="card">
    <div class="card-title">A3. Thông tin phẫu thuật</div>
    <div class="form-row full"><div class="form-group"><label>Chẩn đoán tổn thương</label><textarea id="f_chanDoan" placeholder="Ghi đầy đủ chẩn đoán..."></textarea></div></div>
    <div class="form-row"><div class="form-group"><label>Loại phẫu thuật</label><select id="f_loaiPT"><option value="">Chọn...</option><option>Thay khớp</option><option>Kết hợp xương nội tủy/nẹp vít</option><option>Nội soi khớp</option><option>Tái tạo dây chằng</option><option>Sửa gân/giải phóng gân cơ</option><option>Phẫu thuật cột sống</option><option>Khác</option></select></div><div class="form-group"><label>Vùng phẫu thuật</label><select id="f_vungPT"><option value="">Chọn...</option><option>Chi trên</option><option>Chi dưới</option><option>Cột sống</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Phương pháp phẫu thuật</label><select id="f_ppPT"><option value="">Chọn...</option><option>Mổ hở truyền thống</option><option>Phẫu thuật ít xâm lấn/nội soi</option><option>Kết hợp</option></select></div><div class="form-group"><label>Phương pháp vô cảm</label><select id="f_voCam"><option value="">Chọn...</option><option>Gây mê toàn thân</option><option>Gây tê tủy sống</option><option>Gây tê ngoài màng cứng</option><option>Gây tê TK ngoại biên</option><option>Kết hợp</option></select></div></div>
  </div>
  <div class="card">
    <div class="card-title">A5. Đánh giá đau trước phẫu thuật (VAS)</div>
    <div class="vas-wrap"><span style="font-size:11px;color:var(--text-muted);min-width:70px;">Không đau (0)</span><input type="range" min="0" max="10" step="1" id="f_vasNhap" value="0" oninput="document.getElementById('vas_nhap_v').textContent=this.value"><span class="vas-num" id="vas_nhap_v">0</span><span style="font-size:11px;color:var(--text-muted);">Đau tối đa (10)</span></div>
    <div class="vas-labels"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span></div>
  </div>`;
    }

    function calcBMI() {
      const cn = parseFloat(document.getElementById("f_canNang")?.value);
      const cc = parseFloat(document.getElementById("f_chieuCao")?.value) / 100;
      const el = document.getElementById("bmi-display");
      if (cn > 0 && cc > 0) {
        const bmi = (cn / (cc * cc)).toFixed(1);
        let cat = bmi < 18.5 ? "Thiếu cân" : bmi < 23 ? "Bình thường" : bmi < 27.5 ? "Thừa cân" : "Béo phì";
        el.textContent = `BMI: ${bmi} kg/m² — ${cat} (theo WHO châu Á)`;
      } else { el.textContent = ""; }
    }

    const HADS_DATA = [
      { id: 1, t: "A", q: "Tôi cảm thấy căng thẳng hoặc bồn chồn:", opts: ["Không bao giờ (0)", "Đôi khi (1)", "Thường xuyên (2)", "Hầu hết lúc (3)"] },
      { id: 2, t: "D", q: "Tôi vẫn thưởng thức được những điều từng làm tôi thích thú:", opts: ["Vẫn như trước (0)", "Chỉ một ít (1)", "Không nhiều như trước (2)", "Chắc chắn không (3)"] },
      { id: 3, t: "A", q: "Tôi có cảm giác sợ hãi như thể có điều gì xấu sắp xảy ra:", opts: ["Hoàn toàn không (0)", "Một chút nhưng không lo (1)", "Đúng vậy và khá lo (2)", "Chắc chắn và rất nhiều (3)"] },
      { id: 4, t: "D", q: "Tôi có thể cười và nhìn thấy mặt vui của sự việc:", opts: ["Thường xuyên như trước (0)", "Thỉnh thoảng (1)", "Không nhiều lắm (2)", "Hoàn toàn không (3)"] },
      { id: 5, t: "A", q: "Đầu óc tôi căng thẳng với những mối lo:", opts: ["Thỉnh thoảng (0)", "Thỉnh thoảng nhưng không thường (1)", "Thường xuyên (2)", "Hầu hết lúc (3)"] },
      { id: 6, t: "D", q: "Tôi cảm thấy vui vẻ:", opts: ["Thường xuyên (0)", "Đôi khi (1)", "Không thường xuyên (2)", "Hoàn toàn không (3)"] },
      { id: 7, t: "A", q: "Tôi có thể ngồi thư giãn và thoải mái:", opts: ["Chắc chắn (0)", "Thường thì có (1)", "Không thường xuyên (2)", "Hoàn toàn không thể (3)"] },
      { id: 8, t: "D", q: "Tôi cảm thấy như mình đang chậm lại:", opts: ["Hoàn toàn không (0)", "Đôi khi (1)", "Thường xuyên (2)", "Hầu hết lúc (3)"] },
      { id: 9, t: "A", q: "Tôi có cảm giác lo lắng / sợ hãi:", opts: ["Hoàn toàn không (0)", "Đôi khi (1)", "Thường xuyên (2)", "Rất thường xuyên (3)"] },
      { id: 10, t: "D", q: "Tôi không còn quan tâm đến bề ngoài của mình:", opts: ["Vẫn như trước (0)", "Ít quan tâm hơn (1)", "Không để tâm nhiều (2)", "Hoàn toàn không (3)"] },
      { id: 11, t: "A", q: "Tôi cảm thấy bồn chồn như thể phải đứng dậy và vận động:", opts: ["Hoàn toàn không (0)", "Không nhiều (1)", "Khá nhiều (2)", "Thực sự rất nhiều (3)"] },
      { id: 12, t: "D", q: "Tôi mong chờ những điều thú vị sắp xảy ra:", opts: ["Như tôi thường làm (0)", "Ít hơn trước (1)", "Chắc chắn ít hơn (2)", "Hầu như không bao giờ (3)"] },
      { id: 13, t: "A", q: "Tôi đột nhiên có cảm giác hoảng loạn:", opts: ["Hoàn toàn không (0)", "Không thường xuyên (1)", "Thường xuyên (2)", "Rất thường xuyên (3)"] },
      { id: 14, t: "D", q: "Tôi tìm thấy niềm vui trong cuốn sách hay hoặc chương trình TV:", opts: ["Thường xuyên (0)", "Đôi khi (1)", "Không thường xuyên (2)", "Hiếm khi (3)"] },
    ];

    function buildStep2() {
      const rows = HADS_DATA.map(h => `
    <tr>
      <td style="width:32px;text-align:center;vertical-align:middle;">
        <span class="hads-badge badge-${h.t}">${h.t}</span><br>
        <span style="font-size:10px;color:var(--text-muted)">${h.id}</span>
      </td>
      <td style="font-size:12px;line-height:1.5;">${h.q}</td>
      <td>
        <div class="opt-list">
          ${h.opts.map((o, vi) => `<label><input type="radio" name="hads_${h.id}" value="${vi}" onchange="calcHADS()"> ${o}</label>`).join("")}
        </div>
      </td>
    </tr>`).join("");

      const psqi5rows = ["5b. Thức giấc giữa đêm", "5c. Phải dậy đi vệ sinh", "5d. Không thở thoải mái", "5e. Ho hoặc ngáy to", "5f. Cảm thấy quá lạnh", "5g. Cảm thấy quá nóng", "5h. Có ác mộng", "5i. Bị đau nhức", "5j. Lý do khác"].map((q, i) =>
        `<tr><td style="font-size:12px">${q}</td>${[0, 1, 2, 3].map(v => `<td><input type="radio" name="psqi_5_${i}" value="${v}" onchange="calcPSQI()"></td>`).join("")}</tr>`
      ).join("");

      document.getElementById("step2").innerHTML = `
  <div class="card">
    <div class="card-title">B1. Thang HADS — 14 câu (tuần vừa qua)</div>
    <div style="overflow-x:auto;">
    <table class="hads-table">
      <thead><tr><th></th><th>Câu hỏi</th><th>Mức độ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="score-row" id="hads-score">
      <div class="score-cell"><div class="score-val" id="h-a">—</div><div class="score-lbl">HADS-A (lo âu)</div></div>
      <div class="score-cell"><div class="score-val" id="h-d">—</div><div class="score-lbl">HADS-D (trầm cảm)</div></div>
      <div class="score-cell"><div class="score-val" id="h-ai" style="font-size:13px"></div><div class="score-lbl">Phân loại A</div></div>
      <div class="score-cell"><div class="score-val" id="h-di" style="font-size:13px"></div><div class="score-lbl">Phân loại D</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">B2. Chỉ số PSQI — Chất lượng giấc ngủ</div>
    <div class="form-row"><div class="form-group"><label>Giờ đi ngủ (PSQI-1)</label><input type="time" id="f_psqi1" value="22:00" onchange="calcPSQI()"></div><div class="form-group"><label>Giờ thức dậy (PSQI-3)</label><input type="time" id="f_psqi3" value="06:00" onchange="calcPSQI()"></div></div>
    <div class="form-row"><div class="form-group"><label>Mất bao lâu để ngủ được (phút) — PSQI-2</label><input type="number" id="f_psqi2" placeholder="30" min="0" max="120" onchange="calcPSQI()"></div><div class="form-group"><label>Ngủ thực sự bao nhiêu giờ/đêm — PSQI-4</label><input type="number" id="f_psqi4" placeholder="6.5" step="0.5" min="0" max="12" onchange="calcPSQI()"></div></div>
    <div class="form-row"><div class="form-group"><label>Chất lượng giấc ngủ tổng thể — PSQI-6</label><select id="f_psqi6" onchange="calcPSQI()"><option value="0">Rất tốt (0)</option><option value="1">Tương đối tốt (1)</option><option value="2">Tương đối kém (2)</option><option value="3">Rất kém (3)</option></select></div><div class="form-group"><label>PSQI-5a: Mất &gt;30 phút để ngủ — số lần/tuần</label><select id="f_psqi5a" onchange="calcPSQI()"><option value="0">Không lần nào (0)</option><option value="1">&lt;1 lần/tuần (1)</option><option value="2">1–2 lần/tuần (2)</option><option value="3">≥3 lần/tuần (3)</option></select></div></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:10px 0 6px">PSQI-5b đến 5j: Trong tháng qua gặp vấn đề này bao nhiêu lần?</div>
    <div style="overflow-x:auto;"><table class="psqi-tbl"><thead><tr><th style="text-align:left">Vấn đề</th><th>Không (0)</th><th>&lt;1/tuần (1)</th><th>1–2/tuần (2)</th><th>≥3/tuần (3)</th></tr></thead><tbody>${psqi5rows}</tbody></table></div>
    <div class="form-row" style="margin-top:10px"><div class="form-group"><label>Dùng thuốc ngủ/tuần — PSQI-7</label><select id="f_psqi7" onchange="calcPSQI()"><option value="0">Không (0)</option><option value="1">&lt;1/tuần (1)</option><option value="2">1–2/tuần (2)</option><option value="3">≥3/tuần (3)</option></select></div><div class="form-group"><label>Khó giữ tỉnh táo ban ngày — PSQI-8</label><select id="f_psqi8" onchange="calcPSQI()"><option value="0">Không (0)</option><option value="1">&lt;1/tuần (1)</option><option value="2">1–2/tuần (2)</option><option value="3">≥3/tuần (3)</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Ảnh hưởng sinh hoạt hàng ngày — PSQI-9</label><select id="f_psqi9" onchange="calcPSQI()"><option value="0">Không ảnh hưởng (0)</option><option value="1">Ảnh hưởng nhẹ (1)</option><option value="2">Ảnh hưởng vừa (2)</option><option value="3">Ảnh hưởng nhiều (3)</option></select></div></div>
    <div class="score-row" id="psqi-score">
      <div class="score-cell"><div class="score-val" id="psqi-total">—</div><div class="score-lbl">Tổng PSQI (/21)</div></div>
      <div class="score-cell"><div class="score-val" id="psqi-interp" style="font-size:13px"></div><div class="score-lbl">Phân loại</div></div>
    </div>
  </div>`;
    }

    function buildStep3() {
      const hlRows = ["Kiểm soát đau sau PT", "Chăm sóc điều dưỡng", "Thông tin trước/sau mổ", "Khả năng vận động sau mổ", "Kết quả phẫu thuật tổng thể"]
        .map((q, i) => `<tr><td style="font-size:12px">${q}</td>${[1, 2, 3, 4, 5].map(v => `<td><input type="radio" name="hl_${i}" value="${v}"></td>`).join("")}</tr>`)
        .join("");
      document.getElementById("step3").innerHTML = `
  <div class="card">
    <div class="card-title">C1. Thông tin phẫu thuật thực tế</div>
    <div class="form-row"><div class="form-group"><label>Ngày phẫu thuật thực tế</label><input type="date" id="f_ngayPTthuc"></div><div class="form-group"><label>Thời gian phẫu thuật (phút)</label><input type="number" id="f_tgPT" placeholder="90"></div></div>
    <div class="form-row"><div class="form-group"><label>Phương pháp PT thực tế</label><input id="f_ppPTthuc"></div><div class="form-group"><label>Phương pháp vô cảm thực tế</label><input id="f_voCamThuc"></div></div>
    <div class="form-row"><div class="form-group"><label>Mất máu ước tính (mL)</label><input type="number" id="f_matMau" placeholder="200"></div><div class="form-group"><label>Truyền máu</label><select id="f_truyenMau"><option value="Không">Không</option><option value="Có">Có</option></select></div></div>
  </div>
  <div class="card">
    <div class="card-title">C2. Đau sau phẫu thuật (VAS ngày 1–3)</div>
    ${[1, 2, 3].map(d => `
    <div style="margin-bottom:12px"><label style="font-size:12px;color:var(--text-muted)">Ngày ${d} sau mổ</label>
    <div class="vas-wrap"><span style="font-size:11px;color:var(--text-muted);min-width:18px;">0</span><input type="range" min="0" max="10" step="1" id="f_vas${d}" value="0" oninput="document.getElementById('vasv${d}').textContent=this.value"><span class="vas-num" id="vasv${d}">0</span><span style="font-size:11px;color:var(--text-muted);">10</span></div></div>`).join("")}
  </div>
  <div class="card">
    <div class="card-title">C4. Vận động sớm & biến chứng</div>
    <div class="form-row"><div class="form-group"><label>Thời điểm vận động đầu tiên</label><select id="f_vanDong"><option value="">&lt;12h</option><option>12–24h</option><option>24–48h</option><option>&gt;48h</option><option>Chưa vận động được</option></select></div><div class="form-group"><label>Khả năng tự vận động ngày 1</label><select id="f_khanangVD"><option>Tốt</option><option>Trung bình</option><option>Kém</option><option>Không thể</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Biến chứng sau PT</label><select id="f_bienChung"><option>Không có</option><option>Chảy máu/tụ máu</option><option>Nhiễm trùng vết mổ</option><option>DVT</option><option>Thuyên tắc phổi</option><option>Đau khó kiểm soát</option><option>Khác</option></select></div><div class="form-group"><label>Thời gian nằm viện sau PT (ngày)</label><input type="number" id="f_tgNamVien" placeholder="3"></div></div>
  </div>
  <div class="card">
    <div class="card-title">C7. Mức độ hài lòng (Likert 1–5)</div>
    <div style="overflow-x:auto;"><table class="psqi-tbl"><thead><tr><th style="text-align:left">Tiêu chí</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>${hlRows}</tbody></table></div>
    <div class="form-row full" style="margin-top:10px"><div class="form-group"><label>Nhận xét / góp ý của bệnh nhân</label><textarea id="f_nhanXet" placeholder="Ghi tự do..."></textarea></div></div>
  </div>`;
    }

    // ── Score calculations ────────────────────────────────────────────────────────
    function calcHADS() {
      let A = 0, D = 0, tA = 0, tD = 0;
      HADS_DATA.forEach(h => {
        const sel = document.querySelector(`input[name="hads_${h.id}"]:checked`);
        if (sel) { if (h.t === "A") { A += +sel.value; tA++; } else { D += +sel.value; tD++; } }
      });
      const aEl = document.getElementById("h-a"), dEl = document.getElementById("h-d");
      const aiEl = document.getElementById("h-ai"), diEl = document.getElementById("h-di");
      if (aEl) aEl.textContent = tA === 7 ? A : "—";
      if (dEl) dEl.textContent = tD === 7 ? D : "—";
      const interp = s => s >= 11 ? "Rối loạn" : s >= 8 ? "Nguy cơ" : "Bình thường";
      const clr = s => s >= 11 ? "var(--red)" : s >= 8 ? "var(--amber)" : "var(--green)";
      if (aiEl && tA === 7) { aiEl.textContent = interp(A); aiEl.style.color = clr(A); }
      if (diEl && tD === 7) { diEl.textContent = interp(D); diEl.style.color = clr(D); }
    }

    function calcPSQI() {
      const gi = id => parseInt(document.getElementById(id)?.value || 0) || 0;
      const gf = id => parseFloat(document.getElementById(id)?.value || 0) || 0;
      const C1 = gi("f_psqi6");
      const p2 = gf("f_psqi2"), p5a = gi("f_psqi5a");
      const c2r = p2 <= 15 ? 0 : p2 <= 30 ? 1 : p2 <= 60 ? 2 : 3;
      const C2 = Math.round((c2r + p5a) / 2);
      const p4 = gf("f_psqi4");
      const C3 = p4 > 7 ? 0 : p4 >= 6 ? 1 : p4 >= 5 ? 2 : 3;
      let C4 = 0;
      const t1 = (document.getElementById("f_psqi1")?.value || "").split(":");
      const t3 = (document.getElementById("f_psqi3")?.value || "").split(":");
      if (t1.length === 2 && t3.length === 2 && p4 > 0) {
        const bed = +t1[0] * 60 + +t1[1], wake = +t3[0] * 60 + +t3[1];
        const inBed = wake > bed ? wake - bed : wake + 1440 - bed;
        const eff = inBed > 0 ? p4 * 60 / inBed * 100 : 0;
        C4 = eff >= 85 ? 0 : eff >= 75 ? 1 : eff >= 65 ? 2 : 3;
      }
      let dist = 0; for (let i = 0; i < 9; i++) { const s = document.querySelector(`input[name="psqi_5_${i}"]:checked`); if (s) dist += +s.value; }
      const C5 = dist === 0 ? 0 : dist <= 9 ? 1 : dist <= 18 ? 2 : 3;
      const C6 = gi("f_psqi7");
      const C7 = Math.round((gi("f_psqi8") + gi("f_psqi9")) / 2);
      const total = C1 + C2 + C3 + C4 + C5 + C6 + C7;
      const tv = document.getElementById("psqi-total"), ti = document.getElementById("psqi-interp");
      if (tv) tv.textContent = total;
      if (ti) { ti.textContent = total >= 5 ? "Kém (≥5)" : "Tốt (<5)"; ti.style.color = total >= 5 ? "var(--red)" : "var(--green)"; }
    }
