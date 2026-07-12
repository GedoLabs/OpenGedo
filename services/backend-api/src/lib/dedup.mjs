/**
 * Dedup helpers — shared text normalization + similarity used to stop the
 * same goal / todo / memory from being captured twice across multi-turn
 * conversations.
 *
 * Two-tier matching:
 *   1. normalizeForDedup()  → exact match after whitespace/case/full-width
 *      normalization. Catches "完成90天英语目标" ≡ "完成 90 天英语目标".
 *   2. diceCoefficient()    → char-bigram similarity for near-duplicates that
 *      survive normalization ("学好英语" vs "把英语学好").
 */

/**
 * Canonicalise a string for comparison:
 *   full-width → half-width · lower-case · strip whitespace · strip common
 *   punctuation & emoji. Two strings that mean the same thing collapse to the
 *   same normalized form.
 */
export function normalizeForDedup(input) {
  let s = String(input ?? '');
  // Full-width ASCII (！-～) → half-width.
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // Ideographic space → normal space (then stripped below).
  s = s.replace(/　/g, ' ');
  s = s.toLowerCase();
  // Drop ALL whitespace — "90 天" ≡ "90天".
  s = s.replace(/\s+/g, '');
  // Drop punctuation that doesn't change meaning.
  s = s.replace(/[，。！？、；：,.!?;:~～\-—…·"'""''「」『』（）()【】\[\]《》]/g, '');
  // Drop emoji / pictographs / variation selectors.
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '');
  return s.trim();
}

/** Char-bigram frequency map for Dice similarity. */
function bigrams(s) {
  const grams = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  return grams;
}

/**
 * Sørensen–Dice coefficient over character bigrams of the *normalized* strings.
 * Returns 0..1. Cheap, synchronous, language-agnostic (works on CJK).
 */
export function diceCoefficient(a, b) {
  const na = normalizeForDedup(a);
  const nb = normalizeForDedup(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  for (const v of ga.values()) totalA += v;
  for (const [g, v] of gb.entries()) {
    totalB += v;
    const inA = ga.get(g);
    if (inA) overlap += Math.min(v, inA);
  }
  return (2 * overlap) / (totalA + totalB);
}

/**
 * True when a and b are the same item: identical after normalization, or
 * Dice similarity ≥ threshold. Default 0.82 — tuned to catch reworded
 * duplicates while leaving genuinely distinct items apart.
 */
export function isNearDuplicate(a, b, threshold = 0.82) {
  const na = normalizeForDedup(a);
  const nb = normalizeForDedup(b);
  if (na && na === nb) return true;
  if (!na || !nb) return false;
  return diceCoefficient(a, b) >= threshold;
}

/** The text that identifies a capture (todo → title, memory → content, entity kinds → entity+fact). */
export function captureText(kind, payload = {}) {
  if (kind === 'task') return String(payload.title || payload.content || '');
  if (kind === 'entity_fact') {
    // Same card + same key + same value = same suggestion; a changed value
    // must NOT dedup against the old one (e.g. a corrected birthday).
    return [payload.entity_name || payload.entity_id || '', payload.k || '', payload.v || '']
      .map(String).join(' ');
  }
  if (kind === 'entity_suggest') return String(payload.name || payload.entity_name || '');
  return String(payload.content || payload.title || '');
}

/**
 * Exact dedup key for a capture: kind + normalized identifying text +
 * (for todos) due_date. Two captures with the same key are the same item.
 */
export function captureDedupKey(kind, payload = {}) {
  const text = normalizeForDedup(captureText(kind, payload));
  const due = kind === 'task' ? payload.due_date || '' : '';
  return `${kind}|${text}|${due}`;
}

export default {
  normalizeForDedup,
  diceCoefficient,
  isNearDuplicate,
  captureText,
  captureDedupKey,
};
