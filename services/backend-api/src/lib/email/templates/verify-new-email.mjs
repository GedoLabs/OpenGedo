import { greeting, signoff, pasteLinkLabel } from './_shared.mjs';

const S = { en: 'Confirm your new email', zh: '确认你的新邮箱', ja: '新しいメールアドレスの確認' };
const PRE = {
  en: 'Confirm your new email to finish the change.',
  zh: '确认新邮箱以完成更改。',
  ja: '変更を完了するために新しいメールを確認してください。',
};
const BODY = {
  en: 'You asked to change the email on your GEDO account to this address. Confirm it to finish the change.',
  zh: '你请求把 GEDO 账户的邮箱改为这个地址。请确认以完成更改。',
  ja: 'GEDO アカウントのメールアドレスをこのアドレスに変更するリクエストがありました。変更を完了するには確認してください。',
};
const CTA = { en: 'Confirm email', zh: '确认邮箱', ja: 'メールを確認' };
const NOTE = {
  en: "This link expires in 24 hours. If you didn't request this change, please contact us at support@gedo.ai.",
  zh: '该链接 24 小时内有效。如果这不是你本人的操作,请联系 support@gedo.ai。',
  ja: '有効期限は24時間です。心当たりがない場合は support@gedo.ai までご連絡ください。',
};

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  return {
    previewText: PRE[lang] || PRE.en,
    blocks: [
      { type: 'p', text: greeting(data.name, lang) },
      { type: 'p', text: BODY[lang] || BODY.en },
      { type: 'button', label: CTA[lang] || CTA.en, href: data.verifyUrl },
      { type: 'note', text: NOTE[lang] || NOTE.en },
      { type: 'link', label: pasteLinkLabel(lang), href: data.verifyUrl },
      { type: 'p', text: signoff(lang) },
    ],
  };
}
