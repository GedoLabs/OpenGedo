/**
 * ChatGPT custom memory adapter — plain text, ≤4 KB.
 *
 * ChatGPT's memory field accepts free-form text and works best as
 * "facts the assistant should remember", separated by paragraphs.
 * Not markdown-aware. We render the highest-leverage facts first and
 * truncate by paragraph rather than mid-sentence.
 */

const TARGET_MAX = 3800;  // a hair under the 4K limit, leave headroom

export function render({ identity = {}, semantic = {}, procedural = {} } = {}) {
  const blocks = [];

  // Block 1: identity
  const idParts = [];
  if (identity.name) idParts.push(`Name: ${identity.name}`);
  if (identity.profession) idParts.push(`Currently a ${identity.profession}`);
  if (identity.life_stage) idParts.push(`Life stage: ${identity.life_stage}`);
  if (identity.north_star) idParts.push(`Long-term goal: ${identity.north_star}`);
  if (idParts.length) blocks.push(idParts.join('. ') + '.');

  // Block 2: values
  const vParts = [];
  if (identity.values?.top_priorities?.length) {
    vParts.push(`Top priorities: ${identity.values.top_priorities.join(', ')}`);
  }
  if (identity.values?.non_negotiables?.length) {
    vParts.push(`Non-negotiables: ${identity.values.non_negotiables.join('; ')}`);
  }
  if (vParts.length) blocks.push(vParts.join('. ') + '.');

  // Block 3: communication style
  const comm = identity.communication || {};
  const cParts = [];
  if (comm.preferred_tone) cParts.push(`Prefers a ${comm.preferred_tone} tone`);
  if (typeof comm.verbosity === 'number') {
    cParts.push(comm.verbosity < 0.34 ? 'concise replies' : comm.verbosity < 0.67 ? 'medium-length replies' : 'detailed replies');
  }
  if (Array.isArray(comm.languages) && comm.languages.length) {
    cParts.push(`Primary language: ${comm.languages[0]}${comm.languages.length > 1 ? ` (also ${comm.languages.slice(1).join(', ')})` : ''}`);
  }
  if (identity.cognition?.reasoning_mode) cParts.push(`${identity.cognition.reasoning_mode} reasoner`);
  if (cParts.length) blocks.push(cParts.join('. ') + '.');

  // Block 4: relevant semantic dims (career + health typically most actionable)
  const ordered = ['career', 'growth', 'health', 'family', 'finance', 'social', 'hobby', 'self_realization'];
  for (const dim of ordered) {
    const data = semantic.dimensions?.[dim];
    if (!data?.summary) continue;
    const friendly = humanDim(dim);
    blocks.push(`${friendly}: ${data.summary}`);
  }

  // Block 5: hard rules — must survive the truncation, prepend tag
  const rules = (procedural?.rules || []).filter(r => r.active !== false).slice(0, 6);
  for (const r of rules) {
    blocks.push(`Important rule: ${r.rule_text}`);
  }

  // Compose paragraph-by-paragraph until we hit the budget.
  const out = [];
  let len = 0;
  for (const b of blocks) {
    const next = b.trim();
    if (!next) continue;
    const cost = next.length + 2; // \n\n
    if (len + cost > TARGET_MAX) break;
    out.push(next);
    len += cost;
  }
  return out.join('\n\n') + '\n';
}

function humanDim(dim) {
  return ({
    health: 'Health',
    career: 'Career',
    family: 'Family',
    finance: 'Finance',
    growth: 'Personal growth',
    social: 'Social',
    hobby: 'Hobbies',
    self_realization: 'Self-realization',
  })[dim] || dim;
}

export default { render, TARGET_MAX };
