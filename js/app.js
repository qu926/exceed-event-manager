import {
  ATTENDANCE_STATUSES,
  EVENT_STATUSES,
  IVAN_ATTRIBUTE,
  IVAN_ATTRIBUTES,
  REQUEST_TIME_SLOT_LABELS,
  RESERVATION_ATTRIBUTE,
  RESERVATION_SEAT_ORDER,
  ROLES,
  SEAT_TYPES,
  SLOT_LIMITS,
  STAFF_ATTENDANCE_STATUSES,
  TIME_SLOTS,
  buildDefaultState,
  archiveFinishedEvents,
  clone,
  configureCore,
  createId,
  deleteReservation,
  deleteReservationRequest,
  deleteRole,
  findEvent,
  findReservationBySlot,
  findStaffMember,
  findUser,
  formatDateLabel,
  formatDateTime,
  generateAttendanceDiscordText,
  generateReservationDiscordText,
  getActiveEvents,
  getActiveUsers,
  getAcceptedReservationRequestsForEvent,
  getArchivedEvents,
  getAttendanceEntry,
  getAttendanceEntriesForEvent,
  getAttendanceSummary,
  getDashboardIssues,
  getGroupLabels,
  getMissingUsers,
  getReservationOpenAt,
  getReservationRequestOpenAt,
  getReservationRequestBuckets,
  getReservationRequestAcceptanceStatus,
  getReservationRequestsForEvent,
  getReservationSetting,
  getReservationSaveConflict,
  getReservationWarnings,
  getReservationsForEvent,
  getRoles,
  getSeatLimitStatuses,
  getActiveStaffMembers,
  getTimeSlotLabel,
  getMissingStaffMembers,
  getStaffAttendanceEntry,
  getStaffAttendanceEntriesForEvent,
  getStaffAttendanceSummary,
  getVacationExemptUsers,
  isEventArchived,
  isReservationFilled,
  isOnVacation,
  isReservationRequestOpen,
  isReservationRequestIvan,
  mergeSharedState,
  normalizeReservation,
  setReservationRequestPlacement,
  setStaffMemberActive,
  setUserActive,
  sortedStaffMembers,
  sortedUsers,
  toLocalDateTimeString,
  upsertAttendance,
  upsertEvent,
  upsertReservation,
  upsertReservationRequest,
  upsertReservationSetting,
  upsertRole,
  upsertStaffAttendance,
  upsertStaffMember,
  upsertUser,
  upsertVacation,
  wasReservationChangedAfterEventCutoff,
} from "./core.js";

function loadRequiredAppConfig() {
  const config = window.EVENT_MANAGER_CONFIG;
  const requiredValues = [
    ["appId", config?.appId],
    ["brandName", config?.brandName],
    ["title", config?.title],
    ["core.sitePassword", config?.core?.sitePassword],
    ["core.adminPassword", config?.core?.adminPassword],
  ];
  const missingKeys = requiredValues
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);

  if (!config || missingKeys.length) {
    const detail = !config
      ? "window.EVENT_MANAGER_CONFIG が定義されていません。"
      : `必須設定が不足しています: ${missingKeys.join(", ")}`;
    const message = `EXCEED専用設定エラー: ${detail}`;
    const errorRoot = document.querySelector("#app");
    if (errorRoot) {
      errorRoot.replaceChildren();
      const heading = document.createElement("h1");
      heading.textContent = "EXCEED 設定エラー";
      const description = document.createElement("p");
      description.textContent = detail;
      errorRoot.append(heading, description);
    }
    console.error(message);
    throw new Error(message);
  }

  return config;
}

const APP_CONFIG = loadRequiredAppConfig();
const BASE_APP_ID = String(APP_CONFIG.appId).trim();
const STORES = buildStoreConfigs(APP_CONFIG);
const SITE_SESSION_KEY = `${BASE_APP_ID}:site-unlocked`;
const ADMIN_SESSION_KEY = `${BASE_APP_ID}:admin-unlocked`;
const STORE_SESSION_KEY = `${BASE_APP_ID}:active-store`;
const PRODUCER_NAME = String(APP_CONFIG.producerName || "").trim();
const PRODUCER_LOGO_PATH = String(APP_CONFIG.producerLogoPath || "").trim();
let activeStore = null;
let storeContextVersion = 0;
let APP_ID = "";
let STORAGE_KEY = "";
let PENDING_LOCAL_CHANGES_KEY = "";
let BRAND_NAME = "";
let APP_TITLE = "";
let LOGO_PATH = "";
let LOGO_ALT = "";
let STATE_ROW_ID = "";

setActiveStoreConfig(getInitialStoreKey());

const root = document.querySelector("#app");
const toastRoot = document.querySelector("#toast");
const HOST_ATTENDANCE_LIST_STATUSES = ["出勤", "欠席", "未定", "体入", "未入力", "長期休暇"];
const VIEW_PAGES = new Set(["attendance", "staffAttendance", "attendanceList", "reservation", "admin"]);
const ADMIN_TABS = new Set([
  "dashboard",
  "attendance",
  "staffAttendance",
  "missing",
  "hosts",
  "staff",
  "vacations",
  "events",
  "reservations",
  "archive",
  "discord",
  "histories",
  "data",
]);
const RESERVATION_TABS = new Set(["requests"]);

let hasStoredLocalState = false;
let state = loadState();
let syncStatus = getInitialSyncStatus();
const archiveResult = archiveFinishedEvents(state);
if (archiveResult.changed) {
  state = archiveResult.state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let siteUnlocked = sessionStorage.getItem(SITE_SESSION_KEY) === "1";
let adminUnlocked = sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
let view = {
  page: "attendance",
  adminTab: "dashboard",
  eventId: "",
  archiveEventId: "",
  attendanceUserId: "",
  staffAttendanceMemberId: "",
  reservationTab: "requests",
  dashboardDetailType: "",
  dashboardDetailKey: "",
  editingUserId: "",
  editingStaffMemberId: "",
  editingVacationId: "",
  editingEventId: "",
  editingReservationRequestId: "",
};

resetViewForCurrentStore();
restoreViewFromLocation();

render();
initializeSharedState();

root.addEventListener("click", handleClick);
root.addEventListener("submit", handleSubmit);
root.addEventListener("change", handleChange);
window.addEventListener("hashchange", () => {
  restoreViewFromLocation();
  render();
});
window.setInterval(archiveEndedEvents, 60_000);

function buildStoreConfigs(config) {
  const stores = Array.isArray(config.stores) && config.stores.length
    ? config.stores
    : [{
      key: String(config.brandName || config.appId || "store").toLowerCase(),
      appId: config.appId,
      stateRowId: config.stateRowId,
      brandName: config.brandName,
      title: config.title,
      eyebrow: config.eyebrow,
      logoPath: config.logoPath,
      logoAlt: config.logoAlt,
      sitePassword: config.core?.sitePassword,
      adminPassword: config.core?.adminPassword,
      core: config.core,
    }];
  return stores.map((store, index) => normalizeStoreConfig(config, store, index));
}

function normalizeStoreConfig(config, store, index) {
  const key = String(store.key || store.appId || store.brandName || `store-${index + 1}`).trim().toLowerCase().replace(/\s+/g, "-");
  const brandName = String(store.brandName || config.brandName || key).trim();
  const appId = String(store.appId || `${BASE_APP_ID}-${key}`).trim();
  const core = {
    ...(config.core || {}),
    ...(store.core || {}),
  };
  if (store.sitePassword) core.sitePassword = String(store.sitePassword);
  if (store.adminPassword) core.adminPassword = String(store.adminPassword);
  return {
    key,
    appId,
    stateRowId: String(store.stateRowId || appId),
    brandName,
    title: String(store.title || `${brandName} 勤怠・予約管理`),
    eyebrow: String(store.eyebrow || `${brandName} Event Manager`),
    logoPath: String(store.logoPath || config.logoPath || "").trim(),
    logoAlt: String(store.logoAlt || `${brandName} ロゴ`),
    core,
  };
}

function getInitialStoreKey() {
  const sessionKey = sessionStorage.getItem(STORE_SESSION_KEY);
  if (findStoreConfig(sessionKey)) return sessionKey;
  return STORES[0]?.key || "";
}

function getStoreLoginMatch(password) {
  const raw = String(password || "").trim().toLowerCase();
  return STORES.find((store) => raw && raw === String(store.core.sitePassword || "").trim().toLowerCase()) || null;
}

function isAdminPassword(password) {
  const raw = String(password || "");
  return STORES.some((store) => raw === store.core.adminPassword);
}

function findStoreConfig(key) {
  return STORES.find((store) => store.key === key) || null;
}

function setActiveStoreConfig(storeKey) {
  activeStore = findStoreConfig(storeKey) || STORES[0];
  APP_ID = activeStore.appId;
  STORAGE_KEY = `${APP_ID}:state:v1`;
  PENDING_LOCAL_CHANGES_KEY = `${APP_ID}:pending-local-changes`;
  BRAND_NAME = activeStore.brandName;
  APP_TITLE = activeStore.title;
  LOGO_PATH = activeStore.logoPath;
  LOGO_ALT = activeStore.logoAlt;
  STATE_ROW_ID = activeStore.stateRowId;
  configureCore(activeStore.core);
  document.title = APP_TITLE;
  document.body.dataset.brand = APP_ID;
  document.body.dataset.store = activeStore.key;
  sessionStorage.setItem(STORE_SESSION_KEY, activeStore.key);
  storeContextVersion += 1;
}

function switchStore(storeKey, { keepAdmin = adminUnlocked, message = "" } = {}) {
  if (!findStoreConfig(storeKey)) return false;
  setActiveStoreConfig(storeKey);
  hasStoredLocalState = false;
  state = loadState();
  syncStatus = getInitialSyncStatus();
  const archiveResult = archiveFinishedEvents(state);
  if (archiveResult.changed) {
    state = archiveResult.state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  resetViewForCurrentStore();
  siteUnlocked = true;
  adminUnlocked = keepAdmin;
  sessionStorage.setItem(SITE_SESSION_KEY, "1");
  if (keepAdmin) sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  saveViewToLocation();
  render();
  initializeSharedState(storeContextVersion);
  if (message) showToast(message);
  return true;
}

function resetViewForCurrentStore() {
  view.eventId = getDefaultEventId();
  view.archiveEventId = getDefaultArchiveEventId();
  view.attendanceUserId = getActiveUsers(state)[0]?.id || "";
  view.staffAttendanceMemberId = getActiveStaffMembers(state)[0]?.id || "";
  view.editingReservationRequestId = "";
  view.editingUserId = "";
  view.editingStaffMemberId = "";
  view.editingVacationId = "";
  view.editingEventId = "";
  view.dashboardDetailType = "";
  view.dashboardDetailKey = "";
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed?.meta || !Array.isArray(parsed.users)) return buildDefaultState();
    hasStoredLocalState = true;
    return migrateState(parsed);
  } catch (error) {
    console.warn(error);
    return buildDefaultState();
  }
}

function migrateState(saved) {
  const fresh = buildDefaultState();
  const allowedEventIds = getConfiguredEventIdSet(fresh.event_dates);
  const savedEvents = filterItemsByAllowedEvents(saved.event_dates || [], allowedEventIds, eventIdFromEventDate);
  const migratedEventDates = migrateEventDates(savedEvents, fresh.event_dates);
  const sourceEvents = migratedEventDates.length ? migratedEventDates : fresh.event_dates;
  const reservations = filterItemsByAllowedEvents(saved.reservations || [], allowedEventIds);
  const reservationRequests = filterItemsByAllowedEvents(saved.reservation_requests || [], allowedEventIds);
  return {
    ...fresh,
    ...saved,
    event_dates: migratedEventDates,
    attendance_entries: filterItemsByAllowedEvents(saved.attendance_entries || [], allowedEventIds),
    reservations: migrateReservations(reservations, sourceEvents),
    roles: saved.roles || fresh.roles,
    staff_members: saved.staff_members || [],
    staff_attendance_entries: filterItemsByAllowedEvents(saved.staff_attendance_entries || [], allowedEventIds),
    reservation_settings: filterItemsByAllowedEvents(saved.reservation_settings || [], allowedEventIds),
    reservation_requests: migrateReservationRequests(reservationRequests),
    histories: filterHistoriesByAllowedEvents(saved.histories || [], allowedEventIds),
    settings: { ...fresh.settings, ...(saved.settings || {}) },
    meta: { ...fresh.meta, ...(saved.meta || {}) },
  };
}

function getConfiguredEventIdSet(defaultEvents) {
  if (!hasConfiguredEventSchedule()) return null;
  return new Set((defaultEvents || []).map(eventIdFromEventDate).filter(Boolean));
}

function hasConfiguredEventSchedule() {
  return Array.isArray(activeStore?.core?.eventDates) && activeStore.core.eventDates.length > 0;
}

function eventIdFromEventDate(event) {
  if (!event) return "";
  if (event.id) return String(event.id);
  if (event.event_date) return `ev_${String(event.event_date).replaceAll("-", "")}`;
  return "";
}

function filterItemsByAllowedEvents(items, allowedEventIds, getEventId = (item) => item?.event_date_id || item?.event_id || item?.id) {
  if (!allowedEventIds) return items;
  return (items || []).filter((item) => allowedEventIds.has(String(getEventId(item) || "")));
}

function filterHistoriesByAllowedEvents(histories, allowedEventIds) {
  if (!allowedEventIds) return histories;
  return (histories || []).filter((history) => {
    const payload = history?.after_payload || history?.before_payload || {};
    const eventId = payload.event_date_id || (history?.target_type === "event" ? history.target_id : "");
    return !eventId || allowedEventIds.has(String(eventId));
  });
}

function migrateReservations(reservations, events) {
  const stamp = new Date().toISOString();
  return reservations.map((reservation) => {
    const event = events.find((item) => String(item.id) === String(reservation.event_date_id));
    const migrated = {
      ...reservation,
      id: reservation.id || createId("res"),
      created_at: reservation.created_at || stamp,
      updated_at: reservation.updated_at || reservation.created_at || stamp,
      deleted_at: reservation.deleted_at || null,
      is_deleted: Boolean(reservation.is_deleted),
      time_slot: migrateTimeSlot(reservation.time_slot),
      attribute: RESERVATION_ATTRIBUTE,
      ivan_attribute: IVAN_ATTRIBUTES.includes(reservation.ivan_attribute) ? reservation.ivan_attribute : IVAN_ATTRIBUTE,
    };
    if (migrated.late_warning && !wasReservationChangedAfterEventCutoff(event, migrated)) {
      migrated.late_warning = false;
    }
    return migrated;
  });
}

function migrateReservationRequests(requests) {
  return requests.map((request) => ({
    ...request,
    desired_time_slot: migrateTimeSlot(request.desired_time_slot),
  }));
}

function migrateEventDates(events, generatedEvents = []) {
  const merged = new Map();
  const configuredEvents = getConfiguredEventIdSet(generatedEvents);
  const generatedById = new Map();
  for (const event of generatedEvents) {
    const key = eventIdFromEventDate(event) || event?.event_date;
    if (!key) continue;
    const copy = { ...event };
    generatedById.set(String(key), copy);
    merged.set(String(key), copy);
  }
  for (const event of events) {
    const key = eventIdFromEventDate(event) || event?.event_date;
    if (!key || (configuredEvents && !configuredEvents.has(String(key)))) continue;
    if (configuredEvents) {
      const generated = generatedById.get(String(key));
      merged.set(String(key), {
        ...generated,
        ...event,
        id: generated?.id || event.id,
        event_date: generated?.event_date || event.event_date,
        label: generated?.label || event.label,
        status: generated?.status === "終了" || generated?.status === "休み" ? generated.status : event.status,
        note: generated?.note || event.note,
        reservation_open_at: generated?.reservation_open_at || event.reservation_open_at,
      });
      continue;
    }
    merged.set(String(key), { ...event });
  }
  return [...merged.values()].map((event) => {
    if (!event.event_date) return event;
    const autoOpenAt = getReservationOpenAt(event.event_date);
    const legacyOpenAt = getLegacyReservationOpenAt(event.event_date);
    const previousAutoOpenAt = getPreviousReservationOpenAt(event.event_date);
    const shouldUpdateOpenAt = !event.reservation_open_at || [legacyOpenAt, previousAutoOpenAt].includes(event.reservation_open_at);
    return {
      ...event,
      reservation_open_at: shouldUpdateOpenAt ? autoOpenAt : event.reservation_open_at,
    };
  }).sort((a, b) => String(a.event_date || "").localeCompare(String(b.event_date || "")));
}

function migrateTimeSlot(value) {
  if (value === "前半") return TIME_SLOTS[0];
  if (value === "後半") return TIME_SLOTS[1];
  return value;
}

function getLegacyReservationOpenAt(eventDate) {
  const date = new Date(`${eventDate}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(22, 0, 0, 0);
  return toLocalDateTimeString(date);
}

function getPreviousReservationOpenAt(eventDate) {
  const date = new Date(`${eventDate}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - day - 7);
  date.setHours(22, 0, 0, 0);
  return toLocalDateTimeString(date);
}

function isPlaceholder(value) {
  return !value || String(value).startsWith("PASTE_");
}

function getStorageMode() {
  return APP_CONFIG.storageMode === "supabase" && !isPlaceholder(APP_CONFIG.supabaseUrl) && !isPlaceholder(APP_CONFIG.supabaseAnonKey)
    ? "supabase"
    : "local";
}

function getInitialSyncStatus() {
  if (APP_CONFIG.storageMode === "supabase" && getStorageMode() !== "supabase") {
    return { mode: "error", text: "Supabase未設定。URL/keyを入力してください" };
  }
  const mode = getStorageMode();
  return { mode, text: mode === "supabase" ? "共有DBに接続中" : "この端末に保存" };
}

async function initializeSharedState(expectedVersion = storeContextVersion) {
  if (syncStatus.mode !== "supabase") return;
  try {
    const hasPendingLocalChanges = localStorage.getItem(PENDING_LOCAL_CHANGES_KEY) === "1";
    const localState = hasStoredLocalState && hasPendingLocalChanges ? migrateState(state) : null;
    const record = await loadSharedRecord();
    if (expectedVersion !== storeContextVersion) return;
    if (record.state) {
      const migratedRemoteState = migrateState(record.state);
      const mergedState = localState ? migrateState(mergeSharedState(migratedRemoteState, localState)) : migratedRemoteState;
      if (expectedVersion !== storeContextVersion) return;
      state = mergedState;
      let shouldSaveMigratedState = hasPersistableMigration(record.state, migratedRemoteState) || hasPersistableMerge(migratedRemoteState, mergedState);
      const result = archiveFinishedEvents(state);
      if (result.changed) {
        state = result.state;
        shouldSaveMigratedState = true;
      }
      if (shouldSaveMigratedState) await saveSharedStateWithRetry(state, record.updatedAt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
      syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
      render();
      return;
    }
    await saveSharedState(state);
    if (expectedVersion !== storeContextVersion) return;
    syncStatus = { mode: "supabase", text: "共有DBを初期化済み" };
    render();
  } catch (error) {
    if (expectedVersion !== storeContextVersion) return;
    console.error(error);
    syncStatus = { mode: "error", text: shortSyncError(error, "共有DBに接続できません") };
    render();
  }
}

function hasPersistableMigration(before, after) {
  return [
    "event_dates",
    "attendance_entries",
    "staff_attendance_entries",
    "reservations",
    "reservation_settings",
    "reservation_requests",
    "histories",
  ].some((key) => {
    return JSON.stringify(before[key] || []) !== JSON.stringify(after[key] || []);
  });
}

function hasPersistableMerge(before, after) {
  return [
    "users",
    "roles",
    "staff_members",
    "long_vacations",
    "event_dates",
    "attendance_entries",
    "staff_attendance_entries",
    "reservations",
    "reservation_settings",
    "reservation_requests",
    "histories",
  ].some((key) => {
    return JSON.stringify(before[key] || []) !== JSON.stringify(after[key] || []);
  });
}

function shortSyncError(error, fallback) {
  const message = String(error?.message || error || fallback);
  const status = message.match(/Supabase (?:load|save) failed: (\d+)/)?.[1];
  if (status) return `${fallback} (${status})`;
  return fallback;
}

async function loadSharedState() {
  return (await loadSharedRecord()).state;
}

async function loadSharedRecord() {
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state?id=eq.${encodeURIComponent(
    STATE_ROW_ID,
  )}&select=payload,updated_at`;
  const response = await fetch(url, {
    headers: getSupabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Supabase load failed: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  const payload = rows[0]?.payload;
  return {
    state: payload && Object.keys(payload).length ? payload : null,
    updatedAt: rows[0]?.updated_at || "",
  };
}

async function saveSharedState(nextState, options = {}) {
  if (syncStatus.mode !== "supabase") return;
  if (options.expectedUpdatedAt) return saveSharedStateIfUnchanged(nextState, options.expectedUpdatedAt);
  const stateToSave = migrateState(nextState);
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...getSupabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: STATE_ROW_ID,
      payload: stateToSave,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status} ${await response.text()}`);
}

async function saveSharedStateIfUnchanged(nextState, expectedUpdatedAt) {
  const stateToSave = migrateState(nextState);
  const rowId = STATE_ROW_ID;
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state?id=eq.${encodeURIComponent(
    rowId,
  )}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      ...getSupabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      payload: stateToSave,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  if (!rows.length) {
    const error = new Error("STALE_SHARED_STATE");
    error.code = "STALE_SHARED_STATE";
    throw error;
  }
}

async function saveSharedStateWithRetry(nextState, expectedUpdatedAt = "") {
  let stateToSave = migrateState(nextState);
  let expected = expectedUpdatedAt;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await saveSharedState(stateToSave, expected ? { expectedUpdatedAt: expected } : {});
      return stateToSave;
    } catch (error) {
      if (error.code !== "STALE_SHARED_STATE") throw error;
      const record = await loadSharedRecord();
      const latestState = record.state ? migrateState(record.state) : null;
      stateToSave = latestState ? migrateState(mergeSharedState(latestState, stateToSave)) : migrateState(stateToSave);
      expected = record.updatedAt;
    }
  }
  throw new Error("STALE_SHARED_STATE");
}

function getSupabaseHeaders() {
  const headers = { apikey: APP_CONFIG.supabaseAnonKey };
  if (!String(APP_CONFIG.supabaseAnonKey).startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${APP_CONFIG.supabaseAnonKey}`;
  }
  return headers;
}

function saveState(nextState, message = "保存しました。") {
  state = migrateState(nextState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (syncStatus.mode === "supabase") {
    localStorage.setItem(PENDING_LOCAL_CHANGES_KEY, "1");
    saveMergedSharedState(state)
      .then(() => {
        localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
        syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
        render();
      })
      .catch((error) => {
        console.error(error);
        syncStatus = { mode: "error", text: shortSyncError(error, "共有DBへの保存に失敗") };
        render();
      });
  }
  showToast(message);
  render();
}

async function saveMergedSharedState(localState) {
  const normalizedLocalState = migrateState(localState);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await loadSharedRecord();
    const migratedRemoteState = record.state ? migrateState(record.state) : null;
    const mergedState = migratedRemoteState ? migrateState(mergeSharedState(migratedRemoteState, normalizedLocalState)) : normalizedLocalState;
    try {
      await saveSharedState(mergedState, record.updatedAt ? { expectedUpdatedAt: record.updatedAt } : {});
      state = mergedState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return;
    } catch (error) {
      if (error.code === "STALE_SHARED_STATE") continue;
      throw error;
    }
  }
  const record = await loadSharedRecord();
  state = record.state ? migrateState(mergeSharedState(migrateState(record.state), normalizedLocalState)) : normalizedLocalState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  throw new Error("STALE_SHARED_STATE");
}

function archiveEndedEvents() {
  const result = archiveFinishedEvents(state);
  if (!result.changed) return;
  saveState(result.state, "終了したイベント日をアーカイブしました。");
}

function getDefaultEventId() {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const activeEvents = state.event_dates.filter((event) => !isEventArchived(event));
  const open = activeEvents.find((event) => event.event_date >= todayKey && event.status !== "休み");
  return open?.id || activeEvents.find((event) => event.status !== "休み")?.id || activeEvents[0]?.id || "";
}

function getNextConfiguredEventDate(baseDate = new Date()) {
  const configuredWeekdays = Array.isArray(activeStore?.core?.eventWeekdays)
    ? activeStore.core.eventWeekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const weekdays = configuredWeekdays.length ? configuredWeekdays : [baseDate.getDay()];
  for (let offset = 1; offset <= 60; offset += 1) {
    const candidate = new Date(baseDate);
    candidate.setDate(candidate.getDate() + offset);
    if (weekdays.includes(candidate.getDay())) return toLocalDateTimeString(candidate).slice(0, 10);
  }
  return toLocalDateTimeString(baseDate).slice(0, 10);
}

function getDefaultArchiveEventId() {
  const archived = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  return archived[0]?.id || "";
}

function restoreViewFromLocation() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const page = params.get("page");
  const adminTab = params.get("adminTab");
  const reservationTab = params.get("reservationTab");

  if (VIEW_PAGES.has(page)) view.page = page;
  if (ADMIN_TABS.has(adminTab)) view.adminTab = adminTab;
  if (RESERVATION_TABS.has(reservationTab)) view.reservationTab = reservationTab;
  if (params.has("eventId")) view.eventId = params.get("eventId") || view.eventId;
  if (params.has("archiveEventId")) view.archiveEventId = params.get("archiveEventId") || "";
  if (params.has("attendanceUserId")) view.attendanceUserId = params.get("attendanceUserId") || view.attendanceUserId;
  if (params.has("staffAttendanceMemberId")) view.staffAttendanceMemberId = params.get("staffAttendanceMemberId") || view.staffAttendanceMemberId;
  if (params.has("dashboardDetailType")) view.dashboardDetailType = params.get("dashboardDetailType") || "";
  if (params.has("dashboardDetailKey")) view.dashboardDetailKey = params.get("dashboardDetailKey") || "";
}

function saveViewToLocation() {
  const params = new URLSearchParams();
  params.set("page", view.page);
  params.set("eventId", view.eventId || "");
  if (view.page === "admin") params.set("adminTab", view.adminTab);
  if (view.page === "reservation" || (view.page === "admin" && view.adminTab === "reservations")) {
    params.set("reservationTab", view.reservationTab);
  }
  if (view.archiveEventId) params.set("archiveEventId", view.archiveEventId);
  if (view.attendanceUserId) params.set("attendanceUserId", view.attendanceUserId);
  if (view.staffAttendanceMemberId) params.set("staffAttendanceMemberId", view.staffAttendanceMemberId);
  if (view.dashboardDetailType) params.set("dashboardDetailType", view.dashboardDetailType);
  if (view.dashboardDetailKey) params.set("dashboardDetailKey", view.dashboardDetailKey);

  const nextHash = `#${params.toString()}`;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
}

function render() {
  if (!siteUnlocked) {
    root.innerHTML = renderSiteLogin();
    return;
  }

  const selectedEvent = findEvent(state, view.eventId);
  if (!selectedEvent || isEventArchived(selectedEvent)) view.eventId = getDefaultEventId();
  if (view.archiveEventId && !findEvent(state, view.archiveEventId)) view.archiveEventId = "";
  if (!findUser(state, view.attendanceUserId)) view.attendanceUserId = getActiveUsers(state)[0]?.id || "";
  const selectedStaffMember = findStaffMember(state, view.staffAttendanceMemberId);
  if (!selectedStaffMember || selectedStaffMember.is_active === false) view.staffAttendanceMemberId = getActiveStaffMembers(state)[0]?.id || "";
  if (view.editingReservationRequestId && !(state.reservation_requests || []).some((request) => request.id === view.editingReservationRequestId && !request.is_deleted)) {
    view.editingReservationRequestId = "";
  }
  saveViewToLocation();

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-lockup" aria-label="${escapeAttr(`${BRAND_NAME} ${APP_TITLE}`)}">
          ${renderActiveStoreLogo()}
        </div>
        <nav class="top-nav" aria-label="主要画面">
          <span class="sync-pill ${syncStatus.mode}">${escapeHtml(syncStatus.text)}</span>
          ${navButton("attendance", "ホスト勤怠入力")}
          ${navButton("staffAttendance", "内勤勤怠入力")}
          ${navButton("attendanceList", "出勤一覧")}
          ${navButton("reservation", "予約入力")}
          ${navButton("admin", "運営画面")}
        </nav>
      </header>
      <main>
        ${renderCurrentPage()}
      </main>
    </div>
  `;
}

function renderSiteLogin() {
  return `
    <div class="app-shell">
      <section class="panel login-panel">
        <div class="login-brand">
          ${PRODUCER_LOGO_PATH ? `<img class="producer-mark login-producer-mark" src="${escapeAttr(PRODUCER_LOGO_PATH)}" alt="${escapeAttr(PRODUCER_NAME || ".EXE PRODUCE")}">` : ""}
        </div>
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Password</p>
            <h2>サイトログイン</h2>
          </div>
        </div>
        <form class="stack" data-action="site-login">
          <label>
            <span>店舗パスワード</span>
            <input name="password" type="password" autocomplete="current-password" required autofocus>
          </label>
          <button class="primary-button" type="submit">サイトを表示</button>
        </form>
        <p class="login-note">EXCEED / SYNDICATE / THE CENTRAL の店舗パスワードで、それぞれの店舗画面を表示します。運営パスワードでは運営画面も同時に解放されます。</p>
      </section>
    </div>
  `;
}

function renderActiveStoreLogo() {
  if (!LOGO_PATH) {
    return `<strong class="brand-text-logo">${escapeHtml(BRAND_NAME)}</strong>`;
  }
  return `<img class="brand-mark" src="${escapeAttr(LOGO_PATH)}" alt="${escapeAttr(LOGO_ALT)}">`;
}

function renderStoreSwitcher() {
  if (STORES.length <= 1) return "";
  return `
    <label class="store-switcher">
      <span>店舗切替</span>
      <select data-role="store-select" aria-label="店舗切替">
        ${STORES.map((store) => option(store.key, store.brandName, store.key === activeStore.key)).join("")}
      </select>
    </label>
  `;
}

function navButton(page, label) {
  return `<button class="nav-button ${view.page === page ? "is-active" : ""}" data-action="navigate" data-page="${page}" type="button">${label}</button>`;
}

function renderCurrentPage() {
  if (view.page === "staffAttendance") return renderStaffAttendancePage();
  if (view.page === "attendanceList") return renderHostAttendanceListPage();
  if (view.page === "reservation") return renderReservationPage(false);
  if (view.page === "admin") return renderAdminPage();
  return renderAttendancePage();
}

function renderAttendancePage() {
  const event = findEvent(state, view.eventId);
  const events = getActiveEvents(state)
    .filter((item) => item.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const activeUsers = getActiveUsers(state);
  return `
    <section class="page-grid two-col">
      <div class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Host</p>
            <h2>ホスト勤怠まとめ入力</h2>
          </div>
          <span class="capacity ok">${events.length}日分</span>
        </div>
        <form class="bulk-attendance-form" data-action="save-bulk-attendance">
          <label>
            <span>ホスト名</span>
            <select name="user_id" data-role="attendance-user-select">
              ${activeUsers.map((user) => option(user.id, user.display_name, user.id === view.attendanceUserId)).join("")}
            </select>
          </label>
          <p class="plan-note">各日程の出欠をまとめて選択できます。何も選んでいない日は未入力のままです。</p>
          ${activeUsers.length && events.length ? `
            <button class="primary-button bulk-save-button" type="submit">まとめて登録 / 更新する</button>
            <div class="bulk-attendance-list">
              ${events.map((item) => renderBulkAttendanceRow(item)).join("")}
            </div>
          ` : `<p class="empty">入力対象の日程またはホストがありません。</p>`}
        </form>
      </div>
      <aside class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Status</p>
            <h2>${event ? formatDateLabel(event.event_date) : "対象日未設定"}</h2>
          </div>
          ${statusPill(event?.status || "未設定")}
        </div>
        <label>
          <span>確認する日付</span>
          <select data-role="event-select">
            ${renderEventOptions(view.eventId)}
          </select>
        </label>
        ${renderAttendanceSummaryCards(view.eventId)}
        <div class="subsection">
          <h3>未入力者</h3>
          ${renderNameList(getMissingUsers(state, view.eventId), "未入力者はいません。")}
        </div>
      </aside>
    </section>
  `;
}

function renderBulkAttendanceRow(event) {
  const entry = getAttendanceEntry(state, event.id, view.attendanceUserId);
  return `
    <div class="bulk-attendance-row">
      <input type="hidden" name="attendance_event_id" value="${event.id}">
      <div class="bulk-date">
        <h3>${formatDateLabel(event.event_date)}</h3>
        <span>${formatDateTime(event.reservation_open_at)} 解放</span>
      </div>
      <div class="bulk-status-options" role="radiogroup" aria-label="${formatDateLabel(event.event_date)} の出欠">
        ${ATTENDANCE_STATUSES.map((status) => `
          <label class="bulk-status-option status-${status}">
            <input name="status_${event.id}" type="radio" value="${status}" ${entry?.status === status ? "checked" : ""}>
            <span>${bulkAttendanceLabel(status)}</span>
          </label>
        `).join("")}
      </div>
      <label class="bulk-memo">
        <span>メモ</span>
        <input name="memo_${event.id}" value="${escapeAttr(entry?.memo || "")}" placeholder="任意">
      </label>
    </div>
  `;
}

function bulkAttendanceLabel(status) {
  if (status === "出勤") return "○ 出勤";
  if (status === "欠席") return "× 欠席";
  if (status === "未定") return "△ 未定";
  return status;
}

function renderStaffAttendancePage() {
  const event = findEvent(state, view.eventId);
  const events = getActiveEvents(state)
    .filter((item) => item.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const staffMembers = getActiveStaffMembers(state);
  return `
    <section class="page-grid two-col">
      <div class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Staff</p>
            <h2>内勤勤怠まとめ入力</h2>
          </div>
          <span class="capacity ok">${events.length}日分</span>
        </div>
        <form class="bulk-attendance-form" data-action="save-bulk-staff-attendance">
          <label>
            <span>内勤名</span>
            <select name="staff_member_id" data-role="staff-attendance-member-select">
              ${staffMembers.map((member) => option(member.id, member.display_name, member.id === view.staffAttendanceMemberId)).join("")}
            </select>
          </label>
          <p class="plan-note">各日程の内勤出勤をまとめて選択できます。何も選んでいない日は未入力のままです。</p>
          ${staffMembers.length && events.length ? `
            <button class="primary-button bulk-save-button" type="submit">まとめて登録 / 更新する</button>
            <div class="bulk-attendance-list">
              ${events.map((item) => renderBulkStaffAttendanceRow(item)).join("")}
            </div>
          ` : `<p class="empty">入力対象の日程または内勤スタッフがありません。運営画面の「内勤一覧」から追加してください。</p>`}
        </form>
      </div>
      <aside class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Staff Status</p>
            <h2>${event ? formatDateLabel(event.event_date) : "対象日未設定"}</h2>
          </div>
          ${statusPill(event?.status || "未設定")}
        </div>
        <label>
          <span>確認する日付</span>
          <select data-role="event-select">
            ${renderEventOptions(view.eventId)}
          </select>
        </label>
        ${renderStaffAttendanceSummaryCards(view.eventId)}
        <div class="subsection">
          <h3>内勤未入力</h3>
          ${renderNameList(getMissingStaffMembers(state, view.eventId), "内勤の未入力者はいません。")}
        </div>
      </aside>
    </section>
  `;
}

function renderBulkStaffAttendanceRow(event) {
  const entry = getStaffAttendanceEntry(state, event.id, view.staffAttendanceMemberId);
  return `
    <div class="bulk-attendance-row">
      <input type="hidden" name="attendance_event_id" value="${event.id}">
      <div class="bulk-date">
        <h3>${formatDateLabel(event.event_date)}</h3>
        <span>${formatDateTime(event.reservation_open_at)} 解放</span>
      </div>
      <div class="bulk-status-options is-staff" role="radiogroup" aria-label="${formatDateLabel(event.event_date)} の内勤出勤">
        ${STAFF_ATTENDANCE_STATUSES.map((status) => `
          <label class="bulk-status-option status-${status}">
            <input name="status_${event.id}" type="radio" value="${status}" ${entry?.status === status ? "checked" : ""}>
            <span>${bulkAttendanceLabel(status)}</span>
          </label>
        `).join("")}
      </div>
      <label class="bulk-memo">
        <span>メモ</span>
        <input name="memo_${event.id}" value="${escapeAttr(entry?.memo || "")}" placeholder="任意">
      </label>
    </div>
  `;
}

function renderHostAttendanceListPage() {
  const event = findEvent(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">Attendance List</p>
          <h2>${event ? formatDateLabel(event.event_date) : "出勤一覧"}</h2>
        </div>
        <div class="toolbar compact">
          <select data-role="event-select" aria-label="対象日">
            ${renderEventOptions(view.eventId)}
          </select>
          ${statusPill(event?.status || "未設定")}
        </div>
      </div>
      ${event?.status === "休み" ? `<div class="notice muted">この日は休みです。出勤一覧の対象外です。</div>` : ""}
      <div class="attendance-list-summaries">
        <section class="mini-panel">
          <h3>ホスト</h3>
          ${renderAttendanceSummaryCards(view.eventId)}
        </section>
        <section class="mini-panel">
          <h3>内勤</h3>
          ${renderStaffAttendanceSummaryCards(view.eventId)}
        </section>
      </div>
      <div class="attendance-list-grid">
        ${HOST_ATTENDANCE_LIST_STATUSES.map((status) => renderHostAttendanceListSection(status)).join("")}
      </div>
      <div class="section-title attendance-list-subtitle">
        <h3>内勤</h3>
      </div>
      <div class="attendance-list-grid">
        ${[...STAFF_ATTENDANCE_STATUSES, "未入力"].map((status) => renderStaffAttendanceListSection(status)).join("")}
      </div>
    </section>
  `;
}

function renderHostAttendanceListSection(status) {
  const items = getHostAttendanceListItems(status);
  return `
    <section class="mini-panel attendance-list-section status-${status}">
      <div class="section-title">
        <h3>${escapeHtml(status)}</h3>
        <span class="inline-pill muted">${items.length}人</span>
      </div>
      ${renderDetailList(items, `${status}のホストはいません。`)}
    </section>
  `;
}

function renderStaffAttendanceListSection(status) {
  const items = getStaffAttendanceListItems(status);
  return `
    <section class="mini-panel attendance-list-section status-${status}">
      <div class="section-title">
        <h3>${escapeHtml(status)}</h3>
        <span class="inline-pill muted">${items.length}人</span>
      </div>
      ${renderDetailList(items, `${status}の内勤はいません。`)}
    </section>
  `;
}

function getHostAttendanceListItems(status) {
  if (status === "未入力") {
    return getMissingUsers(state, view.eventId).map((user) => ({ title: user.display_name, meta: `ホスト / ${user.role || "ホスト"}` }));
  }
  if (status === "長期休暇") {
    return getVacationExemptUsers(state, view.eventId).map((user) => {
      const entry = getAttendanceEntry(state, view.eventId, user.id);
      return { title: user.display_name, meta: [`ホスト / ${user.role || "ホスト"}`, "長期休暇中", entry ? `${entry.status}入力あり` : ""].filter(Boolean).join(" / ") };
    });
  }
  const event = findEvent(state, view.eventId);
  return getActiveUsers(state)
    .map((user) => ({ user, entry: getAttendanceEntry(state, view.eventId, user.id) }))
    .filter(({ user, entry }) => entry?.status === status && !(event && isOnVacation(state, user.id, event.event_date)))
    .map(({ user }) => ({ title: user.display_name, meta: `ホスト / ${user.role || "ホスト"}` }));
}

function getStaffAttendanceListItems(status) {
  if (status === "未入力") {
    return getMissingStaffMembers(state, view.eventId).map((member) => ({ title: member.display_name, meta: `内勤 / ${member.staff_type || "内勤"}` }));
  }
  return getActiveStaffMembers(state)
    .map((member) => ({ member, entry: getStaffAttendanceEntry(state, view.eventId, member.id) }))
    .filter(({ entry }) => entry?.status === status)
    .map(({ member }) => ({ title: member.display_name, meta: `内勤 / ${member.staff_type || "内勤"}` }));
}

function renderReservationPage(adminMode) {
  const event = findEvent(state, view.eventId);
  const requestLocked = event && !adminMode && !isReservationRequestOpen(event);
  const isHoliday = event?.status === "休み";
  view.reservationTab = "requests";
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">${adminMode ? "Admin" : "Host"}</p>
          <h2>${event ? formatDateLabel(event.event_date) : "予約入力"}</h2>
        </div>
        <div class="toolbar compact">
          <select data-role="event-select" aria-label="対象日">
            ${renderEventOptions(view.eventId)}
          </select>
          ${statusPill(event?.status || "未設定")}
        </div>
      </div>
      ${renderReservationRequestOpenNotice(event, adminMode)}
      ${isHoliday ? `<div class="notice muted">この日は休みです。勤怠・予約入力対象外です。</div>` : ""}
      ${renderReservationRequestPrototype(event?.id || "", { adminMode, locked: Boolean(requestLocked || isHoliday) })}
    </section>
  `;
}

function renderReservationRequestOpenNotice(event, adminMode) {
  if (!event) return "";
  if (event.status === EVENT_STATUSES[2]) return "";
  const requestOpenAt = getReservationRequestOpenAt(event.event_date);
  if (adminMode) {
    return `<div class="notice">運営画面では受付方式（仮）の解放前でも代理入力できます。受付方式解放: ${formatDateTime(requestOpenAt)}</div>`;
  }
  if (isReservationRequestOpen(event)) {
    return `<div class="notice success">受付方式（仮）は受付中です。解放日時: ${formatDateTime(requestOpenAt)}</div>`;
  }
  return `<div class="notice muted">受付方式（仮）は対象週の水曜22:00から開始されます。現在は閲覧のみ可能です。解放日時: ${formatDateTime(requestOpenAt)}</div>`;
}

function renderReservationRequestPrototype(eventId, { adminMode = false, locked = false } = {}) {
  const event = findEvent(state, eventId);
  if (!event) return "";
  const setting = getReservationSetting(state, eventId);
  const requests = getReservationRequestsForEvent(state, eventId);
  const buckets = getReservationRequestBuckets(state, eventId);
  const acceptance = getReservationRequestAcceptanceStatus(state, eventId);
  const requestLocked = locked || (!adminMode && acceptance.closed);
  const editingRequest = adminMode && view.editingReservationRequestId
    ? requests.find((request) => request.id === view.editingReservationRequestId)
    : null;
  return `
    <section class="request-panel">
      <div class="section-title">
        <h3>予約受付方式（仮）</h3>
        <span class="capacity ${acceptance.closed ? "full" : "ok"}">合計 ${acceptance.total} / ${acceptance.capacity}</span>
      </div>
      <p class="plan-note">担当者は席を選ばず、受付順に予約を登録します。運営があとから予約枠・保留枠へ振り分けます。担当はホストのみ選択できます。</p>
      ${acceptance.closed ? `<div class="notice muted">受付上限 ${acceptance.capacity}件（予約枠${acceptance.reservationCapacity} + 保留枠${acceptance.holdCapacity}）に達しています。新規受付は締切です。</div>` : ""}
      ${adminMode ? renderReservationRequestSettingForm(eventId, setting) : ""}
      ${renderReservationRequestForm(eventId, setting, requestLocked, editingRequest)}
      ${renderReservationRequestSummaryV2(buckets, setting, acceptance)}
      ${renderReservationRequestBucketsV2(buckets, adminMode)}
      ${renderReservationRequestList(requests, adminMode, locked)}
    </section>
  `;
}

function renderReservationRequestSettingForm(eventId, setting) {
  return `
    <form class="request-setting-form" data-action="save-reservation-request-setting">
      <input type="hidden" name="event_date_id" value="${escapeAttr(eventId)}">
      <div class="request-setting-copy">
        <strong>運営用: 席数設定</strong>
        <span>1インスタンス営業として、各タイムの通常席数とアイバン席数を設定します。</span>
      </div>
      <div class="request-setting-controls">
        <div class="request-setting-capacities">
          <label>
            <span>通常席数</span>
            <input name="normal_capacity" type="number" min="0" max="99" step="1" value="${setting.normal_capacity}">
          </label>
          <label>
            <span>アイバン席数</span>
            <input name="ivan_capacity" type="number" min="0" max="99" step="1" value="${setting.ivan_capacity}">
          </label>
        </div>
        <button class="primary-button" type="submit">設定を反映</button>
      </div>
    </form>
  `;
}

function renderReservationRequestForm(eventId, setting, locked, editingRequest = null) {
  const allowedSlots = TIME_SLOTS;
  const editing = editingRequest || {};
  const isEditing = Boolean(editingRequest);
  const personOptions = getReservationPersonOptions(editing.host_user_id);
  const desiredSlot = editing.desired_time_slot || allowedSlots[0];
  const attribute = RESERVATION_ATTRIBUTE;
  const ivanAttribute = IVAN_ATTRIBUTES.includes(editing.ivan_attribute) ? editing.ivan_attribute : IVAN_ATTRIBUTE;
  return `
    <form class="reservation-request-form" data-action="save-reservation-request">
      ${isEditing ? `
        <div class="request-editing-notice">
          <strong>受付を編集中</strong>
          <span>${escapeHtml(getReservationPersonName(editing.host_user_id))} / ${escapeHtml(REQUEST_TIME_SLOT_LABELS[editing.desired_time_slot] || editing.desired_time_slot || "")} / ${formatHistoryDateTime(editing.created_at)}</span>
          <button class="ghost-button" data-action="new-reservation-request" type="button">新規入力に戻る</button>
        </div>
      ` : ""}
      <input type="hidden" name="id" value="${escapeAttr(editing.id || "")}">
      <input type="hidden" name="event_date_id" value="${escapeAttr(eventId)}">
      <div class="request-form-row request-host-row">
        <label><span>担当</span><select name="host_user_id" data-role="reservation-person-select" ${locked ? "disabled" : ""}><option value="">未選択</option>${personOptions.map((person) => option(person.id, person.label, person.id === editing.host_user_id)).join("")}</select></label>
        <label><span>希望回</span><select name="desired_time_slot" ${locked ? "disabled" : ""}>${allowedSlots.map((slot) => option(slot, REQUEST_TIME_SLOT_LABELS[slot] || slot, slot === desiredSlot)).join("")}</select></label>
      </div>
      <div class="request-form-row request-guest-row">
        <label><span>姫名</span><input name="princess_name" value="${escapeAttr(editing.princess_name || "")}" ${locked ? "disabled" : ""}></label>
        <label><span>属性</span><select name="attribute" data-role="reservation-attribute-select" ${locked ? "disabled" : ""}>${renderAttributeOptions(attribute, "attribute")}</select></label>
        <label><span>アイバン名</span><input name="ivan_name" value="${escapeAttr(editing.ivan_name || "")}" ${locked ? "disabled" : ""}></label>
        <label><span>アイバン属性</span><select name="ivan_attribute" data-role="reservation-attribute-select" ${locked ? "disabled" : ""}>${renderAttributeOptions(ivanAttribute, "ivan_attribute")}</select></label>
      </div>
      <div class="request-form-row request-submit-row">
        <label><span>メモ</span><input name="memo" value="${escapeAttr(editing.memo || "")}" placeholder="確認事項、交渉メモなど" ${locked ? "disabled" : ""}></label>
        <button class="primary-button" type="submit" ${locked ? "disabled" : ""}>${isEditing ? "受付を更新" : "受付に登録"}</button>
      </div>
    </form>
  `;
}

function renderReservationRequestSummaryV2(buckets, setting, acceptance) {
  return `
    <div class="request-summary-grid">
      <div class="mini-panel">
        <span>受付合計</span>
        <strong>${acceptance.total} / ${acceptance.capacity}</strong>
        <em>予約枠${acceptance.reservationCapacity} + 保留${acceptance.holdCapacity}</em>
        <span class="capacity ${acceptance.closed ? "full" : "ok"}">${acceptance.closed ? "締切" : "受付中"}</span>
      </div>
      <div class="mini-panel">
        <span>保留枠合計</span>
        <strong>${acceptance.holdUsed} / ${acceptance.holdCapacity}</strong>
        <em>${TIME_SLOTS.map((slot) => `${slot}3`).join(" / ")}</em>
        <span class="capacity ${acceptance.holdUsed >= acceptance.holdCapacity ? "full" : "ok"}">${acceptance.holdUsed >= acceptance.holdCapacity ? "満枠" : `残り${acceptance.holdCapacity - acceptance.holdUsed}`}</span>
      </div>
      ${TIME_SLOTS.map((slot) => {
        const bucket = buckets[slot];
        return [
          renderRequestCapacityPanel(`${slot} 通常席`, bucket.normal),
          renderRequestCapacityPanel(`${slot} アイバン枠`, bucket.ivan),
        ].join("");
      }).join("")}
      ${TIME_SLOTS.map((slot) => renderRequestHoldCapacityPanel(slot, acceptance)).join("")}
    </div>
  `;
}

function renderRequestHoldCapacityPanel(slot, acceptance) {
  const used = acceptance.holdUsedByTimeSlot?.[slot] || 0;
  const cap = acceptance.holdCapacityByTimeSlot?.[slot] || 0;
  const level = used > cap ? "over" : used === cap ? "full" : "ok";
  return `<div class="mini-panel"><span>${escapeHtml(slot)} 保留枠</span><strong>${used} / ${cap}</strong><em>${used ? "予約枠超過分" : "まだ予約枠内"}</em><span class="capacity ${level}">${level === "over" ? "超過" : level === "full" ? "満枠" : `残り${cap - used}`}</span></div>`;
}

function renderRequestCapacityPanel(label, bucket) {
  const level = bucket.reserved.length > bucket.capacity ? "over" : bucket.reserved.length === bucket.capacity ? "full" : "ok";
  return `<div class="mini-panel"><span>${escapeHtml(label)}</span><strong>${bucket.reserved.length} / ${bucket.capacity}</strong><em>${bucket.hold.length ? `保留 ${bucket.hold.length}` : "保留なし"}</em><span class="capacity ${level}">${level === "over" ? "超過" : level === "full" ? "満枠" : "受付中"}</span></div>`;
}

function renderReservationRequestBucketsV2(buckets, adminMode) {
  return `
    <div class="request-bucket-grid">
      ${TIME_SLOTS.map((slot) => {
        const bucket = buckets[slot];
        return `
          ${renderRequestSeatBucket(`${slot} 通常席`, bucket.normal, adminMode)}
          ${renderRequestSeatBucket(`${slot} アイバン枠`, bucket.ivan, adminMode)}
        `;
      }).join("")}
    </div>
  `;
}

function renderRequestSeatBucket(label, bucket, adminMode) {
  return `
    <section class="request-bucket">
      <div class="section-title">
        <h3>${escapeHtml(label)}</h3>
        <span class="capacity ${bucket.reserved.length > bucket.capacity ? "over" : "ok"}">${bucket.reserved.length} / ${bucket.capacity}</span>
      </div>
      ${renderRequestCardsV2(bucket.reserved, adminMode, "予約枠はまだありません。")}
      <h4>保留枠</h4>
      ${renderRequestCardsV2(bucket.hold, adminMode, "保留枠はまだありません。")}
    </section>
  `;
}

function renderRequestCardsV2(requests, adminMode, emptyText) {
  if (!requests.length) return `<p class="empty">${emptyText}</p>`;
  return `<div class="request-card-list">${requests.map((request) => renderRequestCardV2(request, adminMode)).join("")}</div>`;
}

function renderRequestCardV2(request, adminMode) {
  const hostName = getReservationPersonName(request.host_user_id);
  const seatType = isReservationRequestIvan(request) ? "アイバン枠" : "通常席";
  return `
    <article class="request-card ${request.placement_status || "auto"}">
      <div><strong>${escapeHtml(hostName)}</strong><span>${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)} / ${escapeHtml(seatType)} / ${formatHistoryDateTime(request.created_at)}</span></div>
      <p>${escapeHtml(formatReservationGuestMeta(request) || "姫名未入力")}</p>
      ${request.memo ? `<p>${escapeHtml(request.memo)}</p>` : ""}
      ${adminMode ? renderRequestPlacementActionsV2(request) : ""}
    </article>
  `;
}

function renderRequestPlacementActionsV2(request) {
  return `
    <div class="request-actions">
      <button class="icon-button" data-action="edit-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button">編集</button>
      <button class="icon-button" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="auto" type="button">自動</button>
      <button class="icon-button save" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="reserved" type="button">予約枠扱い</button>
      <button class="icon-button danger" data-action="request-placement" data-request-id="${escapeAttr(request.id)}" data-placement-status="hold" type="button">保留扱い</button>
      <button class="icon-button danger" data-action="delete-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button">削除</button>
    </div>
  `;
}

function renderReservationRequestList(requests, adminMode, locked) {
  if (!requests.length) return `<p class="empty">受付はまだありません。</p>`;
  return `
    <div class="table-wrap request-table-wrap">
      <table class="data-table">
        <thead><tr><th>受付</th><th>担当</th><th>希望</th><th>姫 / アイバン</th><th>内容</th><th>扱い</th><th>操作</th></tr></thead>
        <tbody>
          ${requests.map((request, index) => `
            <tr>
              <td>#${String(index + 1).padStart(3, "0")}<br>${formatHistoryDateTime(request.created_at)}</td>
              <td>${escapeHtml(getReservationPersonName(request.host_user_id))}</td>
              <td>${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)}</td>
              <td>${escapeHtml(formatReservationGuestMeta(request))}</td>
              <td>${escapeHtml(request.memo || "")}</td>
              <td>${escapeHtml(formatPlacementStatus(request.placement_status))}</td>
              <td>
                ${adminMode ? `<button class="icon-button" data-action="edit-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button">編集</button>` : ""}
                <button class="icon-button danger" data-action="delete-reservation-request" data-request-id="${escapeAttr(request.id)}" type="button" ${locked && !adminMode ? "disabled" : ""}>削除</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatPlacementStatus(status) {
  if (status === "reserved") return "予約枠扱い";
  if (status === "hold") return "保留扱い";
  return "自動";
}

function renderReservationGrid(eventId, { adminMode = false, locked = false } = {}) {
  const event = findEvent(state, eventId);
  if (!event) return `<div class="empty">イベント日を作成してください。</div>`;
  return TIME_SLOTS.map((timeSlot) => {
    return RESERVATION_SEAT_ORDER.map((seatType) => renderReservationSection(eventId, timeSlot, seatType, adminMode, locked)).join("");
  }).join("");
}

function formatReservationGuestMeta(reservation) {
  return [
    formatGuestAttribute("姫", reservation.princess_name, reservation.attribute),
    formatGuestAttribute("アイバン", reservation.ivan_name, reservation.ivan_attribute),
  ].filter(Boolean).join(" / ");
}

function formatGuestAttribute(label, name, attribute) {
  if (!name) return "";
  return `${label}: ${name}${attribute ? `（${attribute}）` : ""}`;
}

function renderReservationSection(eventId, timeSlot, seatType, adminMode, locked) {
  const key = `${timeSlot}:${seatType}`;
  const count = getSeatLimitStatuses(state, eventId)[key];
  const noIvanColumn = seatType === SEAT_TYPES[0];
  const rows = getGroupLabels(seatType)
    .map((groupNo) => {
      const reservation = findReservationBySlot(state, eventId, timeSlot, seatType, groupNo);
      return renderReservationRow(reservation, { eventId, timeSlot, seatType, groupNo, adminMode, locked, noIvanColumn });
    })
    .join("");
  return `
    <section class="reservation-section">
      <div class="section-title">
        <h3>${getTimeSlotLabel(timeSlot)} ${seatType}</h3>
        <span class="capacity ${count.level}">${count.total} / ${count.limit}${count.level === "full" ? " 満席" : ""}${count.level === "over" ? " 超過" : ""}</span>
      </div>
      <div class="reservation-grid ${noIvanColumn ? "no-ivan-column" : ""}" role="table">
        <div class="grid-head" role="row">
          <span>組数</span><span>担当</span><span>姫名</span><span>属性</span>${noIvanColumn ? "" : "<span>アイバン名</span><span>属性</span>"}
          <span>メモ</span><span>操作</span>
        </div>
        ${rows}
      </div>
    </section>
  `;
}

function renderReservationRow(reservation, context) {
  const disabled = context.locked ? "disabled" : "";
  const data = reservation || {
    id: "",
    host_user_id: "",
    princess_name: "",
    ivan_name: "",
    attribute: RESERVATION_ATTRIBUTE,
    ivan_attribute: IVAN_ATTRIBUTE,
    memo: "",
  };
  const warnings = reservation ? getReservationWarnings(state, reservation) : [];
  const rowClass = warnings.length ? "has-warning" : "";
  return `
    <div class="grid-row slot-row ${rowClass}" data-reservation-id="${escapeAttr(data.id || "")}" data-reservation-updated-at="${escapeAttr(data.updated_at || "")}" data-event-id="${escapeAttr(context.eventId)}" data-time-slot="${escapeAttr(context.timeSlot)}" data-seat-type="${escapeAttr(context.seatType)}" data-group-no="${escapeAttr(context.groupNo)}" role="row">
      <div class="grid-cell fixed" data-label="組数"><strong>${context.groupNo}</strong></div>
      <label class="grid-cell" data-label="担当">
        <select data-field="host_user_id" data-role="reservation-person-select" ${disabled}>
          <option value="">未選択</option>
          ${getReservationPersonOptions(data.host_user_id).map((person) => option(person.id, person.label, person.id === data.host_user_id)).join("")}
        </select>
      </label>
      ${textCell("princess_name", "姫名", data.princess_name, disabled)}
      ${attributeCell("attribute", context.noIvanColumn ? "属性" : "姫属性", data.attribute, disabled)}
      ${context.noIvanColumn ? "" : textCell("ivan_name", "アイバン名", data.ivan_name, disabled)}
      ${context.noIvanColumn ? "" : attributeCell("ivan_attribute", "アイバン属性", data.ivan_attribute, disabled)}
      ${textCell("memo", "メモ", data.memo, disabled)}
      <div class="grid-cell actions" data-label="操作">
        <button class="icon-button save" data-action="save-reservation" type="button" ${disabled}>${data.id ? "更新" : "登録"}</button>
        <button class="icon-button danger" data-action="delete-reservation" type="button" ${disabled || !data.id ? "disabled" : ""}>削除</button>
      </div>
      ${warnings.length ? `<div class="row-warning">${warnings.map(escapeHtml).join(" / ")}</div>` : ""}
    </div>
  `;
}

function textCell(field, label, value, disabled) {
  return `<label class="grid-cell" data-label="${label}"><input data-field="${field}" value="${escapeAttr(value || "")}" ${disabled}></label>`;
}

function attributeCell(field, label, value, disabled) {
  return `
    <label class="grid-cell" data-label="${label}">
      <select data-field="${field}" data-role="reservation-attribute-select" ${disabled}>
        ${renderAttributeOptions(value, field)}
      </select>
    </label>
  `;
}

function renderAdminPage() {
  if (!adminUnlocked) return renderAdminLogin();
  return `
    <section class="admin-layout">
      <aside class="admin-sidebar panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Admin</p>
            <h2>運営画面</h2>
          </div>
        </div>
        <select data-role="event-select" aria-label="対象日">
          ${renderEventOptions(view.eventId)}
        </select>
        ${renderStoreSwitcher()}
        <div class="side-nav">
          ${adminTabButton("dashboard", "運営トップ")}
          ${adminTabButton("attendance", "ホスト勤怠")}
          ${adminTabButton("staffAttendance", "内勤勤怠")}
          ${adminTabButton("missing", "未入力者")}
          ${adminTabButton("hosts", "ホスト一覧")}
          ${adminTabButton("staff", "内勤一覧")}
          ${adminTabButton("vacations", "長期休暇")}
          ${adminTabButton("events", "イベント日")}
          ${adminTabButton("reservations", "予約管理")}
          ${adminTabButton("archive", "アーカイブ")}
          ${adminTabButton("discord", "Discord文面")}
          ${adminTabButton("histories", "変更履歴")}
          ${adminTabButton("data", "データ")}
        </div>
        <button class="ghost-button" data-action="admin-logout" type="button">ログアウト</button>
      </aside>
      <div class="admin-content">
        ${renderAdminContent()}
      </div>
    </section>
  `;
}

function renderAdminLogin() {
  return `
    <section class="panel login-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Password</p>
          <h2>運営画面ログイン</h2>
        </div>
      </div>
      <form class="stack" data-action="admin-login">
        <label>
          <span>共通パスワード</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button class="primary-button" type="submit">運営画面を表示</button>
      </form>
    </section>
  `;
}

function adminTabButton(tab, label) {
  return `<button class="side-button ${view.adminTab === tab ? "is-active" : ""}" data-action="admin-tab" data-tab="${tab}" type="button">${label}</button>`;
}

function renderAdminContent() {
  if (view.adminTab === "attendance") return renderAdminAttendance();
  if (view.adminTab === "staffAttendance") return renderAdminStaffAttendance();
  if (view.adminTab === "missing") return renderAdminMissing();
  if (view.adminTab === "hosts") return renderHostManagement();
  if (view.adminTab === "staff") return renderStaffManagement();
  if (view.adminTab === "vacations") return renderVacationManagement();
  if (view.adminTab === "events") return renderEventManagement();
  if (view.adminTab === "reservations") return renderReservationPage(true);
  if (view.adminTab === "archive") return renderArchive();
  if (view.adminTab === "discord") return renderDiscordTools();
  if (view.adminTab === "histories") return renderHistories();
  if (view.adminTab === "data") return renderDataTools();
  return renderAdminDashboard();
}

function renderAdminDashboard() {
  const event = findEvent(state, view.eventId);
  const issues = getDashboardIssues(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">Dashboard</p>
          <h2>${event ? formatDateLabel(event.event_date) : "運営トップ"}</h2>
        </div>
        ${statusPill(event?.status || "未設定")}
      </div>
      <div class="dashboard-stack">
        <div class="dashboard-grid dashboard-attendance-grid">
          <div class="mini-panel">
            <h3>ホスト勤怠</h3>
            ${renderAttendanceSummaryCards(view.eventId, { detailType: "hostAttendance" })}
          </div>
          <div class="mini-panel">
            <h3>内勤勤怠</h3>
            ${renderStaffAttendanceSummaryCards(view.eventId, { detailType: "staffAttendance" })}
          </div>
        </div>
        ${renderDashboardDetailGroup(["hostAttendance", "staffAttendance"])}
        <div class="dashboard-grid dashboard-operations-grid">
          <div class="mini-panel">
            <h3>予約枠</h3>
            ${renderSeatStatusList(view.eventId, { detailType: "seat" })}
          </div>
          <div class="mini-panel">
            <h3>確認が必要</h3>
            ${issues.length ? `<ul class="issue-list">${issues.map((issue) => `<li class="${issue.level}">⚠ ${escapeHtml(issue.text)}</li>`).join("")}</ul>` : `<p class="empty">要確認項目はありません。</p>`}
          </div>
        </div>
        ${renderDashboardDetailGroup(["seat"])}
      </div>
    </section>
  `;
}

function renderAdminAttendance() {
  const event = findEvent(state, view.eventId);
  const rows = getActiveUsers(state).map((user) => {
    const entry = getAttendanceEntry(state, view.eventId, user.id);
    const vacation = event && isOnVacation(state, user.id, event.event_date);
    return `
      <tr>
        <td>${escapeHtml(user.display_name)}</td>
        <td>${escapeHtml(user.role)}${vacation ? `<span class="inline-pill muted">長期休暇</span>` : ""}</td>
        <td>
          <select data-field="status">
            ${ATTENDANCE_STATUSES.map((status) => option(status, status, status === (entry?.status || "出勤"))).join("")}
          </select>
        </td>
        <td><input data-field="memo" value="${escapeAttr(entry?.memo || "")}"></td>
        <td><button class="icon-button save" data-action="admin-save-attendance" data-user-id="${user.id}" type="button">保存</button></td>
      </tr>
    `;
  }).join("");
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Attendance</p><h2>ホスト勤怠管理</h2></div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>ホスト</th><th>状態</th><th>出欠</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAdminStaffAttendance() {
  const event = findEvent(state, view.eventId);
  const staffMembers = getActiveStaffMembers(state);
  const rows = staffMembers.map((member) => {
    const entry = getStaffAttendanceEntry(state, view.eventId, member.id);
    return `
      <tr>
        <td>${escapeHtml(member.display_name)}</td>
        <td>${escapeHtml(member.staff_type || "内勤")}</td>
        <td>
          <select data-field="status">
            ${STAFF_ATTENDANCE_STATUSES.map((status) => option(status, status, status === (entry?.status || "出勤"))).join("")}
          </select>
        </td>
        <td><input data-field="memo" value="${escapeAttr(entry?.memo || "")}"></td>
        <td><button class="icon-button save" data-action="admin-save-staff-attendance" data-staff-member-id="${member.id}" type="button">保存</button></td>
      </tr>
    `;
  }).join("");
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div><p class="eyebrow">Staff Attendance</p><h2>${event ? formatDateLabel(event.event_date) : ""} 内勤勤怠管理</h2></div>
        ${statusPill(event?.status || "未設定")}
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>内勤サマリー</h3>
          ${renderStaffAttendanceSummaryCards(view.eventId)}
        </div>
        <div class="mini-panel">
          <h3>未入力</h3>
          ${renderNameList(getMissingStaffMembers(state, view.eventId), "内勤の未入力者はいません。")}
        </div>
      </div>
      ${staffMembers.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>内勤</th><th>区分</th><th>出欠</th><th>メモ</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : `<p class="empty">内勤スタッフが未登録です。「内勤一覧」から追加してください。</p>`}
    </section>
  `;
}

function renderAdminMissing() {
  const event = findEvent(state, view.eventId);
  const missing = getMissingUsers(state, view.eventId);
  const missingStaff = getMissingStaffMembers(state, view.eventId);
  const exempt = getVacationExemptUsers(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Missing</p><h2>${event ? formatDateLabel(event.event_date) : ""} 未入力者</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>未入力</h3>
          ${renderNameList(missing, "未入力者はいません。")}
        </div>
        <div class="mini-panel">
          <h3>内勤未入力</h3>
          ${renderNameList(missingStaff, "内勤の未入力者はいません。")}
        </div>
        <div class="mini-panel">
          <h3>催促対象外</h3>
          ${renderNameList(exempt, "長期休暇中の対象者はいません。", "長期休暇中")}
        </div>
      </div>
    </section>
  `;
}

function renderHostManagement() {
  const editing = view.editingUserId ? findUser(state, view.editingUserId) : null;
  const users = sortedUsers(state.users);
  const activeUsers = users.filter((user) => user.is_active !== false);
  const inactiveUsers = users.filter((user) => user.is_active === false);
  const roles = getRoles(state);
  const roleOptions = [...roles];
  if (editing?.role && !roleOptions.some((role) => role.name === editing.role)) {
    const inactiveRole = getRoles(state, true).find((role) => role.name === editing.role);
    roleOptions.push(inactiveRole || { name: editing.role, is_active: false });
  }
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Hosts</p><h2>ホスト一覧管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-user" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-user">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>ホスト名</span><input name="display_name" value="${escapeAttr(editing?.display_name || "")}" required></label>
        <label><span>読み仮名</span><input name="kana" value="${escapeAttr(editing?.kana || "")}"></label>
        <label><span>ロール</span><select name="role">${roleOptions.map((role) => option(role.name, role.is_active === false ? `${role.name}（無効）` : role.name, role.name === (editing?.role || "ホスト"))).join("")}</select></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="mini-panel role-manager">
        <h3>タグ管理</h3>
        <form class="role-form" data-action="save-role">
          <label><span>追加するタグ名</span><input name="name" placeholder="例: 幹部候補"></label>
          <button class="primary-button" type="submit">タグを追加</button>
        </form>
        <div class="role-chip-list">
          ${getRoles(state).map((role) => `
            <span class="role-chip">
              ${escapeHtml(role.name)}
              ${ROLES.includes(role.name)
                ? `<span class="role-chip-note">標準</span>`
                : `<button data-action="delete-role" data-role-name="${escapeAttr(role.name)}" type="button">削除</button>`}
            </span>
          `).join("")}
        </div>
      </div>
      ${renderHostManagementTable(activeUsers, "有効なホストがいません。")}
      <details class="mini-panel collapsed-hosts">
        <summary>無効化済みホスト <strong>${inactiveUsers.length}</strong>人</summary>
        ${renderHostManagementTable(inactiveUsers, "無効化済みホストはいません。")}
      </details>
    </section>
  `;
}

function renderHostManagementTable(users, emptyText) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>ホスト名</th><th>読み</th><th>ロール</th><th>状態</th><th>メモ</th><th>操作</th></tr></thead>
        <tbody>
          ${users.length ? users.map((user) => `
            <tr>
              <td>${escapeHtml(user.display_name)}</td>
              <td>${escapeHtml(user.kana || "")}</td>
              <td>${escapeHtml(user.role)}</td>
              <td>${user.is_active !== false ? `<span class="inline-pill active">有効</span>` : `<span class="inline-pill muted">無効</span>`}</td>
              <td>${escapeHtml(user.note || "")}</td>
              <td>
                <div class="row-actions">
                  <button class="icon-button" data-action="edit-user" data-user-id="${user.id}" type="button">編集</button>
                  ${user.is_active !== false
                    ? `<button class="icon-button danger" data-action="disable-user" data-user-id="${user.id}" type="button">無効化</button>`
                    : `<button class="icon-button save" data-action="enable-user" data-user-id="${user.id}" type="button">有効化</button>`}
                </div>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="6">${escapeHtml(emptyText)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderStaffManagement() {
  const editing = view.editingStaffMemberId
    ? state.staff_members.find((member) => member.id === view.editingStaffMemberId)
    : null;
  const staffMembers = sortedStaffMembers(state.staff_members || []);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Staff</p><h2>内勤一覧管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-staff-member" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-staff-member">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>内勤名</span><input name="display_name" value="${escapeAttr(editing?.display_name || "")}" required></label>
        <label><span>読み仮名</span><input name="kana" value="${escapeAttr(editing?.kana || "")}"></label>
        <label><span>区分</span><input name="staff_type" value="${escapeAttr(editing?.staff_type || "内勤")}" placeholder="例: 内勤 / 受付 / 会計"></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="notice muted">ホスト一覧とは別管理です。ここに登録した人だけが「内勤出勤」の対象になります。</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>内勤名</th><th>読み</th><th>区分</th><th>状態</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>
            ${staffMembers.map((member) => `
              <tr>
                <td>${escapeHtml(member.display_name)}</td>
                <td>${escapeHtml(member.kana || "")}</td>
                <td>${escapeHtml(member.staff_type || "内勤")}</td>
                <td>${member.is_active ? `<span class="inline-pill active">有効</span>` : `<span class="inline-pill muted">無効</span>`}</td>
                <td>${escapeHtml(member.note || "")}</td>
                <td>
                  <div class="row-actions">
                    <button class="icon-button" data-action="edit-staff-member" data-staff-member-id="${member.id}" type="button">編集</button>
                    ${member.is_active
                      ? `<button class="icon-button danger" data-action="disable-staff-member" data-staff-member-id="${member.id}" type="button">無効化</button>`
                      : `<button class="icon-button save" data-action="enable-staff-member" data-staff-member-id="${member.id}" type="button">有効化</button>`}
                  </div>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6">内勤スタッフは未登録です。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderVacationManagement() {
  const editing = view.editingVacationId
    ? state.long_vacations.find((vacation) => vacation.id === view.editingVacationId)
    : null;
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Vacation</p><h2>長期休暇管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-vacation" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-vacation">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>対象ホスト</span><select name="user_id">${getActiveUsers(state).map((user) => option(user.id, user.display_name, user.id === editing?.user_id)).join("")}</select></label>
        <label><span>休暇開始日</span><input name="start_date" type="date" value="${editing?.start_date || ""}" required></label>
        <label><span>休暇終了日</span><input name="end_date" type="date" value="${editing?.end_date || ""}" required></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>理由・メモ</span><input name="reason" value="${escapeAttr(editing?.reason || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>ホスト</th><th>期間</th><th>状態</th><th>理由</th><th>操作</th></tr></thead>
          <tbody>
            ${state.long_vacations.map((vacation) => `
              <tr>
                <td>${escapeHtml(findUser(state, vacation.user_id)?.display_name || "不明")}</td>
                <td>${escapeHtml(vacation.start_date)} - ${escapeHtml(vacation.end_date)}</td>
                <td>${vacation.is_active ? "有効" : "無効"}</td>
                <td>${escapeHtml(vacation.reason || "")}</td>
                <td><button class="icon-button" data-action="edit-vacation" data-vacation-id="${vacation.id}" type="button">編集</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5">長期休暇は未登録です。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderEventManagement() {
  const editing = view.editingEventId ? findEvent(state, view.editingEventId) : null;
  const fixedSchedule = hasConfiguredEventSchedule();
  const activeEvents = state.event_dates.filter((event) => !isEventArchived(event));
  const archivedCount = getArchivedEvents(state).length;
  const newDate = getNextConfiguredEventDate();
  const eventDate = editing?.event_date || newDate;
  const eventForm = fixedSchedule && !editing
    ? `<div class="notice muted">この店舗の日程は設定で固定されています。追加や日付変更はできません。変更が必要な場合は、一覧の「編集」からステータスだけ更新してください。</div>`
    : `
      <form class="form-grid" data-action="save-event">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>イベント日</span><input name="event_date" type="date" value="${eventDate}" data-role="event-date-input" ${fixedSchedule ? "readonly" : ""} required></label>
        <label><span>ステータス</span><select name="status">${EVENT_STATUSES.map((status) => option(status, status, status === (editing?.status || "受付中"))).join("")}</select></label>
        <label><span>予約解放日時</span><input name="reservation_open_at" type="datetime-local" value="${editing?.reservation_open_at || getReservationOpenAt(eventDate)}" data-role="reservation-open-input" ${fixedSchedule ? "readonly" : ""}></label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}" ${fixedSchedule ? "readonly" : ""}></label>
        <button class="primary-button" type="submit">${editing ? (fixedSchedule ? "ステータスを更新する" : "更新する") : "追加する"}</button>
      </form>
    `;
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Events</p><h2>イベント日管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-event" type="button">新規追加に戻る</button>` : ""}
      </div>
      ${eventForm}
      <div class="notice muted">終了した日付は自動でアーカイブに移動します。過去の予約は「アーカイブ」タブから確認できます。現在のアーカイブ: ${archivedCount}件</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>日付</th><th>ステータス</th><th>予約解放</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>
            ${activeEvents.map((event) => `
              <tr class="${event.status === "休み" ? "holiday-row" : ""}">
                <td>${formatDateLabel(event.event_date)}</td>
                <td>${statusPill(event.status)}</td>
                <td>${formatDateTime(event.reservation_open_at)}</td>
                <td>${escapeHtml(event.note || "")}</td>
                <td><button class="icon-button" data-action="edit-event" data-event-id="${event.id}" type="button">編集</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5">受付中または休み予定のイベント日はありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderArchive() {
  const archivedEvents = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  if (!archivedEvents.length) {
    return `
      <section class="panel page-panel">
        <div class="panel-heading">
          <div><p class="eyebrow">Archive</p><h2>アーカイブ</h2></div>
        </div>
        <p class="empty">終了済みのイベント日はまだありません。イベント日が終わると自動でここに移動します。</p>
      </section>
    `;
  }
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Archive</p>
          <h2>アーカイブ</h2>
        </div>
      </div>
      <div class="notice muted">終了したイベント日の予約を日付ごとに折りたたんで確認できます。ここでは編集せず、当日の最終予約と集計だけを見返します。</div>
      <div class="archive-list">
        ${archivedEvents.map((event) => renderArchiveItem(event)).join("")}
      </div>
    </section>
  `;
}

function renderArchiveItem(event) {
  const isOpen = view.archiveEventId === event.id;
  const reservations = getReservationsForEvent(state, event.id);
  const deletedReservations = getReservationsForEvent(state, event.id, true).filter((reservation) => reservation.is_deleted);
  const reservationRequests = getReservationRequestsForEvent(state, event.id);
  const deletedReservationRequests = getReservationRequestsForEvent(state, event.id, { includeDeleted: true }).filter((request) => request.is_deleted);
  const totalReservations = reservations.length + reservationRequests.length;
  const totalDeleted = deletedReservations.length + deletedReservationRequests.length;
  return `
    <section class="archive-item ${isOpen ? "is-open" : ""}">
      <button class="archive-toggle" data-action="toggle-archive" data-event-id="${event.id}" type="button" aria-expanded="${isOpen}">
        <span>${formatDateLabel(event.event_date)}</span>
        <strong>予約 ${totalReservations}件</strong>
        <em>${totalDeleted ? `削除履歴 ${totalDeleted}件` : "削除履歴なし"}</em>
        ${statusPill(event.status)}
      </button>
      ${isOpen ? `
        <div class="archive-body">
          <div class="split">
            <div class="mini-panel">
              <h3>予約枠</h3>
              ${renderSeatStatusList(event.id)}
            </div>
          </div>
          ${renderArchiveAttendance(event.id)}
          ${renderArchiveReservationRequests(event.id)}
          ${reservations.length ? `
            <div class="subsection">
              <h3>旧予約グリッド履歴</h3>
              ${renderReservationGrid(event.id, { adminMode: true, locked: true })}
            </div>
          ` : ""}
          ${renderDeletedReservations(deletedReservations)}
          ${renderDeletedReservationRequests(deletedReservationRequests)}
        </div>
      ` : ""}
    </section>
  `;
}

function renderArchiveAttendance(eventId) {
  const hostItems = getAttendanceEntriesForEvent(state, eventId)
    .filter((entry) => entry.status === "出勤" || entry.status === "体入")
    .map((entry) => {
      const user = findUser(state, entry.user_id);
      return {
        name: user?.display_name || entry.user_id || "不明",
        sortKey: user?.kana || user?.display_name || entry.user_id || "",
        status: entry.status,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"));
  const staffItems = getStaffAttendanceEntriesForEvent(state, eventId)
    .filter((entry) => entry.status === "出勤")
    .map((entry) => {
      const member = findStaffMember(state, entry.staff_member_id);
      return {
        name: member?.display_name || entry.staff_member_id || "不明",
        sortKey: member?.kana || member?.display_name || entry.staff_member_id || "",
        status: entry.status,
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"));

  return `
    <div class="split">
      <div class="mini-panel">
        <h3>ホスト出勤記録</h3>
        ${renderArchiveAttendanceList(hostItems, "出勤・体入のホストはいません。")}
      </div>
      <div class="mini-panel">
        <h3>内勤出勤記録</h3>
        ${renderArchiveAttendanceList(staffItems, "出勤の内勤はいません。")}
      </div>
    </div>
  `;
}

function renderArchiveAttendanceList(items, emptyText) {
  if (!items.length) return `<p class="empty">${emptyText}</p>`;
  return `<ul class="name-list">${items
    .map((item) => `<li>${escapeHtml(item.name)}<span>${escapeHtml(item.status)}</span></li>`)
    .join("")}</ul>`;
}

function renderArchiveReservationRequests(eventId) {
  const requests = getReservationRequestsForEvent(state, eventId);
  const deletedRequests = getReservationRequestsForEvent(state, eventId, { includeDeleted: true }).filter((request) => request.is_deleted);
  if (!requests.length && !deletedRequests.length) {
    return `
      <div class="subsection">
        <h3>予約アーカイブ</h3>
        <p class="empty">予約受付履歴はありません。</p>
      </div>
    `;
  }
  const buckets = getReservationRequestBuckets(state, eventId);
  return `
    <div class="subsection">
      <h3>予約アーカイブ</h3>
      ${requests.length ? `
        ${renderReservationRequestBucketsV2(buckets, false)}
        ${renderArchiveReservationRequestList(requests)}
      ` : `<p class="empty">予約受付履歴はありません。</p>`}
    </div>
  `;
}

function renderArchiveReservationRequestList(requests) {
  return `
    <div class="table-wrap request-table-wrap">
      <table class="data-table">
        <thead><tr><th>受付</th><th>担当</th><th>希望</th><th>姫 / アイバン</th><th>内容</th><th>扱い</th></tr></thead>
        <tbody>
          ${requests.map((request, index) => `
            <tr>
              <td>#${String(index + 1).padStart(3, "0")}<br>${formatHistoryDateTime(request.created_at)}</td>
              <td>${escapeHtml(getReservationPersonName(request.host_user_id))}</td>
              <td>${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)}</td>
              <td>${escapeHtml(formatReservationGuestMeta(request))}</td>
              <td>${escapeHtml(request.memo || "")}</td>
              <td>${escapeHtml(formatPlacementStatus(request.placement_status))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDeletedReservations(deletedReservations) {
  if (!deletedReservations.length) return "";
  return `
    <div class="subsection">
      <h3>削除済み予約</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>削除日時</th><th>枠</th><th>担当</th><th>姫 / アイバン</th><th>メモ</th></tr></thead>
          <tbody>
            ${deletedReservations.map((reservation) => `
              <tr>
                <td>${formatDateTime(reservation.deleted_at)}</td>
                <td>${getTimeSlotLabel(reservation.time_slot)} ${reservation.seat_type} ${reservation.group_no}</td>
                <td>${escapeHtml(getReservationPersonName(reservation.host_user_id))}</td>
                <td>${escapeHtml(formatReservationGuestMeta(reservation))}</td>
                <td>${escapeHtml(reservation.memo || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDeletedReservationRequests(deletedRequests) {
  if (!deletedRequests.length) return "";
  return `
    <div class="subsection">
      <h3>削除済み予約受付</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>削除日時</th><th>受付</th><th>担当</th><th>姫 / アイバン</th><th>内容</th><th>扱い</th></tr></thead>
          <tbody>
            ${deletedRequests.map((request, index) => `
              <tr>
                <td>${formatDateTime(request.deleted_at)}</td>
                <td>#${String(index + 1).padStart(3, "0")} / ${escapeHtml(REQUEST_TIME_SLOT_LABELS[request.desired_time_slot] || request.desired_time_slot)}</td>
                <td>${escapeHtml(getReservationPersonName(request.host_user_id))}</td>
                <td>${escapeHtml(formatReservationGuestMeta(request))}</td>
                <td>${escapeHtml(request.memo || "")}</td>
                <td>${escapeHtml(formatPlacementStatus(request.placement_status))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDiscordTools() {
  const attendanceText = generateAttendanceDiscordText(state, view.eventId);
  const reservationText = generateReservationDiscordText(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Discord</p><h2>Discord文面生成</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>未入力者催促文</h3>
          <textarea class="copy-text" data-copy-source="attendance" rows="10" readonly>${escapeHtml(attendanceText)}</textarea>
          <button class="primary-button" data-action="copy-text" data-source="attendance" type="button">コピー</button>
        </div>
        <div class="mini-panel">
          <h3>予約確認文</h3>
          <textarea class="copy-text" data-copy-source="reservation" rows="10" readonly>${escapeHtml(reservationText)}</textarea>
          <button class="primary-button" data-action="copy-text" data-source="reservation" type="button">コピー</button>
        </div>
      </div>
    </section>
  `;
}

function renderHistories() {
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">History</p><h2>変更履歴</h2></div>
      </div>
      <div class="table-wrap">
        <table class="data-table history-table">
          <thead><tr><th>日時</th><th>対象</th><th>内容</th><th>変更前</th><th>変更後</th></tr></thead>
          <tbody>
            ${state.histories.map((history) => `
              <tr>
                <td>${formatHistoryDateTime(history.changed_at)}</td>
                <td>${escapeHtml(formatHistoryTarget(history))}</td>
                <td>${escapeHtml(history.change_note || "")}</td>
                <td><span class="history-summary">${escapeHtml(summarizeHistoryPayload(history, history.before_payload))}</span></td>
                <td><span class="history-summary">${escapeHtml(summarizeHistoryPayload(history, history.after_payload))}</span></td>
              </tr>
            `).join("") || `<tr><td colspan="5">履歴はまだありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function formatHistoryDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}.${ms}`;
}

function formatHistoryTarget(history) {
  const targetType = formatHistoryTargetType(history);
  const targetDetail = formatHistoryTargetDetail(history);
  return targetDetail ? `${targetType} / ${targetDetail}` : targetType;
}

function formatHistoryTargetType(history) {
  if (history.target_type === "reservation") return "予約";
  if (history.target_type === "reservation_request") return "予約受付";
  if (history.target_type === "reservation_setting") return "予約受付設定";
  if (history.target_type === "attendance") return "ホスト勤怠";
  if (history.target_type === "staff_attendance") return "内勤勤怠";
  if (history.target_type === "event") return "イベント日";
  if (history.target_type === "user") return "ホスト";
  if (history.target_type === "staff_member") return "内勤";
  if (history.target_type === "long_vacation") return "長期休暇";
  return history.target_type;
}

function formatHistoryTargetDetail(history) {
  const payload = history.after_payload || history.before_payload || {};
  if (history.target_type === "attendance") {
    const hostName = payload.user_id ? findUser(state, payload.user_id)?.display_name || payload.user_id : "";
    const event = payload.event_date_id ? findEvent(state, payload.event_date_id) : null;
    return [hostName, event ? formatDateLabel(event.event_date) : ""].filter(Boolean).join(" / ");
  }
  if (history.target_type === "staff_attendance") {
    const staffName = payload.staff_member_id ? findStaffMember(state, payload.staff_member_id)?.display_name || payload.staff_member_id : "";
    const event = payload.event_date_id ? findEvent(state, payload.event_date_id) : null;
    return [staffName, event ? formatDateLabel(event.event_date) : ""].filter(Boolean).join(" / ");
  }
  return "";
}

function renderDataTools() {
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Data</p><h2>データ管理</h2></div>
      </div>
      ${renderSyncTools()}
      <div class="split">
        <div class="mini-panel">
          <h3>バックアップ</h3>
          <p>ブラウザの localStorage に保存されたデータをJSONで書き出します。</p>
          <button class="primary-button" data-action="export-json" type="button">JSONを書き出す</button>
        </div>
        <div class="mini-panel">
          <h3>初期化</h3>
          <p>このブラウザ内のデータを初期状態に戻します。必要な場合だけ実行してください。</p>
          <button class="danger-button" data-action="reset-data" type="button">初期データに戻す</button>
        </div>
      </div>
      <textarea class="copy-text" data-copy-source="export" rows="12" readonly></textarea>
    </section>
  `;
}

function renderSyncTools() {
  const storageMode = getStorageMode();
  const requestedMode = String(APP_CONFIG.storageMode || "local");
  const urlReady = !isPlaceholder(APP_CONFIG.supabaseUrl);
  const keyReady = !isPlaceholder(APP_CONFIG.supabaseAnonKey);
  const canSync = storageMode === "supabase";
  const statusLabel = canSync ? "共有DB有効" : requestedMode === "supabase" ? "Supabase設定不足" : "ローカル保存";
  return `
    <div class="sync-card">
      <div>
        <p class="eyebrow">Database Sync</p>
        <h3>${escapeHtml(statusLabel)}</h3>
        <p>現在: ${escapeHtml(syncStatus.text)} / Row ID: <code>${escapeHtml(STATE_ROW_ID)}</code></p>
      </div>
      <div class="sync-meta">
        <span class="${requestedMode === "supabase" ? "is-ready" : ""}">mode: ${escapeHtml(requestedMode)}</span>
        <span class="${urlReady ? "is-ready" : ""}">URL ${urlReady ? "設定済み" : "未設定"}</span>
        <span class="${keyReady ? "is-ready" : ""}">key ${keyReady ? "設定済み" : "未設定"}</span>
      </div>
      <button class="primary-button" data-action="sync-shared-state" type="button" ${canSync ? "" : "disabled"}>共有DBと再同期</button>
      ${canSync ? "" : `<p class="plan-note">Supabaseを使う場合は <code>js/config.js</code> の <code>storageMode</code>、<code>supabaseUrl</code>、<code>supabaseAnonKey</code> を設定してください。</p>`}
    </div>
  `;
}

function renderDashboardDetail() {
  const { dashboardDetailType: type, dashboardDetailKey: key } = view;
  if (!type || !key) return "";
  if (type === "hostAttendance") return renderHostAttendanceDetail(key);
  if (type === "staffAttendance") return renderStaffAttendanceDetail(key);
  if (type === "seat") return renderSeatDetail(key);
  return "";
}

function renderDashboardDetailGroup(types) {
  return types.includes(view.dashboardDetailType) ? renderDashboardDetail() : "";
}

function renderHostAttendanceDetail(status) {
  const event = findEvent(state, view.eventId);
  const title = `${event ? formatDateLabel(event.event_date) : ""} ホスト勤怠: ${status}`;
  const items = getHostAttendanceDetailItems(status);
  return renderDashboardDetailPanel(title, renderDetailList(items, "対象者はいません。"));
}

function getHostAttendanceDetailItems(status) {
  if (status === "未入力") {
    return getMissingUsers(state, view.eventId).map((user) => ({ title: user.display_name, meta: user.role || "ホスト" }));
  }
  if (status === "長期休暇") {
    return getVacationExemptUsers(state, view.eventId).map((user) => {
      const entry = getAttendanceEntry(state, view.eventId, user.id);
      return { title: user.display_name, meta: ["長期休暇中", entry ? `${entry.status}入力あり` : ""].filter(Boolean).join(" / ") };
    });
  }
  const event = findEvent(state, view.eventId);
  return getActiveUsers(state)
    .map((user) => ({ user, entry: getAttendanceEntry(state, view.eventId, user.id) }))
    .filter(({ user, entry }) => entry?.status === status && !(event && isOnVacation(state, user.id, event.event_date)))
    .map(({ user, entry }) => ({ title: user.display_name, meta: [user.role, entry.memo].filter(Boolean).join(" / ") }));
}

function renderStaffAttendanceDetail(status) {
  const event = findEvent(state, view.eventId);
  const title = `${event ? formatDateLabel(event.event_date) : ""} 内勤勤怠: ${status}`;
  const items = status === "未入力"
    ? getMissingStaffMembers(state, view.eventId).map((member) => ({ title: member.display_name, meta: member.staff_type || "内勤" }))
    : getActiveStaffMembers(state)
      .map((member) => ({ member, entry: getStaffAttendanceEntry(state, view.eventId, member.id) }))
      .filter(({ entry }) => entry?.status === status)
      .map(({ member, entry }) => ({ title: member.display_name, meta: [member.staff_type || "内勤", entry.memo].filter(Boolean).join(" / ") }));
  return renderDashboardDetailPanel(title, renderDetailList(items, "対象者はいません。"));
}

function renderSeatDetail(slotKey) {
  const [timeSlot, seatType] = slotKey.split(":");
  const reservations = getGroupLabels(seatType)
    .map((groupNo) => ({ groupNo, reservation: findReservationBySlot(state, view.eventId, timeSlot, seatType, groupNo) }))
    .filter(({ reservation }) => reservation && isReservationFilled(reservation));
  const emptyGroups = getGroupLabels(seatType)
    .filter((groupNo) => !findReservationBySlot(state, view.eventId, timeSlot, seatType, groupNo));
  const items = reservations.map(({ groupNo, reservation }) => {
    const hostName = getReservationPersonName(reservation.host_user_id);
    return {
      title: `${groupNo} ${hostName}`,
      meta: [formatReservationGuestMeta(reservation), reservation.memo].filter(Boolean).join(" / "),
    };
  });
  const body = `
    ${renderDetailList(items, "この枠の予約はまだありません。")}
    <p class="detail-note">空き枠: ${emptyGroups.length ? emptyGroups.join("、") : "なし"}</p>
  `;
  return renderDashboardDetailPanel(`予約枠: ${getTimeSlotLabel(timeSlot)} ${seatType}`, body);
}

function renderDashboardDetailPanel(title, body) {
  return `
    <section class="dashboard-detail-panel">
      <div class="section-title">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-button" data-action="dashboard-detail-clear" type="button">閉じる</button>
      </div>
      ${body}
    </section>
  `;
}

function renderDetailList(items, emptyText) {
  if (!items.length) return `<p class="empty">${emptyText}</p>`;
  return `
    <ul class="detail-list">
      ${items.map((item) => `<li><strong>${escapeHtml(item.title)}</strong>${item.meta ? `<span>${escapeHtml(item.meta)}</span>` : ""}</li>`).join("")}
    </ul>
  `;
}

function renderAttendanceSummaryCards(eventId, options = {}) {
  const summary = getAttendanceSummary(state, eventId);
  return `
    <div class="summary-grid">
      ${Object.entries(summary).map(([key, value]) => renderSummaryCard(key, value, options.detailType)).join("")}
    </div>
  `;
}

function renderStaffAttendanceSummaryCards(eventId, options = {}) {
  const summary = getStaffAttendanceSummary(state, eventId);
  return `
    <div class="summary-grid">
      ${Object.entries(summary).map(([key, value]) => renderSummaryCard(key, value, options.detailType)).join("")}
    </div>
  `;
}

function renderSummaryCard(key, value, detailType = "") {
  if (!detailType) {
    return `<div class="summary-card status-${key}"><span>${escapeHtml(key)}</span><strong>${value}</strong></div>`;
  }
  const selected = view.dashboardDetailType === detailType && view.dashboardDetailKey === key;
  const attrs = `data-action="dashboard-detail" data-detail-type="${detailType}" data-detail-key="${escapeAttr(key)}"`;
  return `<button class="summary-card dashboard-trigger status-${key} ${selected ? "is-selected" : ""}" ${attrs} type="button"><span>${escapeHtml(key)}</span><strong>${value}</strong></button>`;
}

function renderSeatStatusList(eventId, options = {}) {
  const statuses = getSeatLimitStatuses(state, eventId);
  return `<ul class="status-list">${Object.entries(statuses)
    .map(([key, item]) => {
      const selected = view.dashboardDetailType === options.detailType && view.dashboardDetailKey === key;
      const attrs = options.detailType
        ? `data-action="dashboard-detail" data-detail-type="${options.detailType}" data-detail-key="${escapeAttr(key)}"`
        : "";
      return `<li class="${item.level} dashboard-list-item ${selected ? "is-selected" : ""}" ${attrs}><span>${key.replace(":", " ")}</span><strong>${item.total} / ${item.limit}</strong><em>${item.text}</em></li>`;
    })
    .join("")}</ul>`;
}

function renderNameList(users, emptyText, suffix = "") {
  if (!users.length) return `<p class="empty">${emptyText}</p>`;
  return `<ul class="name-list">${users.map((user) => `<li>${escapeHtml(user.display_name)}${suffix ? `<span>${suffix}</span>` : ""}</li>`).join("")}</ul>`;
}

function renderEventOptions(selectedId) {
  const events = state.event_dates.filter((event) => !isEventArchived(event));
  return events
    .map((event) => option(event.id, `${formatDateLabel(event.event_date)} ${event.status === "休み" ? "休み" : ""}`, event.id === selectedId))
    .join("") || `<option value="">対象日がありません</option>`;
}

function renderArchiveEventOptions(selectedId) {
  const events = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  return events
    .map((event) => option(event.id, `${formatDateLabel(event.event_date)} ${event.status}`, event.id === selectedId))
    .join("") || `<option value="">アーカイブはまだありません</option>`;
}

function statusPill(status) {
  return `<span class="status-pill status-event-${status}">${escapeHtml(status)}</span>`;
}

function option(value, label, selected = false) {
  return `<option value="${escapeAttr(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderAttributeOptions(selectedValue, field = "attribute") {
  if (field === "ivan_attribute") {
    const selected = IVAN_ATTRIBUTES.includes(selectedValue) ? selectedValue : IVAN_ATTRIBUTE;
    return IVAN_ATTRIBUTES.map((attribute) => option(attribute, attribute, attribute === selected)).join("");
  }
  return option(RESERVATION_ATTRIBUTE, RESERVATION_ATTRIBUTE, true);
}

function getReservationPersonOptions(selectedId = "") {
  const people = [
    ...getActiveUsers(state).map((user) => ({ id: user.id, label: user.display_name })),
  ];
  if (selectedId && !people.some((person) => person.id === selectedId)) {
    const user = findUser(state, selectedId);
    if (user) people.push({ id: user.id, label: `${user.display_name}（無効）` });
  }
  return people;
}

function getReservationPersonName(personId) {
  if (!personId) return "未選択";
  const user = findUser(state, personId);
  if (user) return user.display_name;
  const staffMember = findStaffMember(state, personId);
  if (staffMember) return `${staffMember.display_name}（内勤）`;
  return personId;
}

function syncReservationAttributeControls(container) {
  const personField = container?.querySelector("[data-role='reservation-person-select']");
  if (!personField) return;
  container.querySelectorAll("[data-role='reservation-attribute-select']").forEach((select) => {
    if (select.name === "ivan_attribute" || select.dataset.field === "ivan_attribute") {
      select.value = IVAN_ATTRIBUTES.includes(select.value) ? select.value : IVAN_ATTRIBUTE;
      return;
    }
    select.value = RESERVATION_ATTRIBUTE;
  });
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "navigate") {
    view.page = button.dataset.page;
    render();
    return;
  }
  if (action === "admin-tab") {
    view.adminTab = button.dataset.tab;
    render();
    return;
  }
  if (action === "reservation-tab") {
    view.reservationTab = button.dataset.tab;
    render();
    return;
  }
  if (action === "dashboard-detail") {
    const same = view.dashboardDetailType === button.dataset.detailType && view.dashboardDetailKey === button.dataset.detailKey;
    view.dashboardDetailType = same ? "" : button.dataset.detailType;
    view.dashboardDetailKey = same ? "" : button.dataset.detailKey;
    render();
    return;
  }
  if (action === "dashboard-detail-clear") {
    view.dashboardDetailType = "";
    view.dashboardDetailKey = "";
    render();
    return;
  }
  if (action === "admin-logout") {
    adminUnlocked = false;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    render();
    return;
  }
  if (action === "toggle-archive") {
    view.archiveEventId = view.archiveEventId === button.dataset.eventId ? "" : button.dataset.eventId;
    render();
    return;
  }
  if (action === "save-reservation") saveReservationFromRow(button);
  if (action === "delete-reservation") deleteReservationFromRow(button);
  if (action === "edit-reservation-request") {
    view.editingReservationRequestId = button.dataset.requestId || "";
    render();
    window.setTimeout(() => root.querySelector(".reservation-request-form")?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
    return;
  }
  if (action === "new-reservation-request") {
    view.editingReservationRequestId = "";
    render();
    return;
  }
  if (action === "delete-reservation-request") deleteReservationRequestFromButton(button);
  if (action === "request-placement") setReservationRequestPlacementFromButton(button);
  if (action === "admin-save-attendance") saveAdminAttendance(button);
  if (action === "admin-save-staff-attendance") saveAdminStaffAttendance(button);
  if (action === "edit-user") {
    view.editingUserId = button.dataset.userId;
    render();
  }
  if (action === "edit-staff-member") {
    view.editingStaffMemberId = button.dataset.staffMemberId;
    render();
  }
  if (action === "disable-staff-member") {
    disableStaffMemberFromButton(button);
    return;
  }
  if (action === "enable-staff-member") {
    const result = setStaffMemberActive(state, button.dataset.staffMemberId, true);
    applyResult(result, "内勤を有効化しました。");
    return;
  }
  if (action === "disable-user") {
    disableUserFromButton(button);
    return;
  }
  if (action === "enable-user") {
    const result = setUserActive(state, button.dataset.userId, true);
    applyResult(result, "ホストを有効化しました。");
    return;
  }
  if (action === "delete-role") {
    deleteRoleFromButton(button);
    return;
  }
  if (action === "new-user") {
    view.editingUserId = "";
    render();
  }
  if (action === "new-staff-member") {
    view.editingStaffMemberId = "";
    render();
  }
  if (action === "edit-vacation") {
    view.editingVacationId = button.dataset.vacationId;
    render();
  }
  if (action === "new-vacation") {
    view.editingVacationId = "";
    render();
  }
  if (action === "edit-event") {
    view.editingEventId = button.dataset.eventId;
    render();
  }
  if (action === "new-event") {
    view.editingEventId = "";
    render();
  }
  if (action === "copy-text") copyText(button.dataset.source);
  if (action === "export-json") exportJson();
  if (action === "reset-data") resetData();
  if (action === "sync-shared-state") syncSharedStateNow();
}

function disableUserFromButton(button) {
  const user = findUser(state, button.dataset.userId);
  if (!user) {
    showToast("対象ホストが見つかりません。", "error");
    return;
  }
  const ok = window.confirm(`${user.display_name} を無効化します。入力候補と未入力判定から外れます。過去の予約履歴には名前が残ります。`);
  if (!ok) return;
  const result = setUserActive(state, user.id, false);
  if (result.ok && view.editingUserId === user.id) view.editingUserId = "";
  applyResult(result, "ホストを無効化しました。");
}

function deleteRoleFromButton(button) {
  const roleName = button.dataset.roleName || "";
  const affectedUsers = (state.users || []).filter((user) => user.role === roleName);
  const message = affectedUsers.length
    ? `${roleName} を削除します。このタグのホスト ${affectedUsers.length}人は「ホスト」に戻ります。`
    : `${roleName} を削除します。`;
  if (!window.confirm(message)) return;
  const result = deleteRole(state, roleName);
  applyResult(result, "タグを削除しました。");
}

function disableStaffMemberFromButton(button) {
  const staffMember = state.staff_members.find((member) => member.id === button.dataset.staffMemberId);
  if (!staffMember) {
    showToast("対象内勤が見つかりません。", "error");
    return;
  }
  const ok = window.confirm(`${staffMember.display_name} を無効化します。内勤出勤の入力候補と未入力判定から外れます。過去の出勤履歴には名前が残ります。`);
  if (!ok) return;
  const result = setStaffMemberActive(state, staffMember.id, false);
  if (result.ok && view.editingStaffMemberId === staffMember.id) view.editingStaffMemberId = "";
  applyResult(result, "内勤を無効化しました。");
}

function handleSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const data = Object.fromEntries(new FormData(form).entries());

  if (action === "save-attendance") {
    const result = upsertAttendance(state, data);
    applyResult(result, "勤怠を保存しました。");
  }
  if (action === "save-bulk-attendance") {
    saveBulkAttendance(form);
    return;
  }
  if (action === "save-staff-attendance") {
    const result = upsertStaffAttendance(state, data);
    applyResult(result, "内勤出勤を保存しました。");
  }
  if (action === "save-bulk-staff-attendance") {
    saveBulkStaffAttendance(form);
    return;
  }
  if (action === "save-reservation-request") {
    const payload = {
      ...data,
      no_same_time_double_booking: false,
    };
    const result = upsertReservationRequest(state, payload, { admin: view.page === "admin" });
    if (result.ok) {
      form.reset();
      view.editingReservationRequestId = "";
    }
    applyResult(result, "予約受付に登録しました。");
    return;
  }
  if (action === "save-reservation-request-setting") {
    const result = upsertReservationSetting(state, data);
    applyResult(result, "予約受付設定を保存しました。");
    return;
  }
  if (action === "site-login") {
    const store = getStoreLoginMatch(data.password);
    if (store) {
      switchStore(store.key, { keepAdmin: false, message: `${store.brandName}を表示しました。` });
      return;
    }
    if (isAdminPassword(data.password)) {
      siteUnlocked = true;
      adminUnlocked = true;
      sessionStorage.setItem(SITE_SESSION_KEY, "1");
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      showToast("サイトと運営画面を表示しました。");
      render();
    } else {
      showToast("パスワードが違います。", "error");
    }
    return;
  }
  if (action === "admin-login") {
    if (isAdminPassword(data.password)) {
      adminUnlocked = true;
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      showToast("運営画面を表示しました。");
      render();
    } else {
      showToast("パスワードが違います。", "error");
    }
  }
  if (action === "save-user") {
    const result = upsertUser(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingUserId = "";
    applyResult(result, "ホスト情報を保存しました。");
  }
  if (action === "save-staff-member") {
    const result = upsertStaffMember(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingStaffMemberId = "";
    applyResult(result, "内勤情報を保存しました。");
  }
  if (action === "save-role") {
    const result = upsertRole(state, { name: data.name, is_active: true });
    applyResult(result, "タグを保存しました。");
  }
  if (action === "save-vacation") {
    const result = upsertVacation(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingVacationId = "";
    applyResult(result, "長期休暇を保存しました。");
  }
  if (action === "save-event") {
    const existing = data.id ? findEvent(state, data.id) : null;
    if (hasConfiguredEventSchedule() && !existing) {
      showToast("固定日程のためイベント日は追加できません。", "error");
      return;
    }
    const payload = hasConfiguredEventSchedule()
      ? {
        ...data,
        event_date: existing.event_date,
        reservation_open_at: existing.reservation_open_at,
        note: existing.note || "",
      }
      : data;
    const result = upsertEvent(state, payload);
    if (result.ok) {
      view.editingEventId = "";
      view.eventId = result.event.id;
    }
    applyResult(result, "イベント日を保存しました。");
  }
}

function saveBulkAttendance(form) {
  const formData = new FormData(form);
  const userId = String(formData.get("user_id") || "");
  const eventIds = formData.getAll("attendance_event_id").map(String);
  const selectedCount = eventIds.filter((eventId) => formData.get(`status_${eventId}`)).length;
  let nextState = state;
  let savedCount = 0;
  const errors = [];
  if (!userId) {
    showToast("ホスト名を選択してください。", "error");
    return;
  }
  if (!selectedCount) {
    showToast("出欠を選択してください。", "error");
    return;
  }
  const user = findUser(state, userId);
  const ok = window.confirm(`${user?.display_name || "選択中のホスト"} として ${selectedCount}日分の勤怠を保存します。名前は間違いありませんか？`);
  if (!ok) return;
  view.attendanceUserId = userId;
  for (const eventId of eventIds) {
    const status = formData.get(`status_${eventId}`);
    if (!status) continue;
    const result = upsertAttendance(nextState, {
      event_date_id: eventId,
      user_id: userId,
      status,
      memo: formData.get(`memo_${eventId}`) || "",
    });
    if (!result.ok) {
      errors.push(...(result.errors || ["保存できませんでした。"]));
      continue;
    }
    nextState = result.state;
    savedCount += 1;
  }
  if (errors.length) {
    showToast(errors.join(" / "), "error");
    return;
  }
  saveState(nextState, `${savedCount}日分の勤怠を保存しました。`);
}

function saveBulkStaffAttendance(form) {
  const formData = new FormData(form);
  const staffMemberId = String(formData.get("staff_member_id") || "");
  const eventIds = formData.getAll("attendance_event_id").map(String);
  const selectedCount = eventIds.filter((eventId) => formData.get(`status_${eventId}`)).length;
  let nextState = state;
  let savedCount = 0;
  const errors = [];
  if (!staffMemberId) {
    showToast("内勤名を選択してください。", "error");
    return;
  }
  if (!selectedCount) {
    showToast("出欠を選択してください。", "error");
    return;
  }
  const staffMember = findStaffMember(state, staffMemberId);
  const ok = window.confirm(`${staffMember?.display_name || "選択中の内勤"} として ${selectedCount}日分の内勤出勤を保存します。名前は間違いありませんか？`);
  if (!ok) return;
  view.staffAttendanceMemberId = staffMemberId;
  for (const eventId of eventIds) {
    const status = formData.get(`status_${eventId}`);
    if (!status) continue;
    const result = upsertStaffAttendance(nextState, {
      event_date_id: eventId,
      staff_member_id: staffMemberId,
      status,
      memo: formData.get(`memo_${eventId}`) || "",
    });
    if (!result.ok) {
      errors.push(...(result.errors || ["保存できませんでした。"]));
      continue;
    }
    nextState = result.state;
    savedCount += 1;
  }
  if (errors.length) {
    showToast(errors.join(" / "), "error");
    return;
  }
  saveState(nextState, `${savedCount}日分の内勤出勤を保存しました。`);
}

function handleChange(event) {
  const eventSelect = event.target.closest("[data-role='event-select']");
  if (eventSelect) {
    view.eventId = eventSelect.value;
    view.editingReservationRequestId = "";
    render();
    return;
  }
  const archiveEventSelect = event.target.closest("[data-role='archive-event-select']");
  if (archiveEventSelect) {
    view.archiveEventId = archiveEventSelect.value;
    render();
    return;
  }
  const storeSelect = event.target.closest("[data-role='store-select']");
  if (storeSelect) {
    switchStore(storeSelect.value, { keepAdmin: true, message: `${findStoreConfig(storeSelect.value)?.brandName || "店舗"}に切り替えました。` });
    return;
  }
  const attendanceUser = event.target.closest("[data-role='attendance-user-select']");
  if (attendanceUser) {
    view.attendanceUserId = attendanceUser.value;
    render();
    return;
  }
  const staffAttendanceMember = event.target.closest("[data-role='staff-attendance-member-select']");
  if (staffAttendanceMember) {
    view.staffAttendanceMemberId = staffAttendanceMember.value;
    render();
    return;
  }
  const reservationPerson = event.target.closest("[data-role='reservation-person-select']");
  if (reservationPerson) {
    syncReservationAttributeControls(reservationPerson.closest("form") || reservationPerson.closest(".slot-row"));
    return;
  }
  const eventDateInput = event.target.closest("[data-role='event-date-input']");
  if (eventDateInput) {
    const form = eventDateInput.closest("form");
    const openInput = form?.querySelector("[data-role='reservation-open-input']");
    if (openInput && eventDateInput.value) openInput.value = getReservationOpenAt(eventDateInput.value);
  }
}

async function saveReservationFromRow(button) {
  const row = button.closest(".slot-row");
  const payload = reservationPayloadFromRow(row);
  const adminMode = view.page === "admin";
  button.disabled = true;
  try {
    if (syncStatus.mode === "supabase") {
      const result = await saveReservationToSharedState(payload, adminMode);
      if (!result.ok) {
        showToast((result.errors || ["予約を保存できませんでした。"]).join(" / "), "error");
        return;
      }
      state = result.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
      showToast(result.warnings?.length ? `予約を保存しました。確認: ${result.warnings.join(" / ")}` : "予約を保存しました。");
      render();
      return;
    }
    const result = upsertReservation(state, payload, { admin: adminMode, strictDuplicate: true });
    applyResult(result, result.warnings?.length ? `予約を保存しました。確認: ${result.warnings.join(" / ")}` : "予約を保存しました。");
  } catch (error) {
    console.error(error);
    syncStatus = { mode: "error", text: shortSyncError(error, "共有DBへの保存に失敗") };
    showToast("共有DBへの保存に失敗しました。再読み込みして確認してください。", "error");
    render();
  } finally {
    button.disabled = false;
  }
}

async function saveReservationToSharedState(payload, adminMode) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await loadSharedRecord();
    const latestState = record.state ? migrateState(record.state) : migrateState(state);
    const conflict = getReservationSaveConflict(latestState, payload);
    if (conflict) {
      state = latestState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      return {
        ok: false,
        state: latestState,
        errors: [formatReservationConflictMessage(conflict)],
      };
    }
    const result = upsertReservation(latestState, payload, { admin: adminMode, strictDuplicate: true });
    if (!result.ok) return result;
    const normalizedResultState = migrateState(result.state);
    try {
      await saveSharedState(normalizedResultState, { expectedUpdatedAt: record.updatedAt });
      return { ...result, state: normalizedResultState };
    } catch (error) {
      if (error.code === "STALE_SHARED_STATE") continue;
      throw error;
    }
  }
  const record = await loadSharedRecord();
  const latestState = record.state ? migrateState(record.state) : migrateState(state);
  state = latestState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  return {
    ok: false,
    state: latestState,
    errors: ["他の端末で先に更新されました。最新状態を読み込みました。もう一度確認してください。"],
  };
}

function formatReservationConflictMessage(conflict) {
  const reservation = conflict.reservation;
  const summary = summarizeReservationPayload(reservation);
  if (conflict.type === "stale") {
    return `この予約は他の端末で先に変更されています。最新状態を読み込みました: ${summary}`;
  }
  return `この枠は既に登録されています。最新状態を読み込みました: ${summary}`;
}

function deleteReservationFromRow(button) {
  const row = button.closest(".slot-row");
  const reservation = findReservationBySlot(state, row.dataset.eventId, row.dataset.timeSlot, row.dataset.seatType, row.dataset.groupNo);
  const reservationId = row.dataset.reservationId || reservation?.id || "";
  if (!reservationId) {
    showToast("削除する予約がありません。", "error");
    return;
  }
  const result = deleteReservation(state, reservationId);
  applyResult(result, "予約を削除しました。");
}

function deleteReservationRequestFromButton(button) {
  const requestId = button.dataset.requestId;
  if (!requestId) {
    showToast("削除する予約受付がありません。", "error");
    return;
  }
  const ok = window.confirm("この予約受付を削除します。続行しますか？");
  if (!ok) return;
  const result = deleteReservationRequest(state, requestId);
  if (result.ok && view.editingReservationRequestId === requestId) view.editingReservationRequestId = "";
  applyResult(result, "予約受付を削除しました。");
}

function setReservationRequestPlacementFromButton(button) {
  const requestId = button.dataset.requestId;
  const placementStatus = button.dataset.placementStatus || "auto";
  const result = setReservationRequestPlacement(state, requestId, placementStatus);
  applyResult(result, "予約受付の扱いを変更しました。");
}

function reservationPayloadFromRow(row) {
  const payload = {
    id: row.dataset.reservationId || "",
    event_date_id: row.dataset.eventId,
    time_slot: row.dataset.timeSlot,
    seat_type: row.dataset.seatType,
    group_no: row.dataset.groupNo,
  };
  row.querySelectorAll("[data-field]").forEach((field) => {
    payload[field.dataset.field] = field.value;
  });
  return {
    ...normalizeReservation(payload),
    base_updated_at: row.dataset.reservationUpdatedAt || "",
  };
}

function saveAdminAttendance(button) {
  const tr = button.closest("tr");
  const payload = {
    event_date_id: view.eventId,
    user_id: button.dataset.userId,
    status: tr.querySelector("[data-field='status']").value,
    memo: tr.querySelector("[data-field='memo']").value,
  };
  const result = upsertAttendance(state, payload);
  applyResult(result, "勤怠を保存しました。");
}

function saveAdminStaffAttendance(button) {
  const tr = button.closest("tr");
  const payload = {
    event_date_id: view.eventId,
    staff_member_id: button.dataset.staffMemberId,
    status: tr.querySelector("[data-field='status']").value,
    memo: tr.querySelector("[data-field='memo']").value,
  };
  const result = upsertStaffAttendance(state, payload);
  applyResult(result, "内勤出勤を保存しました。");
}

function applyResult(result, successMessage) {
  if (!result.ok) {
    showToast((result.errors || ["保存できませんでした。"]).join(" / "), "error");
    return;
  }
  saveState(result.state, successMessage);
}

async function copyText(source) {
  const textarea = root.querySelector(`[data-copy-source="${source}"]`);
  if (!textarea) return;
  textarea.select();
  try {
    await navigator.clipboard.writeText(textarea.value);
    showToast("コピーしました。");
  } catch {
    document.execCommand("copy");
    showToast("コピーしました。");
  }
}

function exportJson() {
  const textarea = root.querySelector("[data-copy-source='export']");
  textarea.value = JSON.stringify(state, null, 2);
  textarea.select();
  showToast("JSONを書き出しました。");
}

function resetData() {
  const ok = window.confirm("このブラウザ内のデータを初期化します。続行しますか？");
  if (!ok) return;
  state = buildDefaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  view.eventId = getDefaultEventId();
  showToast("初期データに戻しました。");
  render();
}

async function syncSharedStateNow() {
  if (getStorageMode() !== "supabase") {
    syncStatus = getInitialSyncStatus();
    showToast("Supabase URL/key が未設定です。", "error");
    render();
    return;
  }
  syncStatus = { mode: "supabase", text: "共有DBと再同期中" };
  render();
  try {
    const localState = migrateState(state);
    const record = await loadSharedRecord();
    const remoteState = record.state ? migrateState(record.state) : null;
    const mergedState = remoteState ? migrateState(mergeSharedState(remoteState, localState)) : localState;
    state = mergedState;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    await saveSharedStateWithRetry(state, record.updatedAt);
    localStorage.removeItem(PENDING_LOCAL_CHANGES_KEY);
    syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
    showToast("共有DBと再同期しました。");
  } catch (error) {
    console.error(error);
    syncStatus = { mode: "error", text: shortSyncError(error, "共有DBとの再同期に失敗") };
    showToast("共有DBとの再同期に失敗しました。", "error");
  }
  render();
}

function summarizeHistoryPayload(history, payload) {
  if (history?.target_type === "reservation") return summarizeReservationPayload(payload);
  return summarizePayload(payload);
}

function summarizeReservationPayload(payload) {
  if (!payload) return "-";
  const event = findEvent(state, payload.event_date_id);
  const slot = [event ? formatDateLabel(event.event_date) : "", getTimeSlotLabel(payload.time_slot), payload.seat_type, payload.group_no]
    .filter(Boolean)
    .join(" ");
  const hostName = payload.host_user_id ? getReservationPersonName(payload.host_user_id) : "未選択";
  return [
    slot,
    `担当: ${hostName}`,
    formatReservationGuestMeta(payload),
    payload.memo ? `メモ: ${payload.memo}` : "",
    payload.is_deleted ? "削除済み" : "",
  ].filter(Boolean).join(" / ");
}

function summarizePayload(payload) {
  if (!payload) return "-";
  const copy = clone(payload);
  const keys = [
    "display_name",
    "staff_type",
    "event_date",
    "status",
    "memo",
    "time_slot",
    "seat_type",
    "group_no",
    "host_user_id",
    "desired_time_slot",
    "normal_capacity",
    "ivan_capacity",
    "placement_status",
    "princess_name",
    "attribute",
    "ivan_name",
    "ivan_attribute",
    "is_deleted",
  ];
  const picked = {};
  for (const key of keys) {
    if (copy[key] !== undefined && copy[key] !== "") picked[key] = copy[key];
  }
  return JSON.stringify(picked);
}

function showToast(message, type = "success") {
  toastRoot.textContent = message;
  toastRoot.className = `toast is-visible ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toastRoot.className = "toast";
  }, 3000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
