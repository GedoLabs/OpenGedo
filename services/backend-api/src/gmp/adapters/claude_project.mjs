/**
 * Claude Project Instructions adapter — markdown, ≤8 KB.
 *
 * Claude Projects accept a markdown system-instructions block. Claude
 * is good at structured headers, so we use them aggressively, and we
 * include a "When asked to draft on her/his behalf" footer because
 * AS-mode delegations are a common Claude Project use case.
 */

const TARGET_MAX = 7500;

const DIM_LABELS = {
  health: 'Health',
  career: 'Career',
  family: 'Family',
  finance: 'Finance',
  growth: 'Growth & Learning',
  social: 'Social',
  hobby: 'Hobbies',
  self_realization: 'Self-realization',
};

export function render({ identity = {}, semantic = {}, procedural = {} } = {}) {
  const name = identity.name || 'this user';
  const lines = [];

  lines.push(`# Claude Project Instructions — ${name}`);
  lines.push('');
  const intro = [
    `You are working with **${name}**${identity.profession ? `, ${identity.profession}` : ''}.`,
  ];
  const traits = [];
  if (Array.isArray(identity.traits) && identity.traits.length) traits.push(...identity.traits.slice(0, 4));
  if (identity.communication?.preferred_tone) traits.push(`${identity.communication.preferred_tone} tone`);
  if (traits.length) intro.push(`They are: ${traits.join(', ')}.`);
  lines.push(intro.join(' '));

  // What they're optimizing for
  if (identity.north_star || identity.values?.top_priorities?.length || identity.values?.non_negotiables?.length) {
    lines.push('');
    lines.push("## What they're optimizing for");
    if (identity.north_star) lines.push(`- **North star**: ${identity.north_star}`);
    if (identity.values?.top_priorities?.length) {
      lines.push(`- **Top priorities** (current quarter): ${identity.values.top_priorities.join(', ')}.`);
    }
    if (identity.values?.non_negotiables?.length) {
      lines.push(`- **Non-negotiables**: ${identity.values.non_negotiables.join('; ')}.`);
    }
  }

  // Working style
  const workStyle = collectWorkingStyle({ identity, semantic, procedural });
  if (workStyle.length) {
    lines.push('');
    lines.push('## How they work best');
    for (const p of workStyle) lines.push(`- ${p}`);
  }

  // Recent context
  const filledDims = Object.entries(semantic.dimensions || {})
    .filter(([, v]) => v && (v.summary || v.recent_insight))
    .slice(0, 6);
  if (filledDims.length) {
    lines.push('');
    lines.push('## Recent context');
    for (const [dim, data] of filledDims) {
      const head = DIM_LABELS[dim] || dim;
      const body = data.recent_insight || data.summary;
      if (body) lines.push(`- **${head}**: ${trim(body, 240)}`);
    }
  }

  // Failure learnings — Claude does well with explicit lessons
  const failureLessons = (semantic.failure_learnings || []).slice(0, 3);
  if (failureLessons.length) {
    lines.push('');
    lines.push('## Lessons they care about');
    for (const f of failureLessons) {
      lines.push(`- ${f.lesson}${f.context ? ` — _from: ${trim(f.context, 100)}_` : ''}`);
    }
  }

  // Style + rules
  const activeRules = (procedural?.rules || []).filter(r => r.active !== false).slice(0, 8);
  if (activeRules.length || identity.communication?.preferred_tone) {
    lines.push('');
    lines.push('## Style and rules');
    if (identity.communication?.preferred_tone) lines.push(`- Tone: ${identity.communication.preferred_tone}. No hedging language.`);
    if (typeof identity.communication?.verbosity === 'number' && identity.communication.verbosity < 0.5) {
      lines.push('- Length: short and structured. Headlines + bullets > prose.');
    }
    if (Array.isArray(identity.communication?.languages) && identity.communication.languages.length) {
      lines.push(`- Languages: ${identity.communication.languages.join(' first, then ')}.`);
    }
    for (const r of activeRules) {
      lines.push(`- **Hard rule**: ${r.rule_text}`);
    }
  }

  // AS-mode footer (matches plan's L2 digital-twin spec)
  lines.push('');
  lines.push('## When asked to draft on their behalf');
  lines.push(`Sign off with \`Drafted by Claude, reviewed by ${name}\` and surface 1–2 questions before delivering anything externally facing.`);

  return clip(lines.join('\n'), TARGET_MAX);
}

function collectWorkingStyle({ identity, semantic, procedural }) {
  const out = [];
  if (identity.cognition?.reasoning_mode) {
    out.push(`Reasoning is ${identity.cognition.reasoning_mode}; ${identity.cognition.learning_style ? `${identity.cognition.learning_style} learner` : 'evidence-first'}.`);
  }
  // Patterns from semantic
  for (const dim of ['career', 'growth']) {
    const ps = semantic.dimensions?.[dim]?.patterns || [];
    for (const p of ps.slice(0, 1)) out.push(p);
  }
  // Productive hours
  const hours = procedural?.preferences?.productive_hours;
  if (Array.isArray(hours) && hours.length) {
    out.push(`Best output windows: ${hours.join(':00, ')}:00.`);
  }
  if (procedural?.preferences?.morning_routine) out.push(`Morning routine: ${procedural.preferences.morning_routine}`);
  return out;
}

function trim(s, n) { return typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : s; }
function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export default { render, TARGET_MAX };
