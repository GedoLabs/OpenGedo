import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Teardown for the per-run temp data dir created in vitest.config.mjs.
// Runs once in the main vitest process after all workers exit.

export function setup() {}

export function teardown() {
  const dir = process.env.GEDO_DATA_DIR;
  // Only ever delete what vitest.config.mjs itself created under the OS
  // tmpdir — never a real data dir someone pointed GEDO_DATA_DIR at.
  if (dir && dir.startsWith(path.join(os.tmpdir(), 'gedo-test-data-'))) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
