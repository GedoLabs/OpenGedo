/**
 * Template registry + renderer.
 *
 * renderEmail(name, lang, data) -> { subject, html, text }
 * Templates own localized copy as blocks; layout owns the HTML shell + text.
 */

import { wrapHtml, renderBlocks, textFooter } from './layout.mjs';
import { normalizeEmailLang } from './lang.mjs';

import * as verifyEmail from './templates/verify-email.mjs';
import * as verifyNewEmail from './templates/verify-new-email.mjs';
import * as passwordReset from './templates/password-reset.mjs';
import * as passwordChanged from './templates/password-changed.mjs';
import * as emailChanged from './templates/email-changed.mjs';
import * as subscriptionReceipt from './templates/subscription-receipt.mjs';
import * as subscriptionCanceled from './templates/subscription-canceled.mjs';
import * as paymentFailed from './templates/payment-failed.mjs';
import * as accountDeleted from './templates/account-deleted.mjs';
import * as waitlistConfirm from './templates/waitlist-confirm.mjs';
import * as waitlistInvite from './templates/waitlist-invite.mjs';
import * as simClaimNudge from './templates/sim-claim-nudge.mjs';
import * as personaInbox from './templates/persona-inbox.mjs';
import * as importComplete from './templates/import-complete.mjs';

const TEMPLATES = {
  // P0 — transactional (3-lang)
  verify_email: verifyEmail,
  verify_new_email: verifyNewEmail,
  password_reset: passwordReset,
  password_changed: passwordChanged,
  email_changed: emailChanged,
  subscription_receipt: subscriptionReceipt,
  subscription_canceled: subscriptionCanceled,
  payment_failed: paymentFailed,
  account_deleted: accountDeleted,
  // P1 — growth (en-first, 3-lang-ready)
  waitlist_confirm: waitlistConfirm,
  waitlist_invite: waitlistInvite,
  sim_claim_nudge: simClaimNudge,
  persona_inbox: personaInbox,
  import_complete: importComplete,
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * @param {string} name  one of TEMPLATE_NAMES
 * @param {string} langRaw
 * @param {object} data
 * @returns {{ subject: string, html: string, text: string, lang: string }}
 */
export function renderEmail(name, langRaw, data = {}) {
  const tpl = TEMPLATES[name];
  if (!tpl) throw new Error(`unknown email template: ${name}`);
  const lang = normalizeEmailLang(langRaw);

  const subject = tpl.subject(data, lang);
  const { previewText, blocks } = tpl.content(data, lang);
  const { html: contentHtml, text: bodyText } = renderBlocks(blocks);
  const html = wrapHtml({ lang, previewText, contentHtml });
  const text = `${bodyText}\n\n${textFooter(lang)}`;

  return { subject, html, text, lang };
}
