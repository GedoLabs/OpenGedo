/**
 * Email language resolution.
 *
 * Deliberately separate from lib/language.mjs (which drives AI prompts and
 * falls back to `zh`). Transactional email defaults to **en** — matching the
 * web/mobile defaultLocale and GEDO's international (non-China-mainland)
 * positioning. A brand-new signup has no explicit language choice yet, so we
 * must NOT read a synthesized settings default (which is `zh`) as if the user
 * had chosen it — see resolveEmailLang below.
 */

export const SUPPORTED_EMAIL_LANGS = ['en', 'zh', 'ja'];

export function normalizeEmailLang(lang) {
  const short = String(lang || '').trim().toLowerCase().slice(0, 2);
  return SUPPORTED_EMAIL_LANGS.includes(short) ? short : 'en';
}

/**
 * Pick the language for a user's email.
 *
 * Precedence:
 *   1. explicit override (caller already knows)
 *   2. the user's *explicitly saved* settings.language (only when a settings
 *      row actually exists — a synthesized default must not count)
 *   3. a locale captured on a public funnel (signup / waitlist / sim pack)
 *   4. 'en'
 *
 * @param {object} opts
 * @param {string} [opts.explicit]
 * @param {string|null} [opts.settingsLanguage]  raw value from the persisted settings row
 * @param {boolean} [opts.hasSettingsRow]        true only if a settings row exists
 * @param {string|null} [opts.funnelLocale]      locale captured pre-account
 * @returns {'en'|'zh'|'ja'}
 */
export function resolveEmailLang({ explicit, settingsLanguage, hasSettingsRow, funnelLocale } = {}) {
  if (explicit) return normalizeEmailLang(explicit);
  if (hasSettingsRow && settingsLanguage) return normalizeEmailLang(settingsLanguage);
  if (funnelLocale) return normalizeEmailLang(funnelLocale);
  return 'en';
}
