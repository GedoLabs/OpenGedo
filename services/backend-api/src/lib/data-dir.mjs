import path from 'node:path';

/**
 * Single source of truth for the on-disk data root (store.json, memories/,
 * jobs/, uploads/, twin/, shadow/, analytics/ …).
 *
 * Env-overridable via GEDO_DATA_DIR so a second process (e.g. the standalone
 * admin-console) can point at the same store, and so vitest can point every
 * test run at a throwaway temp dir (see vitest.config.mjs). Falls back to the
 * historical cwd/data location so existing deployments are unaffected.
 *
 * Resolved once at import time — set the env var before importing anything
 * that touches the data dir.
 */
export const DATA_DIR = process.env.GEDO_DATA_DIR
  ? path.resolve(process.env.GEDO_DATA_DIR)
  : path.join(process.cwd(), 'data');

/** Resolve a path under the data root, e.g. dataPath('memories', userId). */
export function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}
