import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every vitest run gets a throwaway data root so tests can never touch the
// real dev data/ (store.json, memories/, jobs/, uploads/ …). All on-disk
// paths resolve through src/lib/data-dir.mjs, which honours GEDO_DATA_DIR.
// The temp dir is removed in test/global-setup.mjs teardown.
const TEST_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'gedo-test-data-'));

// Main process (globalSetup teardown reads it) + workers (test.env below).
process.env.GEDO_DATA_DIR = TEST_DATA_DIR;

export default defineConfig({
  test: {
    env: { GEDO_DATA_DIR: TEST_DATA_DIR },
    globalSetup: './test/global-setup.mjs',
    setupFiles: ['./test/setup-env.mjs'],
    // All test files share ONE store.json (single TEST_DATA_DIR above) and the
    // store does non-atomic full-file read-modify-write. Running files in
    // parallel workers races those writes — one worker's writeStore clobbers
    // another's just-created data (surfaced as a flaky account-wipe count
    // assertion). Serialize test files; the suite is ~1s so the cost is nil.
    fileParallelism: false,
  },
});
