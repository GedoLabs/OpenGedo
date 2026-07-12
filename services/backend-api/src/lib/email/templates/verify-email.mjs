import { greeting, signoff, pasteLinkLabel } from './_shared.mjs';

const S = { en: 'Verify your email', zh: '验证你的邮箱', ja: 'メールアドレスの確認' };
const PRE = {
  en: 'Confirm your email to secure your GEDO account.',
  zh: '确认邮箱以保护你的 GEDO 账户。',
  ja: 'メールを確認して GEDO アカウントを保護しましょう。',
};
const BODY = {
  en: 'Welcome to GEDO. Confirm this is your email address to secure your account and start with your companion.',
  zh: '欢迎加入 GEDO。请确认这是你的邮箱,以保护账户安全并开启你的智伴。',
  ja: 'GEDO へようこそ。アカウントを保護し、あなたのコンパニオンを始めるために、メールアドレスをご確認ください。',
};
const CTA = { en: 'Verify email', zh: '验证邮箱', ja: 'メールを確認' };
const NOTE = {
  en: "This link expires in 24 hours. If you didn't create a GEDO account, you can safely ignore this email.",
  zh: '该链接 24 小时内有效。如果你没有注册 GEDO 账户,可以忽略此邮件。',
  ja: 'このリンクの有効期限は24時間です。心当たりがない場合は、このメールを無視してください。',
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
