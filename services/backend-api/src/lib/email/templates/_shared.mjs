/** Small shared bits so each template stays pure localized copy. */

export function greeting(name, lang) {
  const n = String(name || '').trim();
  if (lang === 'zh') return n ? `你好 ${n},` : '你好,';
  if (lang === 'ja') return n ? `${n} さん、こんにちは。` : 'こんにちは。';
  return n ? `Hi ${n},` : 'Hi there,';
}

export function signoff(lang) {
  if (lang === 'zh') return '—— GEDO 团队';
  if (lang === 'ja') return '— GEDO チーム';
  return '— The GEDO team';
}

export function tierLabel(tier) {
  const t = String(tier || 'free').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1); // Free / Pro / Ultra (proper noun, not localized)
}

export function intervalLabel(interval, lang) {
  const i = String(interval || '').toLowerCase();
  if (lang === 'zh') return i === 'yearly' ? '按年' : i === 'monthly' ? '按月' : '—';
  if (lang === 'ja') return i === 'yearly' ? '年額' : i === 'monthly' ? '月額' : '—';
  return i === 'yearly' ? 'Yearly' : i === 'monthly' ? 'Monthly' : '—';
}

/** "Or paste this link into your browser:" prefix for the copy-paste fallback line. */
export function pasteLinkLabel(lang) {
  if (lang === 'zh') return '或将此链接粘贴到浏览器打开:';
  if (lang === 'ja') return 'または以下のリンクをブラウザに貼り付けてください:';
  return 'Or paste this link into your browser:';
}

/** "If this wasn't you, contact support" — reused across security notices. */
export function contactIfNotYou(lang) {
  if (lang === 'zh') return '如果这不是你本人的操作,请立即联系 support@gedo.ai。';
  if (lang === 'ja') return 'ご本人でない場合は、直ちに support@gedo.ai までご連絡ください。';
  return "If you didn't make this change, contact us immediately at support@gedo.ai.";
}
