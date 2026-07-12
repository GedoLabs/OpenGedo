import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './data-dir.mjs';

/**
 * Append-only analytics event log (P0 write-amplification fix).
 *
 * The beacon endpoint is public and unauthenticated; when events lived inside
 * store.json every landing-page visit rewrote the ENTIRE store. Events now go
 * to monthly JSONL files under data/analytics/ via appendFileSync — O(row)
 * instead of O(store), and never contended with business writes.
 *
 *   data/analytics/events-YYYY-MM.jsonl
 *
 * Consumers: Store().addAnalyticsEvent / listAnalyticsEventsSince delegate
 * here, so the beacon route and admin-console dashboards are unchanged.
 * A torn final line from a crash mid-append is tolerated (reader skips
 * unparseable lines). Retention matches the old behaviour: 180 days.
 */

const ANALYTICS_DIR = path.join(DATA_DIR, 'analytics');
const RETENTION_DAYS = 180;
const PRUNE_INTERVAL_MS = 6 * 3600 * 1000;

let _lastPrune = 0;

function ensureDir() {
  if (!fs.existsSync(ANALYTICS_DIR)) fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
}

function monthOf(iso) {
  return String(iso).slice(0, 7); // YYYY-MM
}

function fileForMonth(month) {
  return path.join(ANALYTICS_DIR, `events-${month}.jsonl`);
}

/** Drop whole monthly files that end before the retention cutoff. */
function pruneOldFiles(now = Date.now()) {
  if (now - _lastPrune < PRUNE_INTERVAL_MS) return;
  _lastPrune = now;
  const cutoffMonth = monthOf(new Date(now - RETENTION_DAYS * 24 * 3600 * 1000).toISOString());
  let entries;
  try { entries = fs.readdirSync(ANALYTICS_DIR); } catch { return; }
  for (const name of entries) {
    const m = name.match(/^events-(\d{4}-\d{2})\.jsonl$/);
    if (m && m[1] < cutoffMonth) {
      try { fs.unlinkSync(path.join(ANALYTICS_DIR, name)); } catch { /* best effort */ }
    }
  }
}

/** Append one event row. Row must already carry id/ts (Store() builds it). */
export function appendAnalyticsEvent(row) {
  ensureDir();
  fs.appendFileSync(fileForMonth(monthOf(row.ts)), JSON.stringify(row) + '\n', 'utf8');
  pruneOldFiles();
}

/**
 * All events with ts >= sinceIso (or everything in retention when omitted),
 * ascending by insertion order. Dedupes by id — insurance against a re-run
 * of the store.json migration ever double-appending.
 */
export function listAnalyticsEventsSince(sinceIso) {
  let entries;
  try { entries = fs.readdirSync(ANALYTICS_DIR); } catch { return []; }
  const sinceMonth = sinceIso ? monthOf(sinceIso) : null;
  const files = entries
    .map((name) => name.match(/^events-(\d{4}-\d{2})\.jsonl$/))
    .filter(Boolean)
    .map((m) => m[1])
    .filter((month) => !sinceMonth || month >= sinceMonth)
    .sort();

  const rows = [];
  const seen = new Set();
  for (const month of files) {
    let raw;
    try { raw = fs.readFileSync(fileForMonth(month), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; } // torn/corrupt line
      if (!e || (sinceIso && e.ts < sinceIso)) continue;
      if (e.id) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
      }
      rows.push(e);
    }
  }
  return rows;
}

/** True once the legacy store.json array has been drained to JSONL. */
export function isMigrated() {
  return fs.existsSync(path.join(ANALYTICS_DIR, '.migrated'));
}

/** One-shot import of the legacy store.json rows; caller clears the array. */
export function migrateLegacyRows(rows) {
  ensureDir();
  let count = 0;
  const byMonth = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.ts) continue;
    const month = monthOf(row.ts);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(JSON.stringify(row));
    count += 1;
  }
  for (const [month, lines] of byMonth) {
    fs.appendFileSync(fileForMonth(month), lines.join('\n') + '\n', 'utf8');
  }
  fs.writeFileSync(path.join(ANALYTICS_DIR, '.migrated'), new Date().toISOString(), 'utf8');
  return count;
}

export default { appendAnalyticsEvent, listAnalyticsEventsSince, isMigrated, migrateLegacyRows };
