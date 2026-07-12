import { greeting, signoff } from './_shared.mjs';

const S = { en: 'Your GEDO subscription will end', zh: '你的 GEDO 订阅即将到期', ja: 'GEDO サブスクリプションの終了予定' };
const PRE = {
  en: 'Your GEDO subscription is set to end.',
  zh: '你的 GEDO 订阅即将到期。',
  ja: 'GEDO サブスクリプションが終了予定です。',
};
const BODY = {
  en: (d) => `Your subscription is set to end${d ? ' on ' + d : ''}. You'll keep full access until then.`,
  zh: (d) => `你的订阅将${d ? '于 ' + d + ' ' : ''}到期,在此之前仍可正常使用全部功能。`,
  ja: (d) => `サブスクリプションは${d ? d + ' に' : ''}終了予定です。それまではすべての機能をご利用いただけます。`,
};
const NOTE = {
  en: 'Changed your mind? You can resubscribe any time.',
  zh: '改变主意了?你随时可以重新订阅。',
  ja: '気が変わった場合は、いつでも再登録できます。',
};
const CTA = { en: 'Resubscribe', zh: '重新订阅', ja: '再登録' };

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const body = (BODY[lang] || BODY.en)(data.endDate || '');
  const blocks = [
    { type: 'p', text: greeting(data.name, lang) },
    { type: 'p', text: body },
  ];
  if (data.resubscribeUrl) blocks.push({ type: 'button', label: CTA[lang] || CTA.en, href: data.resubscribeUrl });
  blocks.push({ type: 'note', text: NOTE[lang] || NOTE.en });
  blocks.push({ type: 'p', text: signoff(lang) });

  return { previewText: PRE[lang] || PRE.en, blocks };
}
