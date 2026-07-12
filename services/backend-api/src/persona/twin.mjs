/**
 * Twin 个人模型 — T0 数据地基（docs/GEDO_TWIN_LORA_PLAN.md §2/§6）
 *
 * 职责：Twin 独立同意、语料采集（聊天/上传/导入收割）、进度条统计、
 * adapter 版本注册表（状态机）。训练与服务在 T1/T2。
 *
 * 存储自包含在 data/twin/（随 data/ gitignore，不进仓库）：
 *   registry.json             adapter 注册表
 *   {uid}/samples.jsonl       写作样本原文（脱敏在数据集构造时做，保留原文以便脱敏器升级后重构）
 *   {uid}/dataset-v{n}.jsonl  SFT 数据集（twin-dataset.mjs 产出）
 *
 * 同意模型（§6）：Twin 训练同意**独立于**通用飞轮同意——范围仅限"本人语料、
 * 训练本人 adapter"。撤回 = {uid}/ 目录物理删除 + registry 标 revoked（留审计
 * 行，不留内容）。语料永不进入 Gedo Persona 公共模型训练集。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJsonAtomic } from '../lib/fs-atomic.mjs';
import { Store } from '../lib/store.mjs';
import { normalizeForDedup } from '../lib/dedup.mjs';
import { getEntitlementsForTier, normalizeTier } from '../lib/entitlements.mjs';
import { dataPath } from '../lib/data-dir.mjs';

const store = Store();

const TWIN_DIR = dataPath('twin');
const REGISTRY_FILE = path.join(TWIN_DIR, 'registry.json');

export const TWIN_CONSENT_VERSION = 'twin-consent-v1';
const MIN_ITEMS = Number(process.env.TWIN_MIN_ITEMS || 500);
const MIN_CHARS = Number(process.env.TWIN_MIN_CHARS || 50_000);
const MIN_SAMPLE_CHARS = 20;      // 单条上传样本下限
const MIN_CHAT_MSG_CHARS = 6;     // 聊天消息入语料下限
const MAX_SAMPLE_CHARS = 20_000;  // 单条样本上限（防整本书粘贴）

function userDir(userId) {
  return path.join(TWIN_DIR, String(userId));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// ── 同意 ────────────────────────────────────────────────────────────────────

export function getTwinConsent(userId) {
  const s = store.getSettings(userId) || {};
  const c = s.twin_consent;
  if (!c?.granted_at || c.revoked_at) return { granted: false };
  return { granted: true, version: c.version, granted_at: c.granted_at };
}

export function grantTwinConsent(userId) {
  store.updateSettings(userId, {
    twin_consent: { version: TWIN_CONSENT_VERSION, granted_at: new Date().toISOString() },
  });
  return { granted: true, version: TWIN_CONSENT_VERSION };
}

/** 撤回：语料与数据集物理删除；registry 标 revoked（审计行保留，内容不留）。 */
export function revokeTwinConsent(userId) {
  store.updateSettings(userId, {
    twin_consent: { version: TWIN_CONSENT_VERSION, revoked_at: new Date().toISOString() },
  });
  try {
    fs.rmSync(userDir(userId), { recursive: true, force: true });
  } catch { /* 目录不存在等同已删 */ }
  const reg = readRegistry();
  let touched = 0;
  for (const job of reg) {
    if (job.user_id === String(userId) && job.status !== 'revoked') {
      job.status = 'revoked';
      job.revoked_at = new Date().toISOString();
      job.artifact_path = null;
      job.dataset_path = null;
      touched++;
    }
  }
  if (touched) writeRegistry(reg);
  return { granted: false, revoked: true, jobs_revoked: touched };
}

function assertConsent(userId) {
  if (!getTwinConsent(userId).granted) {
    const e = new Error('twin consent required');
    e.code = 'TWIN_CONSENT_REQUIRED';
    throw e;
  }
}

// ── 语料：写作样本（上传 / 导入收割）────────────────────────────────────────

export function addTwinSample(userId, text, source = 'upload') {
  assertConsent(userId);
  const clean = String(text || '').trim();
  if (clean.length < MIN_SAMPLE_CHARS) {
    const e = new Error(`sample too short (<${MIN_SAMPLE_CHARS} chars)`);
    e.code = 'TWIN_SAMPLE_TOO_SHORT';
    throw e;
  }
  const dir = userDir(userId);
  ensureDir(dir);
  const record = { ts: new Date().toISOString(), source, text: clean.slice(0, MAX_SAMPLE_CHARS) };
  fs.appendFileSync(path.join(dir, 'samples.jsonl'), JSON.stringify(record) + '\n');
  return { added: true, chars: record.text.length };
}

export function listTwinSamples(userId) {
  const f = path.join(userDir(userId), 'samples.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * 导入收割钩子（memory-import 调用）：导入的外部对话里"我: "开头的行
 * 是分身风格的一手语料。未签 Twin 同意时静默跳过。
 */
export function harvestImportedUserTurns(userId, convText, { maxPerConv = 50 } = {}) {
  if (!getTwinConsent(userId).granted) return 0;
  const turns = String(convText || '')
    .split('\n')
    .filter(l => l.startsWith('我: '))
    .map(l => l.slice(3).trim())
    .filter(t => t.length >= MIN_CHAT_MSG_CHARS + 4)
    .slice(0, maxPerConv);
  let added = 0;
  for (const t of turns) {
    try {
      addTwinSample(userId, t, 'import');
      added++;
    } catch { /* 短句跳过 */ }
  }
  return added;
}

// ── 语料：汇总采集与进度条 ──────────────────────────────────────────────────

/**
 * 采集全部授权语料（只取用户本人的话，绝不取 AI 回复——那是别的模型的声音）。
 * @returns {{ items: Array<{source:string,text:string,ctx:string|null,ts:string|null}> }}
 */
export function collectCorpus(userId) {
  assertConsent(userId);
  const seen = new Set();
  const items = [];

  const push = (source, text, ctx = null, ts = null) => {
    const clean = String(text || '').trim();
    if (clean.length < MIN_CHAT_MSG_CHARS) return;
    const key = normalizeForDedup(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({ source, text: clean, ctx, ts });
  };

  // 1) 聊天历史：用户消息 +（供 SFT 重建用的）上一条 AI 消息作为语境
  for (const conv of store.listConversations(userId) || []) {
    const msgs = store.getConversationMessages(conv.id) || [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role !== 'user' || typeof m.content !== 'string') continue;
      const prev = msgs[i - 1];
      const ctx = prev && prev.role === 'assistant' && typeof prev.content === 'string'
        ? prev.content.slice(0, 500)
        : null;
      push('chat', m.content, ctx, m.created_at || null);
    }
  }

  // 2) 写作样本（上传 + 导入收割）
  for (const s of listTwinSamples(userId)) push(s.source || 'upload', s.text, null, s.ts);

  return { items };
}

/** 进度条统计（不需要同意也可查看——展示"开通后会怎样"）。 */
export function corpusStats(userId) {
  const consent = getTwinConsent(userId);
  let items = [];
  if (consent.granted) {
    try { items = collectCorpus(userId).items; } catch { items = []; }
  }
  const chars = items.reduce((a, b) => a + b.text.length, 0);
  const avgLen = items.length ? chars / items.length : 0;
  // 风格熵启发式：全是"好的/嗯"学不出风格
  const styleOk = items.length === 0 ? false : avgLen >= 10;
  const eligible = consent.granted && styleOk && (items.length >= MIN_ITEMS || chars >= MIN_CHARS);

  const actions = [];
  if (!consent.granted) actions.push('grant_consent');
  if (items.length < MIN_ITEMS && chars < MIN_CHARS) actions.push('chat_more', 'import_history', 'upload_samples');
  if (consent.granted && !styleOk && items.length > 0) actions.push('upload_samples');

  return {
    consent,
    items: items.length,
    chars,
    thresholds: { min_items: MIN_ITEMS, min_chars: MIN_CHARS },
    progress: Math.min(1, Math.max(items.length / MIN_ITEMS, chars / MIN_CHARS)),
    style_ok: styleOk,
    eligible,
    actions,
  };
}

// ── Adapter 注册表（状态机：queued → training → gating → active | failed | revoked）──

export function readRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); } catch { return []; }
}

function writeRegistry(reg) {
  ensureDir(TWIN_DIR);
  writeJsonAtomic(REGISTRY_FILE, reg);
}

export function createTwinJob(userId, patch = {}) {
  const reg = readRegistry();
  const versions = reg.filter(j => j.user_id === String(userId)).map(j => j.version || 0);
  const version = (versions.length ? Math.max(...versions) : 0) + 1;
  const job = {
    id: crypto.randomUUID(),
    user_id: String(userId),
    adapter: `twin-${userId}-v${version}`,
    version,
    base_model_version: patch.base_model_version || process.env.GEDO_LLM_MODEL || 'unknown',
    dataset_hash: patch.dataset_hash || null,
    dataset_path: patch.dataset_path || null,
    artifact_path: null,
    status: 'queued',
    metrics: patch.metrics || {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  reg.push(job);
  writeRegistry(reg);
  return job;
}

export function updateTwinJob(jobId, patch = {}) {
  const reg = readRegistry();
  const job = reg.find(j => j.id === jobId);
  if (!job) return null;
  Object.assign(job, patch, { updated_at: new Date().toISOString() });
  writeRegistry(reg);
  return job;
}

export function listTwinJobs(userId) {
  return readRegistry().filter(j => j.user_id === String(userId));
}

export function activeTwin(userId) {
  return listTwinJobs(userId).find(j => j.status === 'active') || null;
}

// ── 状态聚合（进度条 API 的响应体）─────────────────────────────────────────

export function twinStatus(userId, tier = 'free') {
  const ent = getEntitlementsForTier(normalizeTier(tier));
  const jobs = listTwinJobs(userId);
  return {
    entitled: !!ent.personaTwinLora,
    corpus: corpusStats(userId),
    active: activeTwin(userId),
    jobs: jobs.map(({ id, adapter, version, status, base_model_version, created_at, updated_at }) =>
      ({ id, adapter, version, status, base_model_version, created_at, updated_at })),
  };
}

export default {
  TWIN_CONSENT_VERSION,
  getTwinConsent, grantTwinConsent, revokeTwinConsent,
  addTwinSample, listTwinSamples, harvestImportedUserTurns,
  collectCorpus, corpusStats,
  createTwinJob, updateTwinJob, listTwinJobs, activeTwin, readRegistry,
  twinStatus,
};
