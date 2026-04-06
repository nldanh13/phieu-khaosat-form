// ============================================================
// main.js — Phiếu Thu Thập Số Liệu ĐH Y Dược Cần Thơ
//
// THAY ĐỔI SO VỚI PHIÊN BẢN CŨ:
//   [FIX#3]  saveCurrentStep() thất bại → vẫn lưu local + đi tiếp
//   [FIX#4]  Loại bỏ giá trị mặc định số (0) khỏi collectStep
//            → dùng "" thay vì 0 khi chưa nhập
//   [FIX#5]  Select "vận động" sửa option đầu có value rõ ràng
//   [FIX#6]  Phân biệt rõ "chưa nhập" (null/"") vs "nhập = 0"
//   [FIX#7]  jumpToStep kiểm tra validation trước khi nhảy tiến
//   [FIX#8]  getRecordStatus thống nhất logic trạng thái
// ============================================================

// ── Config (đọc từ auth-config.js) ──────────────────────────
const API_URL = window.APP_AUTH?.apiUrl || "";
const USERS   = window.APP_AUTH?.users  || {};

if (!API_URL) console.error("[Config] apiUrl chưa được thiết lập trong auth-config.js");

// ── API helpers ──────────────────────────────────────────────
function buildApiUrl(action = "", params = {}) {
  const url = new URL(API_URL);
  if (action) url.searchParams.set("action", action);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

async function apiGet(action = "", params = {}) {
  const res = await fetch(buildApiUrl(action, params));
  let data = null;
  try { data = await res.json(); } catch { throw new Error("API trả về dữ liệu không hợp lệ"); }
  if (!res.ok) throw new Error(data?.error || ("Lỗi " + res.status));
  return data;
}

// Loại bỏ field null/"" khỏi payload trước khi gửi — giảm kích thước URL
function trimPayload(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

async function apiPost(payload) {
  // Chiến lược: thử POST text/plain trước (không trigger preflight, không bị giới hạn URL)
  // Nếu POST bị CORS block → fallback về GET với data chunk nhỏ
  const jsonBody = JSON.stringify(trimPayload(payload));
  console.log("[apiPost] payload size:", jsonBody.length, "chars | buoc:", payload.buoc, "| ma:", payload.ma_phieu);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body:   jsonBody,
      // KHÔNG set Content-Type header → browser gửi text/plain → không trigger preflight
    });
    const text = await res.text();
    console.log("[apiPost] POST response:", text?.slice(0, 200));
    if (!text?.trim()) throw new Error("Server không trả về dữ liệu");
    const data = JSON.parse(text);
    if (!data?.success) throw new Error(data?.error || "Server trả về lỗi");
    console.log("[apiPost] POST success:", data);
    return data;
  } catch (postErr) {
    // POST thất bại (CORS hoặc lỗi khác) → fallback GET
    console.warn("[apiPost] POST failed:", postErr.message, "— thử GET fallback");
    const url = new URL(API_URL);
    url.searchParams.set("action", "save");
    url.searchParams.set("data", jsonBody);
    const urlStr = url.toString();
    console.log("[apiPost] GET URL length:", urlStr.length);
    if (urlStr.length > 7500) throw new Error("Payload quá lớn cho GET (" + urlStr.length + " ký tự). Lỗi POST: " + postErr.message);
    const res2 = await fetch(urlStr, { method: "GET" });
    const text2 = await res2.text();
    console.log("[apiPost] GET response:", text2?.slice(0, 200));
    if (!text2?.trim()) throw new Error("Server không trả về dữ liệu (GET fallback)");
    const data2 = JSON.parse(text2);
    if (!data2?.success) throw new Error(data2?.error || "Server lỗi (GET)");
    return data2;
  }
}

// ── State ────────────────────────────────────────────────────
let currentUser        = null;
let currentStep        = 1;
let currentHighestStep = 1;
let currentMaPhieu     = null;
let currentRecordSource = "new";
let danhSachCache      = [];
let dashboardFilter    = "all";
let dashboardQuery     = "";
let draftSaveTimer     = null;
let dashboardPage      = 1;
const PAGE_SIZE        = 20;

const LOCAL_DRAFT_KEY = "phieu_local_drafts_v3";

// ── Auth ─────────────────────────────────────────────────────
function doLogin() {
  const u  = document.getElementById("inp-user").value.trim();
  const p  = document.getElementById("inp-pass").value;
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

// ── Helpers ──────────────────────────────────────────────────
function genMaPhieu() {
  const uuid = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()
    : Date.now().toString(36).toUpperCase().slice(-8);
  return "PK" + uuid;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseJSONSafe(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch { return fallback; }
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

function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString("vi-VN", {
      hour: "2-digit", minute: "2-digit",
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  }
  return String(value);
}

// ── Local Draft ──────────────────────────────────────────────
function getLocalDraftMap()    { return parseJSONSafe(localStorage.getItem(LOCAL_DRAFT_KEY), {}); }
function setLocalDraftMap(map) { localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(map)); }
function listLocalDrafts()     { return Object.values(getLocalDraftMap()).sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)); }
function getLocalDraft(ma)     { return ma ? (getLocalDraftMap()[ma] || null) : null; }
function removeLocalDraft(ma)  { const m = getLocalDraftMap(); delete m[ma]; setLocalDraftMap(m); }

function upsertLocalDraft(record) {
  if (!record?.ma_phieu) return;
  const m = getLocalDraftMap();
  m[record.ma_phieu] = record;
  setLocalDraftMap(m);
}

function hasRemoteRecord(ma) {
  return danhSachCache.some(item => item.ma_phieu === ma);
}

// ── Merged record helpers ────────────────────────────────────
function getMergedRecordByMa(ma) {
  const remote = danhSachCache.find(item => item.ma_phieu === ma) || null;
  const local  = getLocalDraft(ma);
  const merged = { ...(remote || {}), ...((local && local.data) || {}) };
  merged.ma_phieu   = ma;
  merged.buoc       = Math.max(Number(remote?.buoc || 0), Number(local?.buoc || 0), 1);
  merged.last_step  = Number(local?.last_step || merged.buoc || 1);
  merged.updated_at = local?.updated_at || remote?.updated_at || remote?.ngay_thu_thap || "";
  merged.local_only = Boolean(local && !remote);
  merged.has_local  = Boolean(local);
  merged.synced     = Boolean(local?.synced);
  return merged;
}

function getManagedRecords() {
  const ids = new Set();
  danhSachCache.forEach(item => item?.ma_phieu && ids.add(item.ma_phieu));
  listLocalDrafts().forEach(item => item?.ma_phieu && ids.add(item.ma_phieu));
  return [...ids].map(getMergedRecordByMa).sort((a, b) =>
    new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
  );
}

// [FIX#8] Thống nhất logic trạng thái:
// - Phiếu chỉ coi là "Hoàn thành" khi buoc >= 3 VÀ đã sync lên server
// - "Chưa đồng bộ" = có remote nhưng local chưa sync
// - "Nháp trên máy" = chưa bao giờ lên server
// - "Đang điền" = có trên server nhưng buoc < 3
function getRecordStatus(record) {
  if (record.local_only)                           return { text: "Nháp trên máy",  cls: "badge-purple" };
  if (record.has_local && !record.synced)          return { text: "Chưa đồng bộ",   cls: "badge-purple" };
  if ((record.buoc || 0) >= 3 && record.synced)   return { text: "Hoàn thành",     cls: "badge-green"  };
  if ((record.buoc || 0) >= 3 && !record.has_local) return { text: "Hoàn thành",   cls: "badge-green"  };
  return { text: "Đang điền", cls: "badge-amber" };
}

function getStepLabel(record) {
  const step = Number(record?.buoc || 1);
  return step >= 3 ? "Đủ 3 bước" : `Đã lưu đến bước ${step}`;
}

// ── Screen & Step navigation ─────────────────────────────────
function showScreen(name, options = {}) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  document.getElementById("btn-dash").style.display    = (name === "new")  ? "inline-block" : "none";
  document.getElementById("btn-new-top").style.display = (name === "dash") ? "inline-block" : "none";

  if (name === "dash") { renderDashboard(); return; }

  if (name === "new") {
    const record        = options.record || null;
    currentRecordSource = options.source || (record ? (record.local_only ? "local" : "remote") : "new");
    currentMaPhieu      = record?.ma_phieu || genMaPhieu();
    currentHighestStep  = Math.max(Number(record?.buoc || 0), 1);
    buildStep1(); buildStep2(); buildStep3();
    ensureFooterControls();
    ensureModeBanner();
    bindAutosave();
    document.querySelectorAll(".step-item").forEach((item, i) => {
      item.onclick = () => jumpToStep(i + 1);
    });
    if (record) {
      applyFormData(record);
      // [FIX-SEED] Nếu chưa có draft local, tạo draft seed từ remote data
      // Đảm bảo autosave sau đó sẽ merge vào data đầy đủ, không bị mất bước khác
      if (!getLocalDraft(currentMaPhieu)) {
        const seedData = { ...record };
        delete seedData.ma_phieu; delete seedData.buoc; delete seedData.last_step;
        delete seedData.updated_at; delete seedData.local_only; delete seedData.has_local; delete seedData.synced;
        upsertLocalDraft({
          ma_phieu:   currentMaPhieu,
          buoc:       Math.max(Number(record.buoc || 0), 1),
          last_step:  Number(record.buoc || 1),
          updated_at: record.updated_at || new Date().toISOString(),
          local_only: false,
          synced:     true,
          user:       currentUser?.name || "",
          data:       { ...seedData, ma_phieu: currentMaPhieu },
        });
      }
    }
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
    document.getElementById(id).className = "step-item" +
      (i + 1 === n ? " active" : i + 1 < n ? " done" : "");
  });
  // [FIX-UPDATE] Phiếu đã hoàn thành (buoc>=3): hiện nút "Lưu cập nhật bước này" thay cho luồng 3 bước
  const isCompleted = currentHighestStep >= 3;
  document.getElementById("btn-prev").style.display   = n > 1 ? "inline-block" : "none";
  document.getElementById("btn-next").style.display   = (!isCompleted && n < 3) ? "inline-block" : "none";
  document.getElementById("btn-finish").style.display = (!isCompleted && n === 3) ? "inline-block" : "none";
  const btnUpdate = document.getElementById("btn-update");
  if (btnUpdate) btnUpdate.style.display = isCompleted ? "inline-block" : "none";
  const local = getLocalDraft(currentMaPhieu);
  updateFooterStatus(
    local?.updated_at
      ? `Nháp gần nhất: ${formatWhen(local.updated_at)}`
      : "Tự động lưu nháp khi đang nhập"
  );
}

// [FIX#7] jumpToStep: không cho nhảy tiến quá bước đã validate
// Chỉ cho phép nhảy về bước đã qua hoặc bước tiếp theo liền kề
function jumpToStep(step) {
  const target = Math.max(1, Math.min(3, Number(step || 1)));
  if (target > currentStep) {
    // Muốn tiến: phải validate bước hiện tại trước
    const errors = validateStep(currentStep);
    if (errors.length > 0) {
      showAlert("form-alert", "Vui lòng hoàn tất bước hiện tại trước: " + errors.join(" · "), "error");
      return;
    }
    saveLocalProgress(false);
  }
  showStep(target);
}

async function nextStep()  {
  const errors = validateStep(currentStep);
  if (errors.length > 0) {
    showAlert("form-alert", "Vui lòng điền đầy đủ: " + errors.join(" · "), "error");
    return;
  }
  // [FIX-SPEED] Lưu local + chuyển bước NGAY — không chờ server
  saveLocalProgress(false);
  currentHighestStep = Math.max(Number(currentHighestStep || 0), Number(currentStep || 0), 1);
  const stepToSave = currentStep; // capture trước khi showStep thay đổi currentStep
  showStep(Math.min(3, currentStep + 1));

  // Gửi lên server ngầm (không block UI)
  const data = collectStep(stepToSave);
  data.ma_phieu       = currentMaPhieu;
  data.buoc           = currentHighestStep;
  data.dieu_tra_vien  = currentUser?.name || "";
  apiPost(data).then(() => {
    markLocalSynced();
    updateFooterStatus(`Đã lưu hệ thống lúc ${formatWhen(new Date().toISOString())}`);
  }).catch(e => {
    updateFooterStatus(`⚠ Chưa lưu lên server (${e.message}) — nháp đã giữ trên máy`);
  });
}

function prevStep() { showStep(Math.max(1, currentStep - 1)); }

async function finishForm() {
  const errors = validateStep(currentStep);
  if (errors.length > 0) {
    showAlert("form-alert", "Vui lòng điền đầy đủ: " + errors.join(" · "), "error");
    return;
  }
  currentHighestStep = Math.max(currentHighestStep, 3);
  saveLocalProgress(false);
  showLoading(true);
  try {
    // [FIX-OVERWRITE] Chỉ collect bước đang active (bước 3) khi finish
    // Merge với existing draft để không mất data bước 1 & 2
    const existingDraft = getLocalDraft(currentMaPhieu) || {};
    const step3Data = collectStep(3);
    const data = { ...(existingDraft.data || {}), ...step3Data, ma_phieu: currentMaPhieu };
    data.buoc     = 3;
    data.dieu_tra_vien = currentUser?.name || "";
    await apiPost(data);
    // Lưu draft với toàn bộ data đã merge
    upsertLocalDraft({
      ...existingDraft,
      ma_phieu:   currentMaPhieu,
      buoc:       3,
      last_step:  3,
      updated_at: new Date().toISOString(),
      local_only: false,
      synced:     true,
      user:       currentUser?.name || "",
      data:       { ...(existingDraft.data || {}), ...step3Data, ma_phieu: currentMaPhieu },
    });
    showAlert("form-alert", `Phiếu ${currentMaPhieu} đã lưu hoàn thành.`, "success");
    const savedMa = currentMaPhieu;
    // [FIX] Chuyển về dashboard TRƯỚC, sau đó load server → khi cache có dữ liệu mới thì xóa draft
    setTimeout(async () => {
      showScreen("dash");
      await loadDanhSach();
      // Sau khi server cache đã có bản ghi này, mới xóa draft local
      const draft = getLocalDraft(savedMa);
      if (draft && draft.synced && Number(draft.buoc || 0) >= 3 && hasRemoteRecord(savedMa)) {
        removeLocalDraft(savedMa);
        renderDashboard();
      }
    }, 900);
  } catch (e) {
    showAlert("form-alert",
      `Không lưu được lên server (${e.message}). Phiếu đã lưu nháp trên máy — vui lòng thử lại khi có mạng.`,
      "error"
    );
  } finally {
    showLoading(false);
  }
}

// [FIX-UPDATE] Lưu cập nhật đúng bước đang chỉnh — dùng khi phiếu đã hoàn thành
async function saveCurrentStepUpdate() {
  const errors = validateStep(currentStep);
  if (errors.length > 0) {
    showAlert("form-alert", "Vui lòng điền đầy đủ: " + errors.join(" · "), "error");
    return;
  }
  // Lưu local ngay (chỉ bước hiện tại, merge vào existing)
  saveLocalProgress(false);
  showLoading(true);
  try {
    const existingDraft = getLocalDraft(currentMaPhieu) || {};
    const stepData = collectStep(currentStep);
    // Gửi lên server: merge toàn bộ data để AppScript upsert đúng bảng
    const data = { ...(existingDraft.data || {}), ...stepData, ma_phieu: currentMaPhieu };
    data.buoc          = currentStep;   // AppScript lưu vào đúng sheet BuocI/II/III
    data.dieu_tra_vien = currentUser?.name || "";
    await apiPost(data);
    // Đánh dấu synced, cập nhật draft
    const updatedData = { ...(existingDraft.data || {}), ...stepData, ma_phieu: currentMaPhieu };
    upsertLocalDraft({
      ...existingDraft,
      ma_phieu:   currentMaPhieu,
      buoc:       Math.max(Number(existingDraft.buoc || 0), 3),
      last_step:  currentStep,
      updated_at: new Date().toISOString(),
      local_only: false,
      synced:     true,
      user:       currentUser?.name || "",
      data:       updatedData,
    });
    showAlert("form-alert", `✓ Đã cập nhật bước ${currentStep} lên hệ thống.`, "success");
    updateFooterStatus(`Đã lưu hệ thống lúc ${formatWhen(new Date().toISOString())}`);
  } catch (e) {
    showAlert("form-alert",
      `Không lưu được lên server (${e.message}). Nháp đã giữ trên máy.`,
      "error"
    );
  } finally {
    showLoading(false);
  }
}

// ── Validation ───────────────────────────────────────────────
function validateStep(n) {
  const get    = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  const errors = [];

  if (n === 1) {
    if (!get("f_ten"))          errors.push("Họ và tên bệnh nhân");
    if (!get("f_hoSo"))         errors.push("Số hồ sơ bệnh án");
    if (!get("f_ngaySinh"))     errors.push("Ngày sinh");
    if (!get("f_gioi"))         errors.push("Giới tính");
    if (!get("f_ngayNhapVien")) errors.push("Ngày nhập viện");
    if (!get("f_loaiPT"))       errors.push("Loại phẫu thuật");
    if (!get("f_voCam"))        errors.push("Phương pháp vô cảm");
  }

  if (n === 2) {
    const chuaTraLoi = [];
    for (let i = 1; i <= 14; i++) {
      if (!document.querySelector(`input[name="hads_${i}"]:checked`)) chuaTraLoi.push(i);
    }
    if (chuaTraLoi.length > 0) errors.push(`Chưa trả lời câu HADS số: ${chuaTraLoi.join(", ")}`);
    if (!get("f_psqi1")) errors.push("Giờ đi ngủ (PSQI-1)");
    if (!get("f_psqi3")) errors.push("Giờ thức dậy (PSQI-3)");
  }

  if (n === 3) {
    if (!get("f_ngayPTthuc")) errors.push("Ngày phẫu thuật thực tế");
  }

  return errors;
}

// ── Save current step (chỉ dùng cho finishForm — nextStep đã tách) ───────────
async function saveCurrentStep() {
  const errors = validateStep(currentStep);
  if (errors.length > 0) {
    showAlert("form-alert", "Vui lòng điền đầy đủ: " + errors.join(" · "), "error");
    return false;
  }
  saveLocalProgress(false);
  showLoading(true);
  try {
    const data = collectStep(currentStep);
    data.ma_phieu = currentMaPhieu;
    data.buoc     = Math.max(Number(currentHighestStep || 0), Number(currentStep || 0), 1);
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
    showAlert("form-alert", "Không lưu lên hệ thống được. Dữ liệu đã được giữ dưới dạng nháp trên máy. (" + e.message + ")", "error");
    return false;
  }
}

// ── Local draft ──────────────────────────────────────────────
function saveLocalProgress(showMessage = false) {
  if (!currentMaPhieu || !document.getElementById("screen-new")?.classList.contains("active")) return;
  const existing = getLocalDraft(currentMaPhieu) || {};
  // [FIX-OVERWRITE] Chỉ collect bước ĐANG HIỂN THỊ để tránh overwrite
  // dữ liệu bước khác bằng "" (DOM ẩn trả về rỗng)
  const currentStepData = collectStep(currentStep);
  const record = {
    ma_phieu:   currentMaPhieu,
    buoc:       Math.max(Number(existing.buoc || 0), Number(currentHighestStep || 0), Number(currentStep || 0), 1),
    last_step:  Number(currentStep || 1),
    updated_at: new Date().toISOString(),
    local_only: !hasRemoteRecord(currentMaPhieu),
    synced:     false,
    user:       currentUser?.name || "",
    // Merge: giữ nguyên data cũ, chỉ cập nhật bước hiện tại
    data: { ...(existing.data || {}), ...currentStepData, ma_phieu: currentMaPhieu },
  };
  upsertLocalDraft(record);
  updateFooterStatus(`Đã lưu nháp lúc ${formatWhen(record.updated_at)}`);
  if (showMessage) showAlert("form-alert", "Đã lưu nháp trên máy. Có thể mở lại để điền tiếp.", "success");
}

function markLocalSynced() {
  const existing = getLocalDraft(currentMaPhieu) || {};
  // [FIX-OVERWRITE] Chỉ update bước hiện tại, giữ nguyên data các bước khác
  const currentStepData = collectStep(currentStep);
  upsertLocalDraft({
    ...existing,
    ma_phieu:   currentMaPhieu,
    buoc:       Math.max(Number(existing.buoc || 0), Number(currentHighestStep || 0), Number(currentStep || 0), 1),
    last_step:  Number(currentStep || 1),
    updated_at: new Date().toISOString(),
    local_only: false, synced: true,
    user:       currentUser?.name || "",
    data: { ...(existing.data || {}), ...currentStepData, ma_phieu: currentMaPhieu },
  });
}

function bindAutosave() {
  const screen = document.getElementById("screen-new");
  if (!screen || screen.dataset.autosaveBound === "1") return;
  const handler = event => {
    if (!screen.classList.contains("active")) return;
    if (!event.target.closest("#screen-new")) return;
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => saveLocalProgress(false), 500);
  };
  screen.addEventListener("input",  handler, true);
  screen.addEventListener("change", handler, true);
  screen.dataset.autosaveBound = "1";
}

// ── Dashboard ────────────────────────────────────────────────
async function loadDanhSach() {
  const drafts = listLocalDrafts();
  showAlert("dash-alert",
    drafts.length
      ? "Đang tải danh sách từ Google Sheets... Nếu mạng lỗi vẫn có thể mở các nháp trên máy."
      : "Đang tải dữ liệu từ Google Sheets...",
    "info"
  );
  try {
    const res = await apiGet("danh-sach");
    danhSachCache = Array.isArray(res) ? res : (res.items || []);
    renderDashboard();
    hideAlert("dash-alert");
  } catch (e) {
    danhSachCache = Array.isArray(danhSachCache) ? danhSachCache : [];
    renderDashboard();
    showAlert("dash-alert",
      "Không kết nối được API. Vẫn có thể tiếp tục các phiếu nháp đã lưu trên máy. (" + e.message + ")",
      "error"
    );
  }
}

function renderDashboard() {
  const records         = getManagedRecords();
  const normalizedQuery = dashboardQuery.trim().toLowerCase();
  const filtered        = records.filter(record => {
    const hay    = `${record.ma_phieu || ""} ${record.ho_ten || ""} ${record.so_ho_so || ""}`.toLowerCase();
    const matchQ = !normalizedQuery || hay.includes(normalizedQuery);
    const matchF = dashboardFilter === "all"
      || (dashboardFilter === "draft"    && record.local_only)
      || (dashboardFilter === "progress" && !record.local_only && (record.buoc || 0) < 3)
      || (dashboardFilter === "done"     && (record.buoc || 0) >= 3);
    return matchQ && matchF;
  });

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  dashboardPage     = Math.min(dashboardPage, totalPages);
  const pageStart   = (dashboardPage - 1) * PAGE_SIZE;
  const pageRecords = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card"><div class="stat-num">${records.length}</div><div class="stat-lbl">Tổng phiếu quản lý</div></div>
    <div class="stat-card"><div class="stat-num">${records.filter(r => r.local_only).length}</div><div class="stat-lbl">Nháp trên máy</div></div>
    <div class="stat-card"><div class="stat-num">${records.filter(r => !r.local_only && (r.buoc || 0) < 3).length}</div><div class="stat-lbl">Đang điền</div></div>
    <div class="stat-card"><div class="stat-num">${records.filter(r => (r.buoc || 0) >= 3).length}</div><div class="stat-lbl">Hoàn thành</div></div>
  `;

  const cards = pageRecords.map(record => {
    const status     = getRecordStatus(record);
    const actionText = (record.buoc || 0) >= 3 ? "Cập nhật" : "Tiếp tục";
    return `
      <div class="phieu-item">
        <div class="phieu-head">
          <div>
            <div class="phieu-name">${escapeHtml(record.ho_ten || "(Chưa có tên bệnh nhân)")}</div>
            <div class="phieu-sub">Mã phiếu: ${escapeHtml(record.ma_phieu || "")} · ${record.so_ho_so ? "HSBA: " + escapeHtml(record.so_ho_so) + " · " : ""}${record.updated_at ? "Cập nhật: " + escapeHtml(formatWhen(record.updated_at)) : "Chưa có thời gian"}</div>
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
          ${record.loai_pt  ? `<span class="badge badge-amber">${escapeHtml(record.loai_pt)}</span>` : ""}
          ${record.local_only ? `<span class="badge badge-gray">Chưa gửi lên hệ thống</span>` : ""}
        </div>
      </div>`;
  }).join("");

  const paginationHtml = totalPages > 1 ? `
    <div class="pagination">
      <button class="btn btn-sm" onclick="changePage(${dashboardPage - 1})" ${dashboardPage <= 1 ? "disabled" : ""}>← Trước</button>
      <span class="page-info">Trang ${dashboardPage} / ${totalPages} &nbsp;·&nbsp; ${filtered.length} phiếu</span>
      <button class="btn btn-sm" onclick="changePage(${dashboardPage + 1})" ${dashboardPage >= totalPages ? "disabled" : ""}>Tiếp →</button>
    </div>` : filtered.length > 0 ? `<div class="page-info-simple">${filtered.length} phiếu</div>` : "";

  document.getElementById("phieu-list").innerHTML = `
    <div class="dashboard-tools">
      <div class="dashboard-search"><input id="dash-search" type="search" placeholder="Tìm theo tên, mã phiếu, số hồ sơ..." value="${escapeHtml(dashboardQuery)}"></div>
      <div class="segmented" id="dash-segmented">
        <button data-filter="all"      class="${dashboardFilter === "all"      ? "active" : ""}">Tất cả</button>
        <button data-filter="draft"    class="${dashboardFilter === "draft"    ? "active" : ""}">Nháp máy</button>
        <button data-filter="progress" class="${dashboardFilter === "progress" ? "active" : ""}">Đang điền</button>
        <button data-filter="done"     class="${dashboardFilter === "done"     ? "active" : ""}">Hoàn thành</button>
      </div>
    </div>
    <div class="phieu-list-wrap">${cards || '<div class="empty">Không có phiếu phù hợp bộ lọc hiện tại.</div>'}</div>
    ${paginationHtml}
  `;

  document.getElementById("dash-search")?.addEventListener("input", e => {
    dashboardQuery = e.target.value || "";
    dashboardPage  = 1;
    renderDashboard();
  });
  document.querySelectorAll("#dash-segmented button").forEach(btn => {
    btn.addEventListener("click", () => {
      dashboardFilter = btn.dataset.filter || "all";
      dashboardPage   = 1;
      renderDashboard();
    });
  });
}

function changePage(page) {
  const records  = getManagedRecords();
  const filtered = records.filter(record => {
    const hay    = `${record.ma_phieu || ""} ${record.ho_ten || ""} ${record.so_ho_so || ""}`.toLowerCase();
    const matchQ = !dashboardQuery.trim() || hay.includes(dashboardQuery.trim().toLowerCase());
    const matchF = dashboardFilter === "all"
      || (dashboardFilter === "draft"    && record.local_only)
      || (dashboardFilter === "progress" && !record.local_only && (record.buoc || 0) < 3)
      || (dashboardFilter === "done"     && (record.buoc || 0) >= 3);
    return matchQ && matchF;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  dashboardPage    = Math.max(1, Math.min(page, totalPages));
  renderDashboard();
}

function openRecordByMa(ma) {
  const record = getMergedRecordByMa(ma);
  showScreen("new", {
    record,
    step:   record.last_step || Math.min(record.buoc || 1, 3),
    source: record.local_only ? "local" : "remote",
  });
}

function deleteLocalDraftOnly(ma) {
  if (!confirm(`Xóa nháp trên máy của phiếu ${ma}?`)) return;
  removeLocalDraft(ma);
  renderDashboard();
}

// ── Mode banner / footer ─────────────────────────────────────
function ensureFooterControls() {
  const group = document.querySelector(".form-footer .btn-group");
  if (!group || document.getElementById("btn-save-draft")) return;
  const btn = document.createElement("button");
  btn.className = "btn btn-sm"; btn.id = "btn-save-draft"; btn.type = "button";
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
  const status     = record ? getRecordStatus(record) : { text: "Phiếu mới", cls: "badge-blue" };
  const sourceText = record?.local_only
    ? "Đang mở nháp lưu trên máy"
    : record?.ma_phieu ? "Có thể tiếp tục hoặc chỉnh sửa để cập nhật" : "Phiếu mới, có tự lưu nháp trên máy";
  banner.innerHTML = `<strong>${record?.ma_phieu ? "Phiếu " + escapeHtml(record.ma_phieu) : "Phiếu mới"}</strong> · <span class="badge ${status.cls}">${escapeHtml(status.text)}</span><span class="sub">${escapeHtml(sourceText)}${record?.updated_at ? " · cập nhật gần nhất: " + escapeHtml(formatWhen(record.updated_at)) : ""}</span>`;
}

function updateFooterStatus(text) {
  const info = document.getElementById("footer-info");
  if (!info) return;
  const base = `Bước ${currentStep}/3 — Mã phiếu: ${currentMaPhieu}`;
  info.innerHTML = `${escapeHtml(base)}<span class="footer-status"><span class="footer-status-dot"></span>${escapeHtml(text)}</span>`;
}

// ── Apply / Collect form data ────────────────────────────────
const FIELD_ID_MAP = {
  ho_ten: "f_ten", so_ho_so: "f_hoSo", ngay_sinh: "f_ngaySinh", gioi_tinh: "f_gioi",
  nghe_nghiep: "f_ngheNghiep", dia_chi: "f_diaChi", hoc_van: "f_hocVan", dan_toc: "f_danToc",
  ngay_nhap_vien: "f_ngayNhapVien", ngay_pt_du_kien: "f_ngayPT",
  can_nang: "f_canNang", chieu_cao: "f_chieuCao", chan_doan: "f_chanDoan",
  loai_pt: "f_loaiPT", vung_pt: "f_vungPT", pp_pt: "f_ppPT", vo_cam: "f_voCam",
  vas_nhap_vien: "f_vasNhap",
  psqi1: "f_psqi1", psqi2: "f_psqi2", psqi3: "f_psqi3", psqi4: "f_psqi4",
  psqi5a: "f_psqi5a", psqi6: "f_psqi6", psqi7: "f_psqi7", psqi8: "f_psqi8", psqi9: "f_psqi9",
  ngay_pt_thuc: "f_ngayPTthuc", tg_pt: "f_tgPT", pp_pt_thuc: "f_ppPTthuc",
  vo_cam_thuc: "f_voCamThuc", mat_mau: "f_matMau", truyen_mau: "f_truyenMau",
  vas1: "f_vas1", vas2: "f_vas2", vas3: "f_vas3",
  van_dong: "f_vanDong", kha_nang_vd: "f_khanangVD", bien_chung: "f_bienChung",
  tg_nam_vien: "f_tgNamVien", nhan_xet: "f_nhanXet",
};

// [FIX-DATE] Google Sheets trả về ngày dạng ISO "2000-01-15T00:00:00+07:00"
// nhưng <input type="date"> chỉ nhận "YYYY-MM-DD" → cần cắt phần thừa
const DATE_FIELDS = new Set(["ngay_sinh","ngay_nhap_vien","ngay_pt_du_kien","ngay_pt_thuc"]);
function normalizeDateForInput(field, value) {
  if (!DATE_FIELDS.has(field)) return value;
  if (!value) return value;
  const s = String(value);
  // Nếu có "T" (ISO datetime) → lấy phần YYYY-MM-DD trước chữ T
  const tIdx = s.indexOf("T");
  if (tIdx > 0) return s.slice(0, tIdx);
  // Nếu dạng dd/MM/yyyy → convert sang YYYY-MM-DD
  const dmyMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  return value;
}

function applyFormData(data = {}) {
  Object.entries(FIELD_ID_MAP).forEach(([field, id]) => {
    const el = document.getElementById(id);
    if (!el || data[field] === undefined || data[field] === null || data[field] === "") return;
    el.value = normalizeDateForInput(field, data[field]);
  });
  for (let i = 1; i <= 14; i++) {
    const v = data[`hads_${i}`];
    if (v === undefined || v === null || v === "") continue;
    const r = document.querySelector(`input[name="hads_${i}"][value="${v}"]`);
    if (r) r.checked = true;
  }
  for (let i = 0; i < 9; i++) {
    const v = data[`psqi_5_${i}`];
    if (v === undefined || v === null || v === "") continue;
    const r = document.querySelector(`input[name="psqi_5_${i}"][value="${v}"]`);
    if (r) r.checked = true;
  }
  for (let i = 0; i < 5; i++) {
    const v = data[`hl_${i}`];
    if (v === undefined || v === null || v === "") continue;
    const r = document.querySelector(`input[name="hl_${i}"][value="${v}"]`);
    if (r) r.checked = true;
  }
  updateRangeIndicators();
  if (typeof calcBMI  === "function") calcBMI();
  if (typeof calcHADS === "function") calcHADS();
  if (typeof calcPSQI === "function") calcPSQI();
  restoreSelectionHighlights();
}

function updateRangeIndicators() {
  const vn = document.getElementById("f_vasNhap"), vnv = document.getElementById("vas_nhap_v");
  if (vn && vnv) vnv.textContent = vn.value || "0";
  [1, 2, 3].forEach(n => {
    const i = document.getElementById(`f_vas${n}`), l = document.getElementById(`vasv${n}`);
    if (i && l) l.textContent = i.value || "0";
  });
}

function collectAllStepsData() {
  return { ...collectStep(1), ...collectStep(2), ...collectStep(3) };
}

// [FIX#4][FIX#6] collectStep: không tự điền giá trị mặc định
// - getText/getNum trả về "" khi trường trống → phân biệt "chưa nhập" vs "nhập 0"
// - radio trả về null khi chưa chọn (không phải "")
// - Select bắt buộc chọn rõ ràng (không default option đầu)
function collectStep(n) {
  // Trả về chuỗi, hoặc "" nếu trống
  const getText = id => {
    const el = document.getElementById(id);
    return el ? el.value : "";
  };
  // Trả về số nếu nhập, null nếu trống — phân biệt 0 với chưa nhập
  const getNum = id => {
    const el = document.getElementById(id);
    if (!el || el.value === "" || el.value === null) return null;
    const v = parseFloat(el.value);
    return isNaN(v) ? null : v;
  };
  // Radio: trả về số nếu chọn, null nếu chưa chọn
  const radio = name => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? parseInt(el.value) : null;
  };

  if (n === 1) return {
    ho_ten:         getText("f_ten"),
    so_ho_so:       getText("f_hoSo"),
    ngay_sinh:      getText("f_ngaySinh"),
    gioi_tinh:      getText("f_gioi"),
    nghe_nghiep:    getText("f_ngheNghiep"),
    dia_chi:        getText("f_diaChi"),
    hoc_van:        getText("f_hocVan"),
    dan_toc:        getText("f_danToc"),
    ngay_nhap_vien: getText("f_ngayNhapVien"),
    ngay_pt_du_kien: getText("f_ngayPT"),
    can_nang:       getNum("f_canNang"),
    chieu_cao:      getNum("f_chieuCao"),
    chan_doan:      getText("f_chanDoan"),
    loai_pt:        getText("f_loaiPT"),
    vung_pt:        getText("f_vungPT"),
    pp_pt:          getText("f_ppPT"),
    vo_cam:         getText("f_voCam"),
    // VAS: range luôn có giá trị số (mặc định 0 của input range là hợp lệ)
    vas_nhap_vien:  getNum("f_vasNhap"),
  };

  if (n === 2) {
    const d = {};
    for (let i = 1; i <= 14; i++) d[`hads_${i}`] = radio(`hads_${i}`);
    d.psqi1  = getText("f_psqi1");
    d.psqi3  = getText("f_psqi3");
    d.psqi2  = getNum("f_psqi2");
    d.psqi4  = getNum("f_psqi4");
    d.psqi5a = getText("f_psqi5a") !== "" ? getNum("f_psqi5a") : null;
    d.psqi6  = getNum("f_psqi6");
    d.psqi7  = getNum("f_psqi7");
    d.psqi8  = getNum("f_psqi8");
    d.psqi9  = getNum("f_psqi9");
    for (let i = 0; i < 9; i++) d[`psqi_5_${i}`] = radio(`psqi_5_${i}`);
    return d;
  }

  if (n === 3) return {
    ngay_pt_thuc:  getText("f_ngayPTthuc"),
    tg_pt:         getNum("f_tgPT"),
    pp_pt_thuc:    getText("f_ppPTthuc"),
    vo_cam_thuc:   getText("f_voCamThuc"),
    mat_mau:       getNum("f_matMau"),
    truyen_mau:    getText("f_truyenMau"),
    // VAS sau mổ: range, giá trị 0 là hợp lệ
    vas1:          getNum("f_vas1"),
    vas2:          getNum("f_vas2"),
    vas3:          getNum("f_vas3"),
    van_dong:      getText("f_vanDong"),
    kha_nang_vd:   getText("f_khanangVD"),
    bien_chung:    getText("f_bienChung"),
    tg_nam_vien:   getNum("f_tgNamVien"),
    hl_0: radio("hl_0"), hl_1: radio("hl_1"), hl_2: radio("hl_2"),
    hl_3: radio("hl_3"), hl_4: radio("hl_4"),
    nhan_xet:      getText("f_nhanXet"),
  };
}

// ── Build Steps HTML ─────────────────────────────────────────
function buildStep1() {
  document.getElementById("step1").innerHTML = `
  <div class="card">
    <div class="card-title">A1. Thông tin hành chính</div>
    <div class="form-row">
      <div class="form-group"><label>Họ và tên bệnh nhân <span class="req">*</span></label><input id="f_ten" placeholder="Nguyễn Văn A"></div>
      <div class="form-group"><label>Số hồ sơ bệnh án <span class="req">*</span></label><input id="f_hoSo" placeholder="HS-2024-001"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Ngày sinh <span class="req">*</span></label><input type="date" id="f_ngaySinh"></div>
      <div class="form-group"><label>Giới tính <span class="req">*</span></label><select id="f_gioi"><option value="">Chọn...</option><option>Nam</option><option>Nữ</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Nghề nghiệp</label><input id="f_ngheNghiep"></div>
      <div class="form-group"><label>Địa chỉ (tỉnh/TP)</label><input id="f_diaChi"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Trình độ học vấn</label><select id="f_hocVan"><option value="">Chọn...</option><option>&lt;THCS</option><option>THCS</option><option>THPT</option><option>CĐ/ĐH</option><option>Sau ĐH</option></select></div>
      <div class="form-group"><label>Dân tộc</label><input id="f_danToc" placeholder="Kinh, Khác..."></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Ngày nhập viện <span class="req">*</span></label><input type="date" id="f_ngayNhapVien"></div>
      <div class="form-group"><label>Ngày phẫu thuật dự kiến</label><input type="date" id="f_ngayPT"></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">A2. Nhân trắc</div>
    <div class="form-row">
      <div class="form-group"><label>Cân nặng (kg)</label><input type="number" id="f_canNang" placeholder="60" oninput="calcBMI()"></div>
      <div class="form-group"><label>Chiều cao (cm)</label><input type="number" id="f_chieuCao" placeholder="165" oninput="calcBMI()"></div>
    </div>
    <div id="bmi-display" style="font-size:12px;color:var(--text-muted);margin-top:4px;"></div>
  </div>
  <div class="card">
    <div class="card-title">A3. Thông tin phẫu thuật</div>
    <div class="form-row full"><div class="form-group"><label>Chẩn đoán tổn thương</label><textarea id="f_chanDoan" placeholder="Ghi đầy đủ chẩn đoán..."></textarea></div></div>
    <div class="form-row">
      <div class="form-group"><label>Loại phẫu thuật <span class="req">*</span></label><select id="f_loaiPT"><option value="">Chọn...</option><option>Thay khớp</option><option>Kết hợp xương nội tủy/nẹp vít</option><option>Nội soi khớp</option><option>Tái tạo dây chằng</option><option>Sửa gân/giải phóng gân cơ</option><option>Phẫu thuật cột sống</option><option>Khác</option></select></div>
      <div class="form-group"><label>Vùng phẫu thuật</label><select id="f_vungPT"><option value="">Chọn...</option><option>Chi trên</option><option>Chi dưới</option><option>Cột sống</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Phương pháp phẫu thuật</label><select id="f_ppPT"><option value="">Chọn...</option><option>Mổ hở truyền thống</option><option>Phẫu thuật ít xâm lấn/nội soi</option><option>Kết hợp</option></select></div>
      <div class="form-group"><label>Phương pháp vô cảm <span class="req">*</span></label><select id="f_voCam"><option value="">Chọn...</option><option>Gây mê toàn thân</option><option>Gây tê tủy sống</option><option>Gây tê ngoài màng cứng</option><option>Gây tê TK ngoại biên</option><option>Kết hợp</option></select></div>
    </div>
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
    const cat = bmi < 18.5 ? "Thiếu cân" : bmi < 23 ? "Bình thường" : bmi < 27.5 ? "Thừa cân" : "Béo phì";
    el.textContent = `BMI: ${bmi} kg/m² — ${cat} (theo WHO châu Á)`;
  } else { el.textContent = ""; }
}

const HADS_DATA = window.HADS_DATA || [];

function buildStep2() {
  const hadsCards = HADS_DATA.map(h => `
    <div class="q-card">
      <div class="q-header">
        <span class="hads-badge badge-${h.t}">${h.t}${h.id}</span>
        <span class="q-text">${h.q}</span>
      </div>
      <div class="opt-list">
        ${h.opts.map((o,vi) => `
          <label class="opt-label" onclick="selectOpt(this)">
            <input type="radio" name="hads_${h.id}" value="${vi}" onchange="calcHADS()">
            <span>${o}</span>
          </label>`).join("")}
      </div>
    </div>`).join("");

  const psqi5Labels = ["Không (0)", "<1/tuần (1)", "1–2/tuần (2)", "≥3/tuần (3)"];
  const psqi5Items  = window.PSQI5_ITEMS || [];
  const psqi5Cards  = psqi5Items
    .map((q,i) => `
      <div class="q-card">
        <div class="q-text" style="margin-bottom:8px">${q}</div>
        <div class="opt-row">
          ${psqi5Labels.map((lbl,v) => `<label class="opt-chip" onclick="selectChip(this)"><input type="radio" name="psqi_5_${i}" value="${v}" onchange="calcPSQI()"><span>${lbl}</span></label>`).join("")}
        </div>
      </div>`).join("");

  document.getElementById("step2").innerHTML = `
  <div class="card">
    <div class="card-title">B1. Thang HADS — 14 câu <span style="font-size:11px;color:var(--red)">* Bắt buộc trả lời đủ 14 câu</span></div>
    <div class="q-list">${hadsCards}</div>
    <div class="score-row" id="hads-score">
      <div class="score-cell"><div class="score-val" id="h-a">—</div><div class="score-lbl">HADS-A (lo âu)</div></div>
      <div class="score-cell"><div class="score-val" id="h-d">—</div><div class="score-lbl">HADS-D (trầm cảm)</div></div>
      <div class="score-cell"><div class="score-val" id="h-ai" style="font-size:13px"></div><div class="score-lbl">Phân loại A</div></div>
      <div class="score-cell"><div class="score-val" id="h-di" style="font-size:13px"></div><div class="score-lbl">Phân loại D</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">B2. Chỉ số PSQI — Chất lượng giấc ngủ</div>
    <div class="form-row">
      <div class="form-group"><label>Giờ đi ngủ (PSQI-1) <span class="req">*</span></label><input type="time" id="f_psqi1" onchange="calcPSQI()"></div>
      <div class="form-group"><label>Giờ thức dậy (PSQI-3) <span class="req">*</span></label><input type="time" id="f_psqi3" onchange="calcPSQI()"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Mất bao lâu để ngủ được (phút) — PSQI-2</label><input type="number" id="f_psqi2" placeholder="30" min="0" max="120" onchange="calcPSQI()"></div>
      <div class="form-group"><label>Ngủ thực sự bao nhiêu giờ/đêm — PSQI-4</label><input type="number" id="f_psqi4" placeholder="6.5" step="0.5" min="0" max="12" onchange="calcPSQI()"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Chất lượng giấc ngủ tổng thể — PSQI-6</label>
        <select id="f_psqi6" onchange="calcPSQI()">
          <option value="">Chọn...</option>
          <option value="0">Rất tốt (0)</option>
          <option value="1">Tương đối tốt (1)</option>
          <option value="2">Tương đối kém (2)</option>
          <option value="3">Rất kém (3)</option>
        </select>
      </div>
      <div class="form-group">
        <label>PSQI-5a: Mất &gt;30 phút để ngủ — số lần/tuần</label>
        <select id="f_psqi5a" onchange="calcPSQI()">
          <option value="">Chọn...</option>
          <option value="0">Không lần nào (0)</option>
          <option value="1">&lt;1 lần/tuần (1)</option>
          <option value="2">1–2 lần/tuần (2)</option>
          <option value="3">≥3 lần/tuần (3)</option>
        </select>
      </div>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:10px 0 8px">PSQI-5b đến 5j: Trong tháng qua gặp vấn đề này bao nhiêu lần?</div>
    <div class="q-list">${psqi5Cards}</div>
    <div class="form-row" style="margin-top:10px">
      <div class="form-group">
        <label>Dùng thuốc ngủ/tuần — PSQI-7</label>
        <select id="f_psqi7" onchange="calcPSQI()">
          <option value="">Chọn...</option>
          <option value="0">Không (0)</option>
          <option value="1">&lt;1/tuần (1)</option>
          <option value="2">1–2/tuần (2)</option>
          <option value="3">≥3/tuần (3)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Khó giữ tỉnh táo ban ngày — PSQI-8</label>
        <select id="f_psqi8" onchange="calcPSQI()">
          <option value="">Chọn...</option>
          <option value="0">Không (0)</option>
          <option value="1">&lt;1/tuần (1)</option>
          <option value="2">1–2/tuần (2)</option>
          <option value="3">≥3/tuần (3)</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Ảnh hưởng sinh hoạt hàng ngày — PSQI-9</label>
        <select id="f_psqi9" onchange="calcPSQI()">
          <option value="">Chọn...</option>
          <option value="0">Không ảnh hưởng (0)</option>
          <option value="1">Ảnh hưởng nhẹ (1)</option>
          <option value="2">Ảnh hưởng vừa (2)</option>
          <option value="3">Ảnh hưởng nhiều (3)</option>
        </select>
      </div>
    </div>
    <div class="score-row" id="psqi-score">
      <div class="score-cell"><div class="score-val" id="psqi-total">—</div><div class="score-lbl">Tổng PSQI (/21)</div></div>
      <div class="score-cell"><div class="score-val" id="psqi-interp" style="font-size:13px"></div><div class="score-lbl">Phân loại</div></div>
    </div>
  </div>`;
}

function buildStep3() {
  const hlLabels = ["1","2","3","4","5"];
  const hlItems  = window.HL_ITEMS || [];
  const hlCards  = hlItems
    .map((q,i) => `
      <div class="q-card">
        <div class="q-text" style="margin-bottom:8px">${q}</div>
        <div class="opt-row">
          ${hlLabels.map((lbl,vi) => `<label class="opt-chip" onclick="selectChip(this)"><input type="radio" name="hl_${i}" value="${vi+1}"><span>${lbl}</span></label>`).join("")}
        </div>
      </div>`).join("");

  // [FIX#5] Select "vận động": option đầu có value rõ ràng (không để trống)
  // [FIX#4] Select khác: thêm option trống "Chọn..." để tránh default value ngầm
  document.getElementById("step3").innerHTML = `
  <div class="card">
    <div class="card-title">C1. Thông tin phẫu thuật thực tế</div>
    <div class="form-row">
      <div class="form-group"><label>Ngày phẫu thuật thực tế <span class="req">*</span></label><input type="date" id="f_ngayPTthuc"></div>
      <div class="form-group"><label>Thời gian phẫu thuật (phút)</label><input type="number" id="f_tgPT" placeholder="90"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Phương pháp PT thực tế</label><input id="f_ppPTthuc"></div>
      <div class="form-group"><label>Phương pháp vô cảm thực tế</label><input id="f_voCamThuc"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Mất máu ước tính (mL)</label><input type="number" id="f_matMau" placeholder="200"></div>
      <div class="form-group">
        <label>Truyền máu</label>
        <select id="f_truyenMau">
          <option value="">Chọn...</option>
          <option value="Không">Không</option>
          <option value="Có">Có</option>
        </select>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">C2. Đau sau phẫu thuật (VAS ngày 1–3)</div>
    ${[1,2,3].map(d=>`
    <div style="margin-bottom:12px"><label style="font-size:12px;color:var(--text-muted)">Ngày ${d} sau mổ</label>
    <div class="vas-wrap"><span style="font-size:11px;color:var(--text-muted);min-width:18px;">0</span><input type="range" min="0" max="10" step="1" id="f_vas${d}" value="0" oninput="document.getElementById('vasv${d}').textContent=this.value"><span class="vas-num" id="vasv${d}">0</span><span style="font-size:11px;color:var(--text-muted);">10</span></div></div>`).join("")}
  </div>
  <div class="card">
    <div class="card-title">C4. Vận động sớm & biến chứng</div>
    <div class="form-row">
      <div class="form-group">
        <label>Thời điểm vận động đầu tiên</label>
        <select id="f_vanDong">
          <option value="">Chọn...</option>
          <option value="<12h">&lt;12h</option>
          <option value="12–24h">12–24h</option>
          <option value="24–48h">24–48h</option>
          <option value=">48h">&gt;48h</option>
          <option value="Chưa vận động được">Chưa vận động được</option>
        </select>
      </div>
      <div class="form-group">
        <label>Khả năng tự vận động ngày 1</label>
        <select id="f_khanangVD">
          <option value="">Chọn...</option>
          <option value="Tốt">Tốt</option>
          <option value="Trung bình">Trung bình</option>
          <option value="Kém">Kém</option>
          <option value="Không thể">Không thể</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Biến chứng sau PT</label>
        <select id="f_bienChung">
          <option value="">Chọn...</option>
          <option value="Không có">Không có</option>
          <option value="Chảy máu/tụ máu">Chảy máu/tụ máu</option>
          <option value="Nhiễm trùng vết mổ">Nhiễm trùng vết mổ</option>
          <option value="DVT">DVT</option>
          <option value="Thuyên tắc phổi">Thuyên tắc phổi</option>
          <option value="Đau khó kiểm soát">Đau khó kiểm soát</option>
          <option value="Khác">Khác</option>
        </select>
      </div>
      <div class="form-group"><label>Thời gian nằm viện sau PT (ngày)</label><input type="number" id="f_tgNamVien" placeholder="3"></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">C7. Mức độ hài lòng (Likert 1–5)</div>
    <div class="q-list">${hlCards}</div>
    <div class="form-row full" style="margin-top:10px"><div class="form-group"><label>Nhận xét / góp ý của bệnh nhân</label><textarea id="f_nhanXet" placeholder="Ghi tự do..."></textarea></div></div>
  </div>`;
}

// ── Score calculations ────────────────────────────────────────
function calcHADS() {
  let A = 0, D = 0, tA = 0, tD = 0;
  HADS_DATA.forEach(h => {
    const sel = document.querySelector(`input[name="hads_${h.id}"]:checked`);
    if (sel) { if (h.t === "A") { A += +sel.value; tA++; } else { D += +sel.value; tD++; } }
  });
  const aEl = document.getElementById("h-a"),   dEl = document.getElementById("h-d");
  const aiEl = document.getElementById("h-ai"), diEl = document.getElementById("h-di");
  if (aEl)  aEl.textContent = tA === 7 ? A : "—";
  if (dEl)  dEl.textContent = tD === 7 ? D : "—";
  const interp = s => s >= 11 ? "Rối loạn" : s >= 8 ? "Nguy cơ" : "Bình thường";
  const clr    = s => s >= 11 ? "var(--red)" : s >= 8 ? "var(--amber)" : "var(--green)";
  if (aiEl && tA === 7) { aiEl.textContent = interp(A); aiEl.style.color = clr(A); }
  if (diEl && tD === 7) { diEl.textContent = interp(D); diEl.style.color = clr(D); }
}

function calcPSQI() {
  const gi = id => {
    const el = document.getElementById(id);
    if (!el || el.value === "") return null;
    return parseInt(el.value) || 0;
  };
  const gf = id => {
    const el = document.getElementById(id);
    if (!el || el.value === "") return null;
    return parseFloat(el.value) || 0;
  };

  const psqi6 = gi("f_psqi6");
  const C1  = psqi6 !== null ? psqi6 : 0;

  const p2  = gf("f_psqi2"), p5a = gi("f_psqi5a");
  const c2r = p2 === null ? 0 : p2 <= 15 ? 0 : p2 <= 30 ? 1 : p2 <= 60 ? 2 : 3;
  const C2  = (p5a !== null) ? Math.round((c2r + p5a) / 2) : c2r;

  const p4  = gf("f_psqi4");
  const C3  = p4 === null ? 0 : p4 > 7 ? 0 : p4 >= 6 ? 1 : p4 >= 5 ? 2 : 3;

  let C4 = 0;
  const t1 = (document.getElementById("f_psqi1")?.value || "").split(":");
  const t3 = (document.getElementById("f_psqi3")?.value || "").split(":");
  if (t1.length === 2 && t3.length === 2 && p4 !== null && p4 > 0) {
    const bed = +t1[0]*60 + +t1[1], wake = +t3[0]*60 + +t3[1];
    const inBed = wake > bed ? wake - bed : wake + 1440 - bed;
    const eff   = inBed > 0 ? p4 * 60 / inBed * 100 : 0;
    C4 = eff >= 85 ? 0 : eff >= 75 ? 1 : eff >= 65 ? 2 : 3;
  }

  let dist = 0;
  for (let i = 0; i < 9; i++) { const s = document.querySelector(`input[name="psqi_5_${i}"]:checked`); if (s) dist += +s.value; }
  const C5 = dist === 0 ? 0 : dist <= 9 ? 1 : dist <= 18 ? 2 : 3;

  const psqi7 = gi("f_psqi7"); const C6 = psqi7 !== null ? psqi7 : 0;
  const psqi8 = gi("f_psqi8"); const psqi9 = gi("f_psqi9");
  const C7 = (psqi8 !== null && psqi9 !== null) ? Math.round((psqi8 + psqi9) / 2) : 0;

  const total = C1 + C2 + C3 + C4 + C5 + C6 + C7;
  const tv = document.getElementById("psqi-total"), ti = document.getElementById("psqi-interp");
  if (tv) tv.textContent = total;
  if (ti) { ti.textContent = total >= 5 ? "Kém (≥5)" : "Tốt (<5)"; ti.style.color = total >= 5 ? "var(--red)" : "var(--green)"; }
}

// ── Selection highlight ───────────────────────────────────────
function selectOpt(label) {
  const input = label.querySelector("input[type=radio]");
  if (!input) return;
  const name = input.name;
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
    r.closest(".opt-label")?.classList.remove("opt-selected");
  });
  label.classList.add("opt-selected");
}

function selectChip(label) {
  const input = label.querySelector("input[type=radio]");
  if (!input) return;
  const name = input.name;
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
    r.closest(".opt-chip")?.classList.remove("chip-selected");
  });
  label.classList.add("chip-selected");
}

function restoreSelectionHighlights() {
  document.querySelectorAll(".opt-label input[type=radio]:checked").forEach(r => {
    r.closest(".opt-label")?.classList.add("opt-selected");
  });
  document.querySelectorAll(".opt-chip input[type=radio]:checked").forEach(r => {
    r.closest(".opt-chip")?.classList.add("chip-selected");
  });
}

// ── DOMContentLoaded ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  ensureFooterControls();
  ensureModeBanner();
  bindAutosave();
  document.getElementById("btn-dash")?.addEventListener("click", () => { showScreen("dash"); loadDanhSach(); });
  document.getElementById("btn-new-top")?.addEventListener("click", () => showScreen("new"));
});