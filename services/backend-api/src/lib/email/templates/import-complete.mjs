import { greeting, signoff } from './_shared.mjs';

const S = { en: 'Your GEDO import is ready' };
const PRE = { en: 'Your import has finished processing.' };
const CTA = { en: 'Open GEDO' };

// Build an en detail line from whichever counts the caller provides.
function detailEn(d) {
  if (d.kind === 'source') {
    const n = Number(d.candidatesCreated) || 0;
    return n > 0
      ? `Your imported source is ready — ${n} item${n === 1 ? '' : 's'} to review.`
      : 'Your imported source has finished processing.';
  }
  // memory pack
  const ep = Number(d.episodesCreated) || 0;
  const ent = Number(d.entitiesTouched) || 0;
  const entPart = ent > 0 ? `, ${ent} ${ent === 1 ? 'entity' : 'entities'} updated` : '';
  return `Your import finished — ${ep} ${ep === 1 ? 'memory' : 'memories'} added${entPart}.`;
}

const DETAIL = { en: detailEn };

export function subject(_data, lang) { return S[lang] || S.en; }

export function content(data, lang) {
  const detail = (DETAIL[lang] || DETAIL.en)(data);
  const blocks = [
    { type: 'p', text: greeting(data.name, lang) },
    { type: 'p', text: detail },
  ];
  if (data.openUrl) blocks.push({ type: 'button', label: CTA[lang] || CTA.en, href: data.openUrl });
  blocks.push({ type: 'p', text: signoff(lang) });
  return { previewText: PRE[lang] || PRE.en, blocks };
}
