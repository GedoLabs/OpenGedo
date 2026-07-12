/**
 * 来源库（Source Store）— 记忆导入中心的"原始数据层"。
 *
 * 每个来源 = 用户提供的一份外部资料（文件 / 网页链接 / 粘贴文本 / AI 平台导出），
 * 管线：收集 → 保存原始数据 → 转化（清洗+分块+本地嵌入）→ 提取候选 → 用户确认。
 * 本模块只负责持久化与状态流转；解析/提取在 source-pipeline.service，
 * 配额检查在路由层（memory/ 不得依赖 billing，见 GEDO_KERNEL_ARCHITECTURE 边界）。
 *
 * 磁盘布局（与 canonical 记忆文件存储同构，随用户隔离，GMP 导出可整体打包）：
 *   data/memories/{user_id}/sources/{source_id}/
 *     meta.json    – 下方 schema（可变状态：status/progress/stats/error）
 *     raw.bin      – 原始字节（上传文件/导出 zip；url、text 类型无此文件）
 *     text.txt     – 清洗后正文（转化产物，供再提取与人工核查）
 *     chunks.jsonl – 每行 { i, text, embedding?, meta? }（RAG 原始层，二期接检索）
 */

import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../lib/fs-atomic.mjs';
import { randomId, nowIso } from '../lib/crypto.mjs';
import { dataPath } from '../lib/data-dir.mjs';

const DATA_DIR = dataPath('memories');

export const SOURCE_TYPES = ['file', 'url', 'text', 'chat_export'];
export const SOURCE_PLATFORMS = ['chatgpt', 'claude', 'gemini', 'kimi', 'doubao', 'deepseek', 'generic'];
export const SOURCE_STATUSES = ['queued', 'fetching', 'parsing', 'extracting', 'review', 'done', 'failed', 'canceled'];
/** 处理尚未终结的状态（列表轮询、启动恢复都以此判断）。 */
export const ACTIVE_SOURCE_STATUSES = new Set(['queued', 'fetching', 'parsing', 'extracting']);

function sourcesDir(userId) {
  return path.join(DATA_DIR, userId, 'sources');
}

function sourceDir(userId, sourceId) {
  return path.join(sourcesDir(userId), sourceId);
}

function metaPath(userId, sourceId) {
  return path.join(sourceDir(userId, sourceId), 'meta.json');
}

export function rawPath(userId, sourceId) {
  return path.join(sourceDir(userId, sourceId), 'raw.bin');
}

function textPath(userId, sourceId) {
  return path.join(sourceDir(userId, sourceId), 'text.txt');
}

function chunksPath(userId, sourceId) {
  return path.join(sourceDir(userId, sourceId), 'chunks.jsonl');
}

function readMeta(userId, sourceId) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(userId, sourceId), 'utf8'));
  } catch {
    return null;
  }
}

function writeMeta(userId, sourceId, meta) {
  writeJsonAtomic(metaPath(userId, sourceId), meta);
}

/**
 * @param {string} userId
 * @param {{ type: string, platform?: string|null, title?: string, origin?: object }} fields
 * @param {Buffer|null} [rawBuffer] 原始字节（file / chat_export）
 */
export function createSource(userId, fields, rawBuffer = null) {
  const id = `src_${randomId()}`;
  const dir = sourceDir(userId, id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    id,
    user_id: userId,
    type: SOURCE_TYPES.includes(fields.type) ? fields.type : 'file',
    platform: SOURCE_PLATFORMS.includes(fields.platform) ? fields.platform : null,
    title: String(fields.title || '').slice(0, 160) || null,
    origin: fields.origin || {},
    status: 'queued',
    progress: { chunks_done: 0, chunks_total: 0, candidates_created: 0, entities_suggested: 0 },
    stats: { char_count: 0, chunk_count: 0, conv_count: 0, accepted: 0, rejected: 0 },
    error: null,
    job_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (rawBuffer && rawBuffer.length) fs.writeFileSync(rawPath(userId, id), rawBuffer);
  writeMeta(userId, id, meta);
  return meta;
}

export function getSource(userId, sourceId) {
  if (!/^src_[\w-]+$/.test(String(sourceId || ''))) return null;
  return readMeta(userId, sourceId);
}

/** 按创建时间倒序返回全部来源 meta（内测规模：readdir + 逐个读 meta 足够）。 */
export function listSources(userId) {
  const dir = sourcesDir(userId);
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((n) => n.startsWith('src_'));
  } catch {
    return [];
  }
  const items = [];
  for (const name of entries) {
    const meta = readMeta(userId, name);
    if (meta) items.push(meta);
  }
  return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * 浅合并更新；progress / stats / error 单独深一层合并，避免调用方每次都要带全量。
 */
export function updateSource(userId, sourceId, patch = {}) {
  const meta = readMeta(userId, sourceId);
  if (!meta) return null;
  const { progress, stats, ...rest } = patch;
  Object.assign(meta, rest);
  if (progress && typeof progress === 'object') Object.assign(meta.progress, progress);
  if (stats && typeof stats === 'object') Object.assign(meta.stats, stats);
  meta.updated_at = nowIso();
  writeMeta(userId, sourceId, meta);
  return meta;
}

/** 删除来源目录（raw/text/chunks/meta 一并清除）。候选 captures 由路由层负责清理。 */
export function deleteSource(userId, sourceId) {
  const meta = readMeta(userId, sourceId);
  if (!meta) return false;
  fs.rmSync(sourceDir(userId, sourceId), { recursive: true, force: true });
  return true;
}

export function readRaw(userId, sourceId) {
  try {
    return fs.readFileSync(rawPath(userId, sourceId));
  } catch {
    return null;
  }
}

export function saveText(userId, sourceId, text) {
  fs.writeFileSync(textPath(userId, sourceId), String(text || ''), 'utf8');
}

export function readText(userId, sourceId) {
  try {
    return fs.readFileSync(textPath(userId, sourceId), 'utf8');
  } catch {
    return null;
  }
}

/** @param {Array<{i:number,text:string,embedding?:number[]|null,meta?:object}>} chunks */
export function saveChunks(userId, sourceId, chunks) {
  const lines = chunks.map((c) => JSON.stringify(c)).join('\n');
  fs.writeFileSync(chunksPath(userId, sourceId), lines ? `${lines}\n` : '', 'utf8');
}

export function readChunks(userId, sourceId) {
  try {
    return fs.readFileSync(chunksPath(userId, sourceId), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 对外 API 形状（meta 即公开形状，这里留一层以便未来裁剪内部字段）。 */
export function toPublicSource(meta) {
  if (!meta) return null;
  const { user_id: _uid, ...pub } = meta;
  return pub;
}
