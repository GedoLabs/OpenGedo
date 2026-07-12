/**
 * S2 影子模式 — Gedo Persona 成熟度数据采集
 * （docs/GEDO_PERSONA_ROLLOUT_PLAN.md §5：Shadow → Dogfood → Canary → Switch）
 *
 * 生产对话按采样率异步双跑 gedo 端点：同样的内核上下文喂给自有模型，
 * 影子回复**只落日志、永不给用户**。积累的成对样本 = 生产分布上的免费评测集
 * （长文本/推理/真实语言分布天然齐全），周度跑 scripts/eval/shadow-report.mjs
 * 出胜率曲线，即"成熟度仪表盘"（G1 判据）。
 *
 * 安全设计：
 *   - fire-and-forget：任何失败只 warn，绝不影响用户链路
 *   - 并发上限（GEDO_SHADOW_CONCURRENCY，默认 1）：保护本地 GPU，超载直接丢样本
 *   - 工具轮跳过：影子无法执行工具，对比不公平
 *   - 断供模式跳过：生产本身就是 gedo，无对比意义
 *
 * 隐私：日志含完整输入上下文（判卷与未来 DPO 偏好对都需要），写入
 * data/shadow/（已随 data/ gitignore，不出服务器）。该目录属于"训练同意条款"
 * 的覆盖范围（实施方案 §4 法务项）——条款上线前仅限内部账号流量开启。
 *
 * 开关：GEDO_SHADOW_RATE=0.1（0=关闭，默认关闭；改后需重启）
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getLLMRouter } from './router.mjs';
import { isSovereignMode } from './tasks.mjs';
import { dataPath } from '../lib/data-dir.mjs';

const SHADOW_DIR = dataPath('shadow');

let inFlight = 0;

function shadowRate() {
  const r = Number(process.env.GEDO_SHADOW_RATE || 0);
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
}

function maxConcurrency() {
  return Math.max(1, Number(process.env.GEDO_SHADOW_CONCURRENCY || 1));
}

/**
 * 生产回合完成后调用（conversation.service post-turn）。
 * @param {object} p
 * @param {string} p.userId
 * @param {Array}  p.messages       本回合的原始输入（system + 历史 + 新消息，未含工具轮）
 * @param {string} p.prodText       生产端最终可见回复文本
 * @param {number} p.prodToolCalls  生产端本回合的工具调用数（>0 则跳过）
 */
export async function maybeRunShadow({ userId, messages, prodText, prodToolCalls = 0 }) {
  const rate = shadowRate();
  if (!rate || Math.random() >= rate) return;
  if (isSovereignMode()) return;
  if (prodToolCalls > 0) return;
  if (!prodText || prodText.trim().length < 2) return;

  const router = getLLMRouter();
  const gedo = router.getProvider('gedo');
  if (!gedo) return;
  if (inFlight >= maxConcurrency()) return; // 采样场景，丢样本可容忍

  inFlight++;
  const t0 = Date.now();
  try {
    const res = await gedo.chat(messages, { temperature: 0.7, maxTokens: 600, noThink: true });
    const shadowText = (res.content || '').trim();
    if (!shadowText) return;

    const record = {
      ts: new Date().toISOString(),
      uid: crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 12),
      prod: { provider: router.getStatus().primaryChat, text: prodText.trim() },
      shadow: { provider: 'gedo', model: gedo.describe().model, text: shadowText, ms: Date.now() - t0 },
      // 完整输入留档：成对判卷与（经同意的）训练偏好对都需要
      messages,
    };

    fs.mkdirSync(SHADOW_DIR, { recursive: true });
    const file = path.join(SHADOW_DIR, `${record.ts.slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(record) + '\n');
  } catch (e) {
    console.warn('[shadow] skipped:', e?.message || e);
  } finally {
    inFlight--;
  }
}

export default { maybeRunShadow };
