export const APP_VERSION = "1.2.0";
export const APP_COMMIT = "ab98f4cdfac3a41b3d993867ecbe99e3bc1e874c";
export const APP_BUILD_TIME = "2026-09-28T06:15:00Z";

if (typeof window !== "undefined") {
  (window as any).__NORTHCODE_BUILD__ = {
    version: APP_VERSION,
    commit: APP_COMMIT,
    buildTime: APP_BUILD_TIME,
  };
}
