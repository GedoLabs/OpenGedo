import { greeting, signoff } from './_shared.mjs';

// P1 growth — en-first. zh/ja fall back to en until copy is added (X[lang] || X.en).
const S = { en: "You're on the GEDO waitlist" };
const PRE = { en: "Thanks for joining the GEDO waitlist." };
const BODY = { en: "Thanks for joining the GEDO waitlist. We'll email you an invite as soon as a spot opens up — keep an eye on your inbox." };

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  return {
    previewText: PRE[lang] || PRE.en,
    blocks: [
      { type: 'p', text: greeting(data.name, lang) },
      { type: 'p', text: BODY[lang] || BODY.en },
      { type: 'p', text: signoff(lang) },
    ],
  };
}
