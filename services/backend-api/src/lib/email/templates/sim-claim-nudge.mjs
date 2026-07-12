import { greeting, signoff } from './_shared.mjs';

const S = {
  en: 'Your parallel life is saved — claim it',
  zh: '你的平行人生已为你保存 —— 注册即可领取',
  ja: 'あなたのパラレルライフを保存しました —— 受け取りましょう',
};
const PRE = {
  en: 'Create a free GEDO account to import your parallel-life story.',
  zh: '注册免费 GEDO 账号，把你的平行人生故事导入智伴。',
  ja: '無料の GEDO アカウントを作成して、パラレルライフの物語を取り込みましょう。',
};
const BODY = {
  en: 'You saved a parallel-life story to this email. Create a free GEDO account to import it into your companion and keep the story going.',
  zh: '你把一段平行人生故事寄存在了这个邮箱。注册免费 GEDO 账号，即可把它导入你的智伴，让故事继续。',
  ja: 'このメールアドレスにパラレルライフの物語を保存しました。無料の GEDO アカウントを作成すると、コンパニオンに取り込んで物語を続けられます。',
};
// 限量开放期的稀缺提示：不写死具体名额数字（邮件会过期，数字易失真），只强调「限量、已占位、尽快锁定」。
const SCARCITY = {
  en: 'GEDO is in limited open registration — your reserved email already counts toward the cap, so sign up soon to lock in your spot.',
  zh: 'GEDO 正在限量开放注册，你的预约邮箱已占用一个名额，请尽快注册锁定你的位置。',
  ja: 'GEDO は現在、数量限定でオープン登録中です。ご予約のメールアドレスはすでに枠を1つ確保しています。お早めにご登録いただき、あなたの枠を確定してください。',
};
const CTA = {
  en: 'Sign up & import',
  zh: '注册并导入',
  ja: '登録して取り込む',
};
const SAVED = { en: 'Saved story', zh: '已保存的故事', ja: '保存された物語' };

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const blocks = [
    { type: 'p', text: greeting(data.name, lang) },
    { type: 'p', text: BODY[lang] || BODY.en },
  ];
  if (data.personaLabel) blocks.push({ type: 'note', text: `${SAVED[lang] || SAVED.en}: ${data.personaLabel}` });
  if (data.signupUrl) blocks.push({ type: 'button', label: CTA[lang] || CTA.en, href: data.signupUrl });
  blocks.push({ type: 'note', text: SCARCITY[lang] || SCARCITY.en });
  blocks.push({ type: 'p', text: signoff(lang) });
  return { previewText: PRE[lang] || PRE.en, blocks };
}
