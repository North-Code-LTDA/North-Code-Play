// North Code Play versioning - dynamically reflects deployed commit
export const APP_VERSION = "1.3.0";

// Fallback commit from base specification if RENDER_GIT_COMMIT is not provided
const DEFAULT_COMMIT = "9fdf134fa210bc5696dacbc5411269d8bc5112fa";

function resolveCommit(): string {
  if (typeof __APP_COMMIT__ !== "undefined" && __APP_COMMIT__) {
    return __APP_COMMIT__;
  }
  if (typeof process !== "undefined" && process.env) {
    if (process.env.RENDER_GIT_COMMIT) {
      return process.env.RENDER_GIT_COMMIT;
    }
    if (process.env.GIT_COMMIT) {
      return process.env.GIT_COMMIT;
    }
  }
  return DEFAULT_COMMIT;
}

function resolveBuildTime(): string {
  if (typeof __APP_BUILD_TIME__ !== "undefined" && __APP_BUILD_TIME__) {
    return __APP_BUILD_TIME__;
  }
  return new Date().toISOString();
}

export const APP_COMMIT = resolveCommit();
export const APP_BUILD_TIME = resolveBuildTime();

if (typeof window !== "undefined") {
  (window as any).__NORTHCODE_BUILD__ = {
    version: APP_VERSION,
    commit: APP_COMMIT,
    buildTime: APP_BUILD_TIME,
  };
}
