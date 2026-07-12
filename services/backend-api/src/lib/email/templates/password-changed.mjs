import { greeting, signoff, contactIfNotYou } from './_shared.mjs';

const S = { en: 'Your password was changed', zh: '你的密码已修改', ja: 'パスワードが変更されました' };
const PRE = {
  en: 'Your GEDO password was just changed.',
  zh: '你的 GEDO 密码刚刚被修改。',
  ja: 'GEDO のパスワードが変更されました。',
};
const BODY = {
  en: 'Your GEDO account password was just changed. If this was you, no action is needed.',
  zh: '你的 GEDO 账户密码刚刚被修改。如果是你本人操作,无需处理。',
  ja: 'GEDO アカウントのパスワードが変更されました。ご本人の操作であれば、対応は不要です。',
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
