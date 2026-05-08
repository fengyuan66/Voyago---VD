import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(import.meta.dirname, "data");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");
const USER_PROFILES_PATH = path.join(DATA_DIR, "userProfiles.json");
const CATALOG_SYNC_PATH = path.join(DATA_DIR, "catalogSync.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonOrDefault(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export function loadCatalog() {
  return readJsonOrDefault(CATALOG_PATH, []);
}

export function saveCatalog(catalog) {
  writeJson(CATALOG_PATH, catalog);
}

export function loadUserProfiles() {
  return readJsonOrDefault(USER_PROFILES_PATH, {});
}

export function saveUserProfiles(profiles) {
  writeJson(USER_PROFILES_PATH, profiles);
}

export function loadCatalogSyncState() {
  return readJsonOrDefault(CATALOG_SYNC_PATH, {
    sourcePath: null,
    lastSignature: null,
    lastImportAt: null,
    lastAttemptAt: null,
    lastImportError: null,
    lastImportedCount: 0,
    lastReason: null,
    status: "never_synced",
  });
}

export function saveCatalogSyncState(state) {
  writeJson(CATALOG_SYNC_PATH, state);
}
