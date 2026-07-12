/**
 * MemoryStore factory (P0.5)
 *
 * Single entry point for business code to obtain the memory store:
 *
 *   import { getMemoryStore } from '../memory/store/index.mjs';
 *   const store = getMemoryStore();
 *   const profile = store.getProfile(userId);
 *
 * Returns a process-wide singleton. Today it is always FileMemoryStore.
 * When PgMemoryStore lands, selection becomes:
 *
 *   MEMORY_STORE=postgres  → PgMemoryStore (requires a live db handle)
 *   otherwise              → FileMemoryStore
 *
 * Keeping selection here means swapping the backing store is a one-place change
 * with zero churn in the ~dozen business modules that consume the interface.
 */

import { FileMemoryStore } from './FileMemoryStore.mjs';

let _instance = null;

/**
 * @returns {import('./MemoryStore.mjs').MemoryStore}
 */
export function getMemoryStore() {
  if (_instance) return _instance;

  // Future: const backend = process.env.MEMORY_STORE || 'file';
  // if (backend === 'postgres') { _instance = new PgMemoryStore(...); }
  _instance = new FileMemoryStore();
  return _instance;
}

/** Test/diagnostics helper: reset the singleton (e.g. to inject a stub adapter). */
export function _setMemoryStore(instance) {
  _instance = instance;
}

export { MemoryStore } from './MemoryStore.mjs';
export { FileMemoryStore } from './FileMemoryStore.mjs';
export default { getMemoryStore, _setMemoryStore };
