/* ==========================================================================
   profile.js — the ONLY place that reads and writes saved data
   --------------------------------------------------------------------------
   Use localStorage key "drill:profile" (v1). Also supports an in-progress
   draft "drill:onboardingDraft". Never write to cookies; server is optional.

   Wrap every localStorage call in try/catch. If blocked (private mode), keep
   data in memory for the session. If data is corrupt or has unknown version,
   restart onboarding and keep old value under "drill:profileBackup".
   ========================================================================== */

const PROFILE_KEY = 'drill:profile';
const DRAFT_KEY = 'drill:onboardingDraft';
const BACKUP_KEY = 'drill:profileBackup';
const PROFILE_VERSION = 1;

let memoryProfile = null;
let memoryDraft = null;
let storageBlocked = false;

function isLocalStorageAvailable() {
  try {
    const testKey = '__test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch (err) {
    return false;
  }
}

function getStorage() {
  return isLocalStorageAvailable() && !storageBlocked ? window.localStorage : null;
}

function readJson(key) {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return '__CORRUPT__';
  }
}

function writeJson(key, value) {
  const storage = getStorage();
  if (!storage) {
    storageBlocked = true;
    return false;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    storageBlocked = true;
    return false;
  }
}

function removeKey(key) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (err) {
    // ignore
  }
}

export function loadProfile() {
  const val = readJson(PROFILE_KEY);
  if (val === '__CORRUPT__') {
    // backup existing raw if possible
    const storage = getStorage();
    if (storage) {
      try {
        const raw = storage.getItem(PROFILE_KEY);
        if (raw) writeJson(BACKUP_KEY, { timestamp: new Date().toISOString(), raw });
      } catch (err) {
        // ignore
      }
    }
    removeKey(PROFILE_KEY);
    memoryProfile = null;
    return null;
  }
  if (!val) {
    memoryProfile = null;
    return null;
  }
  if (val.version !== PROFILE_VERSION) {
    const storage = getStorage();
    if (storage) {
      try {
        const raw = storage.getItem(PROFILE_KEY);
        if (raw) writeJson(BACKUP_KEY, { timestamp: new Date().toISOString(), raw, version: val.version });
      } catch (err) {
        // ignore
      }
    }
    removeKey(PROFILE_KEY);
    memoryProfile = null;
    return null;
  }
  memoryProfile = val;
  return val;
}

export function saveProfile(profile) {
  // validate minimal shape
  const safe = {
    version: PROFILE_VERSION,
    onboardingComplete: !!profile.onboardingComplete,
    createdAt: profile.createdAt || new Date().toISOString(),
    hero: profile.hero && profile.hero.id ? { id: profile.hero.id, name: profile.hero.name || '' } : { id: '', name: '' },
    topics: Array.isArray(profile.topics) ? profile.topics : [],
    unlockedHeroes: Array.isArray(profile.unlockedHeroes) ? profile.unlockedHeroes : [],
    heroesUsed: Array.isArray(profile.heroesUsed) ? profile.heroesUsed : [],
    guideSeen: !!profile.guideSeen,
  };
  memoryProfile = safe;
  const ok = writeJson(PROFILE_KEY, safe);
  return ok;
}

export function isOnboarded() {
  const p = loadProfile();
  return !!(p && p.onboardingComplete);
}

export function resetProfile() {
  removeKey(PROFILE_KEY);
  removeKey(DRAFT_KEY);
  memoryProfile = null;
  memoryDraft = null;
}

export function loadDraft() {
  const val = readJson(DRAFT_KEY);
  if (val === '__CORRUPT__') {
    removeKey(DRAFT_KEY);
    memoryDraft = null;
    return null;
  }
  if (!val) {
    memoryDraft = null;
    return null;
  }
  memoryDraft = val;
  return val;
}

export function saveDraft(draft) {
  memoryDraft = draft || null;
  if (draft === null || draft === undefined) {
    removeKey(DRAFT_KEY);
    return true;
  }
  return writeJson(DRAFT_KEY, draft);
}

export function clearDraft() {
  removeKey(DRAFT_KEY);
  memoryDraft = null;
}
