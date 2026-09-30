import { XtreamCredentials } from '../types';
import { normalizeServerUrl } from './mediaUtils';

export const LEGACY_FAVORITES_KEY = 'northcode_tv_favorites';
export const LEGACY_CREDENTIALS_KEY = 'northcode_tv_credentials';
export const MIGRATION_STATUS_KEY = 'nc_favs_migration_status';

export interface MigrationStatus {
  status: 'unmigrated' | 'migrated' | 'unassigned' | 'imported';
  assignedAccountKey?: string;
  migratedAt?: number;
}

/**
 * Derives a stable, collision-free local account key from serverUrl and username.
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

  // Encode tuple to avoid concatenation collisions
  return `nc_favs_${encodeURIComponent(normServer)}_${encodeURIComponent(cleanUser)}`;
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
 * Checks if unassigned legacy favorites exist and can be imported explicitly
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
 * Bootstraps initial migration for pre-existing credentials.
 * If pre-existing credentials were already saved in localStorage AND legacy favorites exist,
 * automatically links legacy favorites to that specific pre-existing account.
 * If legacy favorites exist BUT no pre-existing credentials were stored, marks as unassigned.
 */
export function bootstrapLegacyMigration(): void {
  if (typeof window === 'undefined') return;

  const currentStatus = getMigrationStatus();
  if (currentStatus.status !== 'unmigrated') {
    return; // Migration already handled
  }

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (!rawLegacy) return;

  try {
    const parsedLegacy = JSON.parse(rawLegacy);
    if (!Array.isArray(parsedLegacy) || parsedLegacy.length === 0) {
      return;
    }
  } catch {
    // Corrupt legacy JSON is preserved as-is, status left unmigrated
    return;
  }

  // Check if pre-existing credentials existed prior to bootstrap
  const rawPreExistingCreds = safeGetStorage(LEGACY_CREDENTIALS_KEY);
  if (rawPreExistingCreds) {
    try {
      const creds: XtreamCredentials = JSON.parse(rawPreExistingCreds);
      const preExistingAccountKey = getAccountKey(creds.serverUrl, creds.username);

      if (preExistingAccountKey) {
        // Copy legacy array to pre-existing account key if account key doesn't already have favorites
        const existingAccountFavs = safeGetStorage(preExistingAccountKey);
        if (!existingAccountFavs) {
          safeSetStorage(preExistingAccountKey, rawLegacy);
        }

        const newStatus: MigrationStatus = {
          status: 'migrated',
          assignedAccountKey: preExistingAccountKey,
          migratedAt: Date.now(),
        };
        safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(newStatus));
        return;
      }
    } catch {
      // ignore
    }
  }

  // Legacy exists but no pre-existing saved credentials were found -> Mark as unassigned
  const unassignedStatus: MigrationStatus = {
    status: 'unassigned',
  };
  safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(unassignedStatus));
}

/**
 * Explicit user-triggered import of unassigned legacy favorites into active account
 */
export function importUnassignedLegacyToAccount(accountKey: string): {
  success: boolean;
  importedCount: number;
} {
  if (!accountKey) return { success: false, importedCount: 0 };

  const rawLegacy = safeGetStorage(LEGACY_FAVORITES_KEY);
  if (!rawLegacy) return { success: false, importedCount: 0 };

  let legacyItems: any[] = [];
  try {
    const parsed = JSON.parse(rawLegacy);
    if (Array.isArray(parsed)) {
      legacyItems = parsed;
    }
  } catch {
    return { success: false, importedCount: 0 };
  }

  if (legacyItems.length === 0) {
    return { success: false, importedCount: 0 };
  }

  // Read current target account favorites
  let currentFavs: any[] = [];
  const rawTarget = safeGetStorage(accountKey);
  if (rawTarget) {
    try {
      const parsedTarget = JSON.parse(rawTarget);
      if (Array.isArray(parsedTarget)) {
        currentFavs = parsedTarget;
      }
    } catch {
      // Preserve corrupt account target string
    }
  }

  // Merge legacy items without duplicating type + id
  let addedCount = 0;
  const merged = [...currentFavs];

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

  const savedTarget = safeSetStorage(accountKey, JSON.stringify(merged));
  if (!savedTarget) {
    return { success: false, importedCount: 0 };
  }

  // Mark migration status as imported
  const newStatus: MigrationStatus = {
    status: 'imported',
    assignedAccountKey: accountKey,
    migratedAt: Date.now(),
  };
  safeSetStorage(MIGRATION_STATUS_KEY, JSON.stringify(newStatus));

  return { success: true, importedCount: addedCount };
}
