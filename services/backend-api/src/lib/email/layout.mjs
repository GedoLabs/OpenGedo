/**
 * Shared email shell + block renderer.
 *
 * Templates own only localized copy expressed as a small list of "blocks";
 * this module turns blocks into both an HTML body and a plaintext alternative,
 * and wraps the HTML in a client-robust shell (inline styles, ~520px card,
 * bulletproof-ish button, preheader). Keeping layout here means every template
 * stays consistent and none of them touch HTML.
 */

const BRAND = 'GEDO';
const SUPPORT_EMAIL = 'support@gedo.ai';

// Light palette — email dark-mode support across clients is inconsistent, so we
// commit to a clean light card rather than half-working theme swaps.
const C = {
  bg: '#f4f4f5',
  card: '#ffffff',
  text: '#0b0b0f',
  muted: '#6b7280',
  border: '#e5e7eb',
  accent: '#5b5bd6',
  accentText: '#ffffff',
};

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FOOTER = {
  en: {
    company: 'GEDO PTE. LTD. · Singapore',
    help: `Questions? Reach us at ${SUPPORT_EMAIL}`,
  },
  zh: {
    company: 'GEDO PTE. LTD. · 新加坡',
    help: `有疑问?联系我们:${SUPPORT_EMAIL}`,
  },
  ja: {
    company: 'GEDO PTE. LTD. · シンガポール',
    help: `ご不明な点は ${SUPPORT_EMAIL} までお問い合わせください`,
  },
};

/**
 * Render a list of blocks to { html, text }.
 * Block shapes:
 *   { type: 'p', text }
 *   { type: 'button', label, href }
 *   { type: 'note', text }              // muted small print
 *   { type: 'link', href, label? }      // copy-paste URL fallback line
 *   { type: 'kv', rows: [[k, v], ...] } // receipt-style table
 *   { type: 'hr' }
 */
export function renderBlocks(blocks = []) {
  const html = [];
  const text = [];

  for (const b of blocks) {
    switch (b?.type) {
      case 'p':
        html.push(`<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.text}">${escapeHtml(b.text)}</p>`);
        text.push(String(b.text ?? ''));
        break;
      case 'button':
        html.push(
          `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:8px;background:${C.accent}">` +
          `<a href="${escapeHtml(b.href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:${C.accentText};text-decoration:none;border-radius:8px">${escapeHtml(b.label)}</a>` +
          `</td></tr></table>`
        );
        text.push(`${b.label}: ${b.href}`);
        break;
      case 'note':
        html.push(`<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${C.muted}">${escapeHtml(b.text)}</p>`);
        text.push(String(b.text ?? ''));
        break;
      case 'link':
        html.push(`<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${C.muted};word-break:break-all">${escapeHtml(b.label ? b.label + ' ' : '')}<a href="${escapeHtml(b.href)}" style="color:${C.accent}">${escapeHtml(b.href)}</a></p>`);
        text.push(`${b.label ? b.label + ' ' : ''}${b.href}`);
        break;
      case 'kv': {
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const trs = rows.map(([k, v]) =>
          `<tr><td style="padding:6px 0;font-size:14px;color:${C.muted}">${escapeHtml(k)}</td>` +
          `<td style="padding:6px 0;font-size:14px;color:${C.text};text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`
        ).join('');
        html.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border}">${trs}</table>`);
        for (const [k, v] of rows) text.push(`${k}: ${v}`);
        break;
      }
      case 'hr':
        html.push(`<hr style="border:none;border-top:1px solid ${C.border};margin:20px 0" />`);
        text.push('---');
        break;
      default:
        break;
    }
  }

  return { html: html.join('\n'), text: text.join('\n\n') };
}

/**
 * Wrap a rendered content body in the full HTML document shell.
 * @param {{ lang: string, previewText?: string, contentHtml: string }} opts
 */
export function wrapHtml({ lang = 'en', previewText = '', contentHtml = '' }) {
  const f = FOOTER[lang] || FOOTER.en;
  const preheader = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(previewText)}</div>`
    : '';
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(BRAND)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.bg}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:${C.card};border-radius:14px;border:1px solid ${C.border}">
<tr><td style="padding:28px 32px 8px">
<div style="font-size:20px;font-weight:800;letter-spacing:0.02em;color:${C.text}">${escapeHtml(BRAND)}</div>
</td></tr>
<tr><td style="padding:12px 32px 8px">
${contentHtml}
</td></tr>
<tr><td style="padding:8px 32px 28px">
<hr style="border:none;border-top:1px solid ${C.border};margin:8px 0 16px" />
<p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:${C.muted}">${escapeHtml(f.company)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:${C.muted}">${escapeHtml(f.help)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plaintext footer appended after the block text. */
export function textFooter(lang = 'en') {
  const f = FOOTER[lang] || FOOTER.en;
  return `—\n${f.company}\n${f.help}`;
}
