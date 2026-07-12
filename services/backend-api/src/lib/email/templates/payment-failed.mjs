import { greeting, signoff } from './_shared.mjs';

const S = {
  en: 'Payment failed — update your card',
  zh: '扣款失败 —— 请更新支付方式',
  ja: 'お支払いに失敗しました — カード情報の更新をお願いします',
};
const PRE = {
  en: "We couldn't process your latest GEDO payment.",
  zh: '我们未能完成你最近的 GEDO 扣款。',
  ja: '直近の GEDO のお支払いを処理できませんでした。',
};
const BODY = {
  en: "We couldn't process your latest GEDO payment. Please update your payment method to keep your subscription active.",
  zh: '我们未能完成你最近的 GEDO 扣款。请更新支付方式,以保持订阅有效。',
  ja: '直近の GEDO のお支払いを処理できませんでした。サブスクリプションを継続するには、お支払い方法を更新してください。',
};
const CTA = { en: 'Update payment', zh: '更新支付方式', ja: 'お支払い方法を更新' };
const NOTE = {
  en: "If your card isn't updated, your subscription may be paused.",
  zh: '若未及时更新,订阅可能会被暂停。',
  ja: 'カード情報が更新されない場合、サブスクリプションが一時停止されることがあります。',
};

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const blocks = [
    { type: 'p', text: greeting(data.name, lang) },
    { type: 'p', text: BODY[lang] || BODY.en },
  ];
  if (data.updateUrl) blocks.push({ type: 'button', label: CTA[lang] || CTA.en, href: data.updateUrl });
  blocks.push({ type: 'note', text: NOTE[lang] || NOTE.en });
  blocks.push({ type: 'p', text: signoff(lang) });

  return { previewText: PRE[lang] || PRE.en, blocks };
}
