import { XtreamCredentials } from '../types';
import { normalizeServerUrl } from './mediaUtils';

export const LEGACY_FAVORITES_KEY = 'northcode_tv_favorites';
export const LEGACY_CREDENTIALS_KEY = 'northcode_tv_credentials';
export const MIGRATION_STATUS_KEY = 'nc_favs_migration_status';
export const SOURCE_REGISTRY_KEY = 'nc_favs_sources_registry';
export const SOURCE_GLOBAL_KEY = 'legacy_global:northcode_tv_favorites';

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

export interface SourceRegistryEntry {
  sourceKey: string;
  status: 'pending_import' | 'imported' | 'migrated';
  assignedAccountKey: string;
  updatedAt: number;
}

export interface FavoritesStorageEnvelope {
  schemaVersion: 1;
  items: any[];
  importedSourceKeys: string[];
}

export type InitStatusResult =
  | { type: 'already_initialized'; status: MigrationStatus }
  | { type: 'no_legacy' }
  | { type: 'initialized'; status: MigrationStatus }
  | { type: 'storage_failure'; error?: any };

/**
 * Derives an unambiguous, collision-free local account key.
 * Serializes the tuple [normalizedServerUrl, effectiveUsername] as JSON,
 * then URI encodes it with a versioned prefix 'nc_favs_v2_'.
 *
 * Rules:
 * - serverUrl is normalized via normalizeServerUrl (handles protocol, port, trailing slashes, base path)
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
 * Deterministic source identifier for a v1 storage key
 */
export function getSourceKeyForV1(oldKey: string): string {
  return `legacy_v1:${oldKey}`;
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
 * Reads source registry safely
 */
export function getSourceRegistry(): Record<string, SourceRegistryEntry> {
  const raw = safeGetStorage(SOURCE_REGISTRY_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Retrieves registry entry for a specific source key
 */
export function getSourceRegistryEntry(sourceKey: string): SourceRegistryEntry | null {
  const reg = getSourceRegistry();
  return reg[sourceKey] || null;
}

/**
 * Saves registry entry for a specific source key
 */
export function setSourceRegistryEntry(sourceKey: string, entry: SourceRegistryEntry): boolean {
  const reg = getSourceRegistry();
  reg[sourceKey] = entry;
  return safeSetStorage(SOURCE_REGISTRY_KEY, JSON.stringify(reg));
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
 * Reads favorites envelope from v2 account key, backward-compatible with legacy array format
 */
export function readAccountEnvelope(accountKey: string): {
  schemaVersion: number;
  items: any[];
  importedSourceKeys: string[];
  isMalformed: boolean;
  raw: string | null;
} {
  if (!accountKey) return { schemaVersion: 1, items: [], importedSourceKeys: [], isMalformed: false, raw: null };

  const raw = safeGetStorage(accountKey);
  if (raw === null || raw.trim() === '') {
    return { schemaVersion: 1, items: [], importedSourceKeys: [], isMalformed: false, raw };
  }

  try {
    const parsed = JSON.parse(raw);
    // Format 1: Versioned envelope
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      parsed.schemaVersion === 1
    ) {
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      const importedSourceKeys = Array.isArray(parsed.importedSourceKeys)
        ? parsed.importedSourceKeys
        : [];
      return { schemaVersion: 1, items, importedSourceKeys, isMalformed: false, raw };
    }
    // Format 2: Legacy raw array
    if (Array.isArray(parsed)) {
      return { schemaVersion: 0, items: parsed, importedSourceKeys: [], isMalformed: false, raw };
    }
    // Any other object format is considered malformed
    return { schemaVersion: 0, items: [], importedSourceKeys: [], isMalformed: true, raw };
  } catch {
    return { schemaVersion: 0, items: [], importedSourceKeys: [], isMalformed: true, raw };
  }
}

/**
 * Writes favorites envelope to v2 account key, preserving existing importedSourceKeys receipts
 */
export function writeAccountEnvelope(
  accountKey: string,
  items: any[],
  newImportedSourceKeys?: string[]
): boolean {
  if (!accountKey) return false;

  const current = readAccountEnvelope(accountKey);
  if (current.isMalformed) {
    // Refuse to overwrite malformed destination JSON!
    return false;
  }

  const mergedSourceKeys = new Set<string>(current.importedSourceKeys);
  if (newImportedSourceKeys) {
    for (const key of newImportedSourceKeys) {
      if (key) mergedSourceKeys.add(key);
    }
  }

  const envelope: FavoritesStorageEnvelope = {
    schemaVersion: 1,
    items,
    importedSourceKeys: Array.from(mergedSourceKeys),
  };

  return safeSetStorage(accountKey, JSON.stringify(envelope));
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
 * Checks if ambiguous old keys exist and can be imported into active account.
 * Rejects if already imported (provenance receipt) or reserved by another account.
 */
export function hasAmbiguousOldKeyFavorites(
  serverUrl?: string | null,
  username?: string | null,
  activeAccountKey?: string | null
): boolean {
  if (!serverUrl || !username) return false;
  const keyV2 = activeAccountKey || getAccountKey(serverUrl, username);
  const oldKey = getOldAccountKey(serverUrl, username);
  if (!keyV2 || !oldKey) return false;

  const rawOld = safeGetStorage(oldKey);
  if (!rawOld) return false;

  try {
    const parsed = JSON.parse(rawOld);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
  } catch {
    return false;
  }

  if (!isOldKeyAmbiguous(oldKey)) return false;

  const sourceKey = getSourceKeyForV1(oldKey);

  // 1. Check if this account already has the durable receipt for this source
  const targetEnvelope = readAccountEnvelope(keyV2);
  if (targetEnvelope.importedSourceKeys.includes(sourceKey)) {
    return false; // Already completed for this account
  }

  // 2. Check if reserved or imported by another account in source registry
  const entry = getSourceRegistryEntry(sourceKey);
  if (entry && entry.assignedAccountKey && entry.assignedAccountKey !== keyV2) {
    return false; // Reserved or imported by a different account
  }

  return true;
}

/**
 * Checks if unassigned legacy global favorites exist and can be imported explicitly by the active account.
 * Rejects if already imported (provenance receipt in v2 envelope) or reserved by another account.
 */
export function hasUnassignedLegacyFavorites(accountKey?: string): boolean {
  // If active account already has the durable receipt, import is completed
  if (accountKey) {
    const envelope = readAccountEnvelope(accountKey);
    if (envelope.importedSourceKeys.includes(SOURCE_GLOBAL_KEY)) {
      return false;
    }
  }

  const status = getMigrationStatus();
  if (status.status === 'migrated' || status.status === 'imported') {
    return false;
  }

  // If an import is pending, only the assigned account can resume it
  if (status.status === 'pending_import' && status.assignedAccountKey) {
    return Boolean(accountKey && accountKey === status.assignedAccountKey);
  }

  // If legacy was reserved for a pre-existing account, only that account can import it
  if (status.status === 'unmigrated' && status.preExistingAccountKey) {
    return Boolean(accountKey && accountKey === status.preExistingAccountKey);
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
 * If status is already stored in localStorage, never re-evaluate or overwrite.
 * Returns an explicit InitStatusResult.
 */
export function initializeLegacyMigrationStatus(): InitStatusResult {
  if (typeof window === 'undefined') return { type: 'no_legacy' };

  const rawStatus = safeGetStorage(MIGRATION_STATUS_KEY);
  if (rawStatus !== null) {
    return { type: 'already_initialized', status: getMigrationStatus() };
  }

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (!rawLegacy) return { type: 'no_legacy' };

  try {
    const parsedLegacy = JSON.parse(rawLegacy);
    if (!Array.isArray(parsedLegacy) || parsedLegacy.length === 0) {
      return { type: 'no_legacy' };
    }
  } catch {
    return { type: 'no_legacy' };
  }

  // Check if credentials ALREADY existed in localStorage at app startup
  const rawCreds = safeGetStorage(LEGACY_CREDENTIALS_KEY);
  if (rawCreds) {
    try {
      const creds: XtreamCredentials = JSON.parse(rawCreds);
      const preExistingKey = getAccountKey(creds.serverUrl, creds.username);
      if (preExistingKey) {
        const newStatus: MigrationStatus = {
          status: 'unmigrated',
          preExistingAccountKey: preExistingKey,
        };
        const ok = safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(newStatus));
        if (!ok) {
          return { type: 'storage_failure' };
        }
        return { type: 'initialized', status: newStatus };
      }
    } catch {
      // ignore
    }
  }

  // No pre-existing credentials at app startup -> mark legacy as unassigned
  const unassignedStatus: MigrationStatus = { status: 'unassigned' };
  const ok = safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(unassignedStatus));
  if (!ok) {
    return { type: 'storage_failure' };
  }
  return { type: 'initialized', status: unassignedStatus };
}

/**
 * Safely saves credentials to storage, protecting legacy provenance.
 * If legacy data exists and its provenance has not been durably persisted yet,
 * it attempts to persist it first. If that fails (e.g. quota), it REFUSES to overwrite
 * the existing credentials to prevent destroying pre-existing account evidence.
 */
export function safeSaveCredentials(
  fullCredentials: XtreamCredentials
): { success: boolean; error?: 'storage_failure' | 'storage_failure_protecting_legacy' } {
  if (typeof window === 'undefined') return { success: false, error: 'storage_failure' };

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  let hasLegacy = false;
  if (rawLegacy) {
    try {
      const parsed = JSON.parse(rawLegacy);
      hasLegacy = Array.isArray(parsed) && parsed.length > 0;
    } catch {
      hasLegacy = false;
    }
  }

  if (hasLegacy) {
    const rawStatus = safeGetStorage(MIGRATION_STATUS_KEY);
    if (rawStatus === null) {
      const initRes = initializeLegacyMigrationStatus();
      if (initRes.type === 'storage_failure' || safeGetStorage(MIGRATION_STATUS_KEY) === null) {
        return { success: false, error: 'storage_failure_protecting_legacy' };
      }
    }
  }

  const ok = safeSetStorage(LEGACY_CREDENTIALS_KEY, JSON.stringify(fullCredentials));
  if (!ok) {
    return { success: false, error: 'storage_failure' };
  }

  return { success: true };
}

/**
 * Safely removes credentials from storage on logout, protecting legacy provenance.
 */
export function safeRemoveCredentials(): {
  success: boolean;
  error?: 'storage_failure' | 'storage_failure_protecting_legacy';
} {
  if (typeof window === 'undefined') return { success: false, error: 'storage_failure' };

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (rawLegacy) {
    const rawStatus = safeGetStorage(MIGRATION_STATUS_KEY);
    if (rawStatus === null) {
      initializeLegacyMigrationStatus();
      if (safeGetStorage(MIGRATION_STATUS_KEY) === null) {
        return { success: false, error: 'storage_failure_protecting_legacy' };
      }
    }
  }

  try {
    window.localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
    return { success: true };
  } catch {
    return { success: false, error: 'storage_failure' };
  }
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

    let legacyItems: any[] = [];
    try {
      const parsedLegacy = JSON.parse(rawLegacy);
      if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
        legacyItems = parsedLegacy;
      } else {
        return;
      }
    } catch {
      return;
    }

    const currentEnv = readAccountEnvelope(targetKey);
    if (currentEnv.isMalformed) {
      return; // Malformed destination JSON, keep raw value intact!
    }

    // Check if receipt already exists
    if (currentEnv.importedSourceKeys.includes(SOURCE_GLOBAL_KEY)) {
      const newStatus: MigrationStatus = {
        status: 'migrated',
        assignedAccountKey: targetKey,
        migratedAt: Date.now(),
      };
      safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(newStatus));
      return;
    }

    const merged = [...currentEnv.items];
    for (const item of legacyItems) {
      if (!item || item.id === undefined || !item.type) continue;
      const exists = merged.some(
        (existing) =>
          existing && String(existing.id) === String(item.id) && existing.type === item.type
      );
      if (!exists) {
        merged.push(item);
      }
    }

    // Commit list + receipt together
    const ok = writeAccountEnvelope(targetKey, merged, [SOURCE_GLOBAL_KEY]);
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

  const sourceKey = getSourceKeyForV1(oldKey);

  // If old key is ambiguous, do NOT auto-migrate!
  if (isOldKeyAmbiguous(oldKey)) {
    return false;
  }

  const currentEnv = readAccountEnvelope(keyV2);
  if (currentEnv.isMalformed) {
    return false;
  }

  // If this source key is already in importedSourceKeys, migration is done
  if (currentEnv.importedSourceKeys.includes(sourceKey)) {
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

  const merged = [...currentEnv.items];
  for (const item of oldItems) {
    if (!item || item.id === undefined || !item.type) continue;
    const exists = merged.some(
      (existing) =>
        existing && String(existing.id) === String(item.id) && existing.type === item.type
    );
    if (!exists) {
      merged.push(item);
    }
  }

  return writeAccountEnvelope(keyV2, merged, [sourceKey]);
}

export interface ImportResult {
  success: boolean;
  reason?: 'invalid_key' | 'no_legacy' | 'corrupt_legacy' | 'corrupt_target' | 'already_assigned' | 'storage_failure';
  importedCount: number;
  auxiliaryStatusPending?: boolean;
}

/**
 * Explicit user-triggered import of unassigned legacy favorites into active account.
 * Follows failure-resilient ordering:
 * 1. Validate destination list. If JSON malformed, refuse overwrite.
 * 2. Record pending status first. If saving pending status fails, abort.
 * 3. If target envelope already contains source receipt, do NOT re-merge! Finalize auxiliary status.
 * 4. Copy/merge data and write list + source proof together in destination key.
 * 5. Record imported status in auxiliary metadata.
 */
export function importUnassignedLegacyToAccount(accountKey: string): ImportResult {
  if (!accountKey) return { success: false, reason: 'invalid_key', importedCount: 0 };

  const status = getMigrationStatus();

  // If already migrated or imported to another account
  if (
    (status.status === 'imported' || status.status === 'migrated') &&
    status.assignedAccountKey &&
    status.assignedAccountKey !== accountKey
  ) {
    return { success: false, reason: 'already_assigned', importedCount: 0 };
  }

  // If pending import has been assigned to another account
  if (
    status.status === 'pending_import' &&
    status.assignedAccountKey &&
    status.assignedAccountKey !== accountKey
  ) {
    return { success: false, reason: 'already_assigned', importedCount: 0 };
  }

  // If unmigrated legacy is reserved for a pre-existing account
  if (
    status.status === 'unmigrated' &&
    status.preExistingAccountKey &&
    status.preExistingAccountKey !== accountKey
  ) {
    return { success: false, reason: 'already_assigned', importedCount: 0 };
  }

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (!rawLegacy) return { success: false, reason: 'no_legacy', importedCount: 0 };

  let legacyItems: any[] = [];
  try {
    const parsedLegacy = JSON.parse(rawLegacy);
    if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
      legacyItems = parsedLegacy;
    } else {
      return { success: false, reason: 'no_legacy', importedCount: 0 };
    }
  } catch {
    return { success: false, reason: 'corrupt_legacy', importedCount: 0 };
  }

  // Check destination target list
  const targetEnv = readAccountEnvelope(accountKey);
  if (targetEnv.isMalformed) {
    return { success: false, reason: 'corrupt_target', importedCount: 0 };
  }

  // Check if receipt already exists in destination
  if (targetEnv.importedSourceKeys.includes(SOURCE_GLOBAL_KEY)) {
    // Finalize auxiliary status if needed
    if (status.status !== 'imported') {
      const finalStatus: MigrationStatus = {
        status: 'imported',
        assignedAccountKey: accountKey,
        importedAt: Date.now(),
      };
      safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(finalStatus));
    }
    return { success: true, importedCount: 0 };
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
  const merged = [...targetEnv.items];

  for (const item of legacyItems) {
    if (!item || item.id === undefined || !item.type) continue;
    const exists = merged.some(
      (existing) =>
        existing && String(existing.id) === String(item.id) && existing.type === item.type
    );
    if (!exists) {
      merged.push(item);
      addedCount++;
    }
  }

  // 3. Write merged list + source receipt together in destination key
  const savedTarget = writeAccountEnvelope(accountKey, merged, [SOURCE_GLOBAL_KEY]);
  if (!savedTarget) {
    return { success: false, reason: 'storage_failure', importedCount: 0 };
  }

  // 4. Record imported status in auxiliary metadata
  const finalStatus: MigrationStatus = {
    status: 'imported',
    assignedAccountKey: accountKey,
    importedAt: Date.now(),
  };
  const savedFinal = safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(finalStatus));

  // If data commit succeeded but auxiliary status failed:
  // Data import is committed! Do not report failure that would mislead UI or allow replay
  if (!savedFinal) {
    return { success: true, importedCount: addedCount, auxiliaryStatusPending: true };
  }

  return { success: true, importedCount: addedCount };
}

/**
 * Explicit user-triggered import of ambiguous old v1 key into active v2 account.
 * Commits data and source receipt together in the destination key envelope.
 */
export function importAmbiguousOldKeyToAccount(
  serverUrl: string,
  username: string
): ImportResult {
  const keyV2 = getAccountKey(serverUrl, username);
  const oldKey = getOldAccountKey(serverUrl, username);

  if (!keyV2 || !oldKey) return { success: false, reason: 'invalid_key', importedCount: 0 };

  const sourceKey = getSourceKeyForV1(oldKey);

  // Check reservation / ownership in source registry
  const entry = getSourceRegistryEntry(sourceKey);
  if (entry && entry.assignedAccountKey && entry.assignedAccountKey !== keyV2) {
    return { success: false, reason: 'already_assigned', importedCount: 0 };
  }

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

  const targetEnv = readAccountEnvelope(keyV2);
  if (targetEnv.isMalformed) {
    return { success: false, reason: 'corrupt_target', importedCount: 0 };
  }

  // If receipt already present in target envelope, do not re-add items!
  if (targetEnv.importedSourceKeys.includes(sourceKey)) {
    if (!entry || entry.status !== 'imported') {
      setSourceRegistryEntry(sourceKey, {
        sourceKey,
        status: 'imported',
        assignedAccountKey: keyV2,
        updatedAt: Date.now(),
      });
    }
    return { success: true, importedCount: 0 };
  }

  // 1. Reserve source in registry
  const reserved = setSourceRegistryEntry(sourceKey, {
    sourceKey,
    status: 'pending_import',
    assignedAccountKey: keyV2,
    updatedAt: Date.now(),
  });
  if (!reserved) {
    return { success: false, reason: 'storage_failure', importedCount: 0 };
  }

  // 2. Merge items
  let addedCount = 0;
  const merged = [...targetEnv.items];

  for (const item of oldItems) {
    if (!item || item.id === undefined || !item.type) continue;
    const exists = merged.some(
      (existing) =>
        existing && String(existing.id) === String(item.id) && existing.type === item.type
    );
    if (!exists) {
      merged.push(item);
      addedCount++;
    }
  }

  // 3. Write list + source receipt together in destination key
  const savedTarget = writeAccountEnvelope(keyV2, merged, [sourceKey]);
  if (!savedTarget) {
    return { success: false, reason: 'storage_failure', importedCount: 0 };
  }

  // 4. Update source registry status to imported
  setSourceRegistryEntry(sourceKey, {
    sourceKey,
    status: 'imported',
    assignedAccountKey: keyV2,
    updatedAt: Date.now(),
  });

  return { success: true, importedCount: addedCount };
}
