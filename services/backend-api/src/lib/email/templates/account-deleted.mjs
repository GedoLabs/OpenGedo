import { greeting, signoff, contactIfNotYou } from './_shared.mjs';

const S = { en: 'Your GEDO account was deleted', zh: '你的 GEDO 账户已删除', ja: 'GEDO アカウントが削除されました' };
const PRE = {
  en: 'Your GEDO account and data have been deleted.',
  zh: '你的 GEDO 账户及数据已被删除。',
  ja: 'GEDO アカウントとデータが削除されました。',
};
const BODY = {
  en: "Your GEDO account and its data have been deleted. We're sorry to see you go.",
  zh: '你的 GEDO 账户及相关数据已被删除。很遗憾与你告别。',
  ja: 'GEDO アカウントとそのデータが削除されました。ご利用ありがとうございました。',
};

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  return {
    previewText: PRE[lang] || PRE.en,
    blocks: [
      { type: 'p', text: greeting(data.name, lang) },
      { type: 'p', text: BODY[lang] || BODY.en },
      { type: 'note', text: contactIfNotYou(lang) },
      { type: 'p', text: signoff(lang) },
    ],
  };
}
