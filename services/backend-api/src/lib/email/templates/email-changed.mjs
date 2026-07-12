import { greeting, signoff, contactIfNotYou } from './_shared.mjs';

// Security alert sent to the user's PREVIOUS email address after an email change.
const S = { en: 'Your account email was changed', zh: '你的账户邮箱已变更', ja: 'アカウントのメールアドレスが変更されました' };
const PRE = {
  en: 'The email on your GEDO account was changed.',
  zh: '你的 GEDO 账户邮箱已变更。',
  ja: 'GEDO アカウントのメールアドレスが変更されました。',
};
const BODY = {
  en: (e) => `The email address for your GEDO account was changed to ${e}. You're receiving this at your previous address.`,
  zh: (e) => `你的 GEDO 账户邮箱已变更为 ${e}。此邮件发送至你此前的邮箱地址。`,
  ja: (e) => `GEDO アカウントのメールアドレスが ${e} に変更されました。このメールは変更前のアドレスに送信されています。`,
};

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const body = (BODY[lang] || BODY.en)(data.newEmail || '');
  return {
    previewText: PRE[lang] || PRE.en,
    blocks: [
      { type: 'p', text: greeting(data.name, lang) },
      { type: 'p', text: body },
      { type: 'note', text: contactIfNotYou(lang) },
      { type: 'p', text: signoff(lang) },
    ],
  };
}
