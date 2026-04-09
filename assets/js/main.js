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
let tongHopCache       = null; // thống kê toàn hệ thống
let dashboardFilter    = "all";
let dashboardQuery     = "";
let draftSaveTimer     = null;
let dashboardPage      = 1;
const PAGE_SIZE        = 20;

const LOCAL_DRAFT_KEY = "phieu_local_drafts_v3";

// ── Auth ─────────────────────────────────────────────────────
const SESSION_KEY = "phieu_session_v1";

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username: user.username, ts: Date.now() }));
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s?.username || !USERS[s.username]) return null;
    return { username: s.username, ...USERS[s.username] };
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function updateAvatar(user) {
  const wrap = document.getElementById("avatar-wrap");
  const btn  = document.getElementById("avatar-btn");
  const ini  = document.getElementById("avatar-initials");
  const nm   = document.getElementById("avatar-menu-name");
  const rl   = document.getElementById("avatar-menu-role");
  if (!wrap) return;
  if (user) {
    const initials = (user.name || user.username || "?").slice(0, 2).toUpperCase();
    ini.textContent = initials;
    nm.textContent  = user.name || user.username;
    rl.textContent  = user.role === "admin" ? "Quản trị viên" : "Điều tra viên";
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    // Màu avatar khác nhau theo role
    btn.style.background = user.role === "admin" ? "var(--primary)" : "var(--teal-600,#0f6e56)";
  } else {
    wrap.style.display = "none";
  }
}

function toggleAvatarMenu() {
  const menu = document.getElementById("avatar-menu");
  if (!menu) return;
  const isOpen = menu.style.display === "block";
  menu.style.display = isOpen ? "none" : "block";
  // Đóng khi click ra ngoài
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener("click", function closeMenu(e) {
        if (!document.getElementById("avatar-wrap")?.contains(e.target)) {
          menu.style.display = "none";
          document.removeEventListener("click", closeMenu);
        }
      });
    }, 0);
  }
}

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
  saveSession(currentUser);
  updateAvatar(currentUser);
  resetIdleTimer();
  showScreen("dash");
  loadDanhSach();
}

function doLogout(silent = false) {
  if (!silent && !confirm("Đăng xuất khỏi tài khoản " + (currentUser?.name || "") + "?")) return;
  // Lưu draft đang điền trước khi đăng xuất (nếu đang ở form)
  if (document.getElementById("screen-new")?.classList.contains("active")) {
    saveLocalProgress(false);
  }
  stopIdleTimer();
  clearSession();
  currentUser = null;
  updateAvatar(null);
  const menu = document.getElementById("avatar-menu");
  if (menu) menu.style.display = "none";
  document.getElementById("inp-user").value = "";
  document.getElementById("inp-pass").value = "";
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-login").classList.add("active");
  document.getElementById("btn-dash").style.display    = "none";
  document.getElementById("btn-new-top").style.display = "none";
}

// ── Idle timeout (4 giờ không thao tác → đăng xuất im lặng) ─
const IDLE_TIMEOUT_MS  = 4 * 60 * 60 * 1000; // 4 giờ
let idleTimer          = null;

function resetIdleTimer() {
  if (!currentUser) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    doLogout(true);
  }, IDLE_TIMEOUT_MS);
}

function stopIdleTimer() {
  clearTimeout(idleTimer);
}

function bindIdleEvents() {
  ["mousemove","mousedown","keydown","touchstart","scroll","click"].forEach(ev => {
    document.addEventListener(ev, () => { if (currentUser) resetIdleTimer(); }, { passive: true });
  });
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
  // buoc từ Sheets có thể là datetime object (Sheets bug) — cần parse số thuần
  const parseBuoc = v => {
    if (!v && v !== 0) return 0;
    const n = parseInt(String(v), 10);       // parseInt("3") = 3, parseInt("Thu Jan...") = NaN
    return (!isNaN(n) && n >= 1 && n <= 3) ? n : 0;
  };
  merged.buoc       = Math.max(parseBuoc(remote?.buoc), parseBuoc(local?.buoc), 1);
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

// Trạng thái phiếu:
// - "Hoàn thành" = đã lưu đủ 3 bước (buoc >= 3) và đã sync lên server
// - "Phiếu mới"  = chưa điền trường nào (buoc = 0 hoặc 1 và chỉ là nháp chưa gửi)
// - "Nháp máy"   = local_only (chưa bao giờ lên server)
// - "Chưa đồng bộ" = có thay đổi chưa sync
// - "Đang điền"  = còn lại (đã có trên server nhưng chưa đủ 3 bước)
function getRecordStatus(record) {
  if (record.local_only && (record.buoc || 0) <= 1) return { text: "Phiếu mới",      cls: "badge-gray"   };
  if (record.local_only)                            return { text: "Nháp trên máy",   cls: "badge-purple" };
  if (record.has_local && !record.synced)           return { text: "Chưa đồng bộ",    cls: "badge-purple" };
  if ((record.buoc || 0) >= 3)                      return { text: "Hoàn thành",      cls: "badge-green"  };
  if ((record.buoc || 0) <= 1 && !record.has_local) return { text: "Phiếu mới",      cls: "badge-gray"   };
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
    // Khởi tạo 1 hàng thuốc trống cho mỗi ngày
    [1, 2, 3].forEach(d => applyThuocNgay(d, ""));
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
  data.updated_by     = currentUser?.name || "";
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
    data.updated_by    = currentUser?.name || "";
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

// Mapping field → bước (mirror của AppScript STEP*_MAP)
const STEP1_FIELDS = new Set([
  "ho_ten","so_ho_so","ngay_sinh","gioi_tinh","nghe_nghiep","dia_chi","hoc_van","dan_toc",
  "ngay_nhap_vien","ngay_pt_du_kien","can_nang","chieu_cao","bmi",
  "chan_doan","loai_pt","vung_pt","pp_pt","vo_cam","vas_nhap_vien","dieu_tra_vien","updated_by"
]);
const STEP2_FIELDS = new Set([
  "hads_1","hads_2","hads_3","hads_4","hads_5","hads_6","hads_7",
  "hads_8","hads_9","hads_10","hads_11","hads_12","hads_13","hads_14",
  "psqi1","psqi2","psqi3","psqi4","psqi5a","psqi6",
  "psqi_5_0","psqi_5_1","psqi_5_2","psqi_5_3","psqi_5_4",
  "psqi_5_5","psqi_5_6","psqi_5_7","psqi_5_8",
  "psqi7","psqi8","psqi9","psqi5j_text"
]);
const STEP3_FIELDS = new Set([
  "ngay_pt_thuc","tg_pt","pp_pt_thuc","vo_cam_thuc","mat_mau","truyen_mau",
  "vas1","vas2","vas3","van_dong","kha_nang_vd","bien_chung","tg_nam_vien",
  "thuoc_ngay_1","thuoc_ngay_2","thuoc_ngay_3",
  // backward-compat với phiếu cũ
  "thuoc_nhom1","thuoc_lieu1","thuoc_hq1","thuoc_tdp1",
  "thuoc_nhom2","thuoc_lieu2","thuoc_hq2","thuoc_tdp2",
  "thuoc_nhom3","thuoc_lieu3","thuoc_hq3","thuoc_tdp3",
  "hl_0","hl_1","hl_2","hl_3","hl_4","nhan_xet"
]);

// So sánh 2 giá trị — coi null/""/undefined là như nhau
function valChanged(a, b) {
  const empty = v => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return false;
  return String(a ?? "") !== String(b ?? "");
}

// Phát hiện bước nào có field thay đổi so với snapshot
function detectChangedSteps(current, snapshot) {
  const changed = new Set();
  for (const [k, v] of Object.entries(current)) {
    if (k === "ma_phieu") continue;
    if (!valChanged(v, snapshot[k])) continue;
    if (STEP1_FIELDS.has(k)) changed.add(1);
    else if (STEP2_FIELDS.has(k)) changed.add(2);
    else if (STEP3_FIELDS.has(k)) changed.add(3);
  }
  return changed;
}

// [FIX-UPDATE] Chỉ gửi bước nào có thay đổi so với data đã lưu trên server
async function saveAllStepsUpdate() {
  const errors = validateStep(currentStep);
  if (errors.length > 0) {
    showAlert("form-alert", "Vui lòng điền đầy đủ: " + errors.join(" · "), "error");
    return;
  }
  // Merge bước đang chỉnh vào draft local
  saveLocalProgress(false);
  showLoading(true);
  try {
    const draft    = getLocalDraft(currentMaPhieu) || {};
    const newData  = { ...(draft.data || {}), ma_phieu: currentMaPhieu };
    const dtv      = currentUser?.name || "";

    // Snapshot = data từ server (remote cache) — dùng để so sánh
    const remote   = danhSachCache.find(r => r.ma_phieu === currentMaPhieu) || {};

    // Phát hiện bước nào thay đổi
    const changedSteps = detectChangedSteps(newData, remote);

    if (changedSteps.size === 0) {
      showAlert("form-alert", "Không có dữ liệu nào thay đổi so với bản đã lưu.", "info");
      showLoading(false);
      return;
    }

    // Gửi song song chỉ những bước có thay đổi
    const tasks = [...changedSteps].map(buoc =>
      apiPost({ ...newData, buoc, dieu_tra_vien: dtv, updated_by: dtv })
        .then(() => ({ buoc, ok: true }))
        .catch(e => ({ buoc, ok: false, err: e.message }))
    );
    const results = await Promise.all(tasks);

    const failed  = results.filter(r => !r.ok);
    const success = results.filter(r => r.ok);

    if (failed.length === 0) {
      upsertLocalDraft({
        ...draft,
        ma_phieu:   currentMaPhieu,
        buoc:       3,
        last_step:  currentStep,
        updated_at: new Date().toISOString(),
        local_only: false,
        synced:     true,
        user:       dtv,
        data:       newData,
      });
      const label = [...changedSteps].map(b => `Bước ${b}`).join(", ");
      showAlert("form-alert", `✓ Đã cập nhật ${label} lên Google Sheets.`, "success");
      updateFooterStatus(`Đã lưu hệ thống lúc ${formatWhen(new Date().toISOString())}`);
      // Cập nhật remote cache để lần sau so sánh đúng
      const idx = danhSachCache.findIndex(r => r.ma_phieu === currentMaPhieu);
      if (idx >= 0) danhSachCache[idx] = { ...danhSachCache[idx], ...newData };
    } else {
      const errMsg = failed.map(r => `Bước ${r.buoc}: ${r.err}`).join(" · ");
      showAlert("form-alert",
        `Lưu được ${success.length}/${results.length} bước. Lỗi: ${errMsg}`,
        "error"
      );
    }
  } catch (e) {
    showAlert("form-alert", `Lỗi: ${e.message}`, "error");
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
    if (!get("f_hoSo"))         errors.push("Mã BN");
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
    data.updated_by    = currentUser?.name || "";
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
    // admin truyền user="all" để lấy toàn bộ, user thường truyền tên mình
    const userParam = currentUser?.role === "admin" ? "all" : (currentUser?.name || "");
    const res = await apiGet("danh-sach", { user: userParam });
    console.log("[loadDanhSach] raw response:", JSON.stringify(res)?.slice(0, 300));
    danhSachCache = Array.isArray(res) ? res : (res.data || res.items || []);
    console.log("[loadDanhSach] cache size:", danhSachCache.length, "| first ma_phieu:", danhSachCache[0]?.ma_phieu);
    renderDashboard();
    hideAlert("dash-alert");
    loadTongHop(); // cập nhật thống kê toàn hệ thống
  } catch (e) {
    danhSachCache = Array.isArray(danhSachCache) ? danhSachCache : [];
    renderDashboard();
    showAlert("dash-alert",
      "Không kết nối được API. Vẫn có thể tiếp tục các phiếu nháp đã lưu trên máy. (" + e.message + ")",
      "error"
    );
  }
}

async function loadTongHop() {
  try {
    const res = await apiGet("tong-hop");
    tongHopCache = res;
  } catch (e) {
    tongHopCache = null; // network lỗi → ẩn khung đi, không crash
  }
  renderTongHop();
}

function renderTongHop() {
  const el = document.getElementById("tonghop-grid");
  if (!el) return;
  const d = tongHopCache;
  if (!d) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">Không tải được dữ liệu thống kê.</div>';
    return;
  }

  // Thanh tiến độ % hoàn thành
  const pct = d.tong > 0 ? Math.round(d.hoan_thanh / d.tong * 100) : 0;

  // Bảng theo điều tra viên
  const dtvRows = (d.theo_dtv || []).map(dtv => {
    const p = dtv.tong > 0 ? Math.round(dtv.hoan_thanh / dtv.tong * 100) : 0;
    return `<tr>
      <td style="padding:5px 8px;">${escapeHtml(dtv.ten)}</td>
      <td style="padding:5px 8px;text-align:center;">${dtv.tong}</td>
      <td style="padding:5px 8px;text-align:center;">${dtv.hoan_thanh}</td>
      <td style="padding:5px 8px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="flex:1;background:var(--border);border-radius:4px;height:6px;overflow:hidden;">
            <div style="width:${p}%;background:var(--primary);height:6px;border-radius:4px;transition:width .4s;"></div>
          </div>
          <span style="font-size:11px;color:var(--text-muted);min-width:30px;">${p}%</span>
        </div>
      </td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
      <div class="stat-card" style="border-color:var(--primary);"><div class="stat-num">${d.tong}</div><div class="stat-lbl">Tổng toàn bộ</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--green)">${d.hoan_thanh}</div><div class="stat-lbl">Hoàn thành</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--amber)">${d.dang_dien}</div><div class="stat-lbl">Đang điền</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--text-muted)">${d.moi}</div><div class="stat-lbl">Chưa điền</div></div>
    </div>
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px;">
        <span>Tiến độ hoàn thành</span><span>${pct}%</span>
      </div>
      <div style="background:var(--border);border-radius:6px;height:8px;overflow:hidden;">
        <div style="width:${pct}%;background:var(--primary);height:8px;border-radius:6px;transition:width .6s;"></div>
      </div>
    </div>
    ${dtvRows ? `
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Theo điều tra viên</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:var(--surface-raised,#f5f5f5);">
            <th style="padding:5px 8px;text-align:left;font-weight:600;">Điều tra viên</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">Tổng</th>
            <th style="padding:5px 8px;text-align:center;font-weight:600;">Hoàn thành</th>
            <th style="padding:5px 8px;text-align:left;font-weight:600;">Tiến độ</th>
          </tr>
        </thead>
        <tbody>${dtvRows}</tbody>
      </table>
    </div>` : ""}
  `;
}

function renderDashboard() {
  const records         = getManagedRecords();
  const normalizedQuery = dashboardQuery.trim().toLowerCase();
  const filtered        = records.filter(record => {
    const hay    = `${record.ma_phieu || ""} ${record.ho_ten || ""} ${record.so_ho_so || ""}`.toLowerCase();
    const matchQ = !normalizedQuery || hay.includes(normalizedQuery);
    const matchF = dashboardFilter === "all"
      || (dashboardFilter === "draft"    && getRecordStatus(record).text === "Phiếu mới")
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
    <div class="stat-card"><div class="stat-num">${records.filter(r => getRecordStatus(r).text === "Phiếu mới").length}</div><div class="stat-lbl">Phiếu mới</div></div>
    <div class="stat-card"><div class="stat-num">${records.filter(r => getRecordStatus(r).text === "Đang điền").length}</div><div class="stat-lbl">Đang điền</div></div>
    <div class="stat-card"><div class="stat-num">${records.filter(r => getRecordStatus(r).text === "Hoàn thành").length}</div><div class="stat-lbl">Hoàn thành</div></div>
  `;

  const isAdmin = currentUser?.role === "admin";
  const cards = pageRecords.map(record => {
    const status     = getRecordStatus(record);
    const actionText = (record.buoc || 0) >= 3 ? "Cập nhật" : "Tiếp tục";
    const dtv        = record.dieu_tra_vien || record.user || "";
    return `
      <div class="phieu-item">
        <div class="phieu-head">
          <div>
            <div class="phieu-name">${escapeHtml(record.ho_ten || "(Chưa có tên bệnh nhân)")}</div>
            <div class="phieu-sub">Mã phiếu: ${escapeHtml(record.ma_phieu || "")} · ${record.so_ho_so ? "Mã BN: " + escapeHtml(record.so_ho_so) + " · " : ""}${record.updated_at ? "Cập nhật: " + escapeHtml(formatWhen(record.updated_at)) : "Chưa có thời gian"}</div>
          </div>
          <div class="phieu-actions">
            <button class="btn btn-sm btn-primary" onclick="openRecordByMa('${escapeHtml(record.ma_phieu)}')">${actionText}</button>
            ${record.has_local ? `<button class="btn btn-sm" onclick="deleteLocalDraftOnly('${escapeHtml(record.ma_phieu)}')">Xóa nháp máy</button>` : ""}
            ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="deleteRecord('${escapeHtml(record.ma_phieu)}')">🗑 Xóa</button>` : ""}
          </div>
        </div>
        <div class="phieu-meta">
          <span class="badge ${status.cls}">${escapeHtml(status.text)}</span>
          <span class="badge badge-blue">${escapeHtml(getStepLabel(record))}</span>
          ${dtv ? `<span class="badge badge-gray">👤 ${escapeHtml(dtv)}</span>` : ""}
          ${record.updated_by && record.updated_by !== dtv ? `<span class="badge badge-blue" title="Người sửa gần nhất">✏️ ${escapeHtml(record.updated_by)}</span>` : ""}
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
        <button data-filter="draft"    class="${dashboardFilter === "draft"    ? "active" : ""}">Phiếu mới</button>
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
      || (dashboardFilter === "draft"    && getRecordStatus(record).text === "Phiếu mới")
      || (dashboardFilter === "progress" && !record.local_only && (record.buoc || 0) < 3)
      || (dashboardFilter === "done"     && (record.buoc || 0) >= 3);
    return matchQ && matchF;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  dashboardPage    = Math.max(1, Math.min(page, totalPages));
  renderDashboard();
}

async function openRecordByMa(ma) {
  const record = getMergedRecordByMa(ma);

  // Nếu không có local draft (phiếu của người khác hoặc chưa từng mở),
  // fetch đầy đủ 3 bước từ server trước khi mở form
  const hasLocal = Boolean(getLocalDraft(ma));
  if (!hasLocal && !record.local_only) {
    showAlert("dash-alert", `Đang tải phiếu ${ma}...`, "info");
    try {
      const res = await apiGet("get", { ma });
      hideAlert("dash-alert");
      const fullData = res?.data || res || {};
      // Merge với record dashboard (bước 1) để không mất thông tin
      const merged = { ...record, ...fullData };
      showScreen("new", {
        record: merged,
        step:   Math.min(Math.max(merged.buoc || 1, 1), 3),
        source: "remote",
      });
    } catch (e) {
      hideAlert("dash-alert");
      showAlert("dash-alert", `Không tải được dữ liệu phiếu (${e.message}). Thử lại hoặc kiểm tra mạng.`, "error");
    }
    return;
  }

  // Có local draft → mở bình thường
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

// Xóa phiếu hoàn toàn (admin only) — local + server
async function deleteRecord(ma) {
  if (!confirm(`Xóa hoàn toàn phiếu ${ma}?\n\nHành động này không thể hoàn tác — phiếu sẽ bị xóa khỏi Google Sheets.`)) return;
  // Xóa local draft ngay
  removeLocalDraft(ma);
  // Cập nhật cache ngay để UI phản hồi nhanh
  danhSachCache = danhSachCache.filter(r => r.ma_phieu !== ma);
  renderDashboard();
  // Gọi API xóa server
  try {
    showAlert("dash-alert", `Đang xóa phiếu ${ma} trên server...`, "info");
    const url = new URL(API_URL);
    url.searchParams.set("action", "delete");
    url.searchParams.set("ma_phieu", ma);
    url.searchParams.set("dieu_tra_vien", currentUser?.name || "");
    const res  = await fetch(url.toString());
    const text = await res.text();
    const data = JSON.parse(text);
    if (data?.success) {
      showAlert("dash-alert", `✓ Đã xóa phiếu ${ma} khỏi Google Sheets.`, "success");
    } else {
      showAlert("dash-alert", `Xóa local thành công nhưng server báo lỗi: ${data?.error || "không rõ"}. Kiểm tra GAS.`, "error");
    }
  } catch (e) {
    showAlert("dash-alert", `Đã xóa local. Không kết nối được server để xóa trên Sheets (${e.message}).`, "error");
  }
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
  psqi5j_text: "f_psqi5j_text",
  ngay_pt_thuc: "f_ngayPTthuc", tg_pt: "f_tgPT", pp_pt_thuc: "f_ppPTthuc",
  vo_cam_thuc: "f_voCamThuc", mat_mau: "f_matMau", truyen_mau: "f_truyenMau",
  vas1: "f_vas1", vas2: "f_vas2", vas3: "f_vas3",
  van_dong: "f_vanDong", kha_nang_vd: "f_khanangVD", bien_chung: "f_bienChung",
  tg_nam_vien: "f_tgNamVien", nhan_xet: "f_nhanXet",
};

// [FIX-DATE] Google Sheets tự convert string thành Date object khi đọc lại:
// - "2000-01-15" → Date → normalizeValue trả về "2000-01-15T00:00:00+07:00"
//   → <input type="date"> chỉ nhận "YYYY-MM-DD"
// - "22:30" (giờ ngủ) → Date (hôm nay lúc 22:30) → "2026-04-06T22:30:00+07:00"
//   → <input type="time"> chỉ nhận "HH:MM"
// - 30.0 (số phút) → cần String để gán vào input

const DATE_FIELDS = new Set(["ngay_sinh","ngay_nhap_vien","ngay_pt_du_kien","ngay_pt_thuc"]);
const TIME_FIELDS = new Set(["psqi1","psqi3"]);

function normalizeDateForInput(field, value) {
  if (!value && value !== 0) return value;
  const s = String(value);

  // Trường giờ (HH:MM) — Sheets biến "22:30" → ISO datetime
  if (TIME_FIELDS.has(field)) {
    // ISO datetime "2026-04-06T22:30:00+07:00" → lấy "HH:MM" từ phần T
    const tMatch = s.match(/T(\d{2}:\d{2})/);
    if (tMatch) return tMatch[1];
    // Đã đúng dạng HH:MM rồi
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    return value;
  }

  // Trường ngày (YYYY-MM-DD)
  if (DATE_FIELDS.has(field)) {
    const tIdx = s.indexOf("T");
    if (tIdx > 0) return s.slice(0, tIdx);
    const dmyMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    return value;
  }

  return value;
}

// Các field là select với option value là số nguyên — nếu server trả về float (1.0) thì không khớp
const INT_FIELDS = new Set(["psqi5a","psqi6","psqi7","psqi8","psqi9"]);

function applyFormData(data = {}) {
  Object.entries(FIELD_ID_MAP).forEach(([field, id]) => {
    const el = document.getElementById(id);
    if (!el || data[field] === undefined || data[field] === null || data[field] === "") return;
    let val = normalizeDateForInput(field, data[field]);
    // Float → int cho các select dùng option value số nguyên
    if (INT_FIELDS.has(field) && val !== "" && val !== null) val = String(parseInt(val, 10));
    el.value = val;
  });
  // [FIX-FLOAT] Server có thể trả về 0.0, 1.0 thay vì 0, 1
  // → querySelector [value="0.0"] không tìm được radio có value="0" → dùng parseInt
  for (let i = 1; i <= 14; i++) {
    const v = data[`hads_${i}`];
    if (v === undefined || v === null || v === "") continue;
    const r = document.querySelector(`input[name="hads_${i}"][value="${parseInt(v, 10)}"]`);
    if (r) r.checked = true;
  }
  for (let i = 0; i < 9; i++) {
    const v = data[`psqi_5_${i}`];
    if (v === undefined || v === null || v === "") continue;
    const r = document.querySelector(`input[name="psqi_5_${i}"][value="${parseInt(v, 10)}"]`);
    if (r) r.checked = true;
  }
  for (let i = 0; i < 5; i++) {
    const v = data[`hl_${i}`];
    if (v === undefined || v === null || v === "") continue;
    const r = document.querySelector(`input[name="hl_${i}"][value="${parseInt(v, 10)}"]`);
    if (r) r.checked = true;
  }
  // Thuốc động: ưu tiên thuoc_ngay_*, fallback về field cũ nếu có
  [1, 2, 3].forEach(d => {
    if (data[`thuoc_ngay_${d}`]) {
      applyThuocNgay(d, data[`thuoc_ngay_${d}`]);
    } else if (data[`thuoc_nhom${d}`]) {
      // backward-compat: convert field cũ sang 1 hàng
      applyThuocNgay(d, JSON.stringify([{
        nhom: data[`thuoc_nhom${d}`] || "",
        lieu: data[`thuoc_lieu${d}`] || "",
        hq:   data[`thuoc_hq${d}`]   || "",
        tdp:  data[`thuoc_tdp${d}`]  || "",
      }]));
    } else {
      applyThuocNgay(d, "");
    }
  });
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
    d.psqi5j_text = getText("f_psqi5j_text");
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
    thuoc_ngay_1: collectThuocNgay(1),
    thuoc_ngay_2: collectThuocNgay(2),
    thuoc_ngay_3: collectThuocNgay(3),
    van_dong:      getText("f_vanDong"),
    kha_nang_vd:   getText("f_khanangVD"),
    bien_chung:    getText("f_bienChung"),
    tg_nam_vien:   getNum("f_tgNamVien"),

    hl_0: radio("hl_0"), hl_1: radio("hl_1"), hl_2: radio("hl_2"),
    hl_3: radio("hl_3"), hl_4: radio("hl_4"),
    nhan_xet:      getText("f_nhanXet"),
  };
}

// ── Thuốc động (dynamic drug rows) ──────────────────────────
const MAX_THUOC_PER_NGAY = 0; // 0 = không giới hạn

// Tạo HTML cho một hàng thuốc
function renderThuocRow(ngay, idx, data = {}) {
  const rowId = `thuoc_d${ngay}_r${idx}`;
  const canDelete = idx > 0; // hàng đầu không xóa được
  return `
  <div class="thuoc-row" id="${rowId}" data-ngay="${ngay}" data-idx="${idx}">
    <div class="thuoc-row-head">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);">Thuốc ${idx + 1}</span>
      ${canDelete ? `<button type="button" class="btn-remove-thuoc" onclick="removeThuocRow(${ngay},${idx})" title="Xóa thuốc này">✕</button>` : ""}
    </div>
    <div class="form-row" style="margin-bottom:0">
      <div class="form-group">
        <label>Nhóm thuốc</label>
        <select id="${rowId}_nhom">
          <option value="">Chọn...</option>
          <option value="Không dùng"${data.nhom==="Không dùng"?" selected":""}>Không dùng</option>
          <option value="Paracetamol"${data.nhom==="Paracetamol"?" selected":""}>Paracetamol</option>
          <option value="NSAID"${data.nhom==="NSAID"?" selected":""}>NSAID (Ibuprofen, Diclofenac...)</option>
          <option value="Opioid yếu"${data.nhom==="Opioid yếu"?" selected":""}>Opioid yếu (Tramadol, Codeine...)</option>
          <option value="Opioid mạnh"${data.nhom==="Opioid mạnh"?" selected":""}>Opioid mạnh (Morphine, Fentanyl...)</option>
          <option value="Phối hợp"${data.nhom==="Phối hợp"?" selected":""}>Phối hợp nhiều nhóm</option>
          <option value="Khác"${data.nhom==="Khác"?" selected":""}>Khác</option>
        </select>
      </div>
      <div class="form-group">
        <label>Liều lượng / đường dùng</label>
        <input type="text" id="${rowId}_lieu" value="${data.lieu||""}" placeholder="VD: 1g TM x3/ngày">
      </div>
    </div>
    <div class="form-row" style="margin-bottom:0;margin-top:8px;">
      <div class="form-group">
        <label>Hiệu quả giảm đau</label>
        <select id="${rowId}_hq">
          <option value="">Chọn...</option>
          <option value="Tốt"${data.hq==="Tốt"?" selected":""}>Tốt — giảm đau rõ rệt</option>
          <option value="Trung bình"${data.hq==="Trung bình"?" selected":""}>Trung bình — giảm một phần</option>
          <option value="Kém"${data.hq==="Kém"?" selected":""}>Kém — ít hoặc không giảm</option>
          <option value="Không đánh giá được"${data.hq==="Không đánh giá được"?" selected":""}>Không đánh giá được</option>
        </select>
      </div>
      <div class="form-group">
        <label>Tác dụng phụ</label>
        <select id="${rowId}_tdp">
          <option value="">Chọn...</option>
          <option value="Không có"${data.tdp==="Không có"?" selected":""}>Không có</option>
          <option value="Buồn nôn / nôn"${data.tdp==="Buồn nôn / nôn"?" selected":""}>Buồn nôn / nôn</option>
          <option value="Chóng mặt"${data.tdp==="Chóng mặt"?" selected":""}>Chóng mặt</option>
          <option value="Táo bón"${data.tdp==="Táo bón"?" selected":""}>Táo bón</option>
          <option value="Ngủ gà"${data.tdp==="Ngủ gà"?" selected":""}>Ngủ gà / buồn ngủ</option>
          <option value="Ngứa"${data.tdp==="Ngứa"?" selected":""}>Ngứa</option>
          <option value="Hạ huyết áp"${data.tdp==="Hạ huyết áp"?" selected":""}>Hạ huyết áp</option>
          <option value="Khó thở"${data.tdp==="Khó thở"?" selected":""}>Khó thở</option>
          <option value="Khác"${data.tdp==="Khác"?" selected":""}>Khác</option>
        </select>
      </div>
    </div>
  </div>`;
}

// Thêm 1 hàng thuốc vào ngày d
function addThuocRow(ngay) {
  const list = document.getElementById(`thuoc_list_d${ngay}`);
  if (!list) return;
  const currentRows = list.querySelectorAll(".thuoc-row").length;
  list.insertAdjacentHTML("beforeend", renderThuocRow(ngay, currentRows));
}

// Xóa hàng thuốc
function removeThuocRow(ngay, idx) {
  const list = document.getElementById(`thuoc_list_d${ngay}`);
  if (!list) return;
  const rows = list.querySelectorAll(".thuoc-row");
  if (rows.length <= 1) return; // luôn giữ ít nhất 1 hàng

  // Xóa đúng hàng theo data-idx
  const target = [...rows].find(r => Number(r.dataset.idx) === idx);
  if (!target) return;
  target.remove();

  // Re-index các hàng còn lại
  list.querySelectorAll(".thuoc-row").forEach((row, i) => {
    const oldNgay = row.dataset.ngay;
    const oldIdx  = row.dataset.idx;
    row.dataset.idx = i;
    row.id = `thuoc_d${ngay}_r${i}`;

    // Đổi id từng field: nhom, lieu, hq, tdp
    ["nhom","lieu","hq","tdp"].forEach(f => {
      const el = row.querySelector(`#thuoc_d${oldNgay}_r${oldIdx}_${f}`);
      if (el) el.id = `thuoc_d${ngay}_r${i}_${f}`;
    });

    // Cập nhật onclick nút xóa (hàng đầu không có nút xóa)
    const btn = row.querySelector(".btn-remove-thuoc");
    if (btn) btn.setAttribute("onclick", `removeThuocRow(${ngay},${i})`);
  });
}

// updateAddThuocBtn: không dùng (không giới hạn), giữ lại để tránh lỗi nếu gọi
function updateAddThuocBtn(ngay) {}

// Collect raw array of objects từ DOM
function collectThuocNgayRaw(ngay) {
  const list = document.getElementById(`thuoc_list_d${ngay}`);
  if (!list) return [];
  const rows = list.querySelectorAll(".thuoc-row");
  return [...rows].map((_, i) => {
    const rowId = `thuoc_d${ngay}_r${i}`;
    return {
      nhom: document.getElementById(`${rowId}_nhom`)?.value || "",
      lieu: document.getElementById(`${rowId}_lieu`)?.value || "",
      hq:   document.getElementById(`${rowId}_hq`)?.value   || "",
      tdp:  document.getElementById(`${rowId}_tdp`)?.value  || "",
    };
  }).filter(r => r.nhom || r.lieu); // bỏ hàng trống hoàn toàn
}

// Collect → JSON string (để lưu vào 1 field Sheets)
function collectThuocNgay(ngay) {
  const arr = collectThuocNgayRaw(ngay);
  return arr.length ? JSON.stringify(arr) : "";
}

// Apply thuoc data vào DOM (khi mở phiếu cũ)
function applyThuocNgay(ngay, rawValue) {
  const list = document.getElementById(`thuoc_list_d${ngay}`);
  if (!list) return;

  let arr = [];

  // Thử parse JSON mới
  if (rawValue && typeof rawValue === "string" && rawValue.trim().startsWith("[")) {
    try { arr = JSON.parse(rawValue); } catch { arr = []; }
  }
  // Backward-compat: convert từ field cũ (thuoc_nhom1/2/3 → ngày 1)
  // Được gọi riêng ở applyFormData nếu không có thuoc_ngay_*

  if (arr.length === 0) { list.innerHTML = renderThuocRow(ngay, 0); }
  else { list.innerHTML = arr.map((d, i) => renderThuocRow(ngay, i, d)).join(""); }
  updateAddThuocBtn(ngay);
}

// ── Build Steps HTML ─────────────────────────────────────────
function buildStep1() {
  document.getElementById("step1").innerHTML = `
  <div class="card">
    <div class="card-title">A1. Thông tin hành chính</div>
    <div class="form-row">
      <div class="form-group"><label>Họ và tên bệnh nhân <span class="req">*</span></label><input id="f_ten" placeholder="Nguyễn Văn A"></div>
      <div class="form-group"><label>Mã BN <span class="req">*</span></label><input id="f_hoSo" placeholder="BN-2024-001"></div>
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
        ${i === 8 ? `<div style="margin-top:8px"><input type="text" id="f_psqi5j_text" placeholder="Mô tả lý do khác..." style="width:100%;font-size:12px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);box-sizing:border-box;"></div>` : ""}
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
    <div class="card-title">C2. Đau & Thuốc giảm đau sau phẫu thuật (Ngày 1–3)</div>
    ${[1,2,3].map(d=>`
    <div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-size:13px;font-weight:600;color:var(--primary);margin-bottom:10px;">Ngày ${d} sau mổ</div>

      <div style="margin-bottom:10px;">
        <label style="font-size:12px;color:var(--text-muted);">Điểm đau VAS</label>
        <div class="vas-wrap"><span style="font-size:11px;color:var(--text-muted);min-width:18px;">0</span><input type="range" min="0" max="10" step="1" id="f_vas${d}" value="0" oninput="document.getElementById(\'vasv${d}\').textContent=this.value"><span class="vas-num" id="vasv${d}">0</span><span style="font-size:11px;color:var(--text-muted);">10</span></div>
      </div>

      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">Thuốc giảm đau sử dụng</div>
      <div id="thuoc_list_d${d}"></div>
      <button type="button" id="btn_add_thuoc_d${d}" class="btn btn-sm" style="margin-top:6px;" onclick="addThuocRow(${d})">+ Thêm thuốc</button>
    </div>`).join("")}
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

  // Khôi phục session đã lưu (lưu trạng thái đăng nhập trên thiết bị)
  const saved = loadSession();
  if (saved) {
    currentUser = saved;
    updateAvatar(currentUser);
    resetIdleTimer();
    showScreen("dash");
    loadDanhSach();
  }
  bindIdleEvents();
});