/**
 * Generic system-prompt adapter — renders L1 + L2 + L5 into a single
 * markdown block any frontier LLM can consume. Not platform-specific.
 *
 * Output is sized for "fits in any chat-app system slot" (≤6K chars).
 */

const TARGET_MAX = 6000;

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
  const lines = [];
  const name = identity.name || 'this user';

  lines.push(`# System Prompt — ${name}`);
  lines.push('');
  lines.push(`You are an AI assistant for **${name}**${identity.profession ? `, ${identity.profession}` : ''}.`);
  if (identity.north_star) {
    lines.push('');
    lines.push(`**North star**: ${identity.north_star}`);
  }

  // Identity
  if (identity.life_stage || identity.values?.top_priorities?.length || identity.values?.non_negotiables?.length) {
    lines.push('');
    lines.push('## Identity');
    if (identity.life_stage) lines.push(`- Life stage: ${identity.life_stage}`);
    if (identity.values?.top_priorities?.length) {
      lines.push(`- Top priorities: ${identity.values.top_priorities.join(', ')}`);
    }
    if (identity.values?.non_negotiables?.length) {
      lines.push(`- Non-negotiables: ${identity.values.non_negotiables.join('; ')}`);
    }
  }

  // Voice
  if (identity.communication?.preferred_tone || identity.communication?.languages?.length) {
    lines.push('');
    lines.push('## Voice');
    if (identity.communication?.preferred_tone) lines.push(`- Tone: **${identity.communication.preferred_tone}**`);
    if (typeof identity.communication?.verbosity === 'number') {
      const v = identity.communication.verbosity;
      lines.push(`- Verbosity: ${v < 0.34 ? 'low' : v < 0.67 ? 'medium' : 'high'} (${v.toFixed(2)})`);
    }
    if (identity.communication?.languages?.length) {
      lines.push(`- Languages: ${identity.communication.languages.join(', ')} (primary first)`);
    }
  }

  // Cognition
  if (identity.cognition?.learning_style || identity.cognition?.reasoning_mode) {
    lines.push('');
    lines.push('## Cognition');
    if (identity.cognition.learning_style) lines.push(`- Learning style: ${identity.cognition.learning_style}`);
    if (identity.cognition.reasoning_mode) lines.push(`- Reasoning: ${identity.cognition.reasoning_mode}`);
  }

  // Expertise
  if (Array.isArray(identity.expertise?.domains) && identity.expertise.domains.length) {
    lines.push('');
    lines.push('## Expertise');
    for (const d of identity.expertise.domains.slice(0, 8)) {
      lines.push(`- ${d.domain}${d.level ? ` _(${d.level})_` : ''}`);
    }
  }

  // Recent context — semantic
  const filledDims = Object.entries(semantic.dimensions || {})
    .filter(([, v]) => v && (v.summary || (v.recent_insight)))
    .slice(0, 6);
  if (filledDims.length) {
    lines.push('');
    lines.push('## Recent context');
    for (const [dim, data] of filledDims) {
      const head = DIM_LABELS[dim] || dim;
      const body = data.summary || data.recent_insight;
      if (body) lines.push(`- **${head}**: ${trim(body, 200)}`);
    }
  }

  // Hard rules — procedural
  const activeRules = (procedural?.rules || []).filter(r => r.active !== false).slice(0, 8);
  if (activeRules.length) {
    lines.push('');
    lines.push('## Hard rules');
    for (let i = 0; i < activeRules.length; i++) {
      lines.push(`${i + 1}. ${activeRules[i].rule_text}`);
    }
  }

  if (procedural?.preferences?.morning_routine || procedural?.preferences?.evening_routine) {
    lines.push('');
    lines.push('## Routines');
    if (procedural.preferences.morning_routine) lines.push(`- Morning: ${procedural.preferences.morning_routine}`);
    if (procedural.preferences.evening_routine) lines.push(`- Evening: ${procedural.preferences.evening_routine}`);
  }

  lines.push('');
  lines.push('## When in doubt');
  lines.push(`Ask ${name} a clarifying question rather than assume.`);

  return clip(lines.join('\n'), TARGET_MAX);
}

function trim(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default { render, TARGET_MAX };
