const ACTIVE_MODE_KEY = "siteforge-active-mode";
const BOOTSTRAP_STATE_KEY = "siteforge-app-bootstrap";

export const STORAGE_KEYS = {
  demo: {
    state: "siteforge-app-demo",
    files: "siteforge-files-demo",
  },
  real: {
    state: "siteforge-app-real",
    files: "siteforge-files-real",
  },
};

export const LEGACY_KEYS = ["siteforge-v6-enterprise-demo", "siteforge-v5-enterprise-demo"];

export function getActiveMode() {
  if (typeof window === "undefined") return "blank";
  const mode = window.localStorage.getItem(ACTIVE_MODE_KEY);
  return mode === "demo" || mode === "real" ? mode : "blank";
}

export function setActiveMode(mode) {
  if (typeof window === "undefined") return;
  if (mode !== "demo" && mode !== "real" && mode !== "blank") return;
  if (mode === "blank") {
    window.localStorage.removeItem(ACTIVE_MODE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_MODE_KEY, mode);
}

export function getStateStorageKey(mode = getActiveMode()) {
  if (mode === "demo") return STORAGE_KEYS.demo.state;
  if (mode === "real") return STORAGE_KEYS.real.state;
  return null;
}

export function getFilesStorageKey(mode = getActiveMode()) {
  if (mode === "demo") return STORAGE_KEYS.demo.files;
  if (mode === "real") return STORAGE_KEYS.real.files;
  return null;
}

export function detectLegacyMode() {
  if (typeof window === "undefined") return null;
  for (const key of LEGACY_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      return parsed?.org?.mode === "demo" ? "demo" : "real";
    } catch (error) {
      console.warn("Failed to inspect legacy SiteForge storage", error);
    }
  }
  return null;
}

export function getInitialStateStorageKey() {
  const activeMode = getActiveMode();
  return getStateStorageKey(activeMode) || getStateStorageKey(detectLegacyMode()) || BOOTSTRAP_STATE_KEY;
}

export function storageSlotExists(mode) {
  const key = getStateStorageKey(mode);
  if (!key || typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(key));
}

export function readStateSlot(mode) {
  const key = getStateStorageKey(mode);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(`Failed to read ${mode} SiteForge state slot`, error);
    return null;
  }
}

export function writeStateSlot(mode, value) {
  const key = getStateStorageKey(mode);
  if (!key || typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to write ${mode} SiteForge state slot`, error);
    return false;
  }
}

export function clearStateSlot(mode) {
  const key = getStateStorageKey(mode);
  if (!key || typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}
