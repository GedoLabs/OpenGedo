/**
 * LoRA Dataset Collector (P3-D)
 *
 * Pulls writing samples from L4 memories tagged with 'writing' (emails, notes, posts).
 * Each sample becomes a training pair:
 *   { prompt: "写一封...", completion: "<redacted content>" }
 *
 * Data never leaves this service — only URLs to stored JSONL go into the DB.
 *
 * Usage:
 *   import { collectDataset } from './dataset.mjs';
 *   const { samples, stats } = await collectDataset(db, userId, { redact: true });
 */

import { redact } from './redactor.mjs';

/**
 * Collect writing samples for a user.
 *
 * @param {object} db
 * @param {string} userId
 * @param {object} [opts]
 * @param {boolean} [opts.redact=true]       — apply PII redaction before export
 * @param {number}  [opts.maxSamples=2000]   — hard cap on samples per export
 * @param {string[]}[opts.tags=['writing']]  — which L4 tags to pull
 * @param {string}  [opts.sinceDate]         — ISO date lower bound
 * @returns {Promise<{ samples: object[], stats: object }>}
 */
export async function collectDataset(db, userId, opts = {}) {
  const {
    redact: doRedact = true,
    maxSamples       = 2000,
    tags             = ['writing'],
    sinceDate,
  } = opts;

  // ── 1. Fetch L4 writing memories ─────────────────────────────────────────
  const tagFilter    = tags.map(t => `'${t}'`).join(',');
  const sinceClause  = sinceDate ? `AND m.created_at >= $3` : '';
  const sinceParam   = sinceDate ? [sinceDate] : [];

  const sql = `
    SELECT m.id, m.content_raw, m.content_struct, m.type,
           m.system_tags, m.user_tags, m.created_at, m.decay_class
    FROM memories m
    WHERE m.user_id = $1
      AND m.superseded_by IS NULL
      AND (
        m.system_tags && ARRAY[${tagFilter}]::text[]
        OR m.user_tags && ARRAY[${tagFilter}]::text[]
      )
      ${sinceClause}
    ORDER BY m.created_at DESC
    LIMIT $2
  `;

  let rows = [];
  try {
    rows = await db.queryAll(sql, [userId, maxSamples, ...sinceParam]);
  } catch (err) {
    // Fallback: pull all memories and filter in JS (when fts column missing)
    console.warn('[dataset] primary query failed, falling back:', err.message?.slice(0, 60));
    try {
      const fallbackRows = await db.queryAll(
        `SELECT * FROM memories WHERE user_id = $1 AND superseded_by IS NULL ORDER BY created_at DESC LIMIT $2`,
        [userId, maxSamples * 5],
      );
      rows = fallbackRows.filter(r =>
        [...(r.system_tags || []), ...(r.user_tags || [])].some(t => tags.includes(t))
      ).slice(0, maxSamples);
    } catch { /* give up */ }
  }

  if (!rows.length) {
    return { samples: [], stats: { total: 0, redacted: 0, skipped: 0, tags } };
  }

  // ── 2. Convert to training pairs ─────────────────────────────────────────
  const samples = [];
  let redactedCount = 0;
  let skippedCount  = 0;

  for (const row of rows) {
    const raw = (row.content_raw || '').trim();
    if (raw.length < 20) { skippedCount++; continue; }

    let text = raw;
    let didRedact = false;

    if (doRedact) {
      const result = redact(raw);
      text       = result.text;
      didRedact  = result.changed;
      if (didRedact) redactedCount++;
      if (result.blocked) { skippedCount++; continue; } // skip if redactor flagged it
    }

    // Build a simple instruction-following pair
    const type    = row.type || 'note';
    const prompt  = _buildPrompt(type, row.content_struct);
    const sample  = {
      id:           row.id,
      prompt,
      completion:   text,
      type,
      decay_class:  row.decay_class || 'fast',
      created_at:   row.created_at,
      _redacted:    didRedact,
    };
    samples.push(sample);
  }

  return {
    samples,
    stats: {
      total:    rows.length,
      exported: samples.length,
      redacted: redactedCount,
      skipped:  skippedCount,
      tags,
    },
  };
}

/**
 * Export dataset as JSONL string (one JSON object per line).
 * Each line: { "prompt": "...", "completion": "..." }
 */
export function toJSONL(samples) {
  return samples
    .map(s => JSON.stringify({ prompt: s.prompt, completion: s.completion }))
    .join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _buildPrompt(type, struct) {
  const context = struct?.context || struct?.summary || '';

  const typePrompts = {
    email:        context ? `写一封关于"${context}"的邮件` : '写一封邮件',
    note:         context ? `写一条关于"${context}"的笔记` : '写一条笔记',
    key_event:    context ? `描述一件关于"${context}"的事情` : '描述一件重要的事情',
    personal_trait: '描述我的一个特质或偏好',
    important_info: context ? `说明关于"${context}"的重要信息` : '记录一条重要信息',
  };

  return typePrompts[type] || (context ? `写一段关于"${context}"的内容` : '写一段个人化内容');
}
