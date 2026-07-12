/**
 * Interaction Ingest Service
 *
 * Turns a finalized visitor session (external party chatting with the owner's
 * public digital human) into candidate items for the owner's review inbox.
 *
 * Ownership/permission note: visitor-contributed content is NEVER written
 * directly into the owner's trusted memory/tasks. We only produce *candidates*
 * (interactionInbox), each attributed to the source relationship. The owner
 * approves/rejects from the studio before anything lands in 执行/智忆.
 */

import { analyzeMessage } from './extract.service.mjs';

// Lightweight cues that a visitor message contains an action item for the owner.
const TASK_CUES = ['帮忙', '帮我', '能不能', '可以的话', '方便的话', '记得', '安排', '约', '提醒', '跟进', '回复我', '联系我', '发我', '看一下'];

function looksLikeTask(text) {
  const t = String(text || '');
  return TASK_CUES.some((c) => t.includes(c));
}

/**
 * Analyze a visitor session and return inbox-item drafts (NOT persisted here).
 * The caller persists via store.createInboxItems(userId, drafts).
 *
 * @param {object} session — a visitorSessions row
 * @returns {Promise<object[]>} inbox-item drafts
 */
export async function ingestSession(session) {
  if (!session || !Array.isArray(session.transcript)) return [];

  const sourceLabel = session.visitor?.declared_name
    ? `来自 ${session.visitor.declared_name}`
    : '来自访客';
  const base = {
    session_id: session.id,
    source_relationship_id: session.visitor?.relationship_id || null,
    source_label: sourceLabel,
  };

  const visitorMessages = session.transcript.filter((t) => t.role === 'user');
  const drafts = [];

  for (const msg of visitorMessages) {
    // Memory / reminder extraction (LLM, with rule-based fallback when no LLM).
    let analysis;
    try {
      analysis = await analyzeMessage(msg.content, session.transcript);
    } catch {
      analysis = { should_extract: false, extractions: [] };
    }
    if (analysis?.should_extract) {
      for (const ex of analysis.extractions || []) {
        const kind = ex.type === 'date_reminder' ? 'reminder' : 'memory';
        drafts.push({
          ...base,
          kind,
          confidence: typeof ex.confidence === 'number' ? ex.confidence : 0.5,
          payload: {
            type: ex.type,
            content: ex.content,
            tags: Array.isArray(ex.tags) ? ex.tags : [],
            reminder_date: ex.reminder_date || null,
            quote: msg.content,
          },
        });
      }
    }

    // Task heuristic — visitor explicitly asks the owner to do something.
    if (looksLikeTask(msg.content)) {
      drafts.push({
        ...base,
        kind: 'task',
        confidence: 0.5,
        payload: { title: msg.content.slice(0, 80), quote: msg.content },
      });
    }
  }

  return drafts;
}

export default { ingestSession };
