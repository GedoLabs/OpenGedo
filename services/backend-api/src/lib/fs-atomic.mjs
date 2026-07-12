import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Atomic whole-file replace: write to a temp file in the same directory,
 * fsync, then rename over the target. A process killed mid-write can no
 * longer leave a truncated store.json / profile.json behind — readers see
 * either the old or the new content, never a partial one.
 *
 * Same-directory temp is required: rename(2) is only atomic within a
 * filesystem, and data/ may be a Docker volume mount.
 */
export function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o644);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

/** JSON convenience wrapper (2-space indent, matching existing store format). */
export function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

/**
 * Startup sweep: remove orphaned temp files left by a crash between
 * open() and rename(). Only files older than maxAgeMs are removed — a live
 * temp exists for milliseconds, but another process (admin-console shares
 * this data dir; vitest runs parallel workers) may be mid-write right now.
 */
export function cleanupTempFiles(dir, maxAgeMs = 60_000) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    if (!name.startsWith('.') || !name.endsWith('.tmp')) continue;
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch { /* best effort */ }
  }
}

export default { writeFileAtomic, writeJsonAtomic, cleanupTempFiles };
