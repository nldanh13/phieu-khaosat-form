const LOCAL_DRAFT_KEY = "phieu_local_drafts_v3";
    let currentHighestStep = 1;
    let currentRecordSource = "new";
    let dashboardFilter = "all";
    let dashboardQuery = "";
    let draftSaveTimer = null;

    const FIELD_ID_MAP = {
      ho_ten: "f_ten",
      so_ho_so: "f_hoSo",
      ngay_sinh: "f_ngaySinh",
      gioi_tinh: "f_gioi",
      nghe_nghiep: "f_ngheNghiep",
      dia_chi: "f_diaChi",
      hoc_van: "f_hocVan",
      dan_toc: "f_danToc",
      ngay_nhap_vien: "f_ngayNhapVien",
      ngay_pt_du_kien: "f_ngayPT",
      can_nang: "f_canNang",
      chieu_cao: "f_chieuCao",
      chan_doan: "f_chanDoan",
      loai_pt: "f_loaiPT",
      vung_pt: "f_vungPT",
      pp_pt: "f_ppPT",
      vo_cam: "f_voCam",
      vas_nhap_vien: "f_vasNhap",
      psqi1: "f_psqi1",
      psqi2: "f_psqi2",
      psqi3: "f_psqi3",
      psqi4: "f_psqi4",
      psqi5a: "f_psqi5a",
      psqi6: "f_psqi6",
      psqi7: "f_psqi7",
      psqi8: "f_psqi8",
      psqi9: "f_psqi9",
      ngay_pt_thuc: "f_ngayPTthuc",
      tg_pt: "f_tgPT",
      pp_pt_thuc: "f_ppPTthuc",
      vo_cam_thuc: "f_voCamThuc",
      mat_mau: "f_matMau",
      truyen_mau: "f_truyenMau",
      vas1: "f_vas1",
      vas2: "f_vas2",
      vas3: "f_vas3",
      van_dong: "f_vanDong",
      kha_nang_vd: "f_khanangVD",
      bien_chung: "f_bienChung",
      tg_nam_vien: "f_tgNamVien",
      nhan_xet: "f_nhanXet"
    };

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function parseJSONSafe(raw, fallback) {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : fallback;
      } catch {
        return fallback;
      }
    }

    function getLocalDraftMap() {
      return parseJSONSafe(localStorage.getItem(LOCAL_DRAFT_KEY), {});
    }

    function setLocalDraftMap(map) {
      localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(map));
    }

    function listLocalDrafts() {
      const map = getLocalDraftMap();
      return Object.values(map).sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    }

    function getLocalDraft(ma) {
      if (!ma) return null;
      return getLocalDraftMap()[ma] || null;
    }

    function upsertLocalDraft(record) {
      if (!record?.ma_phieu) return;
      const map = getLocalDraftMap();
      map[record.ma_phieu] = record;
      setLocalDraftMap(map);
    }

    function removeLocalDraft(ma) {
      const map = getLocalDraftMap();
      delete map[ma];
      setLocalDraftMap(map);
    }

    function hasRemoteRecord(ma) {
      return danhSachCache.some(item => item.ma_phieu === ma);
    }

    function formatWhen(value) {
      if (!value) return "";
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
      }
      return String(value);
    }

    function getMergedRecordByMa(ma) {
      const remote = danhSachCache.find(item => item.ma_phieu === ma) || null;
      const local = getLocalDraft(ma);
      const merged = {
        ...(remote || {}),
        ...((local && local.data) || {})
      };
      merged.ma_phieu = ma;
      merged.buoc = Math.max(Number(remote?.buoc || 0), Number(local?.buoc || 0), 1);
      merged.last_step = Number(local?.last_step || merged.buoc || 1);
      merged.updated_at = local?.updated_at || remote?.updated_at || remote?.ngay_thu_thap || "";
      merged.local_only = Boolean(local && !remote);
      merged.has_local = Boolean(local);
      merged.synced = Boolean(local?.synced);
      return merged;
    }

    function getManagedRecords() {
      const ids = new Set();
      danhSachCache.forEach(item => item?.ma_phieu && ids.add(item.ma_phieu));
      listLocalDrafts().forEach(item => item?.ma_phieu && ids.add(item.ma_phieu));
      return [...ids].map(getMergedRecordByMa).sort((a, b) => {
        const ta = new Date(a.updated_at || 0).getTime();
        const tb = new Date(b.updated_at || 0).getTime();
        return tb - ta;
      });
    }

    function getRecordStatus(record) {
      if (record.local_only) return { text: "Nháp trên máy", cls: "badge-purple" };
      if (record.has_local && !record.synced) return { text: "Chưa đồng bộ", cls: "badge-purple" };
      if ((record.buoc || 0) >= 3) return { text: "Hoàn thành", cls: "badge-green" };
      return { text: "Đang điền", cls: "badge-amber" };
    }

    function getStepLabel(record) {
      const step = Number(record?.buoc || 1);
      return step >= 3 ? "Đủ 3 bước" : `Đã lưu đến bước ${step}`;
    }

    function ensureFooterControls() {
      const group = document.querySelector(".form-footer .btn-group");
      if (!group || document.getElementById("btn-save-draft")) return;
      const btn = document.createElement("button");
      btn.className = "btn btn-sm";
      btn.id = "btn-save-draft";
      btn.type = "button";
      btn.textContent = "Lưu nháp";
      btn.onclick = () => saveLocalProgress(true);
      group.insertBefore(btn, group.firstChild);
    }

    function ensureModeBanner() {
      const formAlert = document.getElementById("form-alert");
      if (!formAlert) return null;
      let banner = document.getElementById("form-mode-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "form-mode-banner";
        banner.className = "mode-banner";
        formAlert.insertAdjacentElement("afterend", banner);
      }
      return banner;
    }

    function updateModeBanner(record) {
      const banner = ensureModeBanner();
      if (!banner) return;
      const status = record ? getRecordStatus(record) : { text: "Phiếu mới", cls: "badge-blue" };
      const sourceText = record?.local_only ? "Đang mở nháp lưu trên máy" : record?.ma_phieu ? "Có thể tiếp tục hoặc chỉnh sửa để cập nhật" : "Phiếu mới, có tự lưu nháp trên máy";
      banner.innerHTML = `<strong>${record?.ma_phieu ? "Phiếu " + escapeHtml(record.ma_phieu) : "Phiếu mới"}</strong> · <span class="badge ${status.cls}">${escapeHtml(status.text)}</span><span class="sub">${escapeHtml(sourceText)}${record?.updated_at ? " · cập nhật gần nhất: " + escapeHtml(formatWhen(record.updated_at)) : ""}</span>`;
    }

    function updateFooterStatus(text) {
      const info = document.getElementById("footer-info");
      if (!info) return;
      const base = `Bước ${currentStep}/3 — Mã phiếu: ${currentMaPhieu}`;
      info.innerHTML = `${escapeHtml(base)}<span class="footer-status"><span class="footer-status-dot"></span>${escapeHtml(text)}</span>`;
    }

    function updateRangeIndicators() {
      const vasNhap = document.getElementById("f_vasNhap");
      const vasNhapValue = document.getElementById("vas_nhap_v");
      if (vasNhap && vasNhapValue) vasNhapValue.textContent = vasNhap.value || "0";
      [1, 2, 3].forEach(num => {
        const input = document.getElementById(`f_vas${num}`);
        const label = document.getElementById(`vasv${num}`);
        if (input && label) label.textContent = input.value || "0";
      });
    }

    function applyFormData(data = {}) {
      Object.entries(FIELD_ID_MAP).forEach(([field, id]) => {
        const el = document.getElementById(id);
        if (!el || data[field] === undefined || data[field] === null || data[field] === "") return;
        el.value = data[field];
      });
      for (let i = 1; i <= 14; i++) {
        const value = data[`hads_${i}`];
        if (value === undefined || value === null || value === "") continue;
        const radio = document.querySelector(`input[name="hads_${i}"][value="${value}"]`);
        if (radio) radio.checked = true;
      }
      for (let i = 0; i < 9; i++) {
        const value = data[`psqi_5_${i}`];
        if (value === undefined || value === null || value === "") continue;
        const radio = document.querySelector(`input[name="psqi_5_${i}"][value="${value}"]`);
        if (radio) radio.checked = true;
      }
      for (let i = 0; i < 5; i++) {
        const value = data[`hl_${i}`];
        if (value === undefined || value === null || value === "") continue;
        const radio = document.querySelector(`input[name="hl_${i}"][value="${value}"]`);
        if (radio) radio.checked = true;
      }
      updateRangeIndicators();
      if (typeof calcBMI === "function") calcBMI();
      if (typeof calcHADS === "function") calcHADS();
      if (typeof calcPSQI === "function") calcPSQI();
    }

    function collectAllStepsData() {
      return {
        ...collectStep(1),
        ...collectStep(2),
        ...collectStep(3)
      };
    }

    function saveLocalProgress(showMessage = false) {
      if (!currentMaPhieu || !document.getElementById("screen-new")?.classList.contains("active")) return;
      const existing = getLocalDraft(currentMaPhieu) || {};
      const record = {
        ma_phieu: currentMaPhieu,
        buoc: Math.max(Number(existing.buoc || 0), Number(currentHighestStep || 0), Number(currentStep || 0), 1),
        last_step: Number(currentStep || 1),
        updated_at: new Date().toISOString(),
        local_only: !hasRemoteRecord(currentMaPhieu),
        synced: false,
        user: currentUser?.name || "",
        data: {
          ...existing.data,
          ...collectAllStepsData(),
          ma_phieu: currentMaPhieu
        }
      };
      upsertLocalDraft(record);
      updateFooterStatus(`Đã lưu nháp lúc ${formatWhen(record.updated_at)}`);
      if (showMessage) showAlert("form-alert", "Đã lưu nháp trên máy. Có thể mở lại để điền tiếp.", "success");
    }

    function markLocalSynced() {
      const existing = getLocalDraft(currentMaPhieu) || {};
      upsertLocalDraft({
        ...existing,
        ma_phieu: currentMaPhieu,
        buoc: Math.max(Number(existing.buoc || 0), Number(currentHighestStep || 0), Number(currentStep || 0), 1),
        last_step: Number(currentStep || 1),
        updated_at: new Date().toISOString(),
        local_only: false,
        synced: true,
        user: currentUser?.name || "",
        data: {
          ...(existing.data || {}),
          ...collectAllStepsData(),
          ma_phieu: currentMaPhieu
        }
      });
    }

    function bindAutosave() {
      const screen = document.getElementById("screen-new");
      if (!screen || screen.dataset.autosaveBound === "1") return;
      const handler = (event) => {
        if (!screen.classList.contains("active")) return;
        if (!event.target.closest("#screen-new")) return;
        clearTimeout(draftSaveTimer);
        draftSaveTimer = setTimeout(() => saveLocalProgress(false), 500);
      };
      screen.addEventListener("input", handler, true);
      screen.addEventListener("change", handler, true);
      screen.dataset.autosaveBound = "1";
    }

    function jumpToStep(step) {
      const safeStep = Math.max(1, Math.min(3, Number(step || 1)));
      showStep(safeStep);
    }

    function openRecordByMa(ma) {
      const record = getMergedRecordByMa(ma);
      showScreen("new", { record, step: record.last_step || Math.min(record.buoc || 1, 3), source: record.local_only ? "local" : "remote" });
    }

    function deleteLocalDraftOnly(ma) {
      if (!confirm(`Xóa nháp trên máy của phiếu ${ma}?`)) return;
      removeLocalDraft(ma);
      renderDashboard(danhSachCache);
    }

    async function loadDanhSach() {
      const drafts = listLocalDrafts();
      showAlert("dash-alert", drafts.length ? "Đang tải danh sách từ Google Sheets... Nếu mạng lỗi vẫn có thể mở các nháp trên máy." : "Đang tải dữ liệu từ Google Sheets...", "info");
      try {
        danhSachCache = await apiGet("danh-sach");
        renderDashboard(danhSachCache);
        hideAlert("dash-alert");
      } catch (e) {
        danhSachCache = Array.isArray(danhSachCache) ? danhSachCache : [];
        renderDashboard(danhSachCache);
        showAlert("dash-alert", "Không kết nối được API. Vẫn có thể tiếp tục các phiếu nháp đã lưu trên máy. (" + e.message + ")", "error");
      }
    }

    function renderDashboard() {
      const records = getManagedRecords();
      const normalizedQuery = dashboardQuery.trim().toLowerCase();
      const filtered = records.filter(record => {
        const hay = `${record.ma_phieu || ""} ${record.ho_ten || ""} ${record.so_ho_so || ""}`.toLowerCase();
        const status = getRecordStatus(record).text;
        const matchQuery = !normalizedQuery || hay.includes(normalizedQuery);
        const matchFilter = dashboardFilter === "all"
          || (dashboardFilter === "draft" && record.local_only)
          || (dashboardFilter === "progress" && !record.local_only && (record.buoc || 0) < 3)
          || (dashboardFilter === "done" && (record.buoc || 0) >= 3);
        return matchQuery && matchFilter && status;
      });

      document.getElementById("stat-grid").innerHTML = `
        <div class="stat-card"><div class="stat-num">${records.length}</div><div class="stat-lbl">Tổng phiếu quản lý</div></div>
        <div class="stat-card"><div class="stat-num">${records.filter(r => r.local_only).length}</div><div class="stat-lbl">Nháp trên máy</div></div>
        <div class="stat-card"><div class="stat-num">${records.filter(r => !r.local_only && (r.buoc || 0) < 3).length}</div><div class="stat-lbl">Đang điền</div></div>
        <div class="stat-card"><div class="stat-num">${records.filter(r => (r.buoc || 0) >= 3).length}</div><div class="stat-lbl">Hoàn thành</div></div>
      `;

      const listEl = document.getElementById("phieu-list");
      const cards = filtered.map(record => {
        const status = getRecordStatus(record);
        const actionText = (record.buoc || 0) >= 3 ? "Cập nhật" : "Tiếp tục";
        return `
          <div class="phieu-item">
            <div class="phieu-head">
              <div>
                <div class="phieu-name">${escapeHtml(record.ho_ten || "(Chưa có tên bệnh nhân)")}</div>
                <div class="phieu-sub">Mã phiếu: ${escapeHtml(record.ma_phieu || "")} · ${record.so_ho_so ? "HSBA: " + escapeHtml(record.so_ho_so) + " · " : ""}${record.updated_at ? "Cập nhật: " + escapeHtml(formatWhen(record.updated_at)) : "Chưa có thời gian cập nhật"}</div>
              </div>
              <div class="phieu-actions">
                <button class="btn btn-sm btn-primary" onclick="openRecordByMa('${escapeHtml(record.ma_phieu)}')">${actionText}</button>
                ${record.has_local ? `<button class="btn btn-sm" onclick="deleteLocalDraftOnly('${escapeHtml(record.ma_phieu)}')">Xóa nháp máy</button>` : ""}
              </div>
            </div>
            <div class="phieu-meta">
              <span class="badge ${status.cls}">${escapeHtml(status.text)}</span>
              <span class="badge badge-blue">${escapeHtml(getStepLabel(record))}</span>
              ${record.gioi_tinh ? `<span class="badge badge-gray">${escapeHtml(record.gioi_tinh)}</span>` : ""}
              ${record.loai_pt ? `<span class="badge badge-amber">${escapeHtml(record.loai_pt)}</span>` : ""}
              ${record.local_only ? `<span class="badge badge-gray">Chưa gửi lên hệ thống</span>` : ""}
            </div>
          </div>`;
      }).join("");

      listEl.innerHTML = `
        <div class="dashboard-tools">
          <div class="dashboard-search"><input id="dash-search" type="search" placeholder="Tìm theo tên, mã phiếu, số hồ sơ..." value="${escapeHtml(dashboardQuery)}"></div>
          <div class="segmented" id="dash-segmented">
            <button data-filter="all" class="${dashboardFilter === "all" ? "active" : ""}">Tất cả</button>
            <button data-filter="draft" class="${dashboardFilter === "draft" ? "active" : ""}">Nháp máy</button>
            <button data-filter="progress" class="${dashboardFilter === "progress" ? "active" : ""}">Đang điền</button>
            <button data-filter="done" class="${dashboardFilter === "done" ? "active" : ""}">Hoàn thành</button>
          </div>
        </div>
        <div class="phieu-list-wrap">${cards || '<div class="empty">Không có phiếu phù hợp bộ lọc hiện tại.</div>'}</div>
      `;

      const search = document.getElementById("dash-search");
      if (search) {
        search.addEventListener("input", (e) => {
          dashboardQuery = e.target.value || "";
          renderDashboard();
        });
      }
      document.querySelectorAll("#dash-segmented button").forEach(btn => {
        btn.addEventListener("click", () => {
          dashboardFilter = btn.dataset.filter || "all";
          renderDashboard();
        });
      });
    }

    function showScreen(name, options = {}) {
      document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
      document.getElementById("screen-" + name).classList.add("active");
      document.getElementById("btn-dash").style.display = (name === "new") ? "inline-block" : "none";
      document.getElementById("btn-new-top").style.display = (name === "dash") ? "inline-block" : "none";

      if (name === "dash") {
        renderDashboard();
        return;
      }

      if (name === "new") {
        const record = options.record || null;
        currentRecordSource = options.source || (record ? (record.local_only ? "local" : "remote") : "new");
        currentMaPhieu = record?.ma_phieu || genMaPhieu();
        currentHighestStep = Math.max(Number(record?.buoc || 0), 1);
        buildStep1();
        buildStep2();
        buildStep3();
        ensureFooterControls();
        ensureModeBanner();
        bindAutosave();
        document.querySelectorAll(".step-item").forEach((item, index) => item.onclick = () => jumpToStep(index + 1));
        if (record) applyFormData(record);
        const initialStep = Math.max(1, Math.min(3, Number(options.step || record?.last_step || (record?.buoc || 1))));
        hideAlert("form-alert");
        updateModeBanner(record);
        showStep(initialStep);
      }
    }

    function showStep(n) {
      currentStep = n;
      ["step1", "step2", "step3"].forEach((id, i) => {
        document.getElementById(id).style.display = (i + 1 === n) ? "block" : "none";
      });
      ["tab1", "tab2", "tab3"].forEach((id, i) => {
        const stateClass = i + 1 === n ? " active" : i + 1 < n ? " done" : "";
        document.getElementById(id).className = "step-item" + stateClass;
      });
      document.getElementById("btn-prev").style.display = n > 1 ? "inline-block" : "none";
      document.getElementById("btn-next").style.display = n < 3 ? "inline-block" : "none";
      document.getElementById("btn-finish").style.display = n === 3 ? "inline-block" : "none";
      const local = getLocalDraft(currentMaPhieu);
      updateFooterStatus(local?.updated_at ? `Nháp gần nhất: ${formatWhen(local.updated_at)}` : "Tự động lưu nháp khi đang nhập");
    }

    async function nextStep() {
      if (await saveCurrentStep()) showStep(Math.min(3, currentStep + 1));
    }

    function prevStep() {
      showStep(Math.max(1, currentStep - 1));
    }

    async function finishForm() {
      currentHighestStep = Math.max(currentHighestStep, 3);
      if (await saveCurrentStep()) {
        markLocalSynced();
        const local = getLocalDraft(currentMaPhieu);
        if (local) {
          upsertLocalDraft({ ...local, buoc: 3, synced: true, local_only: false, updated_at: new Date().toISOString() });
        }
        showAlert("form-alert", `Phiếu ${currentMaPhieu} đã lưu hoàn thành. Có thể mở lại từ danh sách để cập nhật sau.`, "success");
        setTimeout(() => {
          showScreen("dash");
          loadDanhSach();
        }, 900);
      }
    }

    async function saveCurrentStep() {
      saveLocalProgress(false);
      showLoading(true);
      try {
        const data = collectStep(currentStep);
        data.ma_phieu = currentMaPhieu;
        data.buoc = Math.max(Number(currentHighestStep || 0), Number(currentStep || 0), 1);
        data.dieu_tra_vien = currentUser?.name || "";
        await apiPost(data);
        currentHighestStep = Math.max(Number(currentHighestStep || 0), Number(currentStep || 0), 1);
        markLocalSynced();
        hideAlert("form-alert");
        updateFooterStatus(`Đã lưu hệ thống lúc ${formatWhen(new Date().toISOString())}`);
        showLoading(false);
        return true;
      } catch (e) {
        showLoading(false);
        showAlert("form-alert", "Không lưu lên hệ thống được. Dữ liệu hiện đã được giữ dưới dạng nháp trên máy. (" + e.message + ")", "error");
        return false;
      }
    }

    document.addEventListener("DOMContentLoaded", () => {
      ensureFooterControls();
      ensureModeBanner();
      bindAutosave();
      const dashBtn = document.getElementById("btn-dash");
      if (dashBtn) dashBtn.onclick = () => { showScreen("dash"); loadDanhSach(); };
      const newBtn = document.getElementById("btn-new-top");
      if (newBtn) newBtn.onclick = () => showScreen("new");
      const newButtons = [...document.querySelectorAll('button[onclick="showScreen(\'new\')"]')];
      newButtons.forEach(btn => btn.onclick = () => showScreen("new"));
    });
