/**
 * PII Redactor (P3-D)
 *
 * Removes or masks personally identifiable information before LoRA training.
 * Two-pass approach:
 *   Pass 1 — Regex patterns (emails, phones, IDs, addresses, credit cards)
 *   Pass 2 — Blocklist check (flag samples that need human review)
 *
 * Privacy guarantee: redaction error rate target < 1% (manual sampling required).
 *
 * Usage:
 *   import { redact } from './redactor.mjs';
 *   const { text, changed, blocked } = redact(rawText);
 */

// ── Regex patterns ────────────────────────────────────────────────────────────

const PATTERNS = [
  // Email addresses
  { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,      mask: '[EMAIL]' },
  // Phone numbers (Chinese mobile + international)
  { re: /(?:\+?86[-\s]?)?1[3-9]\d{9}/g,                             mask: '[PHONE]' },
  { re: /(?:\+?[0-9]{1,3}[-\s.])?(?:\(?\d{1,4}\)?[-\s.]?)?\d{6,10}/g, mask: '[PHONE]' },
  // Chinese ID card (18-digit)
  { re: /[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX]/g, mask: '[ID]' },
  // Passport numbers (CN + US-style)
  { re: /[EG]\d{8}/g,                                                mask: '[PASSPORT]' },
  { re: /\b[A-Z]{1,2}\d{6,8}\b/g,                                   mask: '[PASSPORT]' },
  // Credit card numbers (Luhn-format groups)
  { re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,                             mask: '[CARD]' },
  // Bank account numbers (CN 16-19 digit)
  { re: /\b[3-9]\d{15,18}\b/g,                                      mask: '[BANK_ACCOUNT]' },
  // Physical addresses (basic CJK address patterns)
  { re: /[一-龥]{2,6}(?:省|市|区|县|镇|乡|街道|路|号|楼|室|单元)\d{0,4}/g, mask: '[ADDRESS]' },
  // IP addresses
  { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                             mask: '[IP]' },
  // URLs with potential PII in path/params
  { re: /https?:\/\/[^\s<>"]*?(?:token|api_key|secret|password)=[^\s<>"&]*/gi, mask: '[URL_WITH_SECRET]' },
];

// ── Blocklist — samples containing these should be flagged for human review ──

const BLOCK_PATTERNS = [
  /私钥|private[\s_]key|secret[\s_]key/i,
  /密码|password|passwd/i,
  /api[_\s]?key/i,
  /access[_\s]?token/i,
  /ssh[\s_]rsa/i,
  /BEGIN (RSA |EC |DSA )?PRIVATE KEY/,
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Redact PII from text.
 *
 * @param {string} text
 * @returns {{ text: string, changed: boolean, blocked: boolean, replacements: string[] }}
 */
export function redact(text) {
  if (!text || typeof text !== 'string') {
    return { text: text || '', changed: false, blocked: false, replacements: [] };
  }

  // Pass 1: Check blocklist — these samples should not be used for training
  for (const bp of BLOCK_PATTERNS) {
    if (bp.test(text)) {
      return { text, changed: false, blocked: true, replacements: [] };
    }
  }

  // Pass 2: Apply regex redaction
  let result    = text;
  const applied = [];

  for (const { re, mask } of PATTERNS) {
    const newResult = result.replace(re, (match) => {
      applied.push({ original: match.slice(0, 6) + '…', mask });
      return mask;
    });
    result = newResult;
  }

  return {
    text:         result,
    changed:      result !== text,
    blocked:      false,
    replacements: applied,
  };
}

/**
 * Redact an array of texts (batch).
 * Returns the same shape as redact() but as an array.
 */
export function redactBatch(texts) {
  return texts.map(t => redact(t));
}

/**
 * Validate that a text has been sufficiently redacted.
 * Returns a confidence score 0-1 (1 = likely clean).
 * Note: This is a heuristic, NOT a guarantee.
 */
export function validateRedaction(text) {
  let score = 1.0;
  const flags = [];

  // Check if any PII patterns still match (would indicate missed PII)
  for (const { re } of PATTERNS) {
    const clone = new RegExp(re.source, re.flags.replace('g', ''));
    if (clone.test(text)) {
      score -= 0.2;
      flags.push(re.source.slice(0, 30));
    }
  }

  // Check for blocklist
  for (const bp of BLOCK_PATTERNS) {
    if (bp.test(text)) {
      score = 0;
      flags.push('blocklisted_content');
      break;
    }
  }

  return { score: Math.max(0, score), flags };
}
