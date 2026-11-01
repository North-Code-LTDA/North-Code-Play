// North Code Play versioning - coherent across Web interface and Android Capacitor build
export const APP_VERSION = '1.3.0';
export const ANDROID_VERSION_CODE = 10300;
export const LOCAL_BUILD_COMMIT = 'local-build';

export function resolveCommit(envOverride?: Record<string, string | undefined>): string {
  const env =
    envOverride ??
    (typeof process !== 'undefined' && process.env ? (process.env as Record<string, string | undefined>) : undefined);

  if (env) {
    const envCommit =
      env.RENDER_GIT_COMMIT || env.GIT_COMMIT || env.VITE_APP_COMMIT || env.COMMIT_SHA;
    if (envCommit && envCommit.trim()) {
      return envCommit.trim();
    }
  }

  if (typeof __APP_COMMIT__ !== 'undefined' && __APP_COMMIT__ && __APP_COMMIT__.trim()) {
    return __APP_COMMIT__.trim();
  }

  return LOCAL_BUILD_COMMIT;
}

export function resolveBuildTime(): string {
  if (typeof __APP_BUILD_TIME__ !== 'undefined' && __APP_BUILD_TIME__ && __APP_BUILD_TIME__.trim()) {
    return __APP_BUILD_TIME__.trim();
  }
  return new Date().toISOString();
}

export function formatCommitShort(commit: string = APP_COMMIT): string {
  const clean = (commit || LOCAL_BUILD_COMMIT).trim();
  if (clean === LOCAL_BUILD_COMMIT || clean.startsWith('local')) {
    return clean;
  }
  return clean.length > 10 ? clean.slice(0, 7) : clean;
}

export const APP_COMMIT = resolveCommit();
export const APP_BUILD_TIME = resolveBuildTime();

if (typeof window !== 'undefined') {
  (window as any).__NORTHCODE_BUILD__ = {
    version: APP_VERSION,
    versionCode: ANDROID_VERSION_CODE,
    commit: APP_COMMIT,
    buildTime: APP_BUILD_TIME,
  };
}
