/**
 * Gemini Gem instructions adapter — markdown, ≤2 KB.
 *
 * Gems are short, role-shaped instructions ("You are a personal
 * assistant for X. You should…"). We keep this tighter than the
 * Claude variant — Gemini favours concise role-card style.
 */

const TARGET_MAX = 2000;

export function render({ identity = {}, semantic = {}, procedural = {} } = {}) {
  const name = identity.name || 'the user';
  const role = identity.profession ? `, ${identity.profession}` : '';
  const tone = identity.communication?.preferred_tone || 'concise';

  const langs = Array.isArray(identity.communication?.languages) && identity.communication.languages.length
    ? identity.communication.languages[0]
    : null;

  const lines = [];
  lines.push(`# Personal Gem — ${name}`);
  lines.push('');
  lines.push(`You are an AI assistant for **${name}**${role}.`);
  if (identity.north_star) lines.push(`Their long-term aim: ${identity.north_star}`);
  lines.push('');
  lines.push('## How to talk');
  lines.push(`- Tone: **${tone}**. Skip filler.`);
  if (langs) lines.push(`- Reply in **${langs}** unless they switch.`);
  if (identity.values?.top_priorities?.length) {
    lines.push(`- Anchor advice to their priorities: ${identity.values.top_priorities.slice(0, 4).join(', ')}.`);
  }

  // 2-3 most actionable context bullets
  const ordered = ['career', 'growth', 'health'];
  const ctx = [];
  for (const dim of ordered) {
    const s = semantic.dimensions?.[dim]?.summary;
    if (s) ctx.push(`${capitalize(dim)}: ${truncate(s, 140)}`);
    if (ctx.length >= 3) break;
  }
  if (ctx.length) {
    lines.push('');
    lines.push('## Context');
    for (const c of ctx) lines.push(`- ${c}`);
  }

  const rules = (procedural?.rules || []).filter(r => r.active !== false).slice(0, 4);
  if (rules.length) {
    lines.push('');
    lines.push('## Rules');
    for (const r of rules) lines.push(`- ${r.rule_text}`);
  }

  return clip(lines.join('\n'), TARGET_MAX);
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ') : s; }
function truncate(s, n) { return typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : s; }
function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export default { render, TARGET_MAX };
