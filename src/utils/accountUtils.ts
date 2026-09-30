import { XtreamCredentials } from '../types';
import { normalizeServerUrl } from './mediaUtils';

export const LEGACY_FAVORITES_KEY = 'northcode_tv_favorites';
export const LEGACY_CREDENTIALS_KEY = 'northcode_tv_credentials';
export const MIGRATION_STATUS_KEY = 'nc_favs_migration_status';

export const V2_KEY_PREFIX = 'nc_favs_v2_';
export const OLD_KEY_PREFIX = 'nc_favs_';

export interface MigrationStatus {
  status: 'unmigrated' | 'migrated' | 'unassigned' | 'imported' | 'pending_import';
  preExistingAccountKey?: string;
  assignedAccountKey?: string;
  migratedAt?: number;
  importedAt?: number;
  attemptedAt?: number;
}

/**
 * Derives an unambiguous, collision-free local account key.
 * Serializes the tuple [normalizedServerUrl, effectiveUsername] as JSON,
 * then URI encodes it with a versioned prefix 'nc_favs_v2_'.
 *
 * Rules:
 * - serverUrl is normalized via normalizeServerUrl (handles protocol, trailing slashes, etc.)
 * - username is trimmed, preserving original casing (Server A + user A != Server A + user a)
 * - password, list name, avatar, or session tokens do NOT alter identity
 * - Returns "" if serverUrl or username is missing/empty
 */
export function getAccountKey(
  serverUrl?: string | null,
  username?: string | null
): string {
  if (!serverUrl || !username) return '';

  const normServer = normalizeServerUrl(serverUrl);
  const cleanUser = username.trim();

  if (!normServer || !cleanUser) return '';

  const tupleJson = JSON.stringify([normServer, cleanUser]);
  return `${V2_KEY_PREFIX}${encodeURIComponent(tupleJson)}`;
}

/**
 * Computes the legacy v1 account key formula for backward compatibility check
 */
export function getOldAccountKey(
  serverUrl?: string | null,
  username?: string | null
): string {
  if (!serverUrl || !username) return '';

  const normServer = normalizeServerUrl(serverUrl);
  const cleanUser = username.trim();

  if (!normServer || !cleanUser) return '';

  return `${OLD_KEY_PREFIX}${encodeURIComponent(normServer)}_${encodeURIComponent(cleanUser)}`;
}

/**
 * Safely reads raw string from localStorage without throwing
 */
export function safeGetStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    console.warn(`[safeGetStorage] Error reading key "${key}":`, e);
    return null;
  }
}

/**
 * Safely writes string to localStorage without throwing
 */
export function safeSetStorage(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.error(`[safeSetStorage] Error writing key "${key}":`, e);
    return false;
  }
}

/**
 * Reads migration status object safely
 */
export function getMigrationStatus(): MigrationStatus {
  const raw = safeGetStorage(MIGRATION_STATUS_KEY);
  if (!raw) return { status: 'unmigrated' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.status) {
      return parsed;
    }
  } catch (e) {
    console.warn('[getMigrationStatus] Corrupt status JSON:', e);
  }
  return { status: 'unmigrated' };
}

/**
 * Checks whether an old key string (e.g. nc_favs_http%3A%2F%2Fprovider.test%2Fbase_a_b)
 * is ambiguous (i.e. can be split into multiple valid [serverUrl, username] tuples).
 */
export function isOldKeyAmbiguous(oldKey: string): boolean {
  if (!oldKey.startsWith(OLD_KEY_PREFIX) || oldKey.startsWith(V2_KEY_PREFIX)) {
    return false;
  }

  const payload = oldKey.slice(OLD_KEY_PREFIX.length);
  if (!payload.includes('_')) return false;

  let validSplitCount = 0;
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === '_') {
      const part1 = payload.slice(0, i);
      const part2 = payload.slice(i + 1);

      try {
        const server = decodeURIComponent(part1);
        const user = decodeURIComponent(part2);

        // Check if server is valid URL and user is non-empty
        if (
          (server.startsWith('http://') || server.startsWith('https://')) &&
          user.trim().length > 0
        ) {
          validSplitCount++;
        }
      } catch {
        // ignore decode errors
      }
    }
  }

  return validSplitCount > 1;
}

/**
 * Checks if ambiguous old keys exist for the current active account
 */
export function hasAmbiguousOldKeyFavorites(serverUrl?: string | null, username?: string | null): boolean {
  if (!serverUrl || !username) return false;
  const oldKey = getOldAccountKey(serverUrl, username);
  const rawOld = safeGetStorage(oldKey);
  if (!rawOld) return false;

  try {
    const parsed = JSON.parse(rawOld);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
  } catch {
    return false;
  }

  return isOldKeyAmbiguous(oldKey);
}

/**
 * Checks if unassigned legacy global favorites exist and can be imported explicitly
 */
export function hasUnassignedLegacyFavorites(): boolean {
  const status = getMigrationStatus();
  if (status.status === 'migrated' || status.status === 'imported') {
    return false;
  }
  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (!rawLegacy) return false;

  try {
    const parsedLegacy = JSON.parse(rawLegacy);
    return Array.isArray(parsedLegacy) && parsedLegacy.length > 0;
  } catch {
    return false;
  }
}

/**
 * Initializes migration status on app load.
 * Must run BEFORE any new login overwrites LEGACY_CREDENTIALS_KEY!
 */
export function initializeLegacyMigrationStatus(): void {
  if (typeof window === 'undefined') return;

  const currentStatus = getMigrationStatus();
  if (currentStatus.status !== 'unmigrated') {
    return; // Migration status already determined
  }

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (!rawLegacy) return;

  try {
    const parsedLegacy = JSON.parse(rawLegacy);
    if (!Array.isArray(parsedLegacy) || parsedLegacy.length === 0) {
      return;
    }
  } catch {
    return;
  }

  // Check if credentials ALREADY existed in localStorage at app startup
  const rawCreds = safeGetStorage(LEGACY_CREDENTIALS_KEY);
  if (rawCreds) {
    try {
      const creds: XtreamCredentials = JSON.parse(rawCreds);
      const preExistingKey = getAccountKey(creds.serverUrl, creds.username);
      if (preExistingKey) {
        safeSetStorage(
          MIGRATION_STATUS_KEY,
          JSON.stringify({
            status: 'unmigrated',
            preExistingAccountKey: preExistingKey,
          })
        );
        return;
      }
    } catch {
      // ignore
    }
  }

  // No pre-existing credentials at app startup -> mark legacy as unassigned
  safeSetStorage(
    MIGRATION_STATUS_KEY,
    JSON.stringify({
      status: 'unassigned',
    })
  );
}

/**
 * Bootstraps initial migration for pre-existing account.
 */
export function bootstrapLegacyMigration(activeAccountKey?: string): void {
  if (typeof window === 'undefined') return;

  const currentStatus = getMigrationStatus();

  if (currentStatus.status === 'unmigrated' && currentStatus.preExistingAccountKey) {
    const targetKey = currentStatus.preExistingAccountKey;

    if (activeAccountKey && activeAccountKey !== targetKey) {
      return; // Only the pre-existing account can auto-receive the legacy
    }

    const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
    if (!rawLegacy) return;

    try {
      const parsedLegacy = JSON.parse(rawLegacy);
      if (!Array.isArray(parsedLegacy) || parsedLegacy.length === 0) return;
    } catch {
      return;
    }

    // Save data to target key first
    const existingTarget = safeGetStorage(targetKey);
    let ok = true;
    if (!existingTarget) {
      ok = safeSetStorage(targetKey, rawLegacy);
    }

    if (ok) {
      const newStatus: MigrationStatus = {
        status: 'migrated',
        assignedAccountKey: targetKey,
        migratedAt: Date.now(),
      };
      safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(newStatus));
    }
  }
}

/**
 * Migrates unambiguous old v1 key (nc_favs_...) to v2 key (nc_favs_v2_...)
 */
export function migrateOldKeyToV2(
  serverUrl?: string | null,
  username?: string | null
): boolean {
  if (!serverUrl || !username) return false;

  const keyV2 = getAccountKey(serverUrl, username);
  const oldKey = getOldAccountKey(serverUrl, username);

  if (!keyV2 || !oldKey) return false;

  // If keyV2 already exists, migration for this account is done
  const existingV2 = safeGetStorage(keyV2);
  if (existingV2 !== null) {
    return true;
  }

  const rawOld = safeGetStorage(oldKey);
  if (!rawOld) return false;

  let oldItems: any[] = [];
  try {
    const parsed = JSON.parse(rawOld);
    if (Array.isArray(parsed) && parsed.length > 0) {
      oldItems = parsed;
    } else {
      return false;
    }
  } catch {
    return false;
  }

  // If old key is ambiguous, do NOT auto-migrate!
  if (isOldKeyAmbiguous(oldKey)) {
    return false;
  }

  // Unambiguous old key -> copy to V2
  return safeSetStorage(keyV2, JSON.stringify(oldItems));
}

export interface ImportResult {
  success: boolean;
  reason?: 'invalid_key' | 'no_legacy' | 'corrupt_legacy' | 'corrupt_target' | 'already_assigned' | 'storage_failure';
  importedCount: number;
}

/**
 * Explicit user-triggered import of unassigned legacy favorites into active account.
 * Follows failure-resilient ordering:
 * 1. Validate destination list. If JSON malformed, refuse overwrite.
 * 2. Record pending status first. If saving pending status fails, abort.
 * 3. Copy/merge data. If saving target fails, abort.
 * 4. Record imported status.
 */
export function importUnassignedLegacyToAccount(accountKey: string): ImportResult {
  if (!accountKey) return { success: false, reason: 'invalid_key', importedCount: 0 };

  const status = getMigrationStatus();
  if (
    (status.status === 'imported' || status.status === 'migrated') &&
    status.assignedAccountKey &&
    status.assignedAccountKey !== accountKey
  ) {
    return { success: false, reason: 'already_assigned', importedCount: 0 };
  }

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (!rawLegacy) return { success: false, reason: 'no_legacy', importedCount: 0 };

  let legacyItems: any[] = [];
  try {
    const parsed = JSON.parse(rawLegacy);
    if (Array.isArray(parsed) && parsed.length > 0) {
      legacyItems = parsed;
    } else {
      return { success: false, reason: 'no_legacy', importedCount: 0 };
    }
  } catch {
    return { success: false, reason: 'corrupt_legacy', importedCount: 0 };
  }

  // Check destination target list
  let targetItems: any[] = [];
  const rawTarget = safeGetStorage(accountKey);
  if (rawTarget !== null && rawTarget.trim() !== '') {
    try {
      const parsedTarget = JSON.parse(rawTarget);
      if (Array.isArray(parsedTarget)) {
        targetItems = parsedTarget;
      } else {
        return { success: false, reason: 'corrupt_target', importedCount: 0 };
      }
    } catch {
      // Malformed destination JSON! Keep raw value intact and refuse overwrite
      return { success: false, reason: 'corrupt_target', importedCount: 0 };
    }
  }

  // 1. Durable pending status write
  const pendingStatus: MigrationStatus = {
    status: 'pending_import',
    assignedAccountKey: accountKey,
    attemptedAt: Date.now(),
  };
  const savedPending = safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(pendingStatus));
  if (!savedPending) {
    return { success: false, reason: 'storage_failure', importedCount: 0 };
  }

  // 2. Deduplicate and merge legacy items
  let addedCount = 0;
  const merged = [...targetItems];

  for (const item of legacyItems) {
    if (!item || item.id === undefined || !item.type) continue;
    const exists = merged.some(
      (existing) =>
        String(existing.id) === String(item.id) && existing.type === item.type
    );
    if (!exists) {
      merged.push(item);
      addedCount++;
    }
  }

  // 3. Write merged list
  const savedTarget = safeSetStorage(accountKey, JSON.stringify(merged));
  if (!savedTarget) {
    return { success: false, reason: 'storage_failure', importedCount: 0 };
  }

  // 4. Record imported status
  const finalStatus: MigrationStatus = {
    status: 'imported',
    assignedAccountKey: accountKey,
    importedAt: Date.now(),
  };
  const savedFinal = safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(finalStatus));
  if (!savedFinal) {
    return { success: false, reason: 'storage_failure', importedCount: 0 };
  }

  return { success: true, importedCount: addedCount };
}

/**
 * Explicit user-triggered import of ambiguous old v1 key into active v2 account
 */
export function importAmbiguousOldKeyToAccount(
  serverUrl: string,
  username: string
): ImportResult {
  const keyV2 = getAccountKey(serverUrl, username);
  const oldKey = getOldAccountKey(serverUrl, username);

  if (!keyV2 || !oldKey) return { success: false, reason: 'invalid_key', importedCount: 0 };

  const rawOld = safeGetStorage(oldKey);
  if (!rawOld) return { success: false, reason: 'no_legacy', importedCount: 0 };

  let oldItems: any[] = [];
  try {
    const parsed = JSON.parse(rawOld);
    if (Array.isArray(parsed)) {
      oldItems = parsed;
    }
  } catch {
    return { success: false, reason: 'corrupt_legacy', importedCount: 0 };
  }

  let targetItems: any[] = [];
  const rawTarget = safeGetStorage(keyV2);
  if (rawTarget !== null && rawTarget.trim() !== '') {
    try {
      const parsedTarget = JSON.parse(rawTarget);
      if (Array.isArray(parsedTarget)) {
        targetItems = parsedTarget;
      } else {
        return { success: false, reason: 'corrupt_target', importedCount: 0 };
      }
    } catch {
      return { success: false, reason: 'corrupt_target', importedCount: 0 };
    }
  }

  let addedCount = 0;
  const merged = [...targetItems];

  for (const item of oldItems) {
    if (!item || item.id === undefined || !item.type) continue;
    const exists = merged.some(
      (existing) =>
        String(existing.id) === String(item.id) && existing.type === item.type
    );
    if (!exists) {
      merged.push(item);
      addedCount++;
    }
  }

  const savedTarget = safeSetStorage(keyV2, JSON.stringify(merged));
  if (!savedTarget) {
    return { success: false, reason: 'storage_failure', importedCount: 0 };
  }

  return { success: true, importedCount: addedCount };
}
