import { greeting, signoff } from './_shared.mjs';

const S = { en: 'Your GEDO invite code is here' };
const PRE = { en: 'A spot opened up — here is your GEDO invite code.' };
const BODY = { en: 'A spot just opened up. Use the code below to create your GEDO account:' };
const CODE_LABEL = { en: 'Invite code' };
const CTA = { en: 'Create account' };
const NOTE = { en: 'Codes are limited — redeem yours soon.' };

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const blocks = [
    { type: 'p', text: greeting(data.name, lang) },
    { type: 'p', text: BODY[lang] || BODY.en },
    { type: 'kv', rows: [[(CODE_LABEL[lang] || CODE_LABEL.en), data.code || '']] },
  ];
  if (data.signupUrl) blocks.push({ type: 'button', label: CTA[lang] || CTA.en, href: data.signupUrl });
  blocks.push({ type: 'note', text: NOTE[lang] || NOTE.en });
  blocks.push({ type: 'p', text: signoff(lang) });
  return { previewText: PRE[lang] || PRE.en, blocks };
}
