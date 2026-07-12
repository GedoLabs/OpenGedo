import { greeting, signoff, pasteLinkLabel } from './_shared.mjs';

const S = { en: 'Reset your GEDO password', zh: '重置你的 GEDO 密码', ja: 'GEDO パスワードの再設定' };
const PRE = {
  en: 'Reset your GEDO password.',
  zh: '重置你的 GEDO 密码。',
  ja: 'GEDO のパスワードを再設定します。',
};
const BODY = {
  en: 'We received a request to reset your password. Choose a new one with the button below.',
  zh: '我们收到了重置密码的请求。点击下方按钮设置新密码。',
  ja: 'パスワード再設定のリクエストを受け付けました。下のボタンから新しいパスワードを設定してください。',
};
const CTA = { en: 'Reset password', zh: '重置密码', ja: 'パスワードを再設定' };
const NOTE = {
  en: "This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email — your password stays the same.",
  zh: '该链接 1 小时内有效。如果你没有请求重置,可忽略此邮件,密码不会改变。',
  ja: 'このリンクの有効期限は1時間です。心当たりがない場合は無視してください。パスワードは変更されません。',
};

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  return {
    previewText: PRE[lang] || PRE.en,
    blocks: [
      { type: 'p', text: greeting(data.name, lang) },
      { type: 'p', text: BODY[lang] || BODY.en },
      { type: 'button', label: CTA[lang] || CTA.en, href: data.resetUrl },
      { type: 'note', text: NOTE[lang] || NOTE.en },
      { type: 'link', label: pasteLinkLabel(lang), href: data.resetUrl },
      { type: 'p', text: signoff(lang) },
    ],
  };
}
