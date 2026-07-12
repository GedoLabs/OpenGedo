import { greeting, signoff } from './_shared.mjs';

const S = { en: 'Someone talked to your GEDO persona' };
const PRE = { en: 'New items from a conversation with your persona are waiting for review.' };
const BODY = {
  en: (n) => `${n} new item${n === 1 ? '' : 's'} from a conversation with your published persona ${n === 1 ? 'is' : 'are'} waiting for your review.`,
};
const CTA = { en: 'Review items' };

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const n = Number(data.count) || 0;
  const body = (BODY[lang] || BODY.en)(n);
  const blocks = [
    { type: 'p', text: greeting(data.name, lang) },
    { type: 'p', text: body },
  ];
  if (data.reviewUrl) blocks.push({ type: 'button', label: CTA[lang] || CTA.en, href: data.reviewUrl });
  blocks.push({ type: 'p', text: signoff(lang) });
  return { previewText: PRE[lang] || PRE.en, blocks };
}
