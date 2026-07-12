#!/usr/bin/env node
/**
 * db/migrate.mjs — 顺序执行 migrations/ 目录下的 SQL 文件
 *
 * 用法：
 *   node db/migrate.mjs              # 执行全部 up migrations
 *   node db/migrate.mjs --rollback   # 执行全部 down migrations（逆序）
 *   node db/migrate.mjs --dry-run    # 只打印 SQL，不执行
 *
 * 依赖：DATABASE_URL 环境变量（如不设置，打印 SQL 后退出）
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const isRollback = process.argv.includes('--rollback');
const isDryRun   = process.argv.includes('--dry-run');

// Collect migration files
const allFiles = fs.readdirSync(MIGRATIONS_DIR).sort();
const upFiles   = allFiles.filter(f => f.endsWith('.sql') && !f.endsWith('_down.sql'));
const downFiles = allFiles.filter(f => f.endsWith('_down.sql')).reverse();
const targets   = isRollback ? downFiles : upFiles;

if (targets.length === 0) {
  console.log('No migration files found.');
  process.exit(0);
}

console.log(`\n[migrate] mode=${isRollback ? 'rollback' : 'up'} dry-run=${isDryRun}`);
console.log(`[migrate] ${targets.length} files:\n  ${targets.join('\n  ')}\n`);

if (isDryRun || !process.env.DATABASE_URL) {
  if (!process.env.DATABASE_URL) {
    console.warn('[migrate] DATABASE_URL not set — printing SQL only\n');
  }
  for (const file of targets) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`-- ========== ${file} ==========`);
    console.log(sql);
  }
  process.exit(0);
}

// Execute against real DB
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let ok = 0, failed = 0;
for (const file of targets) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  console.log(`[migrate] running ${file} …`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`[migrate] ✓ ${file}`);
    ok++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[migrate] ✗ ${file}:`, err.message);
    failed++;
    if (!isRollback) break; // stop on first up-migration failure
  }
}

await client.end();
console.log(`\n[migrate] done: ${ok} ok, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
