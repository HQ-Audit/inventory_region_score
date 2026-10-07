const DATA_URL = "webdata.bin?v=20261007_official_handovers_1";
const MAGIC = new TextEncoder().encode("SCOREENC\n");
const SALT_LEN = 16;
const NONCE_LEN = 12;
const PBKDF2_ITERS = 200000;
const INTERNAL_PASSPHRASE = "ABCMART_SCOREAPP_INTERNAL_KEY_V1_WEB";
const MASTER_KEY = "audit2026!";
const REGION_MANAGERS = {
  "강원지역": "임동주 지역장", "경남지역": "조우리 지역장", "경북지역": "장규호 지역장",
  "남동지역": "이하림 지역장", "남서지역": "유영찬 지역장", "대경지역": "박양근 지역장",
  "동남지역": "박진선 지역장", "동북지역": "김대훈 지역장", "부경지역": "박근탁 지역장",
  "온더스팟": "김현지 수석", "북동지역": "강민혁 지역장", "북서지역": "하민철 지역장",
  "서남지역": "김잔디 지역장", "서북지역": "김영호 지역장", "전남지역": "최우석 지역장",
  "전북지역": "최승문 지역장", "제주지역": "박준길 지역장", "중남지역": "조재광 지역장",
  "중부지역": "김영규 지역장", "중서지역": "김동순 지역장", "충남지역": "윤영보 지역장",
  "충북지역": "변혜영 지역장"
};

let dataObj = null;
let currentQuarter = null;
let currentQuarterData = null;
let selectedLoginDd = null;
let currentDd = null;
let currentManagerName = "";
let isMaster = false;
let peopleRows = [];
let selectedPersonKey = null;
let expandedQuarterYears = new Set();
let quarterTreeBootstrapped = false;
let loginModalMode = "master";
let detailTab = "summary";
let selectedQuantityKey = null;
let mainView = "manager";
let storeRows = [];
let selectedStoreKey = null;

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || "").replace(/\s+/g, "").trim().toLowerCase();
const normalizeLoginEmployeeId = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 5 ? digits.padStart(6, "0") : digits;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const fmt2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
};
const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const scoreClass = (v) => Number(v) < 85 ? "score-high" : "";
const deltaClass = (v) => !Number.isFinite(v) ? "" : v < 0 ? "bad" : v > 0 ? "good" : "";
const fmtDelta = (v, empty = "N/A") => {
  if (!Number.isFinite(v)) return empty;
  if (Math.abs(v) < 0.005) return "0.00";
  return (v > 0 ? "+" : "") + fmt2(v);
};
const fmtQty = (v) => {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
};
const fmtQtyDiff = (v) => {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) < 0.0005) return "0";
  return (n > 0 ? "+" : "") + fmtQty(n);
};
const qtyClass = (v) => {
  if (v === null || v === undefined || v === "") return "flat";
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 0.0005) return "flat";
  return n > 0 ? "qty-pos" : "qty-neg";
};
const EMPLOYEE_NUMBER_ALIASES = new Map([
  ["070516", "2411002"], // 변형주: 2024년 11월 사번 변경
  ["1501225", "2511003"], // 강수빈: 2025년 11월 사번 변경
  ["1911132", "2512001"], // 김도연: 2025년 12월 사번 변경
  ["1708087", "2511002"], // 이예지: 2025년 11월 사번 변경
  ["1604035", "2510001"], // 이춘구: 2025년 10월 사번 변경
  ["1304134", "2605005"], // 임환희: 2026년 5월 사번 변경
  ["1606191", "2605006"], // 신흥순: 퇴직금 정산 후 신규 사번 발급
  ["2011131", "2607009"], // 김희진: 2026년 7월 사번 변경
  ["1804015", "2607008"], // 최태규: 2026년 7월 사번 변경
  ["1511060", "2511001"], // 문경진: 2025년 11월 사번 변경
  ["2206126", "2605007"], // 김대근: 2026년 5월 사번 변경
]);
const EMPLOYEE_NUMBER_CANONICAL = new Map();
EMPLOYEE_NUMBER_ALIASES.forEach((currentEmp, formerEmp) => {
  EMPLOYEE_NUMBER_CANONICAL.set(norm(formerEmp), norm(currentEmp));
  EMPLOYEE_NUMBER_CANONICAL.set(norm(currentEmp), norm(currentEmp));
});
const personKey = (r) => {
  const emp = norm(r.emp);
  const canonicalEmp = EMPLOYEE_NUMBER_CANONICAL.get(emp);
  if (canonicalEmp) return "emp:" + canonicalEmp;
  const alias = norm(r.person_alias || r.person_key);
  if (alias) return "alias:" + alias;
  return emp ? "emp:" + emp : "name:" + norm((r.name || "") + "|" + (r.pos || ""));
};

function noteInfo(item) {
  if (!item) return null;
  const raw = String(item.note_raw || item.note || "").trim();
  const type = item.note_type || (raw.includes("대체") ? "replacement" : raw.includes("인수인계") ? "handover" : "");
  const label = type === "replacement" ? "인수인계 대체" : type === "handover" ? "인수인계" : (item.note || "");
  return label ? { label, type } : null;
}

function noteBadge(item) {
  const info = noteInfo(item);
  if (!info) return "";
  const title = info.type === "replacement" ? "정기 재고조사를 인수인계 재고조사로 대체한 건입니다." : info.type === "handover" ? "별도 인수인계 재고조사 기록입니다." : "";
  return '<em class="note-badge ' + info.type + '" title="' + title + '">' + info.label + '</em>';
}

function isHandoverRow(row) {
  const info = noteInfo(row);
  if (info?.type === "handover") return true;
  const records = Array.isArray(row?.records) ? row.records : [];
  return records.length > 0 && records.every((rec) => noteInfo(rec)?.type === "handover");
}

function eventMeta(row) {
  const info = noteInfo(row);
  const regionText = row.dd || "";
  const dateText = "조사일자 " + rowDate(row);
  if (info?.type === "handover") return [regionText, "당시 조사지역", dateText].filter(Boolean).join(" · ");
  if (info?.type === "replacement") return [regionText, "정기 대체", dateText].filter(Boolean).join(" · ");
  return [regionText, dateText].filter(Boolean).join(" · ");
}

function getSearchInput() {
  return $("qInputInline") || $("qInput");
}

function setStatus(text) {
  $("sessionBadge").innerHTML = '<span class="dot"></span> ' + text;
}

function regionManager(region) {
  return REGION_MANAGERS[region] || "";
}

function shortRegionLabel(region) {
  const text = String(region || "").replace(/\s+/g, "").replace(/지역$/, "");
  if (!text) return "지역";
  if (text.includes("온더스팟") || text.toUpperCase() === "OTS") return "OTS";
  return text.slice(0, 2);
}

async function pbkdf2Key(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}

function startsWithMagic(buf) {
  const u = new Uint8Array(buf);
  if (u.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (u[i] !== MAGIC[i]) return false;
  return true;
}

async function decryptBlob(arrayBuffer) {
  if (!startsWithMagic(arrayBuffer)) throw new Error("Invalid webdata.bin");
  const u = new Uint8Array(arrayBuffer);
  let off = MAGIC.length;
  const salt = u.slice(off, off + SALT_LEN); off += SALT_LEN;
  const nonce = u.slice(off, off + NONCE_LEN); off += NONCE_LEN;
  const ct = u.slice(off);
  const key = await pbkdf2Key(INTERNAL_PASSPHRASE, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct);
  return new TextDecoder("utf-8").decode(plain);
}

async function loadData() {
  setStatus("데이터 로드 중");
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("webdata 로드 실패: " + res.status);
  dataObj = JSON.parse(await decryptBlob(await res.arrayBuffer()));
  setCurrentQuarter(defaultQuarterId());
  fillQuarterControls();
  fillRegionsForQuarter();
  setStatus("로그인 대기");
}

function quarterEntries() {
  return Object.entries(dataObj.quarters || {}).map(([id, data]) => ({
    id,
    label: formatQuarterLabel(id, data.label),
    data,
    rank: quarterRank(id),
  })).sort((a, b) => a.rank - b.rank);
}

function formatQuarterLabel(id, label) {
  const source = String(label || id || "");
  const match = source.match(/(20\d{2})\s*Q([1-4])/i) || String(id || "").match(/(20\d{2})Q([1-4])/i);
  return match ? match[1] + " Q" + match[2] : source;
}

function currentQuarterLabel() {
  const data = dataObj && dataObj.quarters ? dataObj.quarters[currentQuarter] : null;
  return formatQuarterLabel(currentQuarter, data && data.label);
}

function updateQuarterCopy() {
  if (!currentQuarter) return;
  const label = currentQuarterLabel();
  const fullLabel = label + " 정기 재고조사";
  if ($("noticeQuarterLabel")) $("noticeQuarterLabel").textContent = fullLabel;
  if ($("introQuarterLabel")) $("introQuarterLabel").textContent = fullLabel;
}

function quarterRank(id) {
  const m = String(id).match(/(\d{4})Q([1-4])/);
  return m ? Number(m[1]) * 10 + Number(m[2]) : 0;
}

function quarterYear(id) {
  const m = String(id || "").match(/(20\d{2})Q[1-4]/i);
  return m ? m[1] : "";
}

function shortQuarterLabel(id, label) {
  const source = String(label || id || "");
  const match = source.match(/(20\d{2})\s*Q([1-4])/i) || String(id || "").match(/(20\d{2})Q([1-4])/i);
  return match ? "Q" + match[2] : formatQuarterLabel(id, label);
}

function shortYearLabel(year) {
  return year;
}

function ensureQuarterYearExpanded() {
  const year = quarterYear(currentQuarter);
  if (year && !quarterTreeBootstrapped) {
    expandedQuarterYears.add(year);
    quarterTreeBootstrapped = true;
  }
}

function setCurrentQuarter(id) {
  const entry = quarterEntries().find((q) => q.id === id) || quarterEntries().at(-1);
  currentQuarter = entry.id;
  currentQuarterData = entry.data;
  ensureQuarterYearExpanded();
  updateQuarterCopy();
}

function defaultQuarterId() {
  const entries = quarterEntries();
  if (!entries.length) return "";
  if (dataObj.defaultQuarter && entries.some((q) => q.id === dataObj.defaultQuarter)) return dataObj.defaultQuarter;
  return entries.at(-1).id;
}

function fillQuarterControls() {
  const entries = quarterEntries();
  const side = $("quarterSide");
  if (!entries.length) {
    side.innerHTML = "";
    return;
  }
  const currentYear = quarterYear(currentQuarter) || quarterYear(entries.at(-1).id);
  if (!quarterTreeBootstrapped && currentYear) {
    expandedQuarterYears.add(currentYear);
    quarterTreeBootstrapped = true;
  }

  const groups = [];
  entries.forEach((q) => {
    const year = quarterYear(q.id) || "\uae30\ud0c0";
    let group = groups.find((item) => item.year === year);
    if (!group) {
      group = { year, entries: [] };
      groups.push(group);
    }
    group.entries.push(q);
  });
  groups.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));

  side.innerHTML = groups.map((group) => {
    const open = expandedQuarterYears.has(group.year);
    const children = group.entries.map((q) =>
      '<button class="side-item quarter-item ' + (q.id === currentQuarter ? "active" : "") + '" type="button" data-quarter="' + q.id + '" title="' + q.label + '">' + shortQuarterLabel(q.id, q.label) + '</button>'
    ).join("");
    return '<div class="quarter-year">' +
      '<button class="quarter-year-toggle ' + (open ? "open" : "") + '" type="button" data-quarter-year="' + group.year + '" aria-expanded="' + (open ? "true" : "false") + '">' +
        '<span><i class="chevron"></i>' + shortYearLabel(group.year) + '</span>' +
      '</button>' +
      '<div class="quarter-children ' + (open ? "" : "collapsed") + '">' + children + '</div>' +
    '</div>';
  }).join("");

  document.querySelectorAll("[data-quarter-year]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const year = String(btn.getAttribute("data-quarter-year") || "");
      if (!year) return;
      if (expandedQuarterYears.has(year)) expandedQuarterYears.delete(year);
      else expandedQuarterYears.add(year);
      fillQuarterControls();
    });
  });
  document.querySelectorAll("[data-quarter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setCurrentQuarter(btn.dataset.quarter);
      fillQuarterControls();
      fillRegionsForQuarter();
      if (currentDd) {
        selectedPersonKey = null;
        detailTab = "summary";
        selectedQuantityKey = null;
        paintRegion(currentDd, true);
        setStatus(currentQuarterLabel() + (isMaster ? " · 마스터 · " : " · ") + currentDd + (currentManagerName ? " · " + currentManagerName : "") + " 조회 중");
        renderActiveView();
      }
    });
  });
}

function fillRegionsForQuarter() {
  const regions = Object.keys(currentQuarterData.regions || {}).sort((a, b) => a.localeCompare(b, "ko"));
  const visibleRegions = isMaster ? regions : (currentDd && regions.includes(currentDd) ? [currentDd] : []);
  selectedLoginDd = currentDd && regions.includes(currentDd) ? currentDd : null;
  const picker = $("regionPicker");
  picker.innerHTML = visibleRegions.map((dd) =>
    '<div class="region-row" data-region-row="' + dd + '">' +
      '<button class="region-option" type="button" role="option" data-region="' + dd + '">' + dd + '</button>' +
    '</div>'
  ).join("");
  if ($("regionNav")) $("regionNav").classList.toggle("hidden", visibleRegions.length === 0);
  if ($("regionFilter")) $("regionFilter").classList.toggle("hidden", !isMaster);
  paintRegion(currentDd || selectedLoginDd || "", Boolean(currentDd));
  if ($("regionFilter")) {
    $("regionFilter").oninput = applyRegionFilter;
    applyRegionFilter();
  }
  picker.querySelectorAll("[data-region]").forEach((button) => {
    button.addEventListener("click", () => {
      if (currentDd && !isMaster) return;
      selectedLoginDd = button.dataset.region;
      if (isMaster) {
        currentDd = selectedLoginDd;
        currentManagerName = regionManager(currentDd);
        selectedPersonKey = null;
        detailTab = "summary";
        selectedQuantityKey = null;
        paintRegion(currentDd, true);
        setStatus(currentQuarterLabel() + " · 마스터 · " + currentDd + (currentManagerName ? " · " + currentManagerName : "") + " 조회 중");
        renderActiveView();
      }
    });
  });
}

function applyRegionFilter() {
  const query = norm($("regionFilter") ? $("regionFilter").value : "");
  $("regionPicker").querySelectorAll("[data-region-row]").forEach((row) => {
    row.classList.toggle("hidden", Boolean(query) && !norm(row.dataset.regionRow).includes(query));
  });
}

function paintRegion(region, locked) {
  $("regionPicker").querySelectorAll("[data-region-row]").forEach((row) => {
    const active = row.dataset.regionRow === region;
    row.classList.toggle("active", active);
    row.classList.toggle("locked", Boolean(locked && (!isMaster || active)));
  });
  $("regionPicker").querySelectorAll("[data-region]").forEach((button) => {
    const active = button.dataset.region === region;
    button.classList.toggle("active", active);
    button.disabled = Boolean(locked && !isMaster && !active);
  });
  $("regionPicker").querySelectorAll("[data-region-access]").forEach((button) => {
    const active = button.dataset.regionAccess === region;
    button.disabled = Boolean(locked && !isMaster);
    button.classList.toggle("active", active);
  });
}

function validateRegion(dd, code) {
  if (norm(code) === norm(MASTER_KEY)) return "master";
  const expected = norm(currentQuarterData.regions[dd]);
  if (!expected) throw new Error("지역 정보가 없습니다.");
  if (norm(code) !== expected) throw new Error("지역/암호가 틀립니다.");
  return "region";
}

function validateEmployeeLogin(employeeId, code) {
  const emp = normalizeLoginEmployeeId(employeeId);
  if (!emp) throw new Error("사번을 입력하세요.");
  const accounts = dataObj && dataObj.accounts;
  if (!accounts || typeof accounts !== "object") {
    throw new Error("지역장 사번 정보가 아직 웹데이터에 반영되지 않았습니다.");
  }
  const account = accounts[emp];
  if (!account) throw new Error("등록되지 않은 지역장 사번입니다.");
  const dd = typeof account === "string" ? account : account.region;
  const manager = typeof account === "string" ? regionManager(dd) : String(account.manager || "").trim();
  if (!dd) throw new Error("사번에 연결된 지역 정보가 없습니다.");
  if (!Object.prototype.hasOwnProperty.call(currentQuarterData.regions || {}, dd)) {
    throw new Error("선택한 분기에 담당 지역 정보가 없습니다.");
  }
  const mode = validateRegion(dd, code);
  if (mode !== "region") throw new Error("지역 비밀번호를 확인하세요.");
  return { dd, manager };
}

function isTargetPosition(pos) {
  const text = norm(pos);
  return text.includes("점장") || text.includes("부점장") || text.includes("매니저");
}

function cleanRows(rows) {
  return (rows || []).filter((r) => r.store !== "(AVG)" && r.name && r.emp && String(r.name).toLowerCase() !== "n/a" && isTargetPosition(r.pos));
}

function rowsForQuarter(id) {
  const q = (dataObj.quarters || {})[id];
  return q ? cleanRows(q.rows).map((r, idx) => ({ ...r, _quarterId: id, _quarterLabel: q.label || formatQuarterLabel(id), _rowIndex: idx })) : [];
}

function rowsThroughSelectedQuarter() {
  const selectedRank = quarterRank(currentQuarter);
  return quarterEntries().filter((q) => q.rank <= selectedRank).flatMap((q) => rowsForQuarter(q.id));
}

function rowDate(row) {
  const dates = [];
  if (Array.isArray(row.records)) {
    row.records.forEach((rec) => {
      if (rec.date) dates.push(String(rec.date));
      if (rec.detail && rec.detail.E) dates.push(String(rec.detail.E));
    });
  }
  return dates.sort().at(-1) || row._quarterLabel || "";
}

function recordDate(row, rec) {
  return String(rec?.date || rec?.detail?.E || rowDate(row) || "");
}

function quantityValue(detail, key) {
  const raw = detail?.[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function categoryHasData(detail, keys) {
  return keys.some((key) => {
    const value = quantityValue(detail, key);
    return value !== null && Math.abs(value) > 0.000001;
  });
}

function quantityRecordKey(row, rec, index) {
  return [row._quarterId, row._rowIndex, index, recordDate(row, rec), row.store || ""].join("|");
}

function quantityRecordsForPerson(person) {
  if (!person) return [];
  const records = [];
  // 2025년 원천은 점수 이력만 보존하고 수량 상세가 없으므로
  // 차이수량 탭의 선택 목록에는 2026년 이후 기록만 노출한다.
  const sortedRows = person.history.filter((row) => quarterRank(row._quarterId) >= quarterRank("2026Q1")).sort((a, b) => {
    const q = quarterRank(b._quarterId) - quarterRank(a._quarterId);
    if (q) return q;
    return String(rowDate(b)).localeCompare(String(rowDate(a)));
  });
  sortedRows.forEach((row) => {
    (row.records || [])
      .map((rec, index) => ({ rec, index }))
      .sort((a, b) => String(recordDate(row, b.rec)).localeCompare(String(recordDate(row, a.rec))))
      .forEach(({ rec, index }) => {
      const detail = rec.detail || {};
      const isFnbLayout = quantityValue(detail, "AY") !== null;
      const categorySignals = [
        ["F", "H", "M", "N"],
        ["O", "Q", "V", "W"],
        ["X", "Z", "AE", "AF"],
        ...(isFnbLayout ? [["AG", "AI", "AN", "AO"]] : []),
      ];
      const hasQuantity = categorySignals.some((keys) => categoryHasData(detail, keys));
      records.push({
        key: quantityRecordKey(row, rec, index),
        row,
        rec,
        detail,
        hasQuantity,
        date: recordDate(row, rec),
        quarterId: row._quarterId,
        quarterLabel: row._quarterLabel || formatQuarterLabel(row._quarterId),
        store: row.store || "",
        score: Number.isFinite(Number(rec.ap)) ? Number(rec.ap) : scoreOf(row),
      });
    });
  });
  return records;
}

function defaultQuantityKey(records) {
  if (!records.length) return null;
  const current = records.find((record) => record.quarterId === currentQuarter);
  return (current || records[0]).key;
}

function quantityRows(record) {
  const detail = record?.detail || {};
  const rows = [
    { label: "신발", system: detail.F, actual: detail.H, diff: detail.I, signals: ["F", "H", "M", "N"] },
    { label: "용품", system: detail.O, actual: detail.Q, diff: detail.R, signals: ["O", "Q", "V", "W"] },
    { label: "의류", system: detail.X, actual: detail.Z, diff: detail.AA, signals: ["X", "Z", "AE", "AF"] },
  ].filter((row) => categoryHasData(detail, row.signals));
  const isFnbLayout = quantityValue(detail, "AY") !== null;
  if (isFnbLayout) {
    if (categoryHasData(detail, ["AG", "AI", "AN", "AO"])) {
      rows.push({ label: "FNB", system: detail.AG, actual: detail.AI, diff: detail.AJ });
    }
    if (rows.length) rows.push({ label: "합계", system: detail.AP, actual: detail.AR, diff: detail.AS, total: true });
  } else {
    if (rows.length) rows.push({ label: "합계", system: detail.AG, actual: detail.AI, diff: detail.AJ, total: true });
  }
  return rows;
}

function allHistoryRows() {
  return quarterEntries().flatMap((q) => rowsForQuarter(q.id));
}

function storeKey(row) {
  return norm(row?.store_group || row?.store);
}

function storeValueKey(value) {
  return norm(value);
}

function assignedStoreForRecord(row, rec) {
  return String(rec?.assigned_store || row?.assigned_store || row?.store_group || row?.store || "").trim();
}

function auditStoreForRecord(row, rec) {
  return String(rec?.audit_store || row?.audit_store || row?.store_group || row?.store || "").trim();
}

function assignedDdForRecord(row, rec) {
  return String(rec?.assigned_dd || row?.dd || "").trim();
}

function auditDdForRecord(row, rec) {
  return String(rec?.audit_dd || row?.dd || "").trim();
}

function latestQuarterEntry() {
  return quarterEntries().at(-1) || null;
}

function storePeriodText() {
  const entries = quarterEntries();
  if (!entries.length) return "전체 기간";
  return formatQuarterLabel(entries[0].id, entries[0].label) + " ~ " + formatQuarterLabel(entries.at(-1).id, entries.at(-1).label);
}

function scoreForRecord(row, rec) {
  const value = Number(rec?.ap);
  return Number.isFinite(value) ? value : scoreOf(row);
}

const auditRegionAverageCache = new Map();

function regionAverageForAuditRecord(row, rec) {
  const dd = auditDdForRecord(row, rec);
  const cacheKey = row._quarterId + "|" + dd;
  if (auditRegionAverageCache.has(cacheKey)) return auditRegionAverageCache.get(cacheKey);
  const scores = [];
  rowsForQuarter(row._quarterId).forEach((candidate) => {
    (Array.isArray(candidate.records) ? candidate.records : []).forEach((candidateRecord) => {
      if (auditDdForRecord(candidate, candidateRecord) !== dd) return;
      const score = scoreForRecord(candidate, candidateRecord);
      if (Number.isFinite(score)) scores.push(score);
    });
  });
  const value = avg(scores);
  auditRegionAverageCache.set(cacheKey, value);
  return value;
}

function dateDistanceDays(a, b) {
  const left = Date.parse(String(a || ""));
  const right = Date.parse(String(b || ""));
  return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) / 86400000 : Infinity;
}

function previousDate(dateText) {
  const parsed = Date.parse(String(dateText || ""));
  if (!Number.isFinite(parsed)) return dateText || "";
  return new Date(parsed - 86400000).toISOString().slice(0, 10);
}

function officialHandoversForStore(targetStoreKey) {
  const transitions = Array.isArray(dataObj?.officialHandovers) ? dataObj.officialHandovers : [];
  return transitions
    .filter((item) => storeValueKey(item.store) === targetStoreKey)
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function officialTransitionBetween(transitions, outgoingName, incomingName) {
  return (transitions || []).find((item) =>
    norm(item.outgoing) === norm(outgoingName) && norm(item.incoming) === norm(incomingName)
  ) || null;
}

function officialTransitionForIncomingEvent(event, eventIndex, events, transitions) {
  if (!Number.isFinite(event?.score)) return null;
  for (const transition of transitions || []) {
    if (norm(transition.incoming) !== norm(event.managerName)) continue;
    let outgoingIndex = -1;
    for (let index = 0; index < eventIndex; index += 1) {
      if (norm(events[index].managerName) === norm(transition.outgoing)) outgoingIndex = index;
    }
    if (outgoingIndex < 0) continue;
    const firstIncomingScoreIndex = events.findIndex((candidate, index) =>
      index > outgoingIndex && norm(candidate.managerName) === norm(transition.incoming) && Number.isFinite(candidate.score)
    );
    if (firstIncomingScoreIndex === eventIndex) return transition;
  }
  return null;
}

function orderHandoverEvents(events) {
  const copied = events.map((event) => ({ ...event }));
  const baseline = copied.slice().sort((a, b) => {
    const rank = quarterRank(a.quarterId) - quarterRank(b.quarterId);
    if (rank) return rank;
    const date = String(a.date).localeCompare(String(b.date));
    if (date) return date;
    return String(a.key).localeCompare(String(b.key));
  });
  const byQuarter = new Map();
  copied.forEach((event) => {
    if (!byQuarter.has(event.quarterId)) byQuarter.set(event.quarterId, []);
    byQuarter.get(event.quarterId).push(event);
  });
  byQuarter.forEach((quarterEvents) => {
    const replacements = quarterEvents.filter((event) => event.note?.type === "replacement");
    const handovers = quarterEvents.filter((event) => event.note?.type === "handover");
    replacements.forEach((outgoing) => {
      const incoming = handovers
        .filter((event) => event.managerKey !== outgoing.managerKey && !event._transitionPair)
        .map((event) => ({ event, gap: dateDistanceDays(event.date, outgoing.date) }))
        .filter((item) => item.gap <= 7)
        .sort((a, b) => a.gap - b.gap)[0]?.event;
      if (!incoming) return;
      const transitionDate = [outgoing.date, incoming.date].filter(Boolean).sort().at(-1) || outgoing.date || incoming.date;
      const pairId = outgoing.quarterId + "|" + outgoing.managerKey + "|" + incoming.managerKey;
      outgoing._transitionPair = pairId;
      outgoing._transitionRole = "outgoing";
      outgoing._transitionDate = transitionDate;
      incoming._transitionPair = pairId;
      incoming._transitionRole = "incoming";
      incoming._transitionDate = transitionDate;
    });

    // 일부 원천은 인계자와 인수자 양쪽 기록이 모두 '인수인계'로 저장된다.
    // 단순 날짜순으로 두면 인수 기록이 하루 빠른 경우 점장이 왕복한 것처럼 보이므로,
    // 직전·직후 분기의 실제 점장 연속성을 이용해 인계자와 인수자를 판별한다.
    const remainingHandovers = handovers.filter((event) => !event._transitionPair);
    const candidates = [];
    for (let leftIndex = 0; leftIndex < remainingHandovers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < remainingHandovers.length; rightIndex += 1) {
        const left = remainingHandovers[leftIndex];
        const right = remainingHandovers[rightIndex];
        if (left.managerKey === right.managerKey) continue;
        const gap = dateDistanceDays(left.date, right.date);
        if (gap > 7) continue;
        const pairKeys = new Set([left.key, right.key]);
        const firstPosition = Math.min(baseline.indexOf(left), baseline.indexOf(right));
        const lastPosition = Math.max(baseline.indexOf(left), baseline.indexOf(right));
        const previous = baseline.slice(0, firstPosition).reverse().find((event) => !pairKeys.has(event.key));
        const next = baseline.slice(lastPosition + 1).find((event) => !pairKeys.has(event.key));
        let outgoing = null;
        let incoming = null;
        if (previous?.managerKey === left.managerKey) outgoing = left;
        if (previous?.managerKey === right.managerKey) outgoing = right;
        if (next?.managerKey === left.managerKey) incoming = left;
        if (next?.managerKey === right.managerKey) incoming = right;
        if (outgoing && !incoming) incoming = outgoing === left ? right : left;
        if (incoming && !outgoing) outgoing = incoming === left ? right : left;
        if (!outgoing || !incoming || outgoing === incoming) continue;
        const continuity = Number(previous?.managerKey === outgoing.managerKey) + Number(next?.managerKey === incoming.managerKey);
        candidates.push({ outgoing, incoming, gap, continuity });
      }
    }
    candidates
      .sort((a, b) => b.continuity - a.continuity || a.gap - b.gap)
      .forEach(({ outgoing, incoming }) => {
        if (outgoing._transitionPair || incoming._transitionPair) return;
        const transitionDate = [outgoing.date, incoming.date].filter(Boolean).sort().at(-1) || outgoing.date || incoming.date;
        const pairId = outgoing.quarterId + '|handover|' + outgoing.managerKey + '|' + incoming.managerKey;
        outgoing._transitionPair = pairId;
        outgoing._transitionRole = 'outgoing';
        outgoing._transitionDate = transitionDate;
        incoming._transitionPair = pairId;
        incoming._transitionRole = 'incoming';
        incoming._transitionDate = transitionDate;
      });
  });
  return copied.sort((a, b) => {
    const rank = quarterRank(a.quarterId) - quarterRank(b.quarterId);
    if (rank) return rank;
    if (a._transitionPair && a._transitionPair === b._transitionPair) {
      return a._transitionRole === "outgoing" ? -1 : 1;
    }
    const date = String(a._transitionDate || a.date).localeCompare(String(b._transitionDate || b.date));
    if (date) return date;
    return String(a.key).localeCompare(String(b.key));
  });
}

function auditEventsForStore(targetStoreKey) {
  const events = [];
  allHistoryRows().forEach((row) => {
    const records = Array.isArray(row.records) ? row.records : [];
    records.forEach((rec, index) => {
      const assignedStore = assignedStoreForRecord(row, rec);
      const auditStore = auditStoreForRecord(row, rec);
      const assignmentMatch = storeValueKey(assignedStore) === targetStoreKey;
      const auditMatch = storeValueKey(auditStore) === targetStoreKey;
      if (!assignmentMatch && !auditMatch) return;
      const detail = rec?.detail || {};
      const categoryRows = quantityRows({ detail });
      const categoryDiffs = {};
      if (auditMatch) {
        categoryRows.filter((item) => !item.total).forEach((item) => {
          categoryDiffs[item.label] = quantityValue({ value: item.diff }, "value");
        });
      }
      events.push({
        key: [row._quarterId, row._rowIndex, index, recordDate(row, rec)].join("|"),
        quarterId: row._quarterId,
        quarterLabel: formatQuarterLabel(row._quarterId, row._quarterLabel),
        date: recordDate(row, rec),
        row,
        rec,
        score: auditMatch ? scoreForRecord(row, rec) : null,
        regionAvg: auditMatch ? regionAverageForAuditRecord(row, rec) : null,
        managerKey: personKey(row),
        managerName: row.name || "이름 없음",
        managerEmp: row.emp || "",
        note: noteInfo(rec) || noteInfo(row),
        categoryDiffs,
        assignedStore,
        auditStore,
        assignedDd: assignedDdForRecord(row, rec),
        auditDd: auditDdForRecord(row, rec),
        relation: assignmentMatch && auditMatch ? "both" : assignmentMatch ? "assignment" : "audit",
      });
    });
  });
  const chronological = events.sort((a, b) => {
    const rank = quarterRank(a.quarterId) - quarterRank(b.quarterId);
    if (rank) return rank;
    const date = String(a.date).localeCompare(String(b.date));
    if (date) return date;
    return String(a.key).localeCompare(String(b.key));
  });
  return orderHandoverEvents(chronological);
}

function buildStoreRows() {
  const latest = latestQuarterEntry();
  if (!latest || !currentDd) {
    storeRows = [];
    return;
  }
  const current = rowsForQuarter(latest.id).filter((row) => row.dd === currentDd);
  const currentByStore = new Map();
  current.forEach((row) => {
    const key = storeKey(row);
    if (!key) return;
    if (!currentByStore.has(key)) currentByStore.set(key, []);
    currentByStore.get(key).push(row);
  });
  const allRows = allHistoryRows();
  storeRows = Array.from(currentByStore.entries()).map(([key, latestRows]) => {
    const history = allRows.filter((row) => storeKey(row) === key);
    const events = auditEventsForStore(key);
    const scoreEvents = events.filter((event) => Number.isFinite(event.score));
    const latestEvent = scoreEvents.at(-1) || null;
    const currentEvent = events.at(-1) || latestEvent;
    const managers = [];
    events.forEach((event) => {
      if (!managers.length || managers.at(-1).key !== event.managerKey) {
        managers.push({ key: event.managerKey, name: event.managerName, emp: event.managerEmp });
      }
    });
    const officialHandovers = officialHandoversForStore(key);
    const explicitPairs = new Set();
    let unpairedExplicitHandovers = 0;
    events.forEach((event) => {
      if (event.note?.type !== "handover" && event.note?.type !== "replacement") return;
      if (event._transitionPair) explicitPairs.add(event._transitionPair);
      else unpairedExplicitHandovers += 1;
    });
    const handoverCount = officialHandovers.length + explicitPairs.size + unpairedExplicitHandovers;
    return {
      key,
      store: latestRows[0]?.store_group || latestRows[0]?.store || history.at(-1)?.store || "",
      latestRows,
      history,
      events,
      scoreEvents,
      latestEvent,
      currentEvent,
      managers,
      officialHandovers,
      managerChanges: Math.max(0, managers.length - 1),
      handoverCount,
    };
  }).sort((a, b) => a.store.localeCompare(b.store, "ko"));
}

function storeAxisLabel(event, index, events) {
  const sameQuarter = events.filter((item) => item.quarterId === event.quarterId);
  if (sameQuarter.length === 1) return event.quarterLabel.replace(/^20/, "");
  const dateMatch = String(event._transitionDate || event.date).match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  return event.quarterLabel.replace(/^20/, "") + (dateMatch ? "\n" + Number(dateMatch[2]) + "/" + Number(dateMatch[3]) : " #" + (sameQuarter.indexOf(event) + 1));
}

function managerSegments(events, xAt) {
  const segments = [];
  events.forEach((event, index) => {
    const previous = segments.at(-1);
    if (!previous || previous.key !== event.managerKey) {
      segments.push({ key: event.managerKey, name: event.managerName, emp: event.managerEmp, start: index, end: index });
    } else {
      previous.end = index;
    }
  });
  return segments.map((segment, index) => {
    const left = segment.start === 0 ? xAt(0) - 22 : (xAt(segment.start - 1) + xAt(segment.start)) / 2;
    const right = segment.end === events.length - 1 ? xAt(events.length - 1) + 22 : (xAt(segment.end) + xAt(segment.end + 1)) / 2;
    return { ...segment, left, right, colorIndex: index % 4 };
  });
}

function tenureSummaryGroups(events) {
  const groups = [];
  events.forEach((event) => {
    const previous = groups.at(-1);
    if (!previous || previous.key !== event.managerKey) {
      groups.push({
        key: event.managerKey,
        name: event.managerName,
        employees: [event.managerEmp].filter(Boolean),
        events: [event],
        colorIndex: groups.length % 4,
      });
      return;
    }
    previous.events.push(event);
    if (event.managerEmp && !previous.employees.includes(event.managerEmp)) previous.employees.push(event.managerEmp);
  });
  return groups;
}

function tenureSummaryHtml(store) {
  const groups = tenureSummaryGroups(store.events);
  if (!groups.length) return '<div class="empty compact">표시할 점장 근속 이력이 없습니다.</div>';
  const latestQuarter = latestQuarterEntry()?.id;
  return '<div class="tenure-explanation-list">' + groups.map((group, index) => {
    const first = group.events[0];
    const last = group.events.at(-1);
    const scoreEvents = group.events.filter((event) => Number.isFinite(event.score));
    const scores = scoreEvents.map((event) => event.score);
    const regionScores = scoreEvents.map((event) => event.regionAvg).filter(Number.isFinite);
    const managerAvg = avg(scores);
    const regionAvg = avg(regionScores);
    const gap = managerAvg !== null && regionAvg !== null ? managerAvg - regionAvg : null;
    const isCurrent = index === groups.length - 1 && last.quarterId === latestQuarter;
    const previous = groups[index - 1];
    const next = groups[index + 1];
    const incomingOfficial = previous ? officialTransitionBetween(store.officialHandovers, previous.name, group.name) : null;
    const outgoingOfficial = next ? officialTransitionBetween(store.officialHandovers, group.name, next.name) : null;
    const startBoundary = incomingOfficial?.date || (first._transitionRole === 'incoming'
      ? first._transitionDate
      : previous
        ? (first._transitionDate || first.date)
        : '');
    const nextFirst = next?.events?.[0];
    const endBoundary = outgoingOfficial?.date
      ? previousDate(outgoingOfficial.date)
      : nextFirst
      ? (last._transitionRole === 'outgoing' ? last._transitionDate : previousDate(nextFirst._transitionDate || nextFirst.date))
      : '';
    const period = index === 0 && first._transitionRole === 'outgoing'
      ? first.quarterLabel + '까지'
      : first.quarterLabel + ' ~ ' + (isCurrent ? '현재' : last.quarterLabel);
    const exactPeriod = index === 0 && first._transitionRole === 'outgoing'
      ? '~ ' + (last._transitionDate || last.date)
      : [startBoundary || first.date, isCurrent ? '현재' : (endBoundary || last.date)].filter(Boolean).join(' ~ ');
    const empText = group.employees.length ? ' · ' + group.employees.join(' → ') : '';
    const responsibilityText = index === 0 && first._transitionRole === 'outgoing'
      ? (last._transitionDate || last.date) + ' 인수인계까지 담당했습니다.'
      : (startBoundary || first.date) + '부터 ' + (isCurrent ? '현재까지 담당 중입니다.' : (endBoundary || last.date) + '까지 담당한 것으로 연결됩니다.');
    let comparisonDescription = '';
    const firstScoreEvent = scoreEvents[0];
    if (previous && firstScoreEvent) {
      const previousScoreEvents = previous.events.filter((event) => Number.isFinite(event.score));
      const previousManagerAvg = avg(previousScoreEvents.map((event) => event.score));
      const firstScoreIndex = group.events.indexOf(firstScoreEvent);
      const transitionEvents = previous.events.concat(group.events.slice(0, firstScoreIndex + 1));
      const isHandover = Boolean(incomingOfficial) || transitionEvents.some((event) => event.note?.type === 'handover' || event.note?.type === 'replacement');
      if (previousManagerAvg !== null) {
        const change = firstScoreEvent.score - previousManagerAvg;
        const direction = Math.abs(change) < 0.005 ? '동일합니다.' : change > 0 ? fmt2(Math.abs(change)) + '점 높습니다.' : fmt2(Math.abs(change)) + '점 낮습니다.';
        const comparisonLabel = isHandover ? '인수인계 전후 비교' : '전 점장 비교';
        comparisonDescription = '\n' + comparisonLabel + ': 변경 전 ' + previous.name + ' 점장 평균 ' + fmt2(previousManagerAvg) + '점 대비 ' + group.name + ' 점장 첫 조사 ' + fmt2(firstScoreEvent.score) + '점으로, ' + direction;
      }
    }
    const scoreDescription = scoreEvents.length
      ? ' 총 ' + scoreEvents.length + '회 조사 평균은 ' + fmt2(managerAvg) + '점이며, 같은 시기 지역 평균 대비 ' + fmtDelta(gap, '-') + '점입니다.' + comparisonDescription
      : ' 해당 담당 기간에 이 점포에서 실시한 조사 기록은 없습니다.';
    const description = responsibilityText + scoreDescription;
    let transition = '';
    if (next) {
      const paired = last._transitionPair && last._transitionPair === nextFirst?._transitionPair;
      const changeDate = outgoingOfficial?.date || (paired ? last._transitionDate : (nextFirst?._transitionDate || nextFirst?.date || ''));
      const hasExplicitHandover = paired || [last, nextFirst].some((event) => event?.note?.type === 'handover' || event?.note?.type === 'replacement');
      const changeLabel = outgoingOfficial || hasExplicitHandover ? '인수인계' : '담당 변경';
      transition = '<div class="tenure-transition"><i></i><span>' + esc([changeDate, changeLabel, next.name + ' 점장 인수'].filter(Boolean).join(' · ')) + '</span></div>';
    }
    return '<article class="tenure-explanation tenure-summary-' + group.colorIndex + '">' +
      '<div class="tenure-summary-mark"><span></span></div>' +
      '<div class="tenure-summary-copy"><div class="tenure-summary-heading"><strong>' + esc(group.name + ' 점장') + '</strong><em>' + esc(period) + '</em></div>' +
      '<small>' + esc(exactPeriod + empText) + '</small><p>' + esc(description) + '</p></div>' +
    '</article>' + transition;
  }).join('') + '</div>';
}

function scoreTrendSvg(store) {
  const events = store.events;
  const scoreEvents = events.filter((event) => Number.isFinite(event.score));
  if (!scoreEvents.length) return '<div class="empty compact">표시할 점수 이력이 없습니다.</div>';
  const width = 1040, height = 330, left = 58, right = 26, top = 64, bottom = 58;
  const plotW = width - left - right, plotH = height - top - bottom;
  const allValues = scoreEvents.flatMap((event) => [event.score, event.regionAvg]).filter(Number.isFinite);
  let min = Math.floor(Math.min(...allValues) / 5) * 5;
  let max = Math.ceil(Math.max(...allValues) / 5) * 5;
  min = Math.min(min, 95); max = Math.max(max, 100);
  if (max - min < 10) { min -= 5; max += 5; }
  const xAt = (index) => events.length === 1 ? left + plotW / 2 : left + (plotW * index / (events.length - 1));
  const yAt = (value) => top + (max - value) / (max - min) * plotH;
  const segments = managerSegments(events, xAt);
  const ticks = [];
  for (let value = min; value <= max; value += 5) ticks.push(value);
  const regionPoints = scoreEvents.filter((event) => Number.isFinite(event.regionAvg)).map((event) => xAt(events.indexOf(event)) + "," + yAt(event.regionAvg)).join(" ");
  const scorePoints = scoreEvents.map((event) => xAt(events.indexOf(event)) + "," + yAt(event.score)).join(" ");
  return '<svg class="store-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(store.store) + ' 종합점수 전체 흐름">' +
    '<g class="tenure-bands">' + segments.map((segment) => '<rect class="tenure-band tenure-' + segment.colorIndex + '" x="' + segment.left + '" y="34" width="' + Math.max(0, segment.right - segment.left) + '" height="' + (plotH + 30) + '"><title>' + esc(segment.name + " · " + segment.emp) + '</title></rect><text class="tenure-label" x="' + (segment.left + 8) + '" y="51">' + esc(segment.name) + '</text>').join("") + '</g>' +
    ticks.map((value) => '<line class="grid-line" x1="' + left + '" x2="' + (width - right) + '" y1="' + yAt(value) + '" y2="' + yAt(value) + '"></line><text class="axis-label y" x="' + (left - 12) + '" y="' + (yAt(value) + 4) + '">' + value + '</text>').join("") +
    (regionPoints ? '<polyline class="region-average-line" points="' + regionPoints + '"></polyline>' : '') +
    '<polyline class="store-score-line" points="' + scorePoints + '"></polyline>' +
    scoreEvents.map((event) => {
      const index = events.indexOf(event);
      const officialIncoming = officialTransitionForIncomingEvent(event, index, events, store.officialHandovers);
      const pairedIncoming = event._transitionRole === 'outgoing' && event._transitionPair
        ? events.find((candidate) => candidate._transitionPair === event._transitionPair && candidate._transitionRole === 'incoming')
        : null;
      const pairNeedsOutgoingMarker = Boolean(pairedIncoming && !Number.isFinite(pairedIncoming.score));
      const showHandoverMarker = Boolean(officialIncoming) || event._transitionRole === 'incoming' || pairNeedsOutgoingMarker || (event.note && !event._transitionPair);
      const noteMarker = showHandoverMarker ? '<path class="handover-marker" d="M ' + (xAt(index) - 6) + ' ' + (yAt(event.score) - 13) + ' L ' + (xAt(index) + 6) + ' ' + (yAt(event.score) - 13) + ' L ' + xAt(index) + ' ' + (yAt(event.score) - 25) + ' Z"></path>' : '';
      const officialLabel = officialIncoming ? officialIncoming.date + ' 공식 인수인계' : '';
      return '<g class="score-point"><circle cx="' + xAt(index) + '" cy="' + yAt(event.score) + '" r="6"><title>' + esc([event.quarterLabel, event.date, event.managerName + " · " + event.managerEmp, "점포 " + fmt2(event.score), "지역 평균 " + fmt2(event.regionAvg), officialLabel, event.note?.label || ""].filter(Boolean).join("\n")) + '</title></circle>' + noteMarker + '<text x="' + xAt(index) + '" y="' + (yAt(event.score) - 11) + '">' + fmt2(event.score) + '</text></g>';
    }).join("") +
    events.map((event, index) => '<text class="axis-label x" x="' + xAt(index) + '" y="' + (height - 28) + '">' + esc(storeAxisLabel(event, index, events).replace("\n", " · ")) + '</text>').join("") +
    '<g class="chart-legend" transform="translate(' + (width - 245) + ',16)"><line class="store-score-line" x1="0" x2="28" y1="0" y2="0"></line><text x="36" y="4">점포 점수</text><line class="region-average-line" x1="116" x2="144" y1="0" y2="0"></line><text x="152" y="4">당시 지역 평균</text></g>' +
  '</svg>';
}

function differenceTrendSvg(store) {
  const events = store.events;
  const categories = [
    { key: "신발", cls: "shoes" }, { key: "용품", cls: "goods" },
    { key: "의류", cls: "apparel" }, { key: "FNB", cls: "fnb" },
  ].filter((category) => events.some((event) => Number.isFinite(event.categoryDiffs[category.key])));
  if (!categories.length) return '<div class="empty compact">표시할 차이수량 이력이 없습니다.</div>';
  const width = 1040, height = 380, left = 66, right = 26, top = 64, bottom = 78;
  const plotW = width - left - right, plotH = height - top - bottom;
  const values = events.flatMap((event) => categories.map((category) => event.categoryDiffs[category.key])).filter(Number.isFinite);
  const absMax = Math.max(1, ...values.map((value) => Math.abs(value)));
  const roundedMax = Math.ceil(absMax / 5) * 5;
  const yAt = (value) => top + (roundedMax - value) / (roundedMax * 2) * plotH;
  const zeroY = yAt(0);
  const groupW = plotW / Math.max(1, events.length);
  const xCenter = (index) => left + groupW * index + groupW / 2;
  const barGap = 3;
  const barW = Math.min(22, Math.max(5, (groupW - 16) / Math.max(1, categories.length) - barGap));
  const segments = managerSegments(events, xCenter);
  const ticks = [-roundedMax, -roundedMax / 2, 0, roundedMax / 2, roundedMax];
  return '<svg class="store-chart-svg quantity-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(store.store) + ' 카테고리별 차이수량 전체 흐름">' +
    '<g class="tenure-bands">' + segments.map((segment) => '<rect class="tenure-band tenure-' + segment.colorIndex + '" x="' + Math.max(left, segment.left) + '" y="34" width="' + Math.max(0, Math.min(width - right, segment.right) - Math.max(left, segment.left)) + '" height="' + (plotH + 30) + '"><title>' + esc(segment.name + " · " + segment.emp) + '</title></rect><text class="tenure-label" x="' + (Math.max(left, segment.left) + 8) + '" y="51">' + esc(segment.name) + '</text>').join("") + '</g>' +
    ticks.map((value) => '<line class="grid-line ' + (value === 0 ? "zero" : "") + '" x1="' + left + '" x2="' + (width - right) + '" y1="' + yAt(value) + '" y2="' + yAt(value) + '"></line><text class="axis-label y" x="' + (left - 12) + '" y="' + (yAt(value) + 4) + '">' + fmtQty(value) + '</text>').join("") +
    events.map((event, eventIndex) => categories.map((category, categoryIndex) => {
      const value = event.categoryDiffs[category.key];
      if (!Number.isFinite(value)) return "";
      const x = xCenter(eventIndex) + (categoryIndex - (categories.length - 1) / 2) * (barW + barGap) - barW / 2;
      const y = value >= 0 ? yAt(value) : zeroY;
      const h = Math.max(1, Math.abs(yAt(value) - zeroY));
      return '<rect class="quantity-bar ' + category.cls + '" x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '"><title>' + esc([event.quarterLabel, event.date, event.managerName + " · " + event.managerEmp, category.key + " " + fmtQtyDiff(value), "종합점수 " + fmt2(event.score), event.note?.label || ""].filter(Boolean).join("\n")) + '</title></rect>';
    }).join("")).join("") +
    events.map((event, index) => '<text class="axis-label x" x="' + xCenter(index) + '" y="' + (height - 40) + '">' + esc(storeAxisLabel(event, index, events).replace("\n", " · ")) + '</text><text class="score-under-bar" x="' + xCenter(index) + '" y="' + (height - 20) + '">' + fmt2(event.score) + '점</text>').join("") +
    '<g class="category-legend" transform="translate(' + Math.max(left, width - 330) + ',16)">' + categories.map((category, index) => '<rect class="quantity-bar ' + category.cls + '" x="' + (index * 76) + '" y="-8" width="12" height="12"></rect><text x="' + (index * 76 + 18) + '" y="2">' + category.key + '</text>').join("") + '</g>' +
  '</svg>';
}

function renderStoreList() {
  const query = norm($("storeSearchInput")?.value || "");
  const filtered = storeRows.filter((store) => !query || norm([store.store, ...store.managers.map((manager) => manager.name), ...store.managers.map((manager) => manager.emp)].join(" ")).includes(query));
  if (!filtered.some((store) => store.key === selectedStoreKey)) selectedStoreKey = filtered[0]?.key || null;
  $("storeResultHint").textContent = filtered.length + "개점";
  $("storeTrendList").innerHTML = filtered.map((store) => {
    const latest = store.latestEvent;
    const current = store.currentEvent || latest;
    const delta = latest && Number.isFinite(latest.regionAvg) && Number.isFinite(latest.score) ? latest.score - latest.regionAvg : null;
    return '<button class="store-row ' + (store.key === selectedStoreKey ? "active" : "") + '" type="button" data-store-key="' + esc(store.key) + '">' +
      '<span><strong>' + esc(store.store) + '</strong><small>' + esc(current?.managerName || "담당자 없음") + ' · 최근 ' + fmt2(latest?.score) + '</small></span>' +
      '<em class="' + deltaClass(delta) + '">' + fmtDelta(delta, "-") + '</em>' +
    '</button>';
  }).join("") || '<div class="empty compact">검색 결과가 없습니다.</div>';
  $("storeTrendList").querySelectorAll("[data-store-key]").forEach((button) => button.addEventListener("click", () => {
    selectedStoreKey = button.dataset.storeKey;
    renderStoreList();
    renderStoreDetail();
  }));
}

function renderStoreDetail() {
  const store = storeRows.find((item) => item.key === selectedStoreKey);
  if (!store) {
    $("storeDetailRegion").textContent = currentDd || "선택 지역";
    $("storeDetailTitle").textContent = "점포를 선택하세요";
    $("storeFactChips").innerHTML = "";
    $("storeDetailBody").innerHTML = '<div class="empty">위 목록에서 점포를 선택하세요.</div>';
    return;
  }
  $("storeDetailRegion").textContent = currentDd + " · " + storePeriodText();
  $("storeDetailTitle").textContent = store.store;
  $("storeFactChips").innerHTML = '<span>조사 ' + store.scoreEvents.length + '회</span><span>점장 교체 ' + store.managerChanges + '회</span><span>인수인계 ' + store.handoverCount + '회</span>';
  $("storeDetailBody").innerHTML =
    '<section class="store-chart-section"><div class="store-chart-title"><div><strong>종합점수 흐름</strong><span>점포 점수와 당시 지역 평균 · 점장 근속 구간</span></div></div><div class="store-chart-wrap">' + scoreTrendSvg(store) + '</div></section>' +
    '<section class="store-chart-section tenure-summary-section"><div class="store-chart-title"><div><strong>점장 근속 이력</strong><span>위 그래프의 근속 구간 색상과 동일하게 담당 기간을 설명합니다.</span></div></div>' + tenureSummaryHtml(store) + '</section>';
}

function renderStoreView() {
  buildStoreRows();
  if (!storeRows.some((store) => store.key === selectedStoreKey)) selectedStoreKey = storeRows[0]?.key || null;
  renderStoreList();
  renderStoreDetail();
}

function channelCode(row) {
  const source = String(row?.store_group || row?.store || "").trim();
  return (source.split(/\s+/)[0] || "기타").toUpperCase();
}

function channelQuarterRows() {
  const storeQuarter = new Map();
  allHistoryRows().forEach((row) => {
    const store = storeKey(row);
    if (!store) return;
    const key = row._quarterId + "|" + store;
    if (!storeQuarter.has(key)) {
      storeQuarter.set(key, { quarterId: row._quarterId, channel: channelCode(row), scores: [] });
    }
    const records = Array.isArray(row.records) && row.records.length ? row.records : [null];
    records.forEach((record) => {
      const score = scoreForRecord(row, record);
      if (Number.isFinite(score)) storeQuarter.get(key).scores.push(score);
    });
  });
  const channelQuarter = new Map();
  storeQuarter.forEach((item) => {
    const storeScore = avg(item.scores);
    if (!Number.isFinite(storeScore)) return;
    const key = item.channel + "|" + item.quarterId;
    if (!channelQuarter.has(key)) channelQuarter.set(key, { channel: item.channel, quarterId: item.quarterId, scores: [] });
    channelQuarter.get(key).scores.push(storeScore);
  });
  return Array.from(channelQuarter.values()).map((item) => ({
    channel: item.channel,
    quarterId: item.quarterId,
    score: avg(item.scores),
    storeCount: item.scores.length,
  }));
}

function renderChannelView() {
  const entries = quarterEntries();
  const rows = channelQuarterRows();
  const preferred = ["GS", "GSA", "KM", "ST", "FD", "FH", "SE", "SP", "MS", "GST", "GSEA"];
  const channels = Array.from(new Set(rows.map((row) => row.channel))).sort((a, b) => {
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b, "ko");
  });
  const latestQuarter = entries.at(-1)?.id;
  const previousQuarter = entries.at(-2)?.id;
  const latestRows = rows.filter((row) => row.quarterId === latestQuarter);
  const previousMap = new Map(rows.filter((row) => row.quarterId === previousQuarter).map((row) => [row.channel, row]));
  const leader = latestRows.slice().sort((a, b) => b.score - a.score)[0];
  const improver = latestRows.map((row) => ({ ...row, delta: row.score - (previousMap.get(row.channel)?.score ?? row.score) })).sort((a, b) => b.delta - a.delta)[0];
  const latestAverage = avg(latestRows.map((row) => row.score));
  if ($("channelPeriodLabel")) $("channelPeriodLabel").textContent = storePeriodText();
  if ($("channelSummary")) {
    $("channelSummary").innerHTML = [
      ["최근 전체 평균", fmt2(latestAverage), formatQuarterLabel(latestQuarter)],
      ["최근 선두 채널", leader?.channel || "-", leader ? fmt2(leader.score) + "점 · " + leader.storeCount + "개점" : "-"],
      ["상승폭 상위", improver?.channel || "-", improver ? fmtDelta(improver.delta) + "점 · 직전 분기 대비" : "-"],
      ["분석 범위", channels.length + "개 채널", latestRows.reduce((sum, row) => sum + row.storeCount, 0) + "개점 반영"],
    ].map(([label, value, meta]) => '<div class="channel-summary-card"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(meta) + '</small></div>').join("");
  }
  const table = $("channelTable");
  if (!table) return;
  table.querySelector("thead").innerHTML = '<tr><th>채널</th>' + entries.map((entry) => '<th>' + esc(formatQuarterLabel(entry.id, entry.label)) + '</th>').join("") + '<th>최근 증감</th><th>최근 점포수</th></tr>';
  table.querySelector("tbody").innerHTML = channels.map((channel) => {
    const byQuarter = new Map(rows.filter((row) => row.channel === channel).map((row) => [row.quarterId, row]));
    const latest = byQuarter.get(latestQuarter);
    const previous = byQuarter.get(previousQuarter);
    const delta = latest && previous ? latest.score - previous.score : null;
    return '<tr><th><span class="channel-code">' + esc(channel) + '</span></th>' + entries.map((entry) => {
      const item = byQuarter.get(entry.id);
      return '<td>' + (item ? '<strong>' + fmt2(item.score) + '</strong><small>' + item.storeCount + '개점</small>' : '<span class="channel-empty">-</span>') + '</td>';
    }).join("") + '<td><em class="' + deltaClass(delta) + '">' + fmtDelta(delta, "-") + '</em></td><td>' + (latest?.storeCount || 0) + '개점</td></tr>';
  }).join("");
}

function updateMainViewCopy() {
  const storeMode = mainView === "store";
  const channelMode = mainView === "channel";
  document.body.classList.toggle("store-mode", storeMode);
  document.body.classList.toggle("channel-mode", channelMode);
  $("quarterNav")?.classList.toggle("hidden", storeMode || channelMode);
  $("storePeriodSummary")?.classList.toggle("hidden", !storeMode && !channelMode);
  if ($("storePeriodLabel")) $("storePeriodLabel").textContent = storePeriodText();
  const periodHint = $("storePeriodSummary")?.querySelector("span");
  if (periodHint) periodHint.textContent = channelMode
    ? "채널별 조회는 지역과 분기 선택에 관계없이 전국 전체 조사 이력을 표시합니다."
    : "점포별 조회는 분기 선택과 관계없이 모든 조사 이력을 표시합니다.";
  if ($("topSubtitle")) $("topSubtitle").textContent = channelMode
    ? "전국 채널별 분기 평균과 반영 점포수를 참고자료로 확인합니다."
    : storeMode
      ? "점포별 점수와 점장 근속 이력을 전체 조사 기간 기준으로 조회합니다."
      : "분기를 선택하면 해당 시점 기준 지역 점장 목록과 누적 평가 흐름을 조회합니다.";
  $("contentGrid")?.classList.toggle("hidden", storeMode || channelMode || !currentDd);
  $("storeFlowGrid")?.classList.toggle("hidden", !storeMode || !currentDd);
  $("channelAnalysisGrid")?.classList.toggle("hidden", !channelMode || !currentDd);
  document.querySelectorAll("[data-main-view]").forEach((button) => {
    const active = button.dataset.mainView === mainView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if ($("noticeQuarterLabel")) $("noticeQuarterLabel").textContent = channelMode ? "전국 채널 통합 실적" : storeMode ? storePeriodText() + " 전체 이력" : currentQuarterLabel() + " 정기 재고조사";
  const noticeLines = $("noticeQuarterLabel")?.closest(".notice-copy")?.querySelectorAll("span");
  if (noticeLines?.length >= 2) {
    noticeLines[0].lastChild.textContent = channelMode ? "을 지역 선택과 무관하게 표시합니다." : storeMode ? "을 점포 기준으로 연결해 표시합니다." : " 결과만 현재 조회 기준으로 사용합니다.";
    noticeLines[1].textContent = channelMode ? "점포별 분기 평균을 먼저 산출한 뒤 채널 평균을 계산한 참고용 분석입니다." : storeMode ? "분기 선택과 관계없이 점수 흐름과 점장별 담당 기간을 조회합니다." : "선택 분기 이후 자료는 표시하지 않고, 2025년 이후 이력은 점장 흐름 확인용으로만 제공합니다.";
  }
}

function setMainView(view) {
  mainView = ["manager", "store", "channel"].includes(view) ? view : "manager";
  updateMainViewCopy();
  if (!currentDd) return;
  const scope = mainView === "channel" ? "전국 채널 분석" : mainView === "store" ? storePeriodText() : currentQuarterLabel();
  setStatus(scope + (isMaster ? " · 마스터" : currentManagerName ? " · " + currentManagerName : ""));
  if (mainView === "store") renderStoreView();
  else if (mainView === "channel") renderChannelView();
  else doSearch();
}

function renderActiveView() {
  updateMainViewCopy();
  if (currentDd) {
    const scope = mainView === "channel" ? "전국 채널 분석" : mainView === "store" ? storePeriodText() : currentQuarterLabel();
    setStatus(scope + (isMaster ? " · 마스터 · " : " · ") + currentDd + (currentManagerName ? " · " + currentManagerName : "") + " 조회 중");
  }
  if (mainView === "store") renderStoreView();
  else if (mainView === "channel") renderChannelView();
  else doSearch();
}

function groupByPerson(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = personKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function currentRegionPersonKeys() {
  return new Set(rowsForQuarter(currentQuarter).filter((r) => r.dd === currentDd).map(personKey));
}

function scoreOf(row) {
  const n = Number(row.ap_avg);
  return Number.isFinite(n) ? n : null;
}

function currentStores(rows) {
  const orderedRows = rows.slice().sort((a, b) => {
    const handoverOrder = Number(isHandoverRow(a)) - Number(isHandoverRow(b));
    if (handoverOrder) return handoverOrder;
    const dateOrder = String(rowDate(b)).localeCompare(String(rowDate(a)));
    if (dateOrder) return dateOrder;
    return String(a.store || "").localeCompare(String(b.store || ""), "ko");
  });
  return [...new Set(orderedRows.map((row) => row.store).filter(Boolean))];
}

function buildPeopleRows() {
  const query = norm(getSearchInput().value);
  // 같은 분기 안의 정기·인수인계·인수인계 대체 기록은 모두 해당 분기 점수다.
  const currentRows = rowsForQuarter(currentQuarter).filter((r) => r.dd === currentDd);
  const allowedKeys = new Set(currentRows.map(personKey));
  const historyByPerson = groupByPerson(rowsThroughSelectedQuarter().filter((r) => allowedKeys.has(personKey(r))));
  const currentByPerson = groupByPerson(currentRows);

  peopleRows = Array.from(currentByPerson.entries()).map(([key, rows]) => {
    const history = (historyByPerson.get(key) || []).sort((a, b) => {
      const q = quarterRank(a._quarterId) - quarterRank(b._quarterId);
      if (q) return q;
      return String(rowDate(a)).localeCompare(String(rowDate(b)));
    });
    const scores = history.map(scoreOf).filter((v) => v !== null);
    const currentScores = history
      .filter((r) => r._quarterId === currentQuarter)
      .map(scoreOf)
      .filter((v) => v !== null);
    const currentAvg = avg(currentScores);
    const prevQuarterRows = history.filter((r) => quarterRank(r._quarterId) < quarterRank(currentQuarter));
    const prevQuarterId = prevQuarterRows.at(-1)?._quarterId;
    const prevRows = prevQuarterId ? prevQuarterRows.filter((r) => r._quarterId === prevQuarterId) : [];
    const prevAvg = avg(prevRows.map(scoreOf).filter((v) => v !== null));
    const delta = currentAvg !== null && prevAvg !== null ? currentAvg - prevAvg : null;
    const historyAvg = avg(scores);
    const avgDelta = currentAvg !== null && historyAvg !== null ? currentAvg - historyAvg : null;
    const first = rows[0];
    const stores = currentStores(rows);
    return {
      key,
      name: first.name || "",
      emp: first.emp || "",
      pos: first.pos || "",
      store: stores.join(", "),
      currentRows: rows,
      history,
      currentAvg,
      prevAvg,
      delta,
      historyAvg,
      avgDelta,
      lowCount: scores.filter((v) => v < 85).length,
      high: scores.length ? Math.max(...scores) : null,
      low: scores.length ? Math.min(...scores) : null,
      count: history.length,
    };
  }).filter((person) => {
    if (!query) return true;
    const hay = norm([person.name, person.emp, person.store, person.pos, ...person.history.map((r) => r.store)].join(" "));
    return hay.includes(query);
  });

  peopleRows.sort((a, b) => {
    const storeD = String(a.store || "").localeCompare(String(b.store || ""), "ko");
    if (storeD) return storeD;
    const nameD = a.name.localeCompare(b.name, "ko");
    if (nameD) return nameD;
    return (a.currentAvg ?? 999) - (b.currentAvg ?? 999);
  });
}

function setMetric(index, label, value, sub = "", cls = "") {
  const card = document.querySelectorAll(".metric")[index];
  if (!card) return;
  card.querySelector("span").textContent = label;
  card.querySelector("strong").textContent = value;
  let small = card.querySelector("small");
  if (!small) {
    small = document.createElement("small");
    card.appendChild(small);
  }
  small.className = cls;
  small.textContent = sub;
}

function trendLabel(delta) {
  if (!Number.isFinite(delta)) return { text: "이력 부족", cls: "warn" };
  if (delta >= 2) return { text: "상승", cls: "up" };
  if (delta <= -2) return { text: "하락", cls: "down" };
  return { text: "유지", cls: "flat" };
}

function renderRegionSummary() {
  const scores = peopleRows.map((p) => p.currentAvg).filter((v) => v !== null);
  const historyPeople = peopleRows.filter((p) => p.count > 1).length;
  const manager = regionManager(currentDd);
  setMetric(0, "조회 기준", currentQuarterLabel(), currentDd + (manager ? " · " + manager : ""));
  setMetric(1, "대상 점장", String(peopleRows.length), "선택 분기 기준");
  setMetric(2, "누적 이력", historyPeople + "명", "2회 이상 평가 이력");
  setMetric(3, "지역 평균", fmt2(avg(scores)), "점장 평균 기준");
}

function renderPersonSummary(person) {
  if (!person) return renderRegionSummary();
  setMetric(0, "선택 점장", person.name, person.emp + " · " + person.pos);
  setMetric(1, "평가 점수", fmt2(person.currentAvg), currentQuarterLabel(), Number(person.currentAvg) < 85 ? "bad" : "");
  setMetric(2, "직전 대비", fmtDelta(person.delta), person.prevAvg === null ? "이전 이력 없음" : "이전 평가 기준", deltaClass(person.delta));
  setMetric(3, "평가 이력", person.count + "회", "2025 Q1 이후 누적");
}

function renderTable() {
  const tbody = $("resultTable").querySelector("tbody");
  tbody.innerHTML = peopleRows.map((p) => {
    const selected = p.key === selectedPersonKey;
    const deltaText = fmtDelta(p.delta);
    const avgDeltaText = fmtDelta(p.avgDelta, "0.00");
    return '<tr data-key="' + p.key + '" class="' + (selected ? "selected" : "") + '">' +
      '<td>' + (p.store || "") + '</td><td>' + p.name + '</td><td>' + p.emp + '</td><td>' + p.pos + '</td>' +
      '<td class="num ' + scoreClass(p.currentAvg) + '">' + fmt2(p.currentAvg) + '</td>' +
      '<td class="num ' + deltaClass(p.avgDelta) + '">' + avgDeltaText + '</td>' +
      '<td class="num ' + deltaClass(p.delta) + '">' + deltaText + '</td>' +
      '<td class="num">' + p.count + '회</td></tr>';
  }).join("");
  tbody.querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => selectPerson(tr.dataset.key)));
  $("resultHint").textContent = "점장 " + peopleRows.length + "명";
}

function renderDetail(person) {
  const detailBody = $("detailBody");
  if (!person) {
    $("detailScope").textContent = "선택 대기";
    detailBody.innerHTML = '<div class="empty">지역 점장 목록에서 행을 선택하세요.</div>';
    detailTab = "summary";
    selectedQuantityKey = null;
    return;
  }

  $("detailScope").textContent = person.name + " · " + currentQuarterLabel();
  const regionScores = peopleRows.map((p) => p.currentAvg).filter((v) => v !== null);
  const regionAvg = avg(regionScores);
  const vsRegion = person.currentAvg !== null && regionAvg !== null ? person.currentAvg - regionAvg : null;
  const trendMap = new Map();
  person.history.forEach((row) => {
    if (!trendMap.has(row._quarterId)) trendMap.set(row._quarterId, []);
    const value = scoreOf(row);
    if (value !== null) trendMap.get(row._quarterId).push(value);
  });
  const trend = Array.from(trendMap.entries())
    .map(([id, values]) => ({ id, label: formatQuarterLabel(id, dataObj.quarters[id]?.label || id), value: avg(values) }))
    .sort((a, b) => quarterRank(b.id) - quarterRank(a.id));
  const events = person.history.slice().sort((a, b) => {
    const q = quarterRank(b._quarterId) - quarterRank(a._quarterId);
    if (q) return q;
    return String(rowDate(b)).localeCompare(String(rowDate(a)));
  });
  const recentTrend = trendLabel(person.delta);
  const quantityRecords = quantityRecordsForPerson(person);
  if (!selectedQuantityKey || !quantityRecords.some((record) => record.key === selectedQuantityKey)) {
    selectedQuantityKey = defaultQuantityKey(quantityRecords);
  }
  const selectedRecord = quantityRecords.find((record) => record.key === selectedQuantityKey) || quantityRecords[0] || null;
  const regionBadge = esc(shortRegionLabel(person.currentRows?.[0]?.dd || currentDd || person.history?.[0]?.dd));
  const activeTab = ["summary", "quantity", "history"].includes(detailTab) ? detailTab : "summary";
  const tabs =
    '<div class="detail-tabs" role="tablist" aria-label="상세 정보 전환">' +
      '<button class="' + (activeTab === "summary" ? "active" : "") + '" type="button" data-detail-tab="summary">요약</button>' +
      '<button class="' + (activeTab === "quantity" ? "active" : "") + '" type="button" data-detail-tab="quantity">차이수량</button>' +
      '<button class="' + (activeTab === "history" ? "active" : "") + '" type="button" data-detail-tab="history">이동 이력</button>' +
    '</div>';

  const summaryHtml =
    '<div class="person-insights summary-insights">' +
      '<div class="insight-card"><span>현재 점수</span><strong class="' + scoreClass(person.currentAvg) + '">' + fmt2(person.currentAvg) + '</strong><small>' + esc(currentQuarterLabel()) + '</small></div>' +
      '<div class="insight-card"><span>직전 대비</span><strong class="' + deltaClass(person.delta) + '">' + fmtDelta(person.delta) + '</strong><small>' + (person.prevAvg === null ? "이전 이력 없음" : "이전 평가 기준") + '</small></div>' +
      '<div class="insight-card"><span>누적 평균 대비</span><strong class="' + deltaClass(person.avgDelta) + '">' + fmtDelta(person.avgDelta, "0.00") + '</strong><small>개인 평균 ' + fmt2(person.historyAvg) + '</small></div>' +
      '<div class="insight-card"><span>지역 평균 대비</span><strong class="' + deltaClass(vsRegion) + '">' + fmtDelta(vsRegion) + '</strong><small>지역 평균 ' + fmt2(regionAvg) + '</small></div>' +
      '<div class="insight-card"><span>평가 이력</span><strong>' + person.count + '회</strong><small>2025 Q1 이후 누적</small></div>' +
      '<div class="insight-card"><span>최근 흐름</span><strong class="' + recentTrend.cls + '">' + recentTrend.text + '</strong><small>직전 평가 기준</small></div>' +
    '</div>' +
    '<div class="detail-title">최근 평가 흐름</div>' +
    '<div class="trend-row">' + trend.map((t) => '<div class="trend-chip ' + (t.id === currentQuarter ? "current-quarter" : "") + '" title="' + (t.id === currentQuarter ? "선택한 분기" : "") + '"><span>' + esc(t.label) + '</span><strong class="' + scoreClass(t.value) + '">' + fmt2(t.value) + '</strong></div>').join("") + '</div>';

  const quantitySelector = quantityRecords.length
    ? '<div class="quantity-record-list">' + quantityRecords.map((record) => {
        const isActive = record.key === selectedRecord?.key;
        const marker = record.quarterId === currentQuarter ? '<em>현재 선택 분기</em>' : "";
        return '<button class="' + (isActive ? "active" : "") + '" type="button" data-quantity-key="' + esc(record.key) + '">' +
          '<strong>' + esc(record.quarterLabel) + ' · ' + esc(record.store || "-") + '</strong>' +
          '<span>' + esc(record.date || "날짜 없음") + ' · ' + fmt2(record.score) + '점' + marker + '</span>' +
        '</button>';
      }).join("") + '</div>'
    : '<div class="empty compact">2025년 자료는 점수 이력만 제공합니다. 차이수량 상세는 2026년 자료부터 표시됩니다.</div>';
  const missingQuantityMessage = selectedRecord && quarterRank(selectedRecord.quarterId) < quarterRank("2026Q1")
    ? "2025년 자료는 점수 이력용으로 제공합니다. 수량 상세는 2026년 자료부터 표시됩니다."
    : "이 기록에는 신발/용품/의류/FNB 수량 상세가 없습니다.";
  const quantityTable = selectedRecord && selectedRecord.hasQuantity
    ? '<div class="quantity-table-wrap"><table class="quantity-table"><thead><tr><th>구분</th><th class="num">전산</th><th class="num">실물</th><th class="num">차이</th></tr></thead><tbody>' +
      quantityRows(selectedRecord).map((row) => '<tr class="' + (row.total ? "total" : "") + '"><td>' + row.label + '</td><td class="num">' + fmtQty(row.system) + '</td><td class="num">' + fmtQty(row.actual) + '</td><td class="num ' + qtyClass(row.diff) + '">' + fmtQtyDiff(row.diff) + '</td></tr>').join("") +
      '</tbody></table></div>'
    : '<div class="empty compact">' + missingQuantityMessage + '</div>';
  const quantityHtml =
    '<div class="quantity-panel">' +
      '<div class="detail-title">기록 선택</div>' +
      quantitySelector +
      quantityTable +
      '<p class="quantity-note">수량 차이는 점수 판단이 아닌 참고 수량입니다.</p>' +
    '</div>';

  const historyHtml =
    '<div class="detail-title">점포 / 지역 이동 이력</div>' +
    '<p class="quantity-note">해당 점장이 어느 점포/지역 기준으로 평가됐는지 최신순으로 보여줍니다.</p>' +
    '<div class="timeline">' + events.map((r) => '<div class="audit-event ' + (r._quarterId === currentQuarter ? "current-quarter" : "") + (isHandoverRow(r) ? " handover-event" : "") + '"><strong>' + esc(formatQuarterLabel(r._quarterId, r._quarterLabel)) + ' · ' + esc(r.store || "") + ' · ' + fmt2(r.ap_avg) + noteBadge(r) + '</strong><span>' + esc(eventMeta(r)) + '</span></div>').join("") + '</div>' +
    '<p class="notice detail-notice">선택한 분기 이후의 미래 데이터는 표시하지 않습니다. 2025년 이후 자료는 점장 흐름 확인용 기준입니다.</p>';

  const panelHtml = activeTab === "quantity" ? quantityHtml : activeTab === "history" ? historyHtml : summaryHtml;
  detailBody.innerHTML =
    '<div class="profile compact-profile"><div class="avatar region-badge">' + regionBadge + '</div><div><strong>' + esc(person.name) + '</strong><span>' + esc(person.emp + ' · ' + person.pos + ' · ' + (person.store || "")) + '</span></div></div>' +
    tabs +
    '<div class="detail-panel">' + panelHtml + '</div>';

  detailBody.querySelectorAll("[data-detail-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      detailTab = button.dataset.detailTab;
      renderDetail(person);
    });
  });
  detailBody.querySelectorAll("[data-quantity-key]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedQuantityKey = button.dataset.quantityKey;
      detailTab = "quantity";
      renderDetail(person);
    });
  });
}

function doSearch() {
  buildPeopleRows();
  const previousKey = selectedPersonKey;
  if (!peopleRows.some((p) => p.key === selectedPersonKey)) selectedPersonKey = peopleRows[0]?.key || null;
  if (previousKey !== selectedPersonKey) {
    selectedQuantityKey = null;
  }
  const selected = peopleRows.find((p) => p.key === selectedPersonKey);
  renderPersonSummary(selected);
  renderTable();
  renderDetail(selected);
}

function selectPerson(key) {
  if (selectedPersonKey !== key) {
    selectedQuantityKey = null;
  }
  selectedPersonKey = key;
  const selected = peopleRows.find((p) => p.key === key);
  renderPersonSummary(selected);
  renderTable();
  renderDetail(selected);
}

function firstRegionForQuarter() {
  if (!currentQuarterData || !currentQuarterData.regions) return "";
  return Object.keys(currentQuarterData.regions || {}).sort((a, b) => a.localeCompare(b, "ko"))[0] || "";
}

function openLoginModal(mode = "master") {
  if (!dataObj || !currentQuarterData) {
    alert("데이터 로드가 끝난 뒤 다시 시도하세요.");
    return;
  }
  loginModalMode = mode;
  const modal = $("loginModal");
  const input = $("modalCodeInput");
  const region = selectedLoginDd || currentDd || firstRegionForQuarter();
  if ($("loginModalEyebrow")) $("loginModalEyebrow").textContent = mode === "master" ? "마스터 접속" : "지역 접속";
  if ($("loginModalTitle")) $("loginModalTitle").textContent = mode === "master" ? "마스터 암호 입력" : region + " 암호 입력";
  if ($("loginModalDesc")) {
    $("loginModalDesc").textContent = mode === "master"
      ? "마스터 암호로 접속하면 지역 목록에서 다른 지역을 바로 전환할 수 있습니다."
      : "선택한 지역의 암호를 입력하면 해당 지역 점장 목록이 표시됩니다.";
  }
  if (input) input.value = "";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => input && input.focus(), 30);
}

function closeLoginModal() {
  const modal = $("loginModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if ($("modalCodeInput")) $("modalCodeInput").value = "";
}

function completeLogin(dd, managerName = "") {
  currentDd = dd;
  currentManagerName = managerName || (isMaster ? regionManager(dd) : "");
  document.body.classList.remove("logged-out");
  selectedLoginDd = dd;
  selectedPersonKey = null;
  selectedStoreKey = null;
  mainView = "manager";
  detailTab = "summary";
  selectedQuantityKey = null;
  fillRegionsForQuarter();
  paintRegion(dd, true);
  closeLoginModal();
  $("loginToolbar").classList.add("hidden");
  $("loginNotice").classList.add("hidden");
  if ($("introPanel")) $("introPanel").classList.add("hidden");
  if ($("legendPanel")) $("legendPanel").classList.add("hidden");
  if ($("summaryGrid")) $("summaryGrid").classList.remove("hidden");
  $("searchToolbar").classList.remove("hidden");
  if ($("viewModeNav")) $("viewModeNav").classList.remove("hidden");
  setStatus(currentQuarterLabel() + (isMaster ? " · 마스터 · " : " · ") + dd + (currentManagerName ? " · " + currentManagerName : "") + " 조회 중");
  renderActiveView();
}

function submitEmployeeLogin() {
  try {
    if (!dataObj || !currentQuarterData) throw new Error("데이터 로드가 끝난 뒤 다시 시도하세요.");
    const employeeId = $("employeeLoginInput") ? $("employeeLoginInput").value : "";
    const code = $("regionPasswordInput") ? $("regionPasswordInput").value : "";
    if (norm(employeeId) === norm(MASTER_KEY) && !String(code || "").trim()) {
      const dd = firstRegionForQuarter();
      if (!dd) throw new Error("조회할 지역 정보가 없습니다.");
      isMaster = true;
      completeLogin(dd);
      return;
    }
    const account = validateEmployeeLogin(employeeId, code);
    isMaster = false;
    completeLogin(account.dd, account.manager);
  } catch (err) {
    alert(err.message || String(err));
  }
}

function submitLoginModal() {
  try {
    const code = $("modalCodeInput") ? $("modalCodeInput").value : "";
    if (loginModalMode === "master") {
      if (norm(code) !== norm(MASTER_KEY)) throw new Error("마스터 암호가 아닙니다.");
      const dd = selectedLoginDd || currentDd || firstRegionForQuarter();
      if (!dd) throw new Error("조회할 지역 정보가 없습니다.");
      isMaster = true;
      completeLogin(dd);
      return;
    }
    const dd = selectedLoginDd;
    if (!dd) throw new Error("지역을 먼저 선택하세요.");
    const mode = validateRegion(dd, code);
    isMaster = mode === "master";
    completeLogin(dd);
  } catch (err) {
    alert(err.message || String(err));
  }
}

function logout() {
  currentDd = null;
  currentManagerName = "";
  document.body.classList.add("logged-out");
  isMaster = false;
  selectedPersonKey = null;
  detailTab = "summary";
  selectedQuantityKey = null;
  selectedStoreKey = null;
  storeRows = [];
  mainView = "manager";
  if ($("modalCodeInput")) $("modalCodeInput").value = "";
  if ($("employeeLoginInput")) $("employeeLoginInput").value = "";
  if ($("regionPasswordInput")) $("regionPasswordInput").value = "";
  getSearchInput().value = "";
  $("loginToolbar").classList.remove("hidden");
  $("loginNotice").classList.remove("hidden");
  if ($("introPanel")) $("introPanel").classList.remove("hidden");
  if ($("legendPanel")) $("legendPanel").classList.remove("hidden");
  if ($("summaryGrid")) $("summaryGrid").classList.add("hidden");
  $("searchToolbar").classList.add("hidden");
  $("contentGrid").classList.add("hidden");
  $("storeFlowGrid")?.classList.add("hidden");
  $("channelAnalysisGrid")?.classList.add("hidden");
  $("viewModeNav")?.classList.add("hidden");
  $("quarterNav")?.classList.remove("hidden");
  $("storePeriodSummary")?.classList.add("hidden");
  document.body.classList.remove("store-mode");
  document.body.classList.remove("channel-mode");
  fillRegionsForQuarter();
  setStatus("로그인 대기");
}

function resetHome() {
  if (!dataObj) return;
  document.body.classList.add("logged-out");
  expandedQuarterYears = new Set();
  quarterTreeBootstrapped = false;
  setCurrentQuarter(defaultQuarterId());
  fillQuarterControls();
  currentDd = null;
  currentManagerName = "";
  isMaster = false;
  selectedLoginDd = null;
  selectedPersonKey = null;
  peopleRows = [];
  detailTab = "summary";
  selectedQuantityKey = null;
  selectedStoreKey = null;
  storeRows = [];
  mainView = "manager";
  closeLoginModal();
  if ($("employeeLoginInput")) $("employeeLoginInput").value = "";
  if ($("regionPasswordInput")) $("regionPasswordInput").value = "";
  if ($("modalCodeInput")) $("modalCodeInput").value = "";
  if ($("qInput")) $("qInput").value = "";
  if ($("qInputInline")) $("qInputInline").value = "";
  if ($("regionFilter")) $("regionFilter").value = "";
  $("loginToolbar").classList.remove("hidden");
  $("loginNotice").classList.remove("hidden");
  if ($("introPanel")) $("introPanel").classList.remove("hidden");
  if ($("legendPanel")) $("legendPanel").classList.remove("hidden");
  if ($("summaryGrid")) $("summaryGrid").classList.add("hidden");
  $("searchToolbar").classList.add("hidden");
  $("contentGrid").classList.add("hidden");
  $("storeFlowGrid")?.classList.add("hidden");
  $("channelAnalysisGrid")?.classList.add("hidden");
  $("viewModeNav")?.classList.add("hidden");
  $("quarterNav")?.classList.remove("hidden");
  $("storePeriodSummary")?.classList.add("hidden");
  document.body.classList.remove("store-mode");
  document.body.classList.remove("channel-mode");
  fillRegionsForQuarter();
  renderDetail(null);
  setStatus("로그인 대기");
}

if ($("employeeLoginBtn")) $("employeeLoginBtn").addEventListener("click", submitEmployeeLogin);
if ($("employeeLoginInput")) $("employeeLoginInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("regionPasswordInput").focus(); });
if ($("regionPasswordInput")) $("regionPasswordInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitEmployeeLogin(); });
if ($("masterAccessBtn")) $("masterAccessBtn").addEventListener("click", () => openLoginModal("master"));
if ($("loginModalSubmit")) $("loginModalSubmit").addEventListener("click", submitLoginModal);
if ($("modalCodeInput")) $("modalCodeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitLoginModal(); });
if ($("loginModalClose")) $("loginModalClose").addEventListener("click", closeLoginModal);
if ($("loginModalCancel")) $("loginModalCancel").addEventListener("click", closeLoginModal);
if ($("loginModal")) $("loginModal").addEventListener("click", (e) => { if (e.target === $("loginModal")) closeLoginModal(); });
if ($("qInput")) $("qInput").addEventListener("input", doSearch);
if ($("qInputInline")) $("qInputInline").addEventListener("input", doSearch);
if ($("storeSearchInput")) $("storeSearchInput").addEventListener("input", () => { renderStoreList(); renderStoreDetail(); });
document.querySelectorAll("[data-main-view]").forEach((button) => button.addEventListener("click", () => setMainView(button.dataset.mainView)));
$("resetBtn").addEventListener("click", () => { getSearchInput().value = ""; doSearch(); });
$("logoutBtn").addEventListener("click", logout);
if ($("brandHome")) $("brandHome").addEventListener("click", resetHome);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("loginModal") && !$("loginModal").classList.contains("hidden")) {
    closeLoginModal();
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
    openLoginModal("master");
  }
});

loadData().catch((err) => {
  console.error(err);
  setStatus("데이터 로드 실패");
  alert(err.message || String(err));
});
