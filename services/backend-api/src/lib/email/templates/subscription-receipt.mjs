import { greeting, signoff, tierLabel, intervalLabel } from './_shared.mjs';

const S = { en: 'Your GEDO subscription is active', zh: '你的 GEDO 订阅已生效', ja: 'GEDO サブスクリプションが有効になりました' };
const PRE = {
  en: 'Thanks for subscribing to GEDO.',
  zh: '感谢订阅 GEDO。',
  ja: 'GEDO をご利用いただきありがとうございます。',
};
const BODY = {
  en: 'Thanks for subscribing to GEDO. Here are your details:',
  zh: '感谢订阅 GEDO。以下是你的订阅详情:',
  ja: 'GEDO をご利用いただきありがとうございます。ご契約内容は以下のとおりです:',
};
const LABELS = {
  en: { plan: 'Plan', billing: 'Billing', renews: 'Renews on' },
  zh: { plan: '套餐', billing: '计费周期', renews: '下次续费' },
  ja: { plan: 'プラン', billing: '請求', renews: '次回更新' },
};
const CTA = { en: 'Manage subscription', zh: '管理订阅', ja: 'サブスクリプションを管理' };

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const L = LABELS[lang] || LABELS.en;
  const rows = [
    [L.plan, tierLabel(data.tier)],
    [L.billing, intervalLabel(data.interval, lang)],
  ];
  if (data.periodEnd) rows.push([L.renews, data.periodEnd]);

  const blocks = [
    { type: 'p', text: greeting(data.name, lang) },
    { type: 'p', text: BODY[lang] || BODY.en },
    { type: 'kv', rows },
  ];
  if (data.manageUrl) blocks.push({ type: 'button', label: CTA[lang] || CTA.en, href: data.manageUrl });
  blocks.push({ type: 'p', text: signoff(lang) });

  return { previewText: PRE[lang] || PRE.en, blocks };
}
