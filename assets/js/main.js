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
let activeDashTab      = 'mine'; // 'mine' | 'overall'
let dashboardFilter    = "all";
let dashboardOwnerFilter = "all";
let dashboardQuery     = "";
let draftSaveTimer     = null;
let dashboardPage      = 1;
let formDirty          = false; // true khi user đã thay đổi ít nhất 1 trường
let viewMode           = false; // true = chế độ xem (read-only)
let dashboardPageSize  = parseInt(localStorage.getItem("phieu_dash_page_size_v1") || "20", 10);
if (![20, 50, 100, -1].includes(dashboardPageSize)) dashboardPageSize = 20;

const LOCAL_DRAFT_KEY  = "phieu_local_drafts_v3";
const FULL_RECORD_CACHE_KEY = "phieu_full_records_cache_v1";
const DASH_PAGE_SIZE_KEY = "phieu_dash_page_size_v1";
const MUC_TIEU_KEY     = "phieu_muc_tieu_v1";
const MUC_TIEU_DEFAULT = 171;

function getMucTieu()    { return parseInt(localStorage.getItem(MUC_TIEU_KEY) || MUC_TIEU_DEFAULT, 10) || MUC_TIEU_DEFAULT; }
function setMucTieu(n)   { localStorage.setItem(MUC_TIEU_KEY, String(n)); }

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


function getCurrentUserName() {
  return currentUser?.name || currentUser?.username || "";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isRecordOwner(record) {
  const owner = normalizeText(record?.dieu_tra_vien || record?.user || "");
  const me = normalizeText(getCurrentUserName());
  if (!me) return false;
  return !owner || owner === me;
}

function getAdmissionDuplicateKey(record) {
  const soHoSo = normalizeText(record?.so_ho_so);
  const ngayNhapVien = String(record?.ngay_nhap_vien || "").trim();
  return soHoSo && ngayNhapVien ? `${soHoSo}__${ngayNhapVien}` : "";
}

function findDuplicateRecords(step1Data, excludeMa = currentMaPhieu) {
  const key = getAdmissionDuplicateKey(step1Data);
  if (!key) return [];
  return getManagedRecords().filter(record => {
    if (!record?.ma_phieu || record.ma_phieu === excludeMa) return false;
    return getAdmissionDuplicateKey(record) === key;
  });
}

function buildDuplicateMessage(step1Data, duplicates) {
  if (!duplicates?.length) return "";
  const first = duplicates[0];
  const owner = first?.dieu_tra_vien || first?.user || "không rõ";
  const dateText = step1Data?.ngay_nhap_vien || "";
  return `Đã có phiếu ${first.ma_phieu} do ${owner} tạo cho mã BN ${step1Data.so_ho_so} ngày nhập viện ${dateText}. Hãy mở phiếu có sẵn để tránh nhập trùng.`;
}

function getCurrentStep1Data() {
  const data = collectStep(1);
  data.ma_phieu = currentMaPhieu;
  return data;
}

function ensureEditableRecord(record = getMergedRecordByMa(currentMaPhieu), alertId = "form-alert") {
  if (viewMode || !isRecordOwner(record)) {
    showAlert(alertId, "Bạn chỉ có quyền xem phiếu này. Chỉ người tạo phiếu mới được sửa hoặc xóa.", "error");
    return false;
  }
  return true;
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

function getFullRecordCacheMap() {
  try { return parseJSONSafe(sessionStorage.getItem(FULL_RECORD_CACHE_KEY), {}); }
  catch { return {}; }
}
function setFullRecordCacheMap(map) {
  try { sessionStorage.setItem(FULL_RECORD_CACHE_KEY, JSON.stringify(map)); }
  catch {}
}
function getCachedFullRecord(ma) {
  if (!ma) return null;
  const map = getFullRecordCacheMap();
  return map[ma]?.data || null;
}
function cacheFullRecord(record) {
  if (!record?.ma_phieu) return;
  const map = getFullRecordCacheMap();
  map[record.ma_phieu] = { ts: Date.now(), data: record };
  const keys = Object.keys(map);
  if (keys.length > 80) {
    keys.sort((a, b) => Number(map[b]?.ts || 0) - Number(map[a]?.ts || 0));
    keys.slice(80).forEach(k => delete map[k]);
  }
  setFullRecordCacheMap(map);
}
function clearCachedFullRecord(ma) {
  if (!ma) return;
  const map = getFullRecordCacheMap();
  delete map[ma];
  setFullRecordCacheMap(map);
}
async function fetchFullRecordCached(ma, { force = false } = {}) {
  if (!ma) throw new Error("Thiếu mã phiếu");
  if (!force) {
    const cached = getCachedFullRecord(ma);
    if (cached) return { data: cached, fromCache: true };
  }
  const res = await apiGet("get", { ma });
  const fullData = res?.data || {};
  const merged = { ...getMergedRecordByMa(ma), ...fullData, ma_phieu: ma };
  cacheFullRecord(merged);
  return { data: merged, fromCache: false };
}

// ── Merged record helpers ────────────────────────────────────
function getMergedRecordByMa(ma) {
  const remote = danhSachCache.find(item => item.ma_phieu === ma) || null;
  const cached = getCachedFullRecord(ma);
  let local    = getLocalDraft(ma);
  if (remote && local && !isRecordOwner(remote)) {
    local = null;
  }
  const merged = { ...(remote || {}), ...(cached || {}), ...((local && local.data) || {}) };
  merged.ma_phieu   = ma;
  // buoc từ Sheets có thể là datetime object (Sheets bug) — cần parse số thuần
  const parseBuoc = v => {
    if (!v && v !== 0) return 0;
    const n = parseInt(String(v), 10);
    return (!isNaN(n) && n >= 1 && n <= 3) ? n : 0;
  };
  merged.buoc       = Math.max(parseBuoc(remote?.buoc), parseBuoc(local?.buoc), 1);
  merged.last_step  = Number(local?.last_step || merged.buoc || 1);
  merged.updated_at = local?.updated_at || remote?.updated_at || remote?.ngay_thu_thap || "";
  merged.created_at = remote?.created_at || local?.data?.created_at || "";
  merged.local_only = Boolean(local && !remote);
  merged.has_local  = Boolean(local);
  merged.synced     = Boolean(local?.synced);
  return merged;
}

function sortRecordsForDashboard(a, b) {
  const ownerDelta = Number(isRecordOwner(b)) - Number(isRecordOwner(a));
  if (ownerDelta !== 0) return ownerDelta;
  return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
}

function getManagedRecords() {
  const ids = new Set();
  danhSachCache.forEach(item => item?.ma_phieu && ids.add(item.ma_phieu));
  listLocalDrafts().forEach(item => item?.ma_phieu && ids.add(item.ma_phieu));
  return [...ids].map(getMergedRecordByMa).sort(sortRecordsForDashboard);
}

function normalizePatientName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi-VN");
}

function formatPatientName(value) {
  const normalized = normalizePatientName(value);
  return normalized || "(Chưa có tên bệnh nhân)";
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "number") return !Number.isNaN(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed === "[]" || trimmed === "{}") return false;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.length > 0;
      if (parsed && typeof parsed === "object") return Object.keys(parsed).length > 0;
    } catch {}
    return true;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

const STRICT_COMPLETE_FIELDS = {
  1: [
    "ho_ten", "so_ho_so", "ngay_sinh", "gioi_tinh", "nghe_nghiep", "dia_chi", "hoc_van", "dan_toc",
    "ngay_nhap_vien", "ngay_pt_du_kien", "can_nang", "chieu_cao", "chan_doan", "loai_pt", "vung_pt", "pp_pt", "vo_cam", "vas_nhap_vien"
  ],
  2: [
    "hads_1", "hads_2", "hads_3", "hads_4", "hads_5", "hads_6", "hads_7", "hads_8", "hads_9", "hads_10", "hads_11", "hads_12", "hads_13", "hads_14",
    "psqi1", "psqi2", "psqi3", "psqi4", "psqi5a", "psqi_5_0", "psqi_5_1", "psqi_5_2", "psqi_5_3", "psqi_5_4", "psqi_5_5", "psqi_5_6", "psqi_5_7", "psqi_5_8",
    "psqi6", "psqi7", "psqi8", "psqi9", "ais_1", "ais_2", "ais_3", "ais_4", "ais_5"
  ],
  3: [
    "ngay_pt_thuc", "tg_pt", "pp_pt_thuc", "vo_cam_thuc", "truyen_mau",
    "vas1", "vas2", "vas3", "thuoc_ngay_1", "thuoc_ngay_2", "thuoc_ngay_3",
    "van_dong", "kha_nang_vd", "bien_chung", "tg_nam_vien", "hl_0", "hl_1", "hl_2", "hl_3", "hl_4"
  ],
};

const STRICT_COMPLETE_FIELD_LABELS = {
  ho_ten: "Họ tên bệnh nhân",
  so_ho_so: "Mã BN",
  ngay_sinh: "Ngày sinh",
  gioi_tinh: "Giới tính",
  nghe_nghiep: "Nghề nghiệp",
  dia_chi: "Địa chỉ",
  hoc_van: "Học vấn",
  dan_toc: "Dân tộc",
  ngay_nhap_vien: "Ngày nhập viện",
  ngay_pt_du_kien: "Ngày phẫu thuật dự kiến",
  can_nang: "Cân nặng",
  chieu_cao: "Chiều cao",
  chan_doan: "Chẩn đoán",
  loai_pt: "Loại phẫu thuật",
  vung_pt: "Vùng phẫu thuật",
  pp_pt: "Phương pháp phẫu thuật",
  vo_cam: "Phương pháp vô cảm",
  vas_nhap_vien: "VAS lúc nhập viện",
  tg_pt: "Thời gian phẫu thuật",
  pp_pt_thuc: "Phương pháp PT thực tế",
  vo_cam_thuc: "Phương pháp vô cảm thực tế",
  truyen_mau: "Truyền máu",
  van_dong: "Tình trạng vận động",
  kha_nang_vd: "Khả năng vận động",
  bien_chung: "Biến chứng",
  tg_nam_vien: "Thời gian nằm viện",
  ngay_pt_thuc: "Ngày phẫu thuật thực tế",
  psqi1: "PSQI-1 giờ đi ngủ",
  psqi2: "PSQI-2 mất bao lâu để ngủ",
  psqi3: "PSQI-3 giờ thức dậy",
  psqi4: "PSQI-4 số giờ ngủ thực sự",
  psqi5a: "PSQI-5a",
  psqi6: "PSQI-6 chất lượng giấc ngủ",
  psqi7: "PSQI-7 dùng thuốc ngủ",
  psqi8: "PSQI-8 khó giữ tỉnh táo ban ngày",
  psqi9: "PSQI-9 ảnh hưởng sinh hoạt",
  thuoc_ngay_1: "Thuốc giảm đau ngày 1",
  thuoc_ngay_2: "Thuốc giảm đau ngày 2",
  thuoc_ngay_3: "Thuốc giảm đau ngày 3",
};
for (let i = 1; i <= 14; i++) STRICT_COMPLETE_FIELD_LABELS[`hads_${i}`] = `HADS câu ${i}`;
for (let i = 0; i < 9; i++) STRICT_COMPLETE_FIELD_LABELS[`psqi_5_${i}`] = `PSQI-5${String.fromCharCode(98 + i)}`;
for (let i = 1; i <= 5; i++) STRICT_COMPLETE_FIELD_LABELS[`ais_${i}`] = `AIS-${i}`;
for (let i = 1; i <= 3; i++) STRICT_COMPLETE_FIELD_LABELS[`vas${i}`] = `VAS sau mổ ngày ${i}`;
for (let i = 0; i < 5; i++) STRICT_COMPLETE_FIELD_LABELS[`hl_${i}`] = `Hài lòng câu ${i + 1}`;

// ── Missing fields scan — danh sách trường cần nhập theo từng bước ──
const REQUIRED_FIELD_SCAN = {
  1: [
    { id:"f_ten",          label:"Họ tên bệnh nhân",      type:"input"  },
    { id:"f_hoSo",         label:"Mã BN",                  type:"input"  },
    { id:"f_ngaySinh",     label:"Ngày sinh",              type:"input"  },
    { id:"f_gioi",         label:"Giới tính",              type:"select" },
    { id:"f_ngheNghiep",   label:"Nghề nghiệp",            type:"input"  },
    { id:"f_diaChi",       label:"Địa chỉ",                type:"input"  },
    { id:"f_hocVan",       label:"Học vấn",                type:"select" },
    { id:"f_danToc",       label:"Dân tộc",                type:"input"  },
    { id:"f_ngayNhapVien", label:"Ngày nhập viện",         type:"input"  },
    { id:"f_ngayPT",       label:"Ngày PT dự kiến",        type:"input"  },
    { id:"f_canNang",      label:"Cân nặng (kg)",          type:"input"  },
    { id:"f_chieuCao",     label:"Chiều cao (cm)",         type:"input"  },
    { id:"f_chanDoan",     label:"Chẩn đoán",              type:"input"  },
    { id:"f_loaiPT",       label:"Loại phẫu thuật",        type:"select" },
    { id:"f_vungPT",       label:"Vùng phẫu thuật",        type:"select" },
    { id:"f_ppPT",         label:"Phương pháp PT",         type:"select" },
    { id:"f_voCam",        label:"Phương pháp vô cảm",     type:"select" },
  ],
  2: [
    ...Array.from({length:14}, (_,i) => ({ name:`hads_${i+1}`, label:`HADS câu ${i+1}`, type:"radio" })),
    { id:"f_psqi1",  label:"PSQI-1 Giờ đi ngủ",          type:"input"  },
    { id:"f_psqi2",  label:"PSQI-2 Phút để ngủ",         type:"input"  },
    { id:"f_psqi3",  label:"PSQI-3 Giờ thức dậy",        type:"input"  },
    { id:"f_psqi4",  label:"PSQI-4 Số giờ ngủ",          type:"input"  },
    { id:"f_psqi5a", label:"PSQI-5a Thức vì đau?",       type:"select" },
    ...Array.from({length:9}, (_,i) => ({ name:`psqi_5_${i}`, label:`PSQI-5${String.fromCharCode(98+i)}`, type:"radio" })),
    { id:"f_psqi6",  label:"PSQI-6 Chất lượng ngủ",      type:"select" },
    { id:"f_psqi7",  label:"PSQI-7 Dùng thuốc ngủ",      type:"select" },
    { id:"f_psqi8",  label:"PSQI-8 Buồn ngủ ban ngày",   type:"select" },
    { id:"f_psqi9",  label:"PSQI-9 Ảnh hưởng sinh hoạt", type:"select" },
    ...Array.from({length:5}, (_,i) => ({ name:`ais_${i+1}`, label:`AIS-${i+1} ${["Khởi phát","Thức giữa đêm","Dậy sớm","Tổng thời gian ngủ","Chất lượng ngủ"][i]}`, type:"radio" })),
  ],
  3: [
    { id:"f_ngayPTthuc", label:"Ngày PT thực tế",          type:"input"  },
    { id:"f_tgPT",       label:"Thời gian PT (phút)",      type:"input"  },
    { id:"f_ppPTthuc",   label:"PP PT thực tế",            type:"select" },
    { id:"f_voCamThuc",  label:"Vô cảm thực tế",           type:"select" },
    { id:"f_truyenMau",  label:"Truyền máu",               type:"select" },
    { id:"f_vanDong",    label:"Tình trạng vận động",      type:"select" },
    { id:"f_khanangVD",  label:"Khả năng vận động",        type:"select" },
    { id:"f_bienChung",  label:"Biến chứng",               type:"select" },
    { id:"f_tgNamVien",  label:"Số ngày nằm viện",         type:"input"  },
    ...Array.from({length:5}, (_,i) => ({ name:`hl_${i}`, label:`Hài lòng câu ${i+1}`, type:"radio" })),
  ],
};

function scanMissingFields() {
  const result = { 1: [], 2: [], 3: [] };
  for (const [step, fields] of Object.entries(REQUIRED_FIELD_SCAN)) {
    for (const f of fields) {
      let empty;
      if (f.type === "radio") {
        empty = !document.querySelector(`input[name="${f.name}"]:checked`);
      } else {
        const el = document.getElementById(f.id);
        empty = !el || !el.value || el.value.trim() === "";
      }
      if (empty) result[Number(step)].push(f);
    }
  }
  return result;
}

// Nhảy tới một trường cụ thể (bằng step + field object)
function jumpToField(step, fieldIdx) {
  const field = window.__mpFields?.[step]?.[fieldIdx];
  if (!field) return;
  if (Number(step) !== currentStep) showStep(Number(step));
  requestAnimationFrame(() => {
    let el;
    if (field.type === "radio") {
      el = document.querySelector(`input[name="${field.name}"]`)?.closest(".q-card") ||
           document.querySelector(`input[name="${field.name}"]`);
    } else {
      el = document.getElementById(field.id);
    }
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      el.focus();
      const orig = el.style.outline;
      el.style.outline = "2.5px solid var(--amber-500, #f59e0b)";
      el.style.outlineOffset = "2px";
      setTimeout(() => { el.style.outline = orig; el.style.outlineOffset = ""; }, 1800);
    } else {
      const orig = el.style.background;
      el.style.background = "rgba(251,191,36,.15)";
      setTimeout(() => el.style.background = orig, 1800);
    }
  });
}

function ensureMissingPanel() {
  if (document.getElementById("missing-panel")) return;
  const container = document.querySelector("#screen-new .container");
  if (!container) return;
  const footer = container.querySelector(".form-footer");
  if (!footer) return;
  const panel = document.createElement("div");
  panel.id = "missing-panel";
  container.insertBefore(panel, footer);
}

function updateMissingPanel() {
  const panel = document.getElementById("missing-panel");
  if (!panel) return;
  if (viewMode) { panel.innerHTML = ""; return; }

  const missing = scanMissingFields();
  window.__mpFields = missing; // store for jumpToField references

  const totalMissing = Object.values(missing).reduce((s, arr) => s + arr.length, 0);

  // Update step tab badges
  for (let s = 1; s <= 3; s++) {
    const tab = document.getElementById(`tab${s}`);
    if (!tab) continue;
    tab.querySelectorAll(".step-missing-badge").forEach(b => b.remove());
    const cnt = (missing[s] || []).length;
    if (cnt > 0) {
      const badge = document.createElement("span");
      badge.className = "step-missing-badge";
      badge.textContent = cnt;
      tab.appendChild(badge);
    }
  }

  if (totalMissing === 0) {
    panel.innerHTML = `<div class="mp-header all-ok"><span class="mp-title ok">✓ Tất cả mục đã điền đầy đủ</span></div>`;
    return;
  }

  // Render grouped missing fields (current step first, others below)
  const stepLabels = { 1: "Bước 1 — Nhập viện", 2: "Bước 2 — Trước mổ", 3: "Bước 3 — Sau mổ" };
  const steps = [currentStep, ...([1,2,3].filter(s => s !== currentStep))];

  const groups = steps.map(s => {
    const fields = missing[s] || [];
    if (!fields.length) return "";
    const isCurrentStep = s === currentStep;
    const btns = fields.map((f, idx) =>
      `<button class="mp-field-btn${isCurrentStep ? "" : " other-step"}"
        onclick="jumpToField(${s},${idx})">${escapeHtml(f.label)}</button>`
    ).join("");
    return `<div class="mp-step-group">
      <div class="mp-step-label">${stepLabels[s]} — ${fields.length} mục</div>
      <div class="mp-fields">${btns}</div>
    </div>`;
  }).join("");

  const curCount = (missing[currentStep] || []).length;
  const otherCount = totalMissing - curCount;
  const summary = curCount > 0
    ? `${curCount} mục chưa nhập ở bước này${otherCount > 0 ? ` · +${otherCount} bước khác` : ""}`
    : `${otherCount} mục chưa nhập ở bước khác`;

  const panelOpen = panel.dataset.open !== "0";
  panel.innerHTML = `
    <div class="mp-header" onclick="this.closest('#missing-panel').dataset.open=(this.closest('#missing-panel').dataset.open==='0'?'1':'0');this.closest('#missing-panel').querySelector('.mp-body').style.display=this.closest('#missing-panel').dataset.open==='0'?'none':'block'">
      <span class="mp-title">⚠ ${escapeHtml(summary)}</span>
      <span class="mp-toggle">▾ Bấm để ${panelOpen ? "ẩn" : "xem"}</span>
    </div>
    <div class="mp-body" style="display:${panelOpen ? "block" : "none"}">${groups}</div>
  `;
  panel.dataset.open = panelOpen ? "1" : "0";
}

function getStrictCompletionMissing(record) {
  if ((record?.buoc || 0) < 3) return ["Chưa đủ 3 bước"];
  const missing = [];
  Object.values(STRICT_COMPLETE_FIELDS).flat().forEach(field => {
    if (!hasMeaningfulValue(record?.[field])) {
      missing.push(STRICT_COMPLETE_FIELD_LABELS[field] || field);
    }
  });
  return missing;
}

// Kiểm tra phiếu đã điền đủ các trường bắt buộc chưa
function isRecordComplete(record) {
  if (record?.strict_complete !== undefined) return Boolean(record.strict_complete);
  return getStrictCompletionMissing(record).length === 0;
}

// Trạng thái phiếu:
// - "Hoàn thành"    = đã lưu đủ 3 bước VÀ điền đủ các trường bắt buộc
// - "Đang thực hiện"= buoc >= 3 nhưng còn thiếu trường
// - "Phiếu mới"     = chưa điền trường nào
// - "Nháp trên máy" = local_only
// - "Chưa đồng bộ"  = có thay đổi chưa sync
// - "Đang điền"     = còn lại
function getRecordStatus(record) {
  if (record.local_only && (record.buoc || 0) <= 1) return { text: "Phiếu mới",       cls: "badge-gray"   };
  if (record.local_only)                            return { text: "Nháp trên máy",    cls: "badge-purple" };
  if (record.has_local && !record.synced)           return { text: "Chưa đồng bộ",     cls: "badge-purple" };
  if (isRecordComplete(record))                     return { text: "Hoàn thành",        cls: "badge-green"  };
  if ((record.buoc || 0) >= 3)                      return { text: "Đang thực hiện",    cls: "badge-amber"  };
  if ((record.buoc || 0) <= 1 && !record.has_local) return { text: "Phiếu mới",        cls: "badge-gray"   };
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

  if (name === "dash") {
    renderDashboard();
    return;
  }

  if (name === "new") {
    const record        = options.record || null;
    currentRecordSource = options.source || (record ? (record.local_only ? "local" : "remote") : "new");
    currentMaPhieu      = record?.ma_phieu || genMaPhieu();
    currentHighestStep  = Math.max(Number(record?.buoc || 0), 1);
    formDirty           = false; // reset khi mở form mới
    viewMode            = Boolean(options.viewMode || (record && !isRecordOwner(record)));
    buildStep1(); buildStep2(); buildStep3();
    // Khởi tạo 1 hàng thuốc trống cho mỗi ngày
    [1, 2, 3].forEach(d => applyThuocNgay(d, ""));
    ensureFooterControls();
    ensureModeBanner();
    ensureMissingPanel();
    bindAutosave();
    document.querySelectorAll(".step-item").forEach((item, i) => {
      item.onclick = () => jumpToStep(i + 1);
    });
    if (record) {
      applyFormData(record);
      // Chỉ chủ phiếu mới được tạo draft local seed để tiếp tục chỉnh sửa
      if (!viewMode && isRecordOwner(record) && !getLocalDraft(currentMaPhieu)) {
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
          user:       getCurrentUserName(),
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

function setFooterButtonsForMode() {
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const btnSave = document.getElementById("btn-save-server");
  if (!btnPrev || !btnNext) return;

  if (viewMode) {
    if (btnSave) btnSave.style.display = "none";
    btnPrev.textContent = "← Bước trước";
    btnNext.textContent = currentStep >= 3 ? "← Quay lại danh sách" : "Tiếp theo →";
    btnNext.onclick = currentStep >= 3 ? () => showScreen("dash") : nextStep;
    return;
  }

  if (btnSave) btnSave.style.display = "inline-block";
  btnPrev.textContent = "← Trước";
  btnNext.textContent = "Tiếp →";
  btnNext.onclick = nextStep;
}

function setFooterStatusTone(mode = "success") {
  const dot = document.querySelector("#footer-info .footer-status-dot");
  if (!dot) return;
  if (mode === "neutral") dot.style.background = "var(--slate-400)";
  else if (mode === "warning") dot.style.background = "var(--amber-600)";
  else dot.style.background = "var(--green-500)";
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

  setFooterButtonsForMode();

  if (viewMode) {
    document.getElementById("btn-prev").style.display = n > 1 ? "inline-block" : "none";
    document.getElementById("btn-next").style.display = "inline-block";
    setTimeout(() => {
      document.querySelectorAll("#step1 input,#step1 select,#step1 textarea,#step2 input,#step2 select,#step2 textarea,#step3 input,#step3 select,#step3 textarea").forEach(el => {
        el.disabled = true;
        el.style.opacity = "0.72";
      });
    }, 50);
    updateFooterStatus("Chỉ xem — dùng các nút để chuyển bước");
    setFooterStatusTone("neutral");
    updateMissingPanel();
    return;
  }

  document.getElementById("btn-prev").style.display = n > 1 ? "inline-block" : "none";
  document.getElementById("btn-next").style.display = n < 3 ? "inline-block" : "none";
  const btnSave = document.getElementById("btn-save-server");
  if (btnSave) btnSave.style.display = "inline-block";

  const local = getLocalDraft(currentMaPhieu);
  updateFooterStatus(
    local?.updated_at
      ? `Tự lưu nháp lúc ${formatWhen(local.updated_at)}`
      : "Tự động lưu nháp khi đang nhập"
  );
  setFooterStatusTone("success");
  updateMissingPanel();
}

// [FIX#7] jumpToStep: không cho nhảy tiến quá bước đã validate
// Chỉ cho phép nhảy về bước đã qua hoặc bước tiếp theo liền kề
function jumpToStep(step) {
  const target = Math.max(1, Math.min(3, Number(step || 1)));
  if (formDirty) saveLocalProgress(false);
  showStep(target);
}

async function nextStep()  {
  if (!ensureEditableRecord()) return;
  // Save local draft silently then just navigate — server save is manual via "Lưu lên server"
  if (formDirty) saveLocalProgress(false);
  currentHighestStep = Math.max(Number(currentHighestStep || 0), Number(currentStep || 0), 1);
  showStep(Math.min(3, currentStep + 1));
}

function prevStep() { showStep(Math.max(1, currentStep - 1)); }

// ── saveToServer: gửi toàn bộ dữ liệu đã nhập lên Google Sheets ──
async function saveToServer() {
  if (!ensureEditableRecord()) return;
  saveLocalProgress(false);
  showLoading(true);
  try {
    const draft = getLocalDraft(currentMaPhieu) || {};
    const allData = { ...(draft.data || {}), ma_phieu: currentMaPhieu };
    const dtv = getCurrentUserName();
    currentHighestStep = Math.max(Number(currentHighestStep || 0), Number(currentStep || 0), 1);

    // Gửi song song tất cả bước đã có dữ liệu
    const stepsToSave = [];
    for (let b = 1; b <= currentHighestStep; b++) stepsToSave.push(b);

    const results = await Promise.all(
      stepsToSave.map(buoc =>
        apiPost({ ...allData, buoc, dieu_tra_vien: dtv, updated_by: dtv })
          .then(() => ({ buoc, ok: true }))
          .catch(e => ({ buoc, ok: false, err: e.message }))
      )
    );

    const failed  = results.filter(r => !r.ok);
    const success = results.filter(r => r.ok);

    if (failed.length === 0) {
      upsertLocalDraft({
        ...draft, ma_phieu: currentMaPhieu, buoc: currentHighestStep,
        last_step: currentStep, updated_at: new Date().toISOString(),
        local_only: false, synced: true, user: dtv, data: allData,
      });
      showAlert("form-alert", `✓ Đã lưu ${success.length} bước lên Google Sheets.`, "success");
      updateFooterStatus(`Đã lưu hệ thống lúc ${formatWhen(new Date().toISOString())}`);
      markLocalSynced();
      // Cập nhật cache và danh sách ngầm
      const idx = danhSachCache.findIndex(r => r.ma_phieu === currentMaPhieu);
      if (idx >= 0) danhSachCache[idx] = { ...danhSachCache[idx], ...allData };
      loadDanhSach().catch(() => {});
    } else {
      const errMsg = failed.map(r => `Bước ${r.buoc}: ${r.err}`).join(" · ");
      showAlert("form-alert",
        `Lưu được ${success.length}/${results.length} bước. Lỗi: ${errMsg}`, "error");
    }
  } catch (e) {
    showAlert("form-alert",
      `Không lưu được lên server (${e.message}). Phiếu đã lưu nháp trên máy.`, "error");
  } finally {
    showLoading(false);
  }
}

async function finishForm() {
  if (!ensureEditableRecord()) return;
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
    data.dieu_tra_vien = getCurrentUserName();
    data.updated_by    = getCurrentUserName();
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
      user:       getCurrentUserName(),
      data:       { ...(existingDraft.data || {}), ...step3Data, ma_phieu: currentMaPhieu },
    });
    showAlert("form-alert", `Phiếu ${currentMaPhieu} đã lưu hoàn thành.`, "success");
    const savedMa = currentMaPhieu;
    // [FIX] Chuyển về dashboard TRƯỚC, sau đó load server → khi cache có dữ liệu mới thì xóa draft
    setTimeout(async () => {
      showScreen("dash");
      await loadDanhSach();
      // Sau khi server cache đã có bản ghi này, mới xóa draft local
      cacheFullRecord({ ...getMergedRecordByMa(savedMa), ...(getLocalDraft(savedMa)?.data || {}), ma_phieu: savedMa });
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
  "psqi7","psqi8","psqi9","psqi5j_text",
  "ais_1","ais_2","ais_3","ais_4","ais_5","ais_tong","ais_phanloai",
  "nguyen_nhan_lo_au","nguyen_nhan_lo_au_khac","nguyen_nhan_rlgn","nguyen_nhan_rlgn_khac",
]);
const STEP3_FIELDS = new Set([
  "ngay_pt_thuc","tg_pt","pp_pt_thuc","vo_cam_thuc","truyen_mau",
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
  if (!ensureEditableRecord()) return;
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
    const dtv      = getCurrentUserName();

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
    if (errors.length === 0) {
      const step1Data = getCurrentStep1Data();
      const duplicates = findDuplicateRecords(step1Data, currentMaPhieu);
      const duplicateMessage = buildDuplicateMessage(step1Data, duplicates);
      if (duplicateMessage) errors.push(duplicateMessage);
    }
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
  if (!ensureEditableRecord()) return false;
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
    data.dieu_tra_vien = getCurrentUserName();
    data.updated_by    = getCurrentUserName();
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
  if (viewMode) return;
  const activeRecord = getMergedRecordByMa(currentMaPhieu);
  if (activeRecord?.ma_phieu && !isRecordOwner(activeRecord)) return;
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
    user:       getCurrentUserName(),
    // Merge: giữ nguyên data cũ, chỉ cập nhật bước hiện tại
    data: { ...(existing.data || {}), ...currentStepData, ma_phieu: currentMaPhieu },
  };
  upsertLocalDraft(record);
  updateFooterStatus(`Đã lưu nháp lúc ${formatWhen(record.updated_at)}`);
  if (showMessage) showAlert("form-alert", "Đã lưu nháp trên máy. Có thể mở lại để điền tiếp.", "success");
}

function markLocalSynced() {
  const existing = getLocalDraft(currentMaPhieu) || {};
  const currentStepData = collectStep(currentStep);
  const mergedData = { ...(existing.data || {}), ...currentStepData, ma_phieu: currentMaPhieu };
  upsertLocalDraft({
    ...existing,
    ma_phieu:   currentMaPhieu,
    buoc:       Math.max(Number(existing.buoc || 0), Number(currentHighestStep || 0), Number(currentStep || 0), 1),
    last_step:  Number(currentStep || 1),
    updated_at: new Date().toISOString(),
    local_only: false, synced: true,
    user:       getCurrentUserName(),
    data:       mergedData,
  });
  cacheFullRecord({ ...getMergedRecordByMa(currentMaPhieu), ...mergedData, ma_phieu: currentMaPhieu });
}

function bindAutosave() {
  const screen = document.getElementById("screen-new");
  if (!screen || screen.dataset.autosaveBound === "1") return;
  const handler = event => {
    if (!screen.classList.contains("active")) return;
    if (!event.target.closest("#screen-new")) return;
    formDirty = true;
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      saveLocalProgress(false);
      updateMissingPanel();
    }, 500);
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
    // Tất cả user đều load toàn bộ (user=all)
    // Dashboard "Phiếu của tôi" lọc theo currentUser ở client
    // → tab Tổng quan có đủ dữ liệu cho calcTongHopLocal fallback
    const res = await apiGet("danh-sach");
    console.log("[loadDanhSach] raw response:", JSON.stringify(res)?.slice(0, 300));
    danhSachCache = Array.isArray(res) ? res : (res.data || res.items || []);
    console.log("[loadDanhSach] cache size:", danhSachCache.length, "| first ma_phieu:", danhSachCache[0]?.ma_phieu);
    renderDashboard();
    hideAlert("dash-alert");
    tongHopCache = null; // reset để tab tổng quan tự tính lại từ data mới
  } catch (e) {
    danhSachCache = Array.isArray(danhSachCache) ? danhSachCache : [];
    renderDashboard();
    showAlert("dash-alert",
      "Không kết nối được API. Vẫn có thể tiếp tục các phiếu nháp đã lưu trên máy. (" + e.message + ")",
      "error"
    );
    loadTongHop(); // vẫn thử load thống kê dù danh sách lỗi
  }
}

function switchDashTab(tab) {
  activeDashTab = tab;
  document.getElementById("dash-tab-mine").classList.toggle("active", tab === "mine");
  document.getElementById("dash-tab-overall").classList.toggle("active", tab === "overall");
  document.getElementById("dash-panel-mine").style.display    = tab === "mine"    ? "block" : "none";
  document.getElementById("dash-panel-overall").style.display = tab === "overall" ? "block" : "none";
  if (tab === "overall") {
    // Chỉ load lại nếu chưa có cache — tránh gọi API mỗi lần click tab
    if (!tongHopCache) {
      loadTongHop();
    } else {
      renderTongHop(); // dùng lại cache, render lại thôi
    }
  }
}

// Tính thống kê từ danhSachCache
// Admin: danhSachCache có toàn bộ → đủ số liệu
// User thường: chỉ có phiếu của mình → hiển thị kèm ghi chú
function calcTongHopLocal() {
  const allRecords = getManagedRecords();
  let tong = 0, hoan_thanh = 0, dang_dien = 0, moi = 0;
  const dtvMap  = {};
  const loaiMap = {};
  allRecords.forEach(r => {
    tong++;
    const buoc   = Number(r.buoc || 0);
    const completed = isRecordComplete(r);
    const loaiPT = String(r.loai_pt || "").trim();
    if (completed)     hoan_thanh++;
    else if (buoc >= 2) dang_dien++;
    else                moi++;
    const dtv = String(r.dieu_tra_vien || r.user || "").trim();
    if (dtv) {
      if (!dtvMap[dtv]) dtvMap[dtv] = { ten: dtv, tong: 0, hoan_thanh: 0 };
      dtvMap[dtv].tong++;
      if (completed) dtvMap[dtv].hoan_thanh++;
    }
    if (loaiPT) {
      if (!loaiMap[loaiPT]) loaiMap[loaiPT] = { ten: loaiPT, tong: 0, hoan_thanh: 0 };
      loaiMap[loaiPT].tong++;
      if (completed) loaiMap[loaiPT].hoan_thanh++;
    }
  });
  const theo_dtv    = Object.values(dtvMap).sort((a, b) => b.tong - a.tong);
  const theo_loai_pt = Object.values(loaiMap).sort((a, b) => b.tong - a.tong);
  return { tong, hoan_thanh, dang_dien, moi, theo_dtv, theo_loai_pt,
    source: "local", scope: "all", apiUnavailable: true };
}

function saveMucTieu(val) {
  const n = parseInt(val, 10);
  if (!n || n < 1) return;
  setMucTieu(n);
  tongHopCache = null; // re-render với mục tiêu mới
  loadTongHop();
  const saved = document.getElementById("muctieu-saved");
  if (saved) { saved.style.display = "inline"; setTimeout(() => saved.style.display = "none", 2000); }
}

function reloadTongHop() {
  tongHopCache = null; // xóa cache → force refresh
  loadTongHop();
}

async function loadTongHop() {
  const el = document.getElementById("tonghop-grid");
  if (el) el.innerHTML = '<div class="tonghop-loading">Đang tải...</div>';

  try {
    // Gọi API tong-hop — không cần param user, server đọc toàn bộ sheet
    // → tất cả user đều nhận được số liệu toàn hệ thống như nhau
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 12000)
    );
    const res = await Promise.race([apiGet("tong-hop"), timeoutPromise]);
    tongHopCache = (res && typeof res.tong === "number") ? res : null;
    if (!tongHopCache) throw new Error("Phản hồi không hợp lệ: " + JSON.stringify(res));
    tongHopCache.source = "server";
    tongHopCache.scope  = "all";
  } catch (e) {
    console.warn("[loadTongHop] API lỗi:", e.message);
    // Fallback: tính từ danhSachCache hiện có
    // Admin → đủ toàn bộ; user thường → chỉ phiếu của mình + ghi chú
    tongHopCache = calcTongHopLocal();
  }
  renderTongHop();
}

function renderTongHop() {
  const el = document.getElementById("tonghop-grid");
  if (!el) return;
  const d = tongHopCache;
  if (!d) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">Chưa tải được — <a href="#" onclick="loadTongHop();return false;" style="color:var(--primary)">thử lại</a></div>';
    return;
  }

  // Tiến độ dựa trên mục tiêu mẫu
  const mucTieu = getMucTieu();
  const pct     = mucTieu > 0 ? Math.min(100, Math.round(d.hoan_thanh / mucTieu * 100)) : 0;
  const conLai  = Math.max(0, mucTieu - d.hoan_thanh);

  // Bảng theo điều tra viên
  const dtvRows = (d.theo_dtv || []).map(dtv => {
    const p = dtv.tong > 0 ? Math.round(dtv.hoan_thanh / dtv.tong * 100) : 0;
    const dd = dtv.tong - dtv.hoan_thanh;
    return `<tr>
      <td>${escapeHtml(dtv.ten)}</td>
      <td class="tc">${dtv.tong}</td>
      <td class="tc th-green">${dtv.hoan_thanh}</td>
      <td class="tc th-amber">${dd}</td>
      <td>
        <div class="th-mini-bar-wrap">
          <div class="th-mini-bar"><div class="th-mini-fill" style="width:${p}%"></div></div>
          <span class="th-mini-pct">${p}%</span>
        </div>
      </td>
    </tr>`;
  }).join("");

  // Bảng theo loại phẫu thuật
  const loaiPTRows = (d.theo_loai_pt || []).map(item => {
    const pct2 = d.tong > 0 ? Math.round(item.tong / d.tong * 100) : 0;
    return `<tr>
      <td>${escapeHtml(item.ten)}</td>
      <td class="tc">${item.tong}</td>
      <td class="tc th-green">${item.hoan_thanh}</td>
      <td class="tc">${pct2}%</td>
    </tr>`;
  }).join("");

  const now = new Date().toLocaleString("vi-VN", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit" });
  el.innerHTML = `
    <div class="tonghop-wrap">
      <!-- Hàng số liệu chính -->
      <div class="th-stat-row">
        <div class="th-stat-box th-main">
          <div class="th-num">${d.hoan_thanh}<span style="font-size:16px;font-weight:500;color:var(--text-muted)"> / ${mucTieu}</span></div>
          <div class="th-lbl">🎯 Hoàn thành / Mục tiêu</div>
        </div>
        <div class="th-stat-box">
          <div class="th-num th-amber">${d.dang_dien}</div>
          <div class="th-lbl">⏳ Đang điền</div>
        </div>
        <div class="th-stat-box">
          <div class="th-num th-muted">${d.tong}</div>
          <div class="th-lbl">📋 Đã thu thập</div>
        </div>
        <div class="th-stat-box">
          <div class="th-num" style="color:${conLai===0?'var(--green,#27ae60)':'var(--primary)'}">${conLai}</div>
          <div class="th-lbl">${conLai===0?'✅ Đã đủ mẫu':'📌 Còn cần thêm'}</div>
        </div>
      </div>

      <!-- Thanh tiến độ theo mục tiêu -->
      <div class="th-progress-wrap">
        <div class="th-progress-label">
          <span>Tiến độ đạt mục tiêu <strong>${mucTieu} mẫu</strong></span>
          <span class="th-pct">${pct}%</span>
        </div>
        <div class="th-progress-bar">
          <div class="th-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="th-progress-sub">
          Cập nhật lúc ${now}
          ${d.source === "server"
            ? " · <span style='color:var(--green,#27ae60)'>✓ Dữ liệu toàn hệ thống</span>"
            : d.scope === "all"
              ? " · Dữ liệu toàn hệ thống (bộ nhớ)"
              : " · ⚠ Chưa kết nối được server — chỉ hiện phiếu của bạn. <a href='#' onclick='reloadTongHop();return false;' style='color:var(--primary)'>Thử lại</a>"}
        </div>
      </div>

      <!-- Đặt mục tiêu — mở cho tất cả user -->
      <div class="th-muctieu-wrap">
        <span class="th-muctieu-label">🎯 Mục tiêu nghiên cứu:</span>
        <input class="th-muctieu-input" id="inp-muc-tieu" type="number" min="1" max="9999"
          value="${mucTieu}" onchange="saveMucTieu(this.value)">
        <span class="th-muctieu-hint">mẫu</span>
        <span class="th-muctieu-saved" id="muctieu-saved" style="display:none">✓ Đã lưu</span>
      </div>

      <!-- Bảng theo điều tra viên -->
      ${dtvRows ? `
      <div class="th-section-title">Tiến độ theo điều tra viên</div>
      <div class="th-table-wrap">
        <table class="th-table">
          <thead>
            <tr>
              <th>Điều tra viên</th>
              <th>Tổng</th>
              <th>Hoàn thành</th>
              <th>Đang điền</th>
              <th>Tiến độ</th>
            </tr>
          </thead>
          <tbody>${dtvRows}</tbody>
        </table>
      </div>` : '<div class="th-empty">Chưa có dữ liệu điều tra viên.</div>'}

      <!-- Bảng theo loại phẫu thuật -->
      ${loaiPTRows ? `
      <div class="th-section-title" style="margin-top:18px;">📊 Phân bố loại phẫu thuật</div>
      <div class="th-table-wrap">
        <table class="th-table">
          <thead>
            <tr>
              <th>Loại phẫu thuật</th>
              <th>Tổng</th>
              <th>Hoàn thành</th>
              <th>% / tổng</th>
            </tr>
          </thead>
          <tbody>${loaiPTRows}</tbody>
        </table>
      </div>` : ""}

      <div style="text-align:right;margin-top:10px;">
        <button class="btn btn-sm" onclick="reloadTongHop()">↻ Làm mới</button>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const allRecords = getManagedRecords();

  const normalizedQuery = dashboardQuery.trim().toLowerCase();
  const filtered = allRecords.filter(record => {
    const hay = `${record.ma_phieu || ""} ${record.ho_ten || ""} ${record.so_ho_so || ""} ${record.dieu_tra_vien || ""} ${record.chan_doan || ""} ${record.loai_pt || ""}`.toLowerCase();
    const matchQ = !normalizedQuery || hay.includes(normalizedQuery);
    const statusText = getRecordStatus(record).text;
    const matchF = dashboardFilter === "all"
      || (dashboardFilter === "draft" && statusText === "Phiếu mới")
      || (dashboardFilter === "progress" && ["Đang điền", "Đang thực hiện", "Chưa đồng bộ", "Nháp trên máy"].includes(statusText))
      || (dashboardFilter === "done" && statusText === "Hoàn thành");
    const owner = isRecordOwner(record);
    const matchOwner = dashboardOwnerFilter === "all"
      || (dashboardOwnerFilter === "mine" && owner)
      || (dashboardOwnerFilter === "others" && !owner);
    return matchQ && matchF && matchOwner;
  });

  const effectivePageSize = dashboardPageSize === -1 ? Math.max(filtered.length || 1, 1) : dashboardPageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  dashboardPage = Math.min(dashboardPage, totalPages);
  const pageStart = (dashboardPage - 1) * effectivePageSize;
  const pageRecords = filtered.slice(pageStart, pageStart + effectivePageSize);

  const mineCount = allRecords.filter(isRecordOwner).length;
  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card"><div class="stat-num">${allRecords.length}</div><div class="stat-lbl">Tổng phiếu</div></div>
    <div class="stat-card"><div class="stat-num">${mineCount}</div><div class="stat-lbl">Phiếu của tôi</div></div>
    <div class="stat-card"><div class="stat-num">${allRecords.filter(r => ["Đang điền","Đang thực hiện","Chưa đồng bộ","Nháp trên máy"].includes(getRecordStatus(r).text)).length}</div><div class="stat-lbl">Đang điền</div></div>
    <div class="stat-card"><div class="stat-num">${allRecords.filter(r => getRecordStatus(r).text === "Hoàn thành").length}</div><div class="stat-lbl">Hoàn thành</div></div>
  `;

  const cards = pageRecords.map(record => {
    const status = getRecordStatus(record);
    const dtv = record.dieu_tra_vien || record.user || "";
    const isOwner = isRecordOwner(record);
    const duplicates = findDuplicateRecords(record, record.ma_phieu);
    const detailText = [record.chan_doan, record.loai_pt, record.vung_pt].filter(Boolean).join(" · ");
    const missingStrict = !isRecordComplete(record) && Number(record.buoc || 0) >= 3 ? getStrictCompletionMissing(record) : [];
    const metaParts = [];
    if (record.so_ho_so) metaParts.push(`BN ${escapeHtml(record.so_ho_so)}`);
    if (dtv) metaParts.push(`Người tạo ${escapeHtml(dtv)}`);
    if (record.updated_at) metaParts.push(`Cập nhật ${escapeHtml(formatWhen(record.updated_at))}`);
    return `
      <div class="phieu-item phieu-compact ${isOwner ? "is-mine" : "is-other"}">
        <div class="phieu-main">
          <div class="phieu-topline">
            <div class="phieu-name">${escapeHtml(formatPatientName(record.ho_ten))}</div>
            <div class="phieu-chipline">
              <span class="badge ${status.cls}">${escapeHtml(status.text)}</span>
              <span class="badge ${isOwner ? "badge-green" : "badge-gray"}">${isOwner ? "Của tôi" : "Người khác"}</span>
              ${missingStrict.length ? `<span class="badge badge-gray" title="Thiếu: ${escapeHtml(missingStrict.slice(0, 8).join(", "))}${missingStrict.length > 8 ? "..." : ""}">Thiếu ${missingStrict.length} mục</span>` : ""}
            </div>
          </div>
          <div class="phieu-meta-line">${metaParts.join('<span class="sep">•</span>') || 'Chưa có thông tin phụ'}</div>
          <div class="phieu-detail-line">${escapeHtml(detailText || (record.ma_phieu ? `Mã phiếu ${record.ma_phieu}` : 'Chưa có chẩn đoán / loại phẫu thuật'))}</div>
          <div class="phieu-bottomline">
            <span class="badge badge-blue">${escapeHtml(getStepLabel(record))}</span>
            ${duplicates.length ? `<span class="badge badge-amber" title="Có phiếu cùng mã BN và ngày nhập viện">Có thể trùng ${duplicates.length}</span>` : ""}
            ${record.local_only ? `<span class="badge badge-gray">Chưa gửi lên hệ thống</span>` : ""}
          </div>
        </div>
        <div class="phieu-side">
          <div class="phieu-code">${escapeHtml(record.ma_phieu || "")}</div>
          <div class="phieu-actions compact-actions">
            ${isOwner ? `<button class="btn btn-sm btn-primary" onclick="openRecordByMa('${escapeHtml(record.ma_phieu)}')">Mở</button>` : `<button class="btn btn-sm" onclick="viewRecordByMa('${escapeHtml(record.ma_phieu)}')">Xem</button>`}
            ${isOwner ? `<button class="btn btn-sm btn-danger" onclick="confirmDeleteRecord('${escapeHtml(record.ma_phieu)}')">Xóa</button>` : ""}
            ${record.has_local && isOwner ? `<button class="btn btn-sm" onclick="deleteLocalDraftOnly('${escapeHtml(record.ma_phieu)}')">Xóa nháp</button>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");

  const paginationHtml = totalPages > 1 ? `
    <div class="pagination">
      <button class="btn btn-sm" onclick="changePage(${dashboardPage - 1})" ${dashboardPage <= 1 ? "disabled" : ""}>← Trước</button>
      <span class="page-info">Trang ${dashboardPage} / ${totalPages} &nbsp;·&nbsp; ${filtered.length} phiếu</span>
      <button class="btn btn-sm" onclick="changePage(${dashboardPage + 1})" ${dashboardPage >= totalPages ? "disabled" : ""}>Tiếp →</button>
    </div>` : filtered.length > 0 ? `<div class="page-info-simple">${dashboardPageSize === -1 ? `Hiển thị toàn bộ ${filtered.length} phiếu` : `${filtered.length} phiếu`}</div>` : "";

  document.getElementById("phieu-list").innerHTML = `
    <div class="dashboard-tools dashboard-tools-compact">
      <div class="dashboard-search"><input id="dash-search" type="search" placeholder="Tìm theo tên, mã BN, mã phiếu, người tạo..." value="${escapeHtml(dashboardQuery)}"></div>
      <div class="dashboard-filter-row">
        <div class="dash-limit-wrap">
          <label for="dash-page-size">Hiển thị</label>
          <select id="dash-page-size" class="dash-limit-select">
            <option value="20" ${dashboardPageSize === 20 ? "selected" : ""}>20 phiếu</option>
            <option value="50" ${dashboardPageSize === 50 ? "selected" : ""}>50 phiếu</option>
            <option value="100" ${dashboardPageSize === 100 ? "selected" : ""}>100 phiếu</option>
            <option value="-1" ${dashboardPageSize === -1 ? "selected" : ""}>Toàn bộ</option>
          </select>
        </div>
        <div class="segmented" id="dash-owner-segmented">
          <button data-owner="all" class="${dashboardOwnerFilter === "all" ? "active" : ""}">Tất cả</button>
          <button data-owner="mine" class="${dashboardOwnerFilter === "mine" ? "active" : ""}">Của tôi</button>
          <button data-owner="others" class="${dashboardOwnerFilter === "others" ? "active" : ""}">Người khác</button>
        </div>
        <div class="segmented" id="dash-segmented">
          <button data-filter="all" class="${dashboardFilter === "all" ? "active" : ""}">Mọi trạng thái</button>
          <button data-filter="draft" class="${dashboardFilter === "draft" ? "active" : ""}">Phiếu mới</button>
          <button data-filter="progress" class="${dashboardFilter === "progress" ? "active" : ""}">Đang điền</button>
          <button data-filter="done" class="${dashboardFilter === "done" ? "active" : ""}">Hoàn thành</button>
        </div>
      </div>
    </div>
    <div class="phieu-list-wrap compact-list">${cards || '<div class="empty">Không có phiếu phù hợp bộ lọc hiện tại.</div>'}</div>
    ${paginationHtml}
  `;

  document.getElementById("dash-search")?.addEventListener("input", e => {
    dashboardQuery = e.target.value || "";
    dashboardPage = 1;
    renderDashboard();
  });
  document.querySelectorAll("#dash-segmented button").forEach(btn => {
    btn.addEventListener("click", () => {
      dashboardFilter = btn.dataset.filter || "all";
      dashboardPage = 1;
      renderDashboard();
    });
  });
  document.querySelectorAll("#dash-owner-segmented button").forEach(btn => {
    btn.addEventListener("click", () => {
      dashboardOwnerFilter = btn.dataset.owner || "all";
      dashboardPage = 1;
      renderDashboard();
    });
  });
  document.getElementById("dash-page-size")?.addEventListener("change", e => {
    const nextSize = parseInt(e.target.value, 10);
    dashboardPageSize = [20, 50, 100, -1].includes(nextSize) ? nextSize : 20;
    localStorage.setItem(DASH_PAGE_SIZE_KEY, String(dashboardPageSize));
    dashboardPage = 1;
    renderDashboard();
  });
}

function changePage(page) {
  const records = getManagedRecords();
  const filtered = records.filter(record => {
    const hay = `${record.ma_phieu || ""} ${record.ho_ten || ""} ${record.so_ho_so || ""} ${record.dieu_tra_vien || ""}`.toLowerCase();
    const matchQ = !dashboardQuery.trim() || hay.includes(dashboardQuery.trim().toLowerCase());
    const statusText = getRecordStatus(record).text;
    const matchF = dashboardFilter === "all"
      || (dashboardFilter === "draft" && statusText === "Phiếu mới")
      || (dashboardFilter === "progress" && ["Đang điền", "Đang thực hiện", "Chưa đồng bộ", "Nháp trên máy"].includes(statusText))
      || (dashboardFilter === "done" && statusText === "Hoàn thành");
    const owner = isRecordOwner(record);
    const matchOwner = dashboardOwnerFilter === "all"
      || (dashboardOwnerFilter === "mine" && owner)
      || (dashboardOwnerFilter === "others" && !owner);
    return matchQ && matchF && matchOwner;
  });
  const effectivePageSize = dashboardPageSize === -1 ? Math.max(filtered.length || 1, 1) : dashboardPageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  dashboardPage = Math.max(1, Math.min(page, totalPages));
  renderDashboard();
}

async function openRecordByMa(ma) {
  const record = getMergedRecordByMa(ma);
  if (!isRecordOwner(record)) {
    showAlert("dash-alert", "Bạn chỉ có quyền xem phiếu do người khác tạo.", "info");
    return viewRecordByMa(ma);
  }

  // Nếu không có local draft, fetch đầy đủ 3 bước từ server trước khi mở form
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

// Popup xác nhận xóa — yêu cầu gõ "Delete"
function confirmDeleteRecord(ma) {
  const record = getMergedRecordByMa(ma);
  if (!isRecordOwner(record)) {
    showAlert("dash-alert", "Chỉ người tạo phiếu mới được xóa phiếu này.", "error");
    return;
  }
  // Tạo modal nếu chưa có
  let modal = document.getElementById("delete-confirm-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "delete-confirm-modal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;";
    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:12px;padding:28px 24px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.25);">
        <div style="font-size:18px;font-weight:700;color:var(--red,#e74c3c);margin-bottom:8px;">⚠ Xóa phiếu</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">
          Hành động này <strong>không thể hoàn tác</strong>. Phiếu sẽ bị xóa hoàn toàn khỏi Google Sheets.<br><br>
          Gõ <code style="background:var(--border);padding:2px 6px;border-radius:4px;">Delete</code> để xác nhận xóa phiếu <strong id="del-ma-label"></strong>:
        </div>
        <input id="del-confirm-input" type="text" placeholder="Gõ Delete để xác nhận"
          style="width:100%;box-sizing:border-box;padding:8px 12px;border:1.5px solid var(--border);border-radius:6px;font-size:14px;margin-bottom:16px;background:var(--surface);color:var(--text);">
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="del-cancel-btn" class="btn btn-sm">Hủy</button>
          <button id="del-confirm-btn" class="btn btn-sm btn-danger" disabled>Xóa phiếu</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("del-cancel-btn").onclick = () => { modal.style.display = "none"; };
    document.getElementById("del-confirm-input").oninput = function() {
      document.getElementById("del-confirm-btn").disabled = this.value !== "Delete";
    };
    modal.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });
  }
  document.getElementById("del-ma-label").textContent = ma;
  document.getElementById("del-confirm-input").value = "";
  document.getElementById("del-confirm-btn").disabled = true;
  modal.style.display = "flex";
  document.getElementById("del-confirm-btn").onclick = () => {
    modal.style.display = "none";
    deleteRecord(ma);
  };
}

// Xóa phiếu — chỉ chủ phiếu mới gọi được (kiểm tra ở renderDashboard)
async function deleteRecord(ma) {
  const record = getMergedRecordByMa(ma);
  if (!isRecordOwner(record)) {
    showAlert("dash-alert", "Chỉ người tạo phiếu mới được xóa phiếu này.", "error");
    return;
  }
  try {
    showAlert("dash-alert", `Đang xóa phiếu ${ma} trên server...`, "info");
    const url = new URL(API_URL);
    url.searchParams.set("action", "delete");
    url.searchParams.set("ma_phieu", ma);
    url.searchParams.set("actor", getCurrentUserName());
    const res = await fetch(url.toString());
    const data = JSON.parse(await res.text());
    if (data?.success) {
      removeLocalDraft(ma);
      danhSachCache = danhSachCache.filter(r => r.ma_phieu !== ma);
      renderDashboard();
      showAlert("dash-alert", `✓ Đã xóa phiếu ${ma} khỏi Google Sheets.`, "success");
    } else {
      showAlert("dash-alert", data?.error || `Không thể xóa phiếu ${ma}.`, "error");
    }
  } catch (e) {
    showAlert("dash-alert", `Không kết nối được server (${e.message}). Phiếu chưa bị xóa.`, "error");
  }
}

// Mở phiếu ở chế độ chỉ xem
async function viewRecordByMa(ma) {
  const record  = getMergedRecordByMa(ma);
  const hasLocal = Boolean(getLocalDraft(ma));
  if (!hasLocal && !record.local_only) {
    showAlert("dash-alert", `Đang tải phiếu ${ma}...`, "info");
    try {
      const res = await apiGet("get", { ma });
      hideAlert("dash-alert");
      const fullData = res?.data || res || {};
      const merged = { ...record, ...fullData };
      showScreen("new", { record: merged, step: 1, source: "remote", viewMode: true });
    } catch (e) {
      hideAlert("dash-alert");
      showAlert("dash-alert", `Không tải được dữ liệu phiếu (${e.message}).`, "error");
    }
    return;
  }
  showScreen("new", { record, step: 1, source: record.local_only ? "local" : "remote", viewMode: true });
}

// ── Mode banner / footer ─────────────────────────────────────
function ensureFooterControls() {
  // Auto-save handles drafts — no manual "Lưu nháp" button needed
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
  const dtv    = record?.dieu_tra_vien || record?.user || "";
  const isOwner = isRecordOwner(record);

  if (viewMode) {
    const ownerText = isOwner ? "Bạn đang xem lại phiếu của mình" : `Đang xem phiếu của ${dtv || "người khác"}`;
    const editBtn = isOwner
      ? `<button class="btn btn-sm btn-primary" style="margin-left:auto;" onclick="switchToEditMode()">Chuyển sang chỉnh sửa</button>`
      : "";
    banner.innerHTML = `
      <div class="mode-banner-row">
        <div>
          <strong>${record?.ma_phieu ? "Phiếu " + escapeHtml(record.ma_phieu) : "Phiếu"}</strong>
          · <span class="badge ${status.cls}">${escapeHtml(status.text)}</span>
          <span class="sub">${escapeHtml(ownerText)} · Chỉ đọc, chỉ có thể chuyển bước để xem nội dung</span>
        </div>
        ${editBtn}
      </div>`;
    banner.classList.add("is-readonly");
    return;
  }

  const sourceText = record?.local_only
    ? "Đang mở nháp lưu trên máy"
    : !isOwner && record?.ma_phieu ? `Phiếu do ${dtv || "người khác"} tạo — bạn chỉ có thể xem` : record?.ma_phieu ? "Có thể tiếp tục hoặc chỉnh sửa để cập nhật" : "Phiếu mới, có tự lưu nháp trên máy";
  banner.classList.remove("is-readonly");
  banner.innerHTML = `<strong>${record?.ma_phieu ? "Phiếu " + escapeHtml(record.ma_phieu) : "Phiếu mới"}</strong> · <span class="badge ${status.cls}">${escapeHtml(status.text)}</span><span class="sub">${escapeHtml(sourceText)}${record?.updated_at ? " · cập nhật gần nhất: " + escapeHtml(formatWhen(record.updated_at)) : ""}</span>`;
}

// Chuyển từ chế độ xem sang chỉnh sửa
function switchToEditMode() {
  const record = getMergedRecordByMa(currentMaPhieu);
  if (!isRecordOwner(record)) {
    showAlert("form-alert", "Chỉ người tạo phiếu mới được chuyển sang chế độ sửa.", "error");
    return;
  }
  viewMode  = false;
  formDirty = false;
  // Bật lại tất cả inputs
  document.querySelectorAll("#step1 input,#step1 select,#step1 textarea,#step2 input,#step2 select,#step2 textarea,#step3 input,#step3 select,#step3 textarea").forEach(el => {
    el.disabled = false;
    el.style.opacity = "";
  });
  updateModeBanner(record);
  setFooterButtonsForMode();
  showStep(currentStep); // re-render buttons
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
  nguyen_nhan_lo_au_khac: "f_nnLoAuKhac", nguyen_nhan_rlgn_khac: "f_nnRlgnKhac",
  ngay_pt_thuc: "f_ngayPTthuc", tg_pt: "f_tgPT", pp_pt_thuc: "f_ppPTthuc",
  vo_cam_thuc: "f_voCamThuc", truyen_mau: "f_truyenMau",
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
const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

function isIsoLikeString(s) {
  return /^\d{4}-\d{2}-\d{2}T/.test(String(s || "").trim());
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateInVN(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatTimeInVN(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value || "00";
  return `${get("hour")}:${get("minute")}`;
}

function normalizeDateForInput(field, value) {
  if (!value && value !== 0) return value;
  const s = String(value).trim();

  // Trường giờ (HH:MM)
  if (TIME_FIELDS.has(field)) {
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
    if (isIsoLikeString(s)) {
      const d = new Date(s);
      if (!isNaN(d)) return formatTimeInVN(d);
    }
    return value;
  }

  // Trường ngày (YYYY-MM-DD)
  if (DATE_FIELDS.has(field)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (isIsoLikeString(s)) {
      const d = new Date(s);
      if (!isNaN(d)) return formatDateInVN(d);
    }
    const dmyMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    return value;
  }

  return value;
}

function normalizeValueForSubmit(field, value) {
  if (value === undefined || value === null || value === "") return value;
  const s = String(value).trim();

  if (TIME_FIELDS.has(field)) {
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
    if (isIsoLikeString(s)) {
      const d = new Date(s);
      if (!isNaN(d)) return formatTimeInVN(d);
    }
    return s;
  }

  if (DATE_FIELDS.has(field)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (isIsoLikeString(s)) {
      const d = new Date(s);
      if (!isNaN(d)) return formatDateInVN(d);
    }
    const dmyMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    return s;
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
    if (field === "ho_ten") val = normalizePatientName(val);
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
  // Khôi phục AIS-5 radios
  for (let i = 1; i <= 5; i++) {
    const v = data[`ais_${i}`];
    if (v === undefined || v === null || v === "") continue;
    const r = document.querySelector(`input[name="ais_${i}"][value="${parseInt(v, 10)}"]`);
    if (r) r.checked = true;
  }
  // Khôi phục checkboxes nguyên nhân lo âu
  try {
    const loAuArr = typeof data.nguyen_nhan_lo_au === "string" && data.nguyen_nhan_lo_au
      ? JSON.parse(data.nguyen_nhan_lo_au) : (Array.isArray(data.nguyen_nhan_lo_au) ? data.nguyen_nhan_lo_au : []);
    loAuArr.forEach(val => {
      const cb = document.querySelector(`input[name="nn_lo_au"][value="${val}"]`);
      if (cb) cb.checked = true;
    });
  } catch {}
  // Khôi phục ô nguyên nhân khác lo âu
  const nnLoAuKhacEl = document.getElementById("f_nnLoAuKhac");
  if (nnLoAuKhacEl && data.nguyen_nhan_lo_au_khac) nnLoAuKhacEl.value = data.nguyen_nhan_lo_au_khac;
  // Khôi phục checkboxes nguyên nhân RLGN
  try {
    const rlgnArr = typeof data.nguyen_nhan_rlgn === "string" && data.nguyen_nhan_rlgn
      ? JSON.parse(data.nguyen_nhan_rlgn) : (Array.isArray(data.nguyen_nhan_rlgn) ? data.nguyen_nhan_rlgn : []);
    rlgnArr.forEach(val => {
      const cb = document.querySelector(`input[name="nn_rlgn"][value="${val}"]`);
      if (cb) cb.checked = true;
    });
  } catch {}
  // Khôi phục ô nguyên nhân khác RLGN
  const nnRlgnKhacEl = document.getElementById("f_nnRlgnKhac");
  if (nnRlgnKhacEl && data.nguyen_nhan_rlgn_khac) nnRlgnKhacEl.value = data.nguyen_nhan_rlgn_khac;
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
  if (typeof calcAIS5 === "function") calcAIS5();
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
    ho_ten:         normalizePatientName(getText("f_ten")),
    so_ho_so:       getText("f_hoSo"),
    ngay_sinh:      normalizeValueForSubmit("ngay_sinh", getText("f_ngaySinh")),
    gioi_tinh:      getText("f_gioi"),
    nghe_nghiep:    getText("f_ngheNghiep"),
    dia_chi:        getText("f_diaChi"),
    hoc_van:        getText("f_hocVan"),
    dan_toc:        getText("f_danToc"),
    ngay_nhap_vien: normalizeValueForSubmit("ngay_nhap_vien", getText("f_ngayNhapVien")),
    ngay_pt_du_kien: normalizeValueForSubmit("ngay_pt_du_kien", getText("f_ngayPT")),
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
    d.psqi1  = normalizeValueForSubmit("psqi1", getText("f_psqi1"));
    d.psqi3  = normalizeValueForSubmit("psqi3", getText("f_psqi3"));
    d.psqi2  = getNum("f_psqi2");
    d.psqi4  = getNum("f_psqi4");
    d.psqi5a = getText("f_psqi5a") !== "" ? getNum("f_psqi5a") : null;
    d.psqi6  = getNum("f_psqi6");
    d.psqi7  = getNum("f_psqi7");
    d.psqi8  = getNum("f_psqi8");
    d.psqi9  = getNum("f_psqi9");
    for (let i = 0; i < 9; i++) d[`psqi_5_${i}`] = radio(`psqi_5_${i}`);
    d.psqi5j_text = getText("f_psqi5j_text");
    // AIS-5
    for (let i = 1; i <= 5; i++) d[`ais_${i}`] = radio(`ais_${i}`);
    // Nguyên nhân lo âu (multi-select checkbox → JSON array)
    const nnLoAuChecked = [...document.querySelectorAll("input[name='nn_lo_au']:checked")].map(el => el.value);
    d.nguyen_nhan_lo_au = nnLoAuChecked.length ? JSON.stringify(nnLoAuChecked) : "";
    d.nguyen_nhan_lo_au_khac = getText("f_nnLoAuKhac");
    // Nguyên nhân RLGN (multi-select checkbox → JSON array)
    const nnRlgnChecked = [...document.querySelectorAll("input[name='nn_rlgn']:checked")].map(el => el.value);
    d.nguyen_nhan_rlgn = nnRlgnChecked.length ? JSON.stringify(nnRlgnChecked) : "";
    d.nguyen_nhan_rlgn_khac = getText("f_nnRlgnKhac");
    return d;
  }

  if (n === 3) return {
    ngay_pt_thuc:  normalizeValueForSubmit("ngay_pt_thuc", getText("f_ngayPTthuc")),
    tg_pt:         getNum("f_tgPT"),
    pp_pt_thuc:    getText("f_ppPTthuc"),
    vo_cam_thuc:   getText("f_voCamThuc"),
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


// ── Google Form Integration (Bước 2) ────────────────────────
const FORM_BASE_URL       = window.APP_FORM?.baseUrl        || "";
const FORM_MA_PHIEU_ENTRY = window.APP_FORM?.maPhieuEntryId || "";

function getFormLink(maPhieu) {
  if (!FORM_BASE_URL || !FORM_MA_PHIEU_ENTRY) return "";
  return `${FORM_BASE_URL}?usp=pp_url&${FORM_MA_PHIEU_ENTRY}=${encodeURIComponent(maPhieu)}`;
}

function showFormLinkModal(maPhieu) {
  const link = getFormLink(maPhieu);
  if (!FORM_BASE_URL) {
    showAlert("form-alert", "Chưa cấu hình APP_FORM trong auth-config.js.", "error");
    return;
  }
  document.getElementById("form-link-modal")?.remove();
  const modal = document.createElement("div");
  modal.id = "form-link-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:24px 22px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25);">
      <div style="font-size:16px;font-weight:700;color:var(--primary);margin-bottom:4px;">📋 Link khảo sát cho bệnh nhân</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">
        Mã phiếu đã điền sẵn: <strong style="color:var(--primary);font-family:'DM Mono',monospace;">${escapeHtml(maPhieu)}</strong>
      </div>
      <div id="form-qr-wrap" style="display:flex;justify-content:center;align-items:center;margin-bottom:16px;padding:16px;background:#fff;border-radius:10px;border:1px solid var(--border);min-height:220px;">
        <div id="form-qr-container"></div>
        <div id="form-qr-loading" style="font-size:12px;color:var(--text-muted);">Đang tạo QR...</div>
      </div>
      <div style="background:var(--slate-50);border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:11px;font-family:'DM Mono',monospace;word-break:break-all;color:var(--slate-700);border:1px solid var(--border);max-height:72px;overflow-y:auto;" id="form-link-display">${escapeHtml(link)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;background:var(--teal-50);border-radius:8px;padding:10px 12px;border-left:3px solid var(--teal-400);line-height:1.6;">
        📱 <strong>Quét QR</strong> bằng camera hoặc <strong>sao chép link</strong> gửi qua Zalo/nhắn tin. Mã phiếu đã điền sẵn.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" style="flex:1;min-width:110px;" onclick="copyFormLink('${escapeHtml(link)}',this)">📋 Sao chép link</button>
        <button class="btn btn-sm" style="flex:1;" onclick="window.open('${escapeHtml(link)}','_blank')">🔗 Mở thử</button>
        <button class="btn btn-sm" onclick="document.getElementById('form-link-modal').remove()">Đóng</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  _loadQRCode(() => {
    const qrEl = document.getElementById("form-qr-container");
    const loading = document.getElementById("form-qr-loading");
    if (loading) loading.style.display = "none";
    if (qrEl && typeof QRCode !== "undefined") {
      new QRCode(qrEl, { text: link, width: 192, height: 192, colorDark: "#0D9488", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    }
  });
}

function _loadQRCode(callback) {
  if (typeof QRCode !== "undefined") { callback(); return; }
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
  s.onload = callback;
  s.onerror = () => { const el = document.getElementById("form-qr-loading"); if (el) el.textContent = "Không tải được QR. Dùng link bên dưới."; };
  document.head.appendChild(s);
}

function copyFormLink(link, btn) {
  const text = link || document.getElementById("form-link-display")?.textContent?.trim();
  if (!text) return;
  const flash = () => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = "✓ Đã sao chép!";
    btn.style.background = "var(--green-600)";
    setTimeout(() => { btn.textContent = orig; btn.style.background = ""; }, 2000);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(flash).catch(() => { _copyFallback(text); flash(); });
  } else {
    _copyFallback(text); flash();
  }
}
function _copyFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
}

async function checkStep2FromForm() {
  if (!currentMaPhieu) return;
  const btn = document.getElementById("btn-check-form");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Đang kiểm tra..."; }
  try {
    const res = await apiGet("check-form-step2", { ma: currentMaPhieu });
    if (res?.submitted) {
      applyFormData(res.data || {});
      calcHADS(); calcPSQI(); calcAIS5(); restoreSelectionHighlights();
      _setStep2FormBadge("done", res.submitted_at);
      showAlert("form-alert", "✓ Đã tải kết quả Google Form. Kiểm tra lại rồi nhấn Lưu.", "success");
    } else {
      _setStep2FormBadge("waiting");
      showAlert("form-alert", "Bệnh nhân chưa điền form. Hãy chia sẻ link/QR rồi thử lại sau.", "info");
    }
  } catch (e) {
    showAlert("form-alert", "Lỗi kiểm tra: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Kiểm tra kết quả"; }
  }
}

function _setStep2FormBadge(status, submittedAt = "") {
  const el = document.getElementById("step2-form-badge");
  if (!el) return;
  if (status === "done") {
    el.innerHTML = `<span class="badge badge-green">✅ Bệnh nhân đã điền</span>` +
      (submittedAt ? `<span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${formatWhen(submittedAt)}</span>` : "");
  } else if (status === "waiting") {
    el.innerHTML = `<span class="badge badge-amber">⏳ Chờ bệnh nhân điền</span>`;
  } else {
    el.innerHTML = `<span class="badge badge-gray">Chưa gửi link</span>`;
  }
}

async function autoCheckStep2Status() {
  if (!currentMaPhieu || !FORM_BASE_URL) return;
  try {
    const res = await apiGet("check-form-step2", { ma: currentMaPhieu });
    _setStep2FormBadge(res?.submitted ? "done" : "waiting", res?.submitted_at);
  } catch { /* silent */ }
}

// ── Build Steps HTML ─────────────────────────────────────────
function buildStep1() {
  document.getElementById("step1").innerHTML = `
  <div class="card">
    <div class="card-title">A1. Thông tin hành chính</div>
    <div class="form-row">
      <div class="form-group"><label>Họ và tên bệnh nhân <span class="req">*</span></label><input id="f_ten" placeholder="NGUYỄN VĂN A" style="text-transform:uppercase" onblur="this.value = normalizePatientName(this.value)"></div>
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
  const psqi5Cards  = psqi5Items.map((q,i) => `
      <div class="q-card">
        <div class="q-text" style="margin-bottom:8px">${q}</div>
        <div class="opt-row">
          ${psqi5Labels.map((lbl,v) => `<label class="opt-chip" onclick="selectChip(this)"><input type="radio" name="psqi_5_${i}" value="${v}" onchange="calcPSQI()"><span>${lbl}</span></label>`).join("")}
        </div>
        ${i === 8 ? `<div style="margin-top:8px"><input type="text" id="f_psqi5j_text" placeholder="Mô tả lý do khác..." style="width:100%;font-size:12px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);box-sizing:border-box;"></div>` : ""}
      </div>`).join("");

  const ais5Items = window.AIS5_ITEMS || [];
  const aisCards  = ais5Items.map(item => `
    <div class="q-card">
      <div class="q-header">
        <span class="hads-badge badge-A" style="background:var(--teal-600,#0f6e56);">AIS${item.id}</span>
        <span class="q-text"><strong>${item.label}</strong> — <span style="color:var(--text-muted);font-size:12px;">${item.desc}</span></span>
      </div>
      <div class="opt-list">
        ${item.opts.map((o,vi) => `
          <label class="opt-label" onclick="selectOpt(this)">
            <input type="radio" name="ais_${item.id}" value="${vi}" onchange="calcAIS5()">
            <span>${o}</span>
          </label>`).join("")}
      </div>
    </div>`).join("");

  const nnLoAuItems = window.NGUYEN_NHAN_LO_AU || [];
  const nnLoAuHtml  = `
    ${nnLoAuItems.map((lbl,i) => `
    <label class="opt-label" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" name="nn_lo_au" value="${escapeHtml(lbl)}" id="nn_lo_au_${i}" style="width:15px;height:15px;flex-shrink:0;" onchange="onNnChange('lo_au',this)">
      <span style="font-size:13px;">${lbl}</span>
    </label>`).join("")}
    <label class="opt-label" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer;border-top:1px solid var(--border);margin-top:4px;padding-top:8px;">
      <input type="checkbox" name="nn_lo_au" value="Không có lo lắng" id="nn_lo_au_khong" style="width:15px;height:15px;flex-shrink:0;" onchange="onNnKhong('lo_au',this)">
      <span style="font-size:13px;font-style:italic;color:var(--text-muted);">Không có lo lắng</span>
    </label>
    <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
      <span style="font-size:13px;white-space:nowrap;color:var(--text-muted);">Nguyên nhân khác:</span>
      <input type="text" id="f_nnLoAuKhac" placeholder="Ghi rõ nếu có..." style="flex:1;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);box-sizing:border-box;">
    </div>`;

  const nnRlgnItems = window.NGUYEN_NHAN_RLGN || [];
  const nnRlgnHtml  = `
    ${nnRlgnItems.map((lbl,i) => `
    <label class="opt-label" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" name="nn_rlgn" value="${escapeHtml(lbl)}" id="nn_rlgn_${i}" style="width:15px;height:15px;flex-shrink:0;" onchange="onNnChange('rlgn',this)">
      <span style="font-size:13px;">${lbl}</span>
    </label>`).join("")}
    <label class="opt-label" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer;border-top:1px solid var(--border);margin-top:4px;padding-top:8px;">
      <input type="checkbox" name="nn_rlgn" value="Không có rối loạn giấc ngủ" id="nn_rlgn_khong" style="width:15px;height:15px;flex-shrink:0;" onchange="onNnKhong('rlgn',this)">
      <span style="font-size:13px;font-style:italic;color:var(--text-muted);">Không có rối loạn giấc ngủ</span>
    </label>
    <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
      <span style="font-size:13px;white-space:nowrap;color:var(--text-muted);">Nguyên nhân khác:</span>
      <input type="text" id="f_nnRlgnKhac" placeholder="Ghi rõ nếu có..." style="flex:1;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);box-sizing:border-box;">
    </div>`;

  const formBannerHtml = FORM_BASE_URL ? `
  <div class="card" style="border:2px solid var(--teal-200);background:var(--teal-50);">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--primary);margin-bottom:4px;">📱 Bước 2 — Bệnh nhân tự điền qua Google Form</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.5;">
          Tạo link/QR → chia sẻ cho bệnh nhân → nhấn <strong>Kiểm tra kết quả</strong> khi bệnh nhân điền xong.
        </div>
        <div id="step2-form-badge" style="margin-top:8px;"><span class="badge badge-gray">Chưa gửi link</span></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;">
        <button class="btn btn-primary btn-sm" onclick="showFormLinkModal('${escapeHtml(currentMaPhieu || "")}')">📋 Tạo link &amp; QR</button>
        <button class="btn btn-sm" id="btn-check-form" onclick="checkStep2FromForm()">🔄 Kiểm tra kết quả</button>
      </div>
    </div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--teal-100);font-size:11px;color:var(--text-muted);">
      💡 Bạn vẫn có thể tự điền tay bên dưới nếu cần.
    </div>
  </div>` : "";

  document.getElementById("step2").innerHTML = `
  ${formBannerHtml}
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
          <option value="">Chọn...</option><option value="0">Rất tốt (0)</option><option value="1">Tương đối tốt (1)</option><option value="2">Tương đối kém (2)</option><option value="3">Rất kém (3)</option>
        </select>
      </div>
      <div class="form-group">
        <label>PSQI-5a: Mất &gt;30 phút để ngủ — số lần/tuần</label>
        <select id="f_psqi5a" onchange="calcPSQI()">
          <option value="">Chọn...</option><option value="0">Không lần nào (0)</option><option value="1">&lt;1 lần/tuần (1)</option><option value="2">1–2 lần/tuần (2)</option><option value="3">≥3 lần/tuần (3)</option>
        </select>
      </div>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:10px 0 8px">PSQI-5b đến 5j: Trong tháng qua gặp vấn đề này bao nhiêu lần?</div>
    <div class="q-list">${psqi5Cards}</div>
    <div class="form-row" style="margin-top:10px">
      <div class="form-group">
        <label>Dùng thuốc ngủ/tuần — PSQI-7</label>
        <select id="f_psqi7" onchange="calcPSQI()">
          <option value="">Chọn...</option><option value="0">Không (0)</option><option value="1">&lt;1/tuần (1)</option><option value="2">1–2/tuần (2)</option><option value="3">≥3/tuần (3)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Khó giữ tỉnh táo ban ngày — PSQI-8</label>
        <select id="f_psqi8" onchange="calcPSQI()">
          <option value="">Chọn...</option><option value="0">Không (0)</option><option value="1">&lt;1/tuần (1)</option><option value="2">1–2/tuần (2)</option><option value="3">≥3/tuần (3)</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Ảnh hưởng sinh hoạt hàng ngày — PSQI-9</label>
        <select id="f_psqi9" onchange="calcPSQI()">
          <option value="">Chọn...</option><option value="0">Không ảnh hưởng (0)</option><option value="1">Ảnh hưởng nhẹ (1)</option><option value="2">Ảnh hưởng vừa (2)</option><option value="3">Ảnh hưởng nhiều (3)</option>
        </select>
      </div>
    </div>
    <div class="score-row" id="psqi-score">
      <div class="score-cell"><div class="score-val" id="psqi-total">—</div><div class="score-lbl">Tổng PSQI (/21)</div></div>
      <div class="score-cell"><div class="score-val" id="psqi-interp" style="font-size:13px"></div><div class="score-lbl">Phân loại</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">B3. Thang AIS-5 — Rối loạn giấc ngủ <span style="font-size:11px;color:var(--text-muted)">(Athens Insomnia Scale, ngưỡng >4)</span></div>
    <div class="q-list">${aisCards}</div>
    <div class="score-row" id="ais-score">
      <div class="score-cell"><div class="score-val" id="ais-total">—</div><div class="score-lbl">Tổng AIS-5 (/15)</div></div>
      <div class="score-cell"><div class="score-val" id="ais-interp" style="font-size:13px"></div><div class="score-lbl">Phân loại</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">B4. Nguyên nhân lo âu trước phẫu thuật <span style="font-size:11px;color:var(--text-muted)">(có thể chọn nhiều)</span></div>
    <div class="q-list" style="display:flex;flex-direction:column;gap:8px;">${nnLoAuHtml}</div>
  </div>
  <div class="card">
    <div class="card-title">B5. Nguyên nhân rối loạn giấc ngủ <span style="font-size:11px;color:var(--text-muted)">(có thể chọn nhiều)</span></div>
    <div class="q-list" style="display:flex;flex-direction:column;gap:8px;">${nnRlgnHtml}</div>
  </div>`;

  setTimeout(() => autoCheckStep2Status(), 300);
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

// ── Nguyên nhân lo âu / RLGN — xử lý exclusive "Không có" ──
// Khi chọn 1 option thường → bỏ chọn "Không có"
function onNnChange(group, el) {
  if (!el.checked) return;
  const khong = document.getElementById("nn_" + group + "_khong");
  if (khong) khong.checked = false;
}
// Khi chọn "Không có" → bỏ chọn tất cả option khác
function onNnKhong(group, el) {
  if (!el.checked) return;
  document.querySelectorAll("input[name='nn_" + group + "']").forEach(cb => {
    if (cb !== el) cb.checked = false;
  });
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

function calcAIS5() {
  let total = 0, count = 0;
  for (let i = 1; i <= 5; i++) {
    const sel = document.querySelector(`input[name="ais_${i}"]:checked`);
    if (sel) { total += +sel.value; count++; }
  }
  const tv = document.getElementById("ais-total");
  const ti = document.getElementById("ais-interp");
  if (tv) tv.textContent = count > 0 ? total : "—";
  if (ti && count === 5) {
    ti.textContent = total > 4 ? "Rối loạn (>4)" : "Bình thường (≤4)";
    ti.style.color = total > 4 ? "var(--red)" : "var(--green)";
  } else if (ti) {
    ti.textContent = "";
  }
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