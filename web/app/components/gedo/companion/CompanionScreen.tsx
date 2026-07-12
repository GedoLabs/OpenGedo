'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { resolveApiBaseUrl, type ChatAttachment, type ChatMode, type ChatReference, type CompanionBrief, type CompanionBriefSuggestion, type ConversationSummary, type MemoryCandidate } from '@/lib/apiClient';
import { parseGedoCards, type GedoCard } from '@/lib/genui/schemas';
import CardRenderer from '@/app/components/chat/CardRenderer';
import { NotifDrawer } from './NotifDrawer';
import { VoiceSession } from './VoiceSession';
import { ReminderRuleModal } from '@/app/components/gedo/memory/ReminderRuleModal';
import { Drawer } from '@/app/components/gedo/Drawer';
import {
  IconSearch, IconPlus, IconClock, IconMic, IconSend,
  IconMemory, IconTarget, IconLayers, IconChev, IconChevD, IconWave,
  IconCheck, IconSpark, IconBolt, IconBell, IconEdit, IconTrash, IconStop, IconWand,
} from '@/app/components/gedo/icons';
import {
  Pill, Dot,
  primaryBtnStyle, ghostBtnStyle, iconBtnStyle,
} from '@/app/components/gedo/primitives';
import { fontVars, text } from '@/app/components/gedo/typography';

type ChatRole = 'user' | 'assistant';

type ToolEvent = { kind: 'call' | 'result'; name: string; detail: string; status: 'success' | 'running' | 'failed'; goalId?: string; result?: unknown };

// Translator type for module-level helpers that surface localized text.
type Tr = (key: string, values?: Record<string, string | number>) => string;

// Backend tool names that have a localized label under app.companion.tools.*;
// anything else falls through to the raw identifier.
const KNOWN_TOOLS = [
  'capture_memory', 'search_memory', 'create_goal', 'plan_goal',
  'create_task', 'complete_task', 'list_today_tasks', 'list_goals', 'generate_review',
];

function toolLabel(name: string, t: Tr): string {
  return KNOWN_TOOLS.includes(name) ? t(`companion.tools.${name}`) : name;
}

// Mode-picker → forced tool_hint. 'auto' sends no hint (today's LLM
// auto-detection + wantsDecompose backstop keeps running unchanged).
const MODE_TOOL_MAP: Record<ChatMode, string | undefined> = {
  auto: undefined,
  memory: 'capture_memory',
  todo: 'create_task',
  goal: 'plan_goal',
  review: 'generate_review',
};

const CHAT_MODES: ChatMode[] = ['auto', 'memory', 'todo', 'goal', 'review'];

function modeColor(mode: ChatMode): string {
  switch (mode) {
    case 'memory': return 'var(--g-dim-memory)';
    case 'todo': return 'var(--g-dim-exec)';
    case 'goal': return 'var(--g-dim-goal)';
    case 'review': return 'var(--g-dim-insight)';
    default: return 'var(--g-text-muted)';
  }
}

function ModeIcon({ mode, size }: { mode: ChatMode; size: number }) {
  switch (mode) {
    case 'memory': return <IconMemory size={size} />;
    case 'todo': return <IconCheck size={size} />;
    case 'goal': return <IconTarget size={size} />;
    case 'review': return <IconLayers size={size} />;
    default: return <IconSpark size={size} />;
  }
}

/**
 * Turn a raw tool result into a human-readable one-line summary + status.
 * Never surfaces raw JSON: prefers the backend's `message`, falls back to
 * count-based summaries, then a generic "完成".
 */
function summarizeToolResult(tool: string, result: unknown, t: Tr): { detail: string; status: 'success' | 'failed' } {
  let obj: Record<string, unknown> | null = null;
  if (result && typeof result === 'object') {
    obj = result as Record<string, unknown>;
  } else if (typeof result === 'string') {
    const trimmed = result.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { obj = JSON.parse(trimmed); } catch { /* not JSON */ }
    }
    // A plain, non-JSON string is already human-readable.
    if (!obj) return { detail: trimmed.slice(0, 80) || t('companion.result.done'), status: 'success' };
  }

  if (!obj) return { detail: t('companion.result.done'), status: 'success' };

  if (obj.success === false) {
    return { detail: typeof obj.message === 'string' ? obj.message : t('companion.result.failed'), status: 'failed' };
  }

  // Backend mutating tools carry a ready-to-show message (server-side, not localized here).
  if (typeof obj.message === 'string' && obj.message) {
    return { detail: obj.message, status: 'success' };
  }

  // Read tools: summarize by count.
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  switch (tool) {
    case 'search_memory': {
      const n = num(obj.total) ?? num(obj.count) ?? 0;
      return { detail: n > 0 ? t('companion.result.foundMemories', { n }) : t('companion.result.noMemories'), status: 'success' };
    }
    case 'list_today_tasks': {
      const n = num(obj.count) ?? 0;
      return { detail: n > 0 ? t('companion.result.todayTasks', { n }) : t('companion.result.noTodayTasks'), status: 'success' };
    }
    case 'list_goals': {
      const n = num(obj.count) ?? 0;
      return { detail: n > 0 ? t('companion.result.totalGoals', { n }) : t('companion.result.noGoals'), status: 'success' };
    }
    default:
      return { detail: t('companion.result.done'), status: 'success' };
  }
}

type ChatMsg = {
  id: string;
  role: ChatRole;
  text: string;
  tools?: ToolEvent[];
  cards?: GedoCard[];
  pending?: boolean;
  attachments?: ChatAttachment[];
  /** 显式关联（「+」→ 关联目标/待办/图鉴卡），随消息 metadata 持久化。 */
  references?: ChatReference[];
  /** Generation was force-stopped mid-reply — persisted via metadata.stopped. */
  stopped?: boolean;
};

// Normalized identity for a capture — mirrors the backend dedup key so the
// panel never renders two cards for the same item even if the backend ever
// emits a near-identical candidate with a fresh id.
function captureKey(c: MemoryCandidate): string {
  const text = (c.kind === 'task' ? (c.title || c.content) : (c.content || c.title)) || '';
  const norm = text
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
  const due = c.kind === 'task' ? (c.due_date || '') : '';
  return `${c.kind}|${norm}|${due}`;
}

export function CompanionScreen() {
  const { api, user } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [composerText, setComposerText] = useState('');
  // Sticky mode-picker selection — stays selected (like a Claude Code model
  // picker) until the user switches it back to 'auto', not reset per-send.
  const [mode, setMode] = useState<ChatMode>('auto');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [pendingRefs, setPendingRefs] = useState<ChatReference[]>([]);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  // 智能引导（P8）：动态开场白 + 真实数据建议卡；失败回落静态 quick 文案。
  const [brief, setBrief] = useState<CompanionBrief | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [convDrawerOpen, setConvDrawerOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Armed message pending a delete confirm — separate from ConvList's own
  // `pendingDelete` (conversation-level) so the two confirm bars can't cross wires.
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null);
  // The in-flight stream's AbortController, so the Stop button can cancel it.
  const streamAbortRef = useRef<AbortController | null>(null);
  const greetName = user?.email?.split('@')[0] || t('companion.defaultName');

  // 图鉴「聊聊TA」等入口：?refType=entity&refId=…&refLabel=… → 注入待发送 chips（一次）。
  const searchParams = useSearchParams();
  const consumedRefParam = useRef<string | null>(null);
  useEffect(() => {
    const type = searchParams?.get('refType');
    const id = searchParams?.get('refId');
    const label = searchParams?.get('refLabel') || '';
    if (!id || !(type === 'goal' || type === 'task' || type === 'entity')) return;
    const key = `${type}:${id}`;
    if (consumedRefParam.current === key) return;
    consumedRefParam.current = key;
    const ref: ChatReference = { type, id, label };
    setPendingRefs(prev => prev.some(r => r.type === ref.type && r.id === ref.id) ? prev : [...prev, ref].slice(0, 5));
  }, [searchParams]);

  // 智能引导拉取：挂载时取一次（brief 端点毫秒级；LLM 开场白由后端每日缓存）。
  useEffect(() => {
    let cancelled = false;
    api.getCompanionBrief(locale)
      .then(b => { if (!cancelled) setBrief(b); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, locale]);

  // Proactive captures (memory/todo candidates) surfaced in the context panel.
  const [captures, setCaptures] = useState<MemoryCandidate[]>([]);

  // Restore historical pending candidates on mount (survives reloads / session switches).
  useEffect(() => {
    let cancelled = false;
    api.listCaptures({ status: 'pending', limit: 20 })
      .then(r => { if (!cancelled) setCaptures(r?.items ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api]);

  const upsertCapture = useCallback((c: MemoryCandidate) => {
    const key = captureKey(c);
    setCaptures(prev => {
      // Match by id first, then by normalized content (last-resort dedup guard).
      let idx = prev.findIndex(x => x.id === c.id);
      if (idx < 0) idx = prev.findIndex(x => captureKey(x) === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = c;
        return next;
      }
      return [c, ...prev].slice(0, 30);
    });
  }, []);

  const handleDecideCapture = useCallback(async (
    id: string,
    decision: 'approve' | 'reject',
    edits?: { content?: string; title?: string }
  ) => {
    try {
      const updated = await api.decideCapture(id, decision, edits);
      upsertCapture(updated);
    } catch { /* swallow */ }
  }, [api, upsertCapture]);

  const handleUndoCapture = useCallback(async (id: string) => {
    try {
      const updated = await api.undoCapture(id);
      upsertCapture(updated);
    } catch { /* swallow */ }
  }, [api, upsertCapture]);

  /** Load one conversation's messages from the backend (sidebar switch / mount only). */
  const hydrateConversation = useCallback(async (cid: string) => {
    setLoadingHistory(true);
    try {
      const r = await api.getConversationMessages(cid);
      const msgs: ChatMsg[] = (r?.messages ?? [])
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          // Rehydrate persisted tool events so the context panel survives reloads.
          const rawTools = (m.metadata?.tools as Array<{ name: string; result: unknown }> | undefined) ?? [];
          const tools: ToolEvent[] = rawTools.map(te => {
            const { detail, status } = summarizeToolResult(te.name, te.result, t);
            const r = te.result as { goal_id?: string; goalId?: string; goal?: { id?: string } } | null;
            const goalId = r && typeof r === 'object' ? (r.goal_id ?? r.goalId ?? r.goal?.id) : undefined;
            return { kind: 'result' as const, name: te.name, detail, status, result: te.result, ...(goalId ? { goalId } : {}) };
          });
          // Re-extract gedo:card fences from the stored body, plus route-B cards
          // persisted inside tool results, so GenUI cards (snapshot / goal_progress …)
          // survive reloads instead of vanishing or rendering as a raw fence.
          const toolCards = rawTools
            .map(te => (te.result && typeof te.result === 'object' ? (te.result as { card?: GedoCard }).card : undefined))
            .filter((c): c is GedoCard => !!c);
          const { text, cards: fenceCards } = m.role === 'assistant'
            ? parseGedoCards(m.content)
            : { text: m.content, cards: [] as GedoCard[] };
          const cards = [...fenceCards, ...toolCards];
          return {
            id: m.id,
            role: m.role as ChatRole,
            text,
            ...(tools.length ? { tools } : {}),
            ...(cards.length ? { cards } : {}),
            ...(Array.isArray(m.metadata?.references) ? { references: m.metadata.references as ChatReference[] } : {}),
            ...(m.metadata?.stopped ? { stopped: true } : {}),
          };
        });
      setMessages(msgs);
    } catch {
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [api]);

  // Load conversation list once; hydrate the most recent thread on mount.
  useEffect(() => {
    let cancelled = false;
    api.listConversations()
      .then(r => {
        if (cancelled) return;
        const items = r?.conversations ?? [];
        setConversations(items);
        if (items.length > 0) {
          const firstId = items[0].id;
          setActiveId(firstId);
          void hydrateConversation(firstId);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, hydrateConversation]);

  const handleSelectConversation = useCallback((cid: string) => {
    if (cid === activeId || streaming) return;
    setActiveId(cid);
    setConvDrawerOpen(false);
    void hydrateConversation(cid);
  }, [activeId, streaming, hydrateConversation]);

  // Pending proactive count (for the bell badge)
  useEffect(() => {
    let cancelled = false;
    api.listProactiveMessages()
      .then(r => {
        if (cancelled) return;
        const pending = (r?.items ?? []).filter(m => !m.feedback).length;
        setUnreadCount(pending);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, notifOpen]);

  // For VoiceSession — runs chatStream with custom onText/onDone hooks
  // so the voice modal owns the transcript stream, and also pushes the
  // round-trip into the visible chat history.
  const handleVoiceSend = useCallback(async (
    text: string,
    hooks: {
      onText: (chunk: string) => void;
      onDone: () => void;
      onError: (err: string) => void;
    }
  ) => {
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', text };
    const aiId = `a-${Date.now()}`;
    setMessages(prev => [...prev, userMsg, { id: aiId, role: 'assistant', text: '', tools: [], pending: true }]);
    let accumulated = '';
    try {
      await api.chatStream(
        { message: text, conversation_id: activeId ?? undefined, persona_mode: 'FOR' },
        {
          onText: chunk => {
            accumulated += chunk;
            hooks.onText(chunk);
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: accumulated, pending: true } : m));
          },
          onConversation: data => { if (!activeId && data.id) setActiveId(data.id); },
          onMemoryCandidate: upsertCapture,
          onDone: () => {
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, pending: false } : m));
            hooks.onDone();
          },
          onError: err => {
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: accumulated || t('companion.result.error', { err }), pending: false } : m));
            hooks.onError(err);
          },
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('companion.result.connectFailed');
      setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: msg, pending: false } : m));
      hooks.onError(msg);
    }
  }, [activeId, api, upsertCapture]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch { /* swallow */ }
  }, [api, activeId]);

  // Shared by a plain send and an edit-then-resend: takes text/attachments as
  // params (not read from composer state) so both callers can share the same
  // ~70-line streaming-callback wiring. Composer-clearing stays in the thin
  // `handleSend` wrapper below — an edit-resend has no composer state to clear.
  const sendMessage = useCallback(async (text: string, opts: { attachments?: ChatAttachment[]; references?: ChatReference[]; editMessageId?: string } = {}) => {
    const attachments = opts.attachments ?? [];
    const references = opts.references ?? [];
    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`, role: 'user', text,
      ...(attachments.length ? { attachments } : {}),
      ...(references.length ? { references } : {}),
    };
    const aiId = `a-${Date.now()}`;
    setMessages(prev => [...prev, userMsg, { id: aiId, role: 'assistant', text: '', tools: [], pending: true }]);
    setStreaming(true);

    let accumulated = '';
    const tools: ToolEvent[] = [];
    const cards: GedoCard[] = [];
    // Force-stop: this controller's signal rides the fetch all the way down to
    // the LLM provider call server-side — Stop actually cancels generation,
    // it doesn't just stop the UI from listening.
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      await api.chatStream(
        {
          message: text,
          conversation_id: activeId ?? undefined,
          persona_mode: 'FOR',
          tool_hint: MODE_TOOL_MAP[mode],
          ...(attachments.length ? { attachments } : {}),
          ...(references.length ? { references: references.map(({ type, id }) => ({ type, id })) } : {}),
          ...(opts.editMessageId ? { edit_message_id: opts.editMessageId } : {}),
        },
        {
          onText: chunk => {
            accumulated += chunk;
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: accumulated, pending: true } : m));
          },
          onToolCall: ({ name }) => {
            tools.push({ kind: 'call', name, detail: t('companion.result.calling'), status: 'running' });
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, tools: [...tools] } : m));
          },
          onToolResult: ({ tool, result }) => {
            const { detail, status } = summarizeToolResult(tool, result, t);
            const r = result as { goal_id?: string; goalId?: string; goal?: { id?: string }; card?: GedoCard } | null;
            const goalId = r && typeof r === 'object' ? (r.goal_id ?? r.goalId ?? r.goal?.id) : undefined;
            // Mark the matching running call with its outcome, or append a new entry
            const idx = tools.findIndex(t => t.name === tool && t.status === 'running');
            if (idx >= 0) tools[idx] = { ...tools[idx], status, detail, result, ...(goalId ? { goalId } : {}) };
            else tools.push({ kind: 'result', name: tool, detail, status, result, ...(goalId ? { goalId } : {}) });
            // Route-B (tool-driven) cards: a tool result carrying a `card` renders
            // through the same CardRenderer as fenced cards — but with real
            // backend data (e.g. show_goal_progress computes true progress).
            if (r?.card) cards.push(r.card);
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, tools: [...tools], cards: [...cards] } : m));
          },
          onCard: card => {
            cards.push(card);
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, cards: [...cards] } : m));
          },
          onConversation: data => {
            if (!activeId && data.id) setActiveId(data.id);
          },
          onMemoryCandidate: upsertCapture,
          onDone: data => {
            // Reconcile the transient u-/a- ids for real persisted ones so
            // this turn's messages can be edited/deleted without a reload.
            setMessages(prev => prev.map(m => {
              if (m.id === aiId) return { ...m, id: data.assistant_message_id ?? m.id, pending: false };
              if (m.id === userMsg.id) return { ...m, id: data.user_message_id ?? m.id };
              return m;
            }));
            if (data.conversation_id && data.title) {
              setConversations(prev => {
                const exists = prev.find(c => c.id === data.conversation_id);
                if (exists) return prev.map(c => c.id === data.conversation_id ? { ...c, title: data.title ?? c.title, updated_at: new Date().toISOString() } : c);
                return [{
                  id: data.conversation_id,
                  user_id: user?.id ?? '',
                  title: data.title ?? t('companion.untitled'),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }, ...prev];
              });
            }
          },
          onAborted: () => {
            // Real ids + the persisted `stopped` marker aren't known locally —
            // resync from the backend, which already persisted the partial
            // reply (server.mjs's 'aborted' case) by the time this fires.
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, pending: false } : m));
            if (activeId) void hydrateConversation(activeId);
          },
          onError: err => {
            // Finalize any still-running tool card so it never hangs on "调用中…".
            for (let i = 0; i < tools.length; i++) {
              if (tools[i].status === 'running') tools[i] = { ...tools[i], status: 'failed', detail: t('companion.result.interrupted') };
            }
            const friendly = err === 'stream_stalled' ? t('companion.result.timeout') : t('companion.result.error', { err });
            setMessages(prev => prev.map(m => m.id === aiId
              ? { ...m, text: accumulated || friendly, tools: [...tools], pending: false }
              : m));
          },
        },
        { signal: abortController.signal }
      );
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === aiId
        ? { ...m, text: accumulated || t('companion.result.connectFailedDetail', { err: err instanceof Error ? err.message : String(err) }), pending: false }
        : m
      ));
    } finally {
      setStreaming(false);
      streamAbortRef.current = null;
    }
  }, [activeId, api, user?.id, upsertCapture, mode, hydrateConversation]);

  // 智能建议卡点击：chat=直接发送（不是预填），其余映射到对应动作。
  const handleBriefSuggestion = useCallback((s: CompanionBriefSuggestion) => {
    if (streaming) return;
    if (s.action === 'open_conversation' && s.conversation_id) {
      setActiveId(s.conversation_id);
      void hydrateConversation(s.conversation_id);
    } else if (s.action === 'open_pending') {
      setNotifOpen(true);
    } else if (s.prompt || s.label) {
      void sendMessage(s.prompt || s.label);
    }
  }, [streaming, hydrateConversation, sendMessage]);

  const handleSend = useCallback(async () => {
    const text = composerText.trim();
    if ((!text && pendingAttachments.length === 0) || streaming) return;
    const attachments = pendingAttachments;
    const references = pendingRefs;
    setComposerText('');
    setPendingAttachments([]);
    setPendingRefs([]);
    await sendMessage(text, { attachments, references });
  }, [composerText, pendingAttachments, pendingRefs, streaming, sendMessage]);

  // Edit = truncate this message + everything after it, then resend the
  // edited text as a normal turn (server does the actual truncation, keyed by
  // the real persisted id — see the id-reconciliation in onDone above).
  const handleEditMessage = useCallback(async (id: string, newText: string) => {
    const text = newText.trim();
    if (!text || streaming) return;
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      return idx === -1 ? prev : prev.slice(0, idx);
    });
    await sendMessage(text, { editMessageId: id });
  }, [streaming, sendMessage]);

  const handleDeleteMessage = useCallback(async (id: string) => {
    if (!activeId) return;
    try {
      await api.deleteConversationMessage(activeId, id);
      setMessages(prev => prev.filter(m => m.id !== id));
    } catch { /* swallow */ }
  }, [api, activeId]);

  // Two-step confirm for message delete, same shape as ConvList's own
  // pendingDelete but a separate variable (see the state declaration above).
  const handleConfirmDeleteMessage = useCallback(() => {
    if (pendingDeleteMessageId) void handleDeleteMessage(pendingDeleteMessageId);
    setPendingDeleteMessageId(null);
  }, [pendingDeleteMessageId, handleDeleteMessage]);
  const handleCancelDeleteMessage = useCallback(() => setPendingDeleteMessageId(null), []);

  const handleStop = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const handleAddAttachment = useCallback(async (file: File) => {
    setUploadingAttachment(true);
    try {
      const uploaded = await api.uploadChatAttachment(file, file.name);
      setPendingAttachments(prev => [...prev, uploaded]);
    } catch { /* swallow — composer just won't show a new chip */ }
    finally { setUploadingAttachment(false); }
  }, [api]);

  const handleRemoveAttachment = useCallback((url: string) => {
    setPendingAttachments(prev => prev.filter(a => a.url !== url));
  }, []);

  const handleNewConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setComposerText('');
  }, []);

  return (
    <div className="gedo-companion-screen" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', background: 'var(--g-bg)' }}>
      <header
        className="gedo-screen-header gedo-companion-header"
        style={{
          minHeight: 60,
          flexShrink: 0,
          padding: '10px 28px',
          borderBottom: '1px solid var(--g-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--g-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div
            className="gedo-hide-mobile"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--g-text-faint)',
              fontSize: fontVars.sm,
              fontFamily: 'var(--g-font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            <span>GEDO</span>
            <span style={{ opacity: 0.5 }}>/</span>
            <span style={{ color: 'var(--g-text-mid)' }}>{t('companion.brand')}</span>
          </div>
          <div className="gedo-companion-hero-text">
            <h1 style={{ margin: 0, fontSize: fontVars.md, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 }}>
              {brief?.greeting?.text || t('companion.heroTitle', { name: greetName })}
            </h1>
            <p className="gedo-hide-mobile-subtitle" style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.4 }}>
              {t('companion.heroSubtitle')}
            </p>
          </div>
        </div>
        <div className="gedo-screen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            style={{
              ...ghostBtnStyle(),
              position: 'relative',
              padding: '6px 10px',
            }}
            onClick={() => setNotifOpen(true)}
            title={t('companion.notifications')}
            aria-label={t('companion.notifications')}
          >
            <IconBell size={14} />
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 4,
                  minWidth: 14,
                  height: 14,
                  padding: '0 4px',
                  borderRadius: 999,
                  background: 'var(--g-accent)',
                  color: 'var(--g-accent-ink)',
                  fontSize: fontVars.sm,
                  fontWeight: 600,
                  fontFamily: 'var(--g-font-mono)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>
          <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.sm }} onClick={() => setVoiceOpen(true)}>
            <IconWave size={14} /> <span className="gedo-btn-label">{t('companion.voiceChat')}</span>
          </button>
          <button type="button" style={{ ...primaryBtnStyle(), fontSize: fontVars.sm }} onClick={handleNewConversation}>
            <IconPlus size={14} /> <span className="gedo-btn-label">{t('companion.newSession')}</span>
          </button>
        </div>
      </header>

      <div className="gedo-mobile-toolbar gedo-mobile-toolbar-compact gedo-mobile-only">
        <button type="button" style={{ ...ghostBtnStyle(), padding: '6px 10px' }} onClick={() => setConvDrawerOpen(true)} title={t('nav.search')} aria-label={t('nav.search')}>
          <IconClock size={14} />
        </button>
        <button type="button" style={{ ...ghostBtnStyle(), padding: '6px 10px' }} onClick={() => setContextDrawerOpen(true)} title={t('companion.board.title')} aria-label={t('companion.board.title')}>
          <IconLayers size={14} />
        </button>
        <button
          type="button"
          style={{ ...ghostBtnStyle(), position: 'relative', padding: '6px 10px' }}
          onClick={() => setNotifOpen(true)}
          title={t('companion.notifications')}
          aria-label={t('companion.notifications')}
        >
          <IconBell size={14} />
          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 4,
                minWidth: 14,
                height: 14,
                padding: '0 4px',
                borderRadius: 999,
                background: 'var(--g-accent)',
                color: 'var(--g-accent-ink)',
                fontSize: fontVars.sm,
                fontWeight: 600,
                fontFamily: 'var(--g-font-mono)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>
        <button type="button" style={primaryBtnStyle()} onClick={handleNewConversation} title={t('companion.newSession')} aria-label={t('companion.newSession')}>
          <IconPlus size={14} />
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <ConvList items={conversations} active={activeId} onSelect={handleSelectConversation} onDelete={handleDeleteConversation} />
        <ChatColumn
          messages={messages}
          loading={loadingHistory}
          streaming={streaming}
          composerText={composerText}
          onComposerChange={setComposerText}
          onSend={handleSend}
          onStop={handleStop}
          mode={mode}
          onModeChange={setMode}
          pendingAttachments={pendingAttachments}
          onAddAttachment={handleAddAttachment}
          onRemoveAttachment={handleRemoveAttachment}
          uploadingAttachment={uploadingAttachment}
          pendingRefs={pendingRefs}
          onRemoveRef={(type, id) => setPendingRefs(prev => prev.filter(r => !(r.type === type && r.id === id)))}
          onOpenRefPicker={() => setRefPickerOpen(true)}
          brief={brief}
          onBriefSuggestion={handleBriefSuggestion}
          onEditMessage={handleEditMessage}
          pendingDeleteMessageId={pendingDeleteMessageId}
          onAskDeleteMessage={setPendingDeleteMessageId}
          onConfirmDeleteMessage={handleConfirmDeleteMessage}
          onCancelDeleteMessage={handleCancelDeleteMessage}
        />
        <ContextPanel
          messages={messages}
          captures={captures}
          onDecide={handleDecideCapture}
          onUndo={handleUndoCapture}
        />
      </div>

      <NotifDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
      <VoiceSession open={voiceOpen} onClose={() => setVoiceOpen(false)} onSend={handleVoiceSend} />
      <RefPickerPanel
        open={refPickerOpen}
        onClose={() => setRefPickerOpen(false)}
        initial={pendingRefs}
        onConfirm={setPendingRefs}
      />

      <Drawer open={convDrawerOpen} onClose={() => setConvDrawerOpen(false)} title={t('nav.search')} side="left" width={300}>
        <div className="gedo-drawer-inner" style={{ height: '100%' }}>
          <ConvList items={conversations} active={activeId} onSelect={handleSelectConversation} onDelete={handleDeleteConversation} />
        </div>
      </Drawer>
      <Drawer open={contextDrawerOpen} onClose={() => setContextDrawerOpen(false)} title={t('companion.board.title')} width={340}>
        <div className="gedo-drawer-inner" style={{ height: '100%' }}>
          <ContextPanel
            messages={messages}
            captures={captures}
            onDecide={handleDecideCapture}
            onUndo={handleUndoCapture}
            embedded
          />
        </div>
      </Drawer>
    </div>
  );
}

// ── Conversation list ─────────────────────────────────────────────────
function ConvList({
  items, active, onSelect, onDelete,
}: {
  items: ConversationSummary[];
  active: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('app');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(c => (c.title ?? '').toLowerCase().includes(q));
  }, [items, query]);

  const sections = useMemo(() => groupConversationsByDate(filtered, t), [filtered, t]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    const focus = () => { searchRef.current?.focus(); };
    window.addEventListener('gedo:focus-conv-search', focus);
    return () => window.removeEventListener('gedo:focus-conv-search', focus);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside
      className="gedo-aux-sidebar gedo-conv-sidebar"
      style={{
        width: 248,
        flexShrink: 0,
        borderRight: '1px solid var(--g-border)',
        background: 'var(--g-bg-raised)',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 10px',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          borderRadius: 10,
          padding: '6px 10px',
          marginBottom: 14,
          color: 'var(--g-text-muted)',
          fontSize: fontVars.base,
        }}
      >
        <IconSearch size={14} style={{ flexShrink: 0 }} />
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('companion.searchPlaceholder')}
          style={{
            marginLeft: 8,
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--g-text)',
            fontSize: fontVars.base,
            fontFamily: 'var(--g-font-sans)',
            minWidth: 0,
          }}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g-text-faint)', padding: 0, fontSize: fontVars.base, lineHeight: 1 }}
          >×</button>
        ) : (
          <span
            style={{
              fontFamily: 'var(--g-font-mono)',
              fontSize: fontVars.xs,
              color: 'var(--g-text-faint)',
              padding: '1px 5px',
              border: '1px solid var(--g-border)',
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            ⌘K
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {sections.length === 0 && (
          <div
            style={{
              padding: '40px 10px',
              textAlign: 'center',
              color: 'var(--g-text-faint)',
              fontSize: fontVars.sm,
              border: '1px dashed var(--g-border)',
              borderRadius: 10,
            }}
          >
            {query ? t('companion.noMatch', { query }) : t('companion.noConversations')}
          </div>
        )}
        {sections.map(sec => (
          <div key={sec.label}>
            <div
              style={{
                fontSize: fontVars.sm,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--g-text-faint)',
                padding: '0 8px 6px',
                fontFamily: 'var(--g-font-mono)',
              }}
            >
              {sec.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sec.items.map(it => (
                <ConvRow
                  key={it.id}
                  item={it}
                  isActive={it.id === active}
                  pendingDelete={pendingDelete === it.id}
                  onSelect={() => onSelect(it.id)}
                  onAskDelete={() => setPendingDelete(it.id)}
                  onConfirmDelete={() => { onDelete(it.id); setPendingDelete(null); }}
                  onCancelDelete={() => setPendingDelete(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ConvRow({
  item, isActive, pendingDelete, onSelect, onAskDelete, onConfirmDelete, onCancelDelete,
}: {
  item: ConversationSummary;
  isActive: boolean;
  pendingDelete: boolean;
  onSelect: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const t = useTranslations('app');
  const locale = useLocale();
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); if (pendingDelete) onCancelDelete(); }}
      style={{
        position: 'relative',
        background: isActive ? 'var(--g-surface-1)' : 'transparent',
        border: `1px solid ${isActive ? 'var(--g-border)' : 'transparent'}`,
        borderRadius: 10,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: '8px 10px',
          paddingRight: hover || isActive ? 32 : 10,
          cursor: 'pointer',
          color: 'inherit',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          borderRadius: 10,
          fontFamily: 'var(--g-font-sans)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color="var(--g-text-faint)" size={6} />
          <span
            style={{
              fontSize: fontVars.sm,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--g-text)' : 'var(--g-text-mid)',
              flex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.title || t('companion.untitled')}
          </span>
          <span style={{ fontSize: fontVars['2xs'], color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}>
            {formatTime(item.updated_at, locale, t)}
          </span>
        </div>
        {item.last_message && (
          <div
            style={{
              fontSize: fontVars['2xs'],
              color: 'var(--g-text-faint)',
              paddingLeft: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {stripMarkdown(item.last_message)}
          </div>
        )}
      </button>
      {(hover || isActive) && !pendingDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAskDelete(); }}
          title={t('companion.deleteConversation')}
          aria-label={t('companion.deleteConversation')}
          style={{
            position: 'absolute',
            top: '50%',
            right: 8,
            transform: 'translateY(-50%)',
            width: 20,
            height: 20,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--g-text-faint)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
      {pendingDelete && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 4,
            padding: '0 6px',
            background: 'color-mix(in oklch, var(--g-danger) 14%, var(--g-bg-raised))',
            border: '1px solid color-mix(in oklch, var(--g-danger) 32%, transparent)',
            borderRadius: 10,
            fontSize: fontVars.xs,
          }}
        >
          <span style={{ flex: 1, paddingLeft: 6, color: 'var(--g-text)' }}>{t('companion.deleteQuestion')}</span>
          <button
            type="button"
            onClick={onCancelDelete}
            style={{
              border: '1px solid var(--g-border)',
              background: 'transparent',
              color: 'var(--g-text-mid)',
              borderRadius: 6,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: fontVars.xs,
              fontFamily: 'var(--g-font-sans)',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirmDelete}
            style={{
              border: 'none',
              background: 'var(--g-danger)',
              color: '#fff',
              borderRadius: 6,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: fontVars.xs,
              fontFamily: 'var(--g-font-sans)',
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

function groupConversationsByDate(items: ConversationSummary[], t: Tr): { label: string; items: ConversationSummary[] }[] {
  const today: ConversationSummary[] = [];
  const yesterday: ConversationSummary[] = [];
  const earlier: ConversationSummary[] = [];
  const now = new Date();
  const yyyy_mm_dd = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const todayKey = yyyy_mm_dd(now);
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  const yestKey = yyyy_mm_dd(yest);
  for (const it of items) {
    const k = yyyy_mm_dd(new Date(it.updated_at));
    if (k === todayKey) today.push(it);
    else if (k === yestKey) yesterday.push(it);
    else earlier.push(it);
  }
  const out: { label: string; items: ConversationSummary[] }[] = [];
  if (today.length) out.push({ label: t('companion.groupToday'), items: today });
  if (yesterday.length) out.push({ label: t('companion.groupYesterday'), items: yesterday });
  if (earlier.length) out.push({ label: t('companion.groupEarlier'), items: earlier });
  return out;
}

function formatTime(iso: string, locale: string, t: Tr): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('companion.timeJustNow');
    if (diffMin < 60) return t('companion.timeMinutesAgo', { n: diffMin });

    const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const yest = new Date(now); yest.setDate(yest.getDate() - 1);
    const isYesterday = d.getDate() === yest.getDate() && d.getMonth() === yest.getMonth() && d.getFullYear() === yest.getFullYear();
    if (isYesterday) return t('companion.groupYesterday');

    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) return t('companion.timeDaysAgo', { n: diffDays });

    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(locale, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** Strips the handful of markdown tokens common in assistant replies so a one-line preview doesn't show raw `**`/`#`/`-`. */
function stripMarkdown(text: string): string {
  return text.replace(/[*_#`]/g, '').replace(/^[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
}

// ── Chat column ───────────────────────────────────────────────────────
function ChatColumn({
  messages, loading, streaming, composerText, onComposerChange, onSend, onStop,
  mode, onModeChange, pendingAttachments, onAddAttachment, onRemoveAttachment, uploadingAttachment,
  pendingRefs, onRemoveRef, onOpenRefPicker, brief, onBriefSuggestion,
  onEditMessage, pendingDeleteMessageId, onAskDeleteMessage, onConfirmDeleteMessage, onCancelDeleteMessage,
}: {
  messages: ChatMsg[];
  loading: boolean;
  streaming: boolean;
  brief: CompanionBrief | null;
  onBriefSuggestion: (s: CompanionBriefSuggestion) => void;
  composerText: string;
  onComposerChange: (s: string) => void;
  onSend: () => void;
  onStop: () => void;
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  pendingAttachments: ChatAttachment[];
  onAddAttachment: (file: File) => void;
  onRemoveAttachment: (url: string) => void;
  uploadingAttachment: boolean;
  pendingRefs: ChatReference[];
  onRemoveRef: (type: ChatReference['type'], id: string) => void;
  onOpenRefPicker: () => void;
  onEditMessage: (id: string, newText: string) => void;
  pendingDeleteMessageId: string | null;
  onAskDeleteMessage: (id: string) => void;
  onConfirmDeleteMessage: () => void;
  onCancelDeleteMessage: () => void;
}) {
  const t = useTranslations('app');
  const locale = useLocale();
  const streamEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    streamEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <main
      className="gedo-chat-main"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        borderRight: '1px solid var(--g-border)',
      }}
    >
      <div
        className="gedo-chat-scroll"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '32px 56px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)' }}>
            {t('companion.loadingHistory')}
          </div>
        )}

        {!loading && messages.length === 0 && <EmptyState brief={brief} onSuggestion={onBriefSuggestion} onPick={onComposerChange} />}

        {messages.length > 0 && (
          <DateDivider>
            {new Date().toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).replace(/\//g, ' / ')}
          </DateDivider>
        )}

        {messages.map(m => m.role === 'user'
          ? (
            <UserMsg
              key={m.id}
              id={m.id}
              text={m.text}
              attachments={m.attachments}
              references={m.references}
              disabled={streaming}
              onEdit={onEditMessage}
              pendingDelete={pendingDeleteMessageId === m.id}
              onAskDelete={() => onAskDeleteMessage(m.id)}
              onConfirmDelete={onConfirmDeleteMessage}
              onCancelDelete={onCancelDeleteMessage}
            />
          )
          : (
            <AiMsg
              key={m.id}
              text={m.text}
              tools={m.tools}
              cards={m.cards}
              pending={m.pending}
              stopped={m.stopped}
              disabled={streaming}
              pendingDelete={pendingDeleteMessageId === m.id}
              onAskDelete={() => onAskDeleteMessage(m.id)}
              onConfirmDelete={onConfirmDeleteMessage}
              onCancelDelete={onCancelDeleteMessage}
            />
          )
        )}
        <div ref={streamEnd} />
      </div>
      <Composer
        value={composerText}
        onChange={onComposerChange}
        onSend={onSend}
        onStop={onStop}
        disabled={streaming}
        mode={mode}
        onModeChange={onModeChange}
        pendingAttachments={pendingAttachments}
        onAddAttachment={onAddAttachment}
        onRemoveAttachment={onRemoveAttachment}
        uploadingAttachment={uploadingAttachment}
        pendingRefs={pendingRefs}
        onRemoveRef={onRemoveRef}
        onOpenRefPicker={onOpenRefPicker}
      />
    </main>
  );
}


const QUICK_KEYS = ['todayStatus', 'jot', 'setGoal'] as const;

const BRIEF_TONE_COLOR: Record<CompanionBriefSuggestion['tone'], string> = {
  exec: 'var(--g-dim-exec)', goal: 'var(--g-dim-goal)', memory: 'var(--g-dim-memory)', insight: 'var(--g-dim-insight)',
};

function EmptyState({ brief, onSuggestion, onPick }: {
  brief: CompanionBrief | null;
  onSuggestion: (s: CompanionBriefSuggestion) => void;
  onPick: (s: string) => void;
}) {
  const t = useTranslations('app');
  const dynamic = brief?.suggestions?.length ? brief.suggestions : null;
  return (
    <div
      style={{
        margin: '60px auto 0',
        maxWidth: 520,
        textAlign: 'center',
        padding: 36,
        background: 'var(--g-bg-raised)',
        border: '1px solid var(--g-border)',
        borderRadius: 16,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          margin: '0 auto 18px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, var(--g-dim-memory), var(--g-accent))',
          color: '#fff',
          fontFamily: 'var(--g-font-mono)',
          fontWeight: 700,
          fontSize: fontVars.lg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        G
      </div>
      <h2 style={{ margin: '0 0 8px', fontSize: fontVars.lg, fontWeight: 600 }}>{t('companion.emptyTitle')}</h2>
      <p style={{ margin: '0 0 18px', fontSize: fontVars.base, color: 'var(--g-text-muted)', lineHeight: 1.6 }}>
        {t('companion.emptyBody')}
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        {dynamic ? dynamic.map(s => (
          // 智能建议（后端真实数据拼装）：点击直接发送/打开对应内容，零预填
          <button
            key={s.id}
            type="button"
            onClick={() => onSuggestion(s)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 13px',
              borderRadius: 999,
              background: 'var(--g-surface-1)',
              border: '1px solid var(--g-border)',
              color: 'var(--g-text-mid)',
              fontSize: fontVars.sm,
              cursor: 'pointer',
              fontFamily: 'var(--g-font-sans)',
              maxWidth: 420,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 999, background: BRIEF_TONE_COLOR[s.tone] || 'var(--g-accent)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ flexShrink: 0 }}>→</span>
          </button>
        )) : QUICK_KEYS.map(key => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(t(`companion.quick.${key}Prompt`))}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              background: 'var(--g-surface-1)',
              border: '1px solid var(--g-border)',
              color: 'var(--g-text-mid)',
              fontSize: fontVars.sm,
              cursor: 'pointer',
              fontFamily: 'var(--g-font-sans)',
            }}
          >
            {t(`companion.quick.${key}`)} →
          </button>
        ))}
      </div>
    </div>
  );
}

function DateDivider({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        color: 'var(--g-text-faint)',
        fontSize: fontVars.xs,
        fontFamily: 'var(--g-font-mono)',
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--g-border)' }} />
      <span>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--g-border)' }} />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** Small file/image chip — used both in the composer preview row (with a
 * remove button) and inline in sent message bubbles (read-only). */
function AttachmentChip({ attachment, onRemove }: { attachment: ChatAttachment; onRemove?: () => void }) {
  const isImage = attachment.mime.startsWith('image/');
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--g-surface-2)', border: '1px solid var(--g-border)',
        borderRadius: 8, padding: isImage ? 3 : '4px 8px', fontSize: fontVars.xs, color: 'var(--g-text-mid)',
        maxWidth: 220,
      }}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- locally-served upload, not an optimizable remote asset
        <img
          src={attachment.url.startsWith('http') ? attachment.url : `${resolveApiBaseUrl()}${attachment.url}`}
          alt={attachment.name}
          style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <IconLayers size={12} />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{attachment.name}</span>
      <span style={{ color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}>{formatBytes(attachment.size)}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="remove"
          style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', padding: '0 2px', fontSize: fontVars.base, lineHeight: 1, flexShrink: 0 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Small two-step confirm bar for a destructive message action — same copy as
 *  ConvRow's conversation-delete confirm (companion.deleteQuestion / common.cancel
 *  / common.delete), just laid out inline under a chat bubble instead of as an
 *  absolute overlay (bubbles are variable-height in a scrolling transcript). */
function DeleteMessageConfirm({ align, onCancel, onConfirm }: { align: 'flex-end' | 'flex-start'; onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations('app');
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: align, gap: 6, fontSize: fontVars.xs }}>
      <span style={{ color: 'var(--g-text-faint)' }}>{t('companion.deleteQuestion')}</span>
      <button type="button" onClick={onCancel} style={{ border: '1px solid var(--g-border)', background: 'transparent', color: 'var(--g-text-mid)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)' }}>
        {t('common.cancel')}
      </button>
      <button type="button" onClick={onConfirm} style={{ border: 'none', background: 'var(--g-danger)', color: '#fff', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)' }}>
        {t('common.delete')}
      </button>
    </div>
  );
}

function msgIconBtnStyle(): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: '1px solid var(--g-border)',
    background: 'var(--g-surface-1)',
    color: 'var(--g-text-faint)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function UserMsg({ id, text, attachments, references, disabled, onEdit, pendingDelete, onAskDelete, onConfirmDelete, onCancelDelete }: {
  id: string;
  text: string;
  attachments?: ChatAttachment[];
  references?: ChatReference[];
  disabled?: boolean;
  onEdit: (id: string, newText: string) => void;
  pendingDelete: boolean;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const t = useTranslations('app');
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const startEdit = () => { setDraft(text); setEditing(true); };
  const save = () => {
    const v = draft.trim();
    if (v && v !== text) onEdit(id, v);
    setEditing(false);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { setEditing(false); return; }
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Same IME-composition guard as the main composer — Enter also confirms
    // a candidate word in Chinese/Japanese/Korean input.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    save();
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '78%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <textarea
            value={draft}
            autoFocus
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            style={{
              width: '100%', resize: 'vertical', borderRadius: 14, border: '1px solid var(--g-accent-line)',
              background: 'var(--g-surface-1)', color: 'var(--g-text)', padding: '12px 16px',
              fontSize: fontVars.base, lineHeight: 1.6, fontFamily: 'var(--g-font-sans)',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setEditing(false)} style={{ border: '1px solid var(--g-border)', background: 'transparent', color: 'var(--g-text-faint)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: fontVars.xs }}>{t('companion.rowEdit.cancel')}</button>
            <button type="button" onClick={save} style={{ border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)', color: 'var(--g-accent)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: fontVars.xs }}>{t('companion.rowEdit.save')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', justifyContent: 'flex-end' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); if (pendingDelete) onCancelDelete(); }}
    >
      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {attachments && attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
            {attachments.map(a => <AttachmentChip key={a.url} attachment={a} />)}
          </div>
        )}
        {references && references.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
            {references.map(r => <RefChip key={`${r.type}:${r.id}`} reference={r} />)}
          </div>
        )}
        {text ? (
          <div
            style={{
              background: 'var(--g-surface-1)',
              border: '1px solid var(--g-border)',
              padding: '12px 16px',
              borderRadius: 14,
              borderTopRightRadius: 4,
              color: 'var(--g-text)',
              fontSize: fontVars.base,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {text}
          </div>
        ) : null}
        {pendingDelete ? (
          <DeleteMessageConfirm align="flex-end" onCancel={onCancelDelete} onConfirm={onConfirmDelete} />
        ) : hover && !disabled ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" onClick={startEdit} title={t('companion.rowEdit.edit')} aria-label={t('companion.rowEdit.edit')} style={msgIconBtnStyle()}>
              <IconEdit size={12} />
            </button>
            <button type="button" onClick={onAskDelete} title={t('companion.rowEdit.delete')} aria-label={t('companion.rowEdit.delete')} style={msgIconBtnStyle()}>
              <IconTrash size={12} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AiMsg({ text, tools, cards, pending, stopped, disabled, pendingDelete, onAskDelete, onConfirmDelete, onCancelDelete }: {
  text: string;
  tools?: ToolEvent[];
  cards?: GedoCard[];
  pending?: boolean;
  stopped?: boolean;
  disabled?: boolean;
  pendingDelete: boolean;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const t = useTranslations('app');
  const [hover, setHover] = useState(false);
  const showTyping = pending && !text && (!cards || cards.length === 0);
  // Rich tool-result expansions (goal trees, memory edit, review stats…) get
  // more room than a plain text reply — only widen when there's something
  // expandable to actually fill it.
  const wide = tools?.some(ev => canExpandTool(ev.name, ev.goalId, ev.result));
  return (
    <div
      style={{ display: 'flex', gap: 12 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); if (pendingDelete) onCancelDelete(); }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          flexShrink: 0,
          background: 'linear-gradient(135deg, var(--g-dim-memory) 0%, var(--g-dim-exec) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--g-bg)',
          fontWeight: 700,
          fontSize: fontVars.sm,
          fontFamily: 'var(--g-font-mono)',
          marginTop: 2,
        }}
      >
        G
      </div>
      <div style={{ flex: 1, fontSize: fontVars.base, lineHeight: 1.65, color: 'var(--g-text-mid)', maxWidth: wide ? '92%' : '78%' }}>
        <div
          style={{
            fontSize: fontVars.xs,
            color: 'var(--g-text-faint)',
            marginBottom: 6,
            fontFamily: 'var(--g-font-mono)',
            letterSpacing: '0.04em',
          }}
        >
          {t('companion.brandFull')}
        </div>
        {tools && tools.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: (text || (cards && cards.length)) ? 12 : 0 }}>
            {tools.map((ev, i) => (
              <ToolTrace key={i} status={ev.status} name={ev.name} detail={ev.detail} goalId={ev.goalId} result={ev.result} />
            ))}
          </div>
        )}
        {cards && cards.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: text ? 12 : 0 }}>
            {cards.map((c, i) => (
              <CardRenderer key={i} card={c} />
            ))}
          </div>
        )}
        {showTyping ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              background: 'var(--g-surface-1)',
              border: '1px solid var(--g-border)',
              borderRadius: 12,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--g-accent)', opacity: 0.9 }} />
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--g-accent)', opacity: 0.55 }} />
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--g-accent)', opacity: 0.25 }} />
            <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)', marginLeft: 4 }}>{t('companion.thinking')}</span>
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {text}
            {stopped && <span style={{ marginLeft: 8, color: 'var(--g-text-faint)', fontSize: fontVars.xs, fontFamily: 'var(--g-font-mono)' }}>· {t('companion.message.stopped')}</span>}
          </div>
        )}
        {pendingDelete ? (
          <div style={{ marginTop: 6 }}>
            <DeleteMessageConfirm align="flex-start" onCancel={onCancelDelete} onConfirm={onConfirmDelete} />
          </div>
        ) : hover && !disabled && !showTyping ? (
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={onAskDelete} title={t('companion.rowEdit.delete')} aria-label={t('companion.rowEdit.delete')} style={msgIconBtnStyle()}>
              <IconTrash size={12} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// One editable line in the 拆解明细 list: rename, (tasks) reschedule, delete.
function EditableRow({ label, title, date, showDate, done, onSave, onDelete }: {
  label?: string;
  title: string;
  date?: string;
  showDate?: boolean;
  done?: boolean;
  onSave: (patch: { title?: string; date?: string | null }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const tr = useTranslations('app');
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(title);
  const [d, setD] = useState(date || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) { setT(title); setD(date || ''); } }, [title, date, editing]);

  const save = async () => {
    if (busy) return;
    const patch: { title?: string; date?: string | null } = {};
    if (t.trim() && t.trim() !== title) patch.title = t.trim();
    if (showDate && (d || '') !== (date || '')) patch.date = d || null;
    if (Object.keys(patch).length === 0) { setEditing(false); return; }
    setBusy(true);
    try { await onSave(patch); setEditing(false); } finally { setBusy(false); }
  };
  const del = async () => { if (busy) return; setBusy(true); try { await onDelete(); } finally { setBusy(false); } };

  const labelEl = label ? <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', minWidth: 44, flexShrink: 0 }}>{label}</span> : null;

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fontVars.sm }}>
        {labelEl}
        <input value={t} autoFocus onChange={(e) => setT(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          style={{ flex: 1, minWidth: 0, fontSize: fontVars.sm, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'var(--g-surface-2)', color: 'var(--g-text)' }} />
        {showDate && (
          <input type="date" value={d} onChange={(e) => setD(e.target.value)}
            style={{ fontSize: fontVars.xs, padding: '1px 4px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'var(--g-surface-2)', color: 'var(--g-text-mid)' }} />
        )}
        <button type="button" onClick={save} disabled={busy} style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 6, border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)', color: 'var(--g-accent)', fontSize: fontVars.xs, cursor: 'pointer' }}>{tr('companion.rowEdit.save')}</button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} style={{ flexShrink: 0, padding: '1px 7px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'transparent', color: 'var(--g-text-faint)', fontSize: fontVars.xs, cursor: 'pointer' }}>{tr('companion.rowEdit.cancel')}</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fontVars.sm }}>
      {labelEl}
      <span style={{ color: done ? 'var(--g-text-faint)' : 'var(--g-text-mid)', flex: 1, minWidth: 0, textDecoration: done ? 'line-through' : 'none' }}>{title}</span>
      {showDate && date && <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}>{String(date).slice(5)}</span>}
      <button type="button" onClick={() => setEditing(true)} disabled={busy} style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'transparent', color: 'var(--g-text-faint)', fontSize: fontVars.xs, cursor: 'pointer' }}>{tr('companion.rowEdit.edit')}</button>
      <button type="button" onClick={del} disabled={busy} style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'transparent', color: 'var(--g-danger)', fontSize: fontVars.xs, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>{tr('companion.rowEdit.delete')}</button>
    </div>
  );
}

// Expandable detail for a decomposition (plan_goal) tool card: pulls the live
// sub-goal tree + near-term tasks for the goal. The decomposition auto-saves,
// so the footer offers the undo path: re-decompose (replace) or discard
// (delete the goal + tree; completed to-dos survive as history server-side).
function DecompositionDetail({ goalId }: { goalId: string }) {
  const { api } = useAuth();
  const tr = useTranslations('app');
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<{ id: string; title: string; level?: string }[]>([]);
  const [tasks, setTasks] = useState<{ id: string; title: string; scheduled_date?: string; status?: string }[]>([]);
  const [redoing, setRedoing] = useState(false);
  const [redoFailed, setRedoFailed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discarded, setDiscarded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, t] = await Promise.all([api.listGoals(), api.listTasks()]);
      const allGoals = (g?.items ?? []) as Array<{ id: string; title: string; level?: string; parent_id?: string | null }>;
      // A previously discarded decomposition has no goal anymore — show the
      // discarded note instead of an empty shell when the card is re-expanded.
      if (!allGoals.some((x) => x.id === goalId)) { setDiscarded(true); return; }
      const ids = new Set<string>([goalId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const x of allGoals) {
          if (x.parent_id && ids.has(x.parent_id) && !ids.has(x.id)) { ids.add(x.id); changed = true; }
        }
      }
      setNodes(allGoals.filter((x) => x.id !== goalId && ids.has(x.id)).map((x) => ({ id: x.id, title: x.title, level: x.level })));
      setTasks(((t?.items ?? []) as Array<{ id: string; title: string; scheduled_date?: string; status?: string; goal_id?: string }>)
        .filter((x) => x.goal_id === goalId)
        .map((x) => ({ id: x.id, title: x.title, scheduled_date: x.scheduled_date, status: x.status })));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [api, goalId]);

  useEffect(() => { load(); }, [load]);

  const redo = useCallback(async () => {
    if (redoing) return;
    setRedoing(true);
    setRedoFailed(false);
    try {
      const r = await api.decomposeGoal(goalId, { replace: true });
      if (r?.failed) setRedoFailed(true);
      await load();
    }
    catch { setRedoFailed(true); } finally { setRedoing(false); }
  }, [api, goalId, load, redoing]);

  const discard = useCallback(async () => {
    if (discarding || discarded) return;
    if (typeof window !== 'undefined' && !window.confirm(tr('companion.decompose.discardConfirm'))) return;
    setDiscarding(true);
    try { await api.deleteGoal(goalId); setDiscarded(true); }
    catch { /* ignore */ } finally { setDiscarding(false); }
  }, [api, goalId, discarding, discarded, tr]);

  const levelLabel = (lvl?: string) =>
    lvl && ['key_result', 'monthly', 'task', 'objective'].includes(lvl) ? tr(`companion.level.${lvl}` as Parameters<typeof tr>[0]) : (lvl || '');

  if (discarded) {
    return (
      <div style={{ borderTop: '1px solid var(--g-border)', padding: '10px 12px', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
        {tr('companion.decompose.discarded')}
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--g-border)', padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {loading ? (
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{tr('companion.decompose.loading')}</div>
      ) : nodes.length === 0 && tasks.length === 0 ? (
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{tr('companion.decompose.empty')}</div>
      ) : (
        <>
          {nodes.map((n) => (
            <EditableRow
              key={n.id}
              label={levelLabel(n.level)}
              title={n.title}
              onSave={async ({ title }) => { if (title) await api.updateGoal(n.id, { title }); await load(); }}
              onDelete={async () => { await api.deleteGoal(n.id); await load(); }}
            />
          ))}
          {tasks.length > 0 && (
            <div style={{ marginTop: nodes.length ? 2 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>{tr('companion.decompose.recentTasks')}</div>
              {tasks.map((t) => (
                <EditableRow
                  key={t.id}
                  title={t.title}
                  date={t.scheduled_date}
                  showDate
                  done={t.status === 'done'}
                  onSave={async ({ title, date }) => { await api.updateTask(t.id, { ...(title ? { title } : {}), ...(date !== undefined ? { scheduled_date: date } : {}) }); await load(); }}
                  onDelete={async () => { await api.deleteTask(t.id); await load(); }}
                />
              ))}
            </div>
          )}
        </>
      )}
      {redoFailed && (
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-danger)' }}>{tr('companion.decompose.redoFailed')}</div>
      )}
      <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
          <IconCheck size={10} /> {tr('companion.decompose.savedChip')}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={redo}
          disabled={redoing || discarding}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 8, border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)',
            color: 'var(--g-accent)', fontSize: fontVars.xs, cursor: redoing ? 'default' : 'pointer', opacity: redoing ? 0.6 : 1, fontFamily: 'var(--g-font-sans)',
          }}
        >
          <IconSpark size={11} /> {redoing ? tr('companion.decompose.redoing') : tr('companion.decompose.redo')}
        </button>
        <button
          type="button"
          onClick={discard}
          disabled={redoing || discarding}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 8,
            border: '1px solid color-mix(in oklch, var(--g-danger) 30%, transparent)', background: 'transparent',
            color: 'var(--g-danger)', fontSize: fontVars.xs, cursor: discarding ? 'default' : 'pointer', opacity: discarding ? 0.6 : 1, fontFamily: 'var(--g-font-sans)',
          }}
        >
          {discarding ? tr('companion.decompose.discarding') : tr('companion.decompose.discard')}
        </button>
      </div>
    </div>
  );
}

// Read-only expandable list for the count-summary tool cards (list_goals /
// list_today_tasks / search_memory): renders the items carried in the result.
function ToolResultList({ name, result }: { name: string; result: unknown }) {
  const tr = useTranslations('app');
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  let items: { key: string; main: string; sub?: string }[] = [];
  if (name === 'list_goals') {
    items = ((r.goals as Array<{ id: string; title: string; progress?: number }>) ?? []).map((g) => ({ key: g.id, main: g.title, sub: `${g.progress ?? 0}%` }));
  } else if (name === 'list_today_tasks') {
    items = ((r.tasks as Array<{ id: string; title: string; status?: string; due_date?: string }>) ?? []).map((t) => ({ key: t.id, main: t.title, sub: t.status === 'done' ? tr('companion.decompose.doneStatus') : (t.due_date ? String(t.due_date).slice(5) : '') }));
  } else if (name === 'search_memory') {
    items = ((r.results as Array<{ id: string; content: string; created_at?: string }>) ?? []).map((m) => ({ key: m.id, main: m.content, sub: m.created_at ? String(m.created_at).slice(0, 10) : '' }));
  }
  return (
    <div style={{ borderTop: '1px solid var(--g-border)', padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.length === 0 ? (
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{tr('companion.decompose.empty')}</div>
      ) : items.map((it) => (
        <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fontVars.sm }}>
          <span style={{ color: 'var(--g-text-mid)', flex: 1, minWidth: 0 }}>{it.main}</span>
          {it.sub && <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}>{it.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// Inline expand for a capture_memory tool result — content/tags shown
// read-only with a click-to-edit affordance (PATCH /v1/memory/:id), replacing
// what the old MemoryCaptureModal did as a separate popup.
function MemoryCaptureExpand({ result }: { result: unknown }) {
  const tr = useTranslations('app');
  const { api } = useAuth();
  const r = (result && typeof result === 'object' ? result : {}) as {
    memoryId?: string;
    memory?: { id?: string; content_raw?: string; tags?: string[]; type?: string };
  };
  const id = r.memory?.id ?? r.memoryId;
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(r.memory?.content_raw ?? '');
  const [tagsText, setTagsText] = useState((r.memory?.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);

  if (!id) return null;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.updateMemory(id, {
        content_raw: content.trim(),
        tags: tagsText.split(',').map(s => s.trim()).filter(Boolean),
      });
      setEditing(false);
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--g-border)', padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {editing ? (
        <>
          <textarea
            value={content}
            autoFocus
            onChange={e => setContent(e.target.value)}
            rows={2}
            style={{ fontSize: fontVars.sm, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'var(--g-surface-2)', color: 'var(--g-text)', resize: 'vertical', fontFamily: 'var(--g-font-sans)' }}
          />
          <input
            value={tagsText}
            onChange={e => setTagsText(e.target.value)}
            placeholder={tr('companion.memoryExpand.tagsPlaceholder')}
            style={{ fontSize: fontVars.xs, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'var(--g-surface-2)', color: 'var(--g-text-mid)' }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={save} disabled={busy} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)', color: 'var(--g-accent)', fontSize: fontVars.xs, cursor: 'pointer' }}>{tr('companion.rowEdit.save')}</button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'transparent', color: 'var(--g-text-faint)', fontSize: fontVars.xs, cursor: 'pointer' }}>{tr('companion.rowEdit.cancel')}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{content}</div>
          {tagsText && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {tagsText.split(',').map(s => s.trim()).filter(Boolean).map(tag => (
                <span key={tag} style={{ fontSize: fontVars.sm, padding: '1px 7px', borderRadius: 999, background: 'var(--g-surface-2)', color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{tag}</span>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setEditing(true)} style={{ alignSelf: 'flex-start', padding: '3px 10px', borderRadius: 6, border: '1px solid var(--g-border)', background: 'transparent', color: 'var(--g-text-faint)', fontSize: fontVars.xs, cursor: 'pointer' }}>
            {tr('companion.rowEdit.edit')}
          </button>
        </>
      )}
    </div>
  );
}

// Inline expand for a create_goal tool result — reuses EditableRow (the same
// rename/delete affordance plan_goal's DecompositionDetail uses) plus a link
// into the full WOOP wizard, replacing the old GoalDraftModal popup.
function GoalCreateExpand({ result }: { result: unknown }) {
  const tr = useTranslations('app');
  const { api } = useAuth();
  const r = (result && typeof result === 'object' ? result : {}) as {
    goalId?: string;
    goal?: { id?: string; title?: string };
  };
  const id = r.goal?.id ?? r.goalId;
  const [title, setTitle] = useState(r.goal?.title ?? '');
  const [deleted, setDeleted] = useState(false);

  if (!id) return null;
  if (deleted) {
    return (
      <div style={{ borderTop: '1px solid var(--g-border)', padding: '8px 12px 10px', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
        {tr('companion.decompose.empty')}
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--g-border)', padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <EditableRow
        title={title}
        onSave={async ({ title: newTitle }) => { if (newTitle) { await api.updateGoal(id, { title: newTitle }); setTitle(newTitle); } }}
        onDelete={async () => { await api.deleteGoal(id); setDeleted(true); }}
      />
      <Link
        href={`/app/today?tab=goals&prefill=${id}`}
        style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
      >
        <IconSpark size={11} /> {tr('companion.goalExpand.continueWoop')}
      </Link>
    </div>
  );
}

// Inline expand for a generate_review tool result — stats grid + insights +
// suggestions, all fields already shaped by ConversationService.generateReview.
function ReviewExpand({ result }: { result: unknown }) {
  const tr = useTranslations('app');
  const r = (result && typeof result === 'object' ? result : {}) as {
    review?: {
      stats?: { completionRate?: number; completedTasks?: number; totalTasks?: number; activeGoals?: number; reflectionCount?: number };
      ai_insights?: string[];
      ai_suggestions?: string[];
      summary?: string;
    };
  };
  const review = r.review;
  if (!review) return null;
  const stats = review.stats ?? {};
  const statRows = [
    { label: tr('companion.reviewExpand.completionRate'), value: `${stats.completionRate ?? 0}%` },
    { label: tr('companion.reviewExpand.tasks'), value: `${stats.completedTasks ?? 0}/${stats.totalTasks ?? 0}` },
    { label: tr('companion.reviewExpand.activeGoals'), value: `${stats.activeGoals ?? 0}` },
    { label: tr('companion.reviewExpand.reflections'), value: `${stats.reflectionCount ?? 0}` },
  ];
  return (
    <div style={{ borderTop: '1px solid var(--g-border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {statRows.map(s => (
          <div key={s.label} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 8, background: 'var(--g-surface-2)' }}>
            <div style={{ fontSize: fontVars.base, fontWeight: 700, color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)' }}>{s.value}</div>
            <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {review.summary && <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6 }}>{review.summary}</p>}
      {!!review.ai_insights?.length && (
        <div>
          <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em', marginBottom: 4 }}>{tr('companion.reviewExpand.insights')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6 }}>
            {review.ai_insights.map((ins, i) => <li key={i}>{ins}</li>)}
          </ul>
        </div>
      )}
      {!!review.ai_suggestions?.length && (
        <div>
          <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em', marginBottom: 4 }}>{tr('companion.reviewExpand.suggestions')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6 }}>
            {review.ai_suggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// Which tool cards can expand, and what to render when they do.
function canExpandTool(name: string, goalId?: string, result?: unknown): boolean {
  if (name === 'plan_goal') return !!goalId;
  const r = (result && typeof result === 'object' ? result : null) as Record<string, unknown> | null;
  if (name === 'list_goals') return !!(r?.goals as unknown[] | undefined)?.length;
  if (name === 'list_today_tasks') return !!(r?.tasks as unknown[] | undefined)?.length;
  if (name === 'search_memory') return !!(r?.results as unknown[] | undefined)?.length;
  if (name === 'capture_memory') return !!(r?.memoryId || (r?.memory as Record<string, unknown> | undefined)?.id);
  if (name === 'create_goal') return !!(r?.goalId || (r?.goal as Record<string, unknown> | undefined)?.id);
  if (name === 'generate_review') return !!r?.review;
  return false;
}

function ToolExpand({ name, goalId, result }: { name: string; goalId?: string; result?: unknown }) {
  if (name === 'plan_goal' && goalId) return <DecompositionDetail goalId={goalId} />;
  if (name === 'capture_memory') return <MemoryCaptureExpand result={result} />;
  if (name === 'create_goal') return <GoalCreateExpand result={result} />;
  if (name === 'generate_review') return <ReviewExpand result={result} />;
  return <ToolResultList name={name} result={result} />;
}

function ToolTrace({
  status,
  name,
  detail,
  goalId,
  result,
}: {
  status: 'success' | 'running' | 'failed';
  name: string;
  detail: string;
  goalId?: string;
  result?: unknown;
}) {
  const t = useTranslations('app');
  const [expanded, setExpanded] = useState(false);
  const canExpand = canExpandTool(name, goalId, result);
  const c =
    status === 'success'
      ? 'var(--g-accent)'
      : status === 'running'
      ? 'var(--g-dim-insight)'
      : 'var(--g-danger)';
  return (
    <div style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10, fontSize: fontVars.base, overflow: 'hidden' }}>
      <div
        onClick={canExpand ? () => setExpanded((e) => !e) : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', cursor: canExpand ? 'pointer' : 'default' }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: `color-mix(in oklch, ${c} 14%, transparent)`,
            border: `1px solid color-mix(in oklch, ${c} 32%, transparent)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: c,
            flexShrink: 0,
          }}
        >
          {status === 'success' ? <IconCheck size={12} /> : status === 'running' ? <IconSpark size={12} /> : <IconBolt size={12} />}
        </span>
        <span style={{ color: 'var(--g-text)', fontWeight: 500 }}>{toolLabel(name, t)}</span>
        <span style={{ color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', fontSize: fontVars.xs }}>·</span>
        <span style={{ color: 'var(--g-text-mid)', flex: 1, fontSize: fontVars.base }}>{detail}</span>
        {status === 'running' && (
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-dim-insight)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
            {t('companion.inProgress')}
          </span>
        )}
        {canExpand && (
          <span style={{ flexShrink: 0, color: 'var(--g-text-faint)', display: 'flex', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
            <IconChev size={14} />
          </span>
        )}
      </div>
      {canExpand && expanded && <ToolExpand name={name} goalId={goalId} result={result} />}
    </div>
  );
}

// Web Speech API isn't standard TypeScript yet — declare minimal type (mirrors VoiceSession.tsx).
interface SpeechRecognitionEventLike { results: { 0: { 0: { transcript: string }; isFinal: boolean } }[]; }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type WindowWithSR = typeof window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function Composer({
  value, onChange, onSend, onStop, disabled,
  mode, onModeChange, pendingAttachments, onAddAttachment, onRemoveAttachment, uploadingAttachment,
  pendingRefs, onRemoveRef, onOpenRefPicker,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  disabled?: boolean;
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  pendingAttachments: ChatAttachment[];
  onAddAttachment: (file: File) => void;
  onRemoveAttachment: (url: string) => void;
  uploadingAttachment: boolean;
  pendingRefs: ChatReference[];
  onRemoveRef: (type: ChatReference['type'], id: string) => void;
  onOpenRefPicker: () => void;
}) {
  const t = useTranslations('app');
  const locale = useLocale();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseValueRef = useRef('');
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Enter also confirms IME candidate selection (Chinese/Japanese/Korean input);
    // isComposing covers most browsers, keyCode 229 catches Safari's stale flag
    // on the confirming keydown. Either signal means "don't send yet".
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    onSend();
  };
  // Auto-grow the textarea with content so typed text is never hidden below
  // the fold; caps at maxHeight and lets the textarea's own scroll take over.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    const w = window as WindowWithSR;
    setMicSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  // Abort any in-flight recognition if the composer unmounts mid-dictation.
  useEffect(() => () => { try { recRef.current?.abort(); } catch {} }, []);

  const toggleVoiceInput = useCallback(() => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as WindowWithSR;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = locale === 'ja' ? 'ja-JP' : locale === 'en' ? 'en-US' : 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    baseValueRef.current = value;
    rec.onresult = (e) => {
      // Recompute from scratch each time — e.results is the full cumulative
      // list for this session, so accumulating via closure would double-count
      // once continuous mode produces more than one final segment.
      let finalText = '';
      let interim = '';
      for (let i = 0; i < (e.results as unknown as ArrayLike<unknown>).length; i++) {
        const res = (e.results as unknown as { [k: number]: { 0: { transcript: string }; isFinal: boolean } })[i];
        if (!res) continue;
        const piece = res[0].transcript;
        if (res.isFinal) finalText += piece;
        else interim += piece;
      }
      const base = baseValueRef.current;
      const sep = base && !/[\s\n]$/.test(base) ? ' ' : '';
      onChange(base + sep + finalText + interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  }, [listening, locale, value, onChange]);

  const canSend = !disabled && (value.trim().length > 0 || pendingAttachments.length > 0);
  return (
    <div className="gedo-chat-composer" style={{ padding: '16px 56px 24px', flexShrink: 0 }}>
      <div
        style={{
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border-hi)',
          borderRadius: 16,
          padding: '12px 14px',
          boxShadow: 'var(--g-shadow-card)',
        }}
      >
        {pendingAttachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {pendingAttachments.map(a => (
              <AttachmentChip key={a.url} attachment={a} onRemove={() => onRemoveAttachment(a.url)} />
            ))}
          </div>
        )}
        {pendingRefs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {pendingRefs.map(r => (
              <RefChip key={`${r.type}:${r.id}`} reference={r} onRemove={() => onRemoveRef(r.type, r.id)} />
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('companion.composer.placeholder')}
          disabled={disabled}
          rows={1}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--g-text)',
            fontFamily: 'var(--g-font-sans)',
            fontSize: fontVars.base,
            lineHeight: 1.55,
            resize: 'none',
            minHeight: 26,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf,text/plain"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) onAddAttachment(file);
                e.target.value = '';
              }}
            />
            <div style={{ position: 'relative' }}>
              <ComposerTool
                icon={<IconPlus size={15} />}
                title={t('companion.composer.attach')}
                onClick={() => setPlusMenuOpen(v => !v)}
              />
              {plusMenuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setPlusMenuOpen(false)} />
                  <div
                    style={{
                      position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 41,
                      width: 250, background: 'var(--g-bg-raised)', border: '1px solid var(--g-border-hi)',
                      borderRadius: 12, padding: 6, boxShadow: 'var(--g-shadow-pop, 0 12px 40px rgba(0,0,0,.35))',
                    }}
                  >
                    <PlusMenuItem
                      icon={<IconLayers size={14} />}
                      label={t('companion.composer.menuAttach')}
                      onClick={() => { setPlusMenuOpen(false); fileRef.current?.click(); }}
                    />
                    <PlusMenuItem
                      icon={<IconTarget size={14} />}
                      label={t('companion.composer.menuLink')}
                      onClick={() => { setPlusMenuOpen(false); onOpenRefPicker(); }}
                    />
                    <PlusMenuItem
                      icon={<IconWand size={14} />}
                      label={t('companion.composer.menuTools')}
                      tag={t('companion.composer.menuSoon')}
                      disabled
                    />
                  </div>
                </>
              )}
            </div>
            {uploadingAttachment && (
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                {t('companion.composer.uploading')}
              </span>
            )}
            <ComposerTool
              icon={<IconClock size={15} />}
              title={t('companion.composer.remind')}
              onClick={() => setReminderOpen(true)}
            />
            <ComposerTool
              icon={<IconMic size={15} />}
              title={micSupported ? t('companion.composer.voiceInput') : t('companion.voice.noSpeechApi')}
              color={listening ? 'var(--g-danger)' : undefined}
              disabled={!micSupported}
              onClick={toggleVoiceInput}
            />
            <span style={{ width: 1, height: 16, background: 'var(--g-border)', alignSelf: 'center', margin: '0 4px' }} />
            <ModePicker mode={mode} onChange={onModeChange} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            <span>{t('companion.composer.lang')}</span>
            {disabled ? (
              <button
                type="button"
                onClick={onStop}
                title={t('companion.message.stop')}
                aria-label={t('companion.message.stop')}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'var(--g-surface-2)',
                  color: 'var(--g-text)',
                  border: '1px solid var(--g-border-hi)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconStop size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: canSend ? 'var(--g-accent)' : 'var(--g-surface-2)',
                  color: canSend ? 'var(--g-accent-ink)' : 'var(--g-text-faint)',
                  border: 'none',
                  cursor: canSend ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconSend size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
      <p style={{ margin: '8px 4px 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', textAlign: 'center' }}>
        {t('companion.composer.hint')}
      </p>
      {reminderOpen && (
        <ReminderRuleModal
          open={reminderOpen}
          onClose={() => setReminderOpen(false)}
          prefillTitle={value.trim()}
          onSaved={() => onChange('')}
        />
      )}
    </div>
  );
}

// ── Mode picker — sticky chip row (自动/记忆/待办/目标/复盘), Claude-Code-style
// "select a tool" affordance. Selecting a mode forces that tool via tool_hint;
// 'auto' (default) preserves today's LLM auto-detection.
function ModePicker({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const t = useTranslations('app');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const color = modeColor(mode);

  return (
    <div ref={rootRef} className="gedo-mode-picker" style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t('companion.modePicker.expandHint')}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 999,
          border: `1px solid ${mode === 'auto' ? 'var(--g-border)' : `color-mix(in oklch, ${color} 38%, transparent)`}`,
          background: mode === 'auto' ? 'transparent' : `color-mix(in oklch, ${color} 14%, transparent)`,
          color: mode === 'auto' ? 'var(--g-text-muted)' : color,
          fontSize: fontVars.xs, fontWeight: 500,
          cursor: 'pointer', fontFamily: 'var(--g-font-sans)',
        }}
      >
        <ModeIcon mode={mode} size={12} />
        {t(`companion.modePicker.${mode}`)}
        <IconChevD size={10} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('companion.modePicker.expandHint')}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            minWidth: 220,
            padding: 6,
            borderRadius: 12,
            background: 'var(--g-bg-raised)',
            border: '1px solid var(--g-border)',
            boxShadow: '0 16px 40px -16px oklch(0 0 0 / 0.4)',
            zIndex: 80,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {CHAT_MODES.map(m => {
            const active = mode === m;
            const c = modeColor(m);
            return (
              <button
                key={m}
                type="button"
                role="menuitem"
                onClick={() => { onChange(m); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '7px 10px', borderRadius: 8, border: 'none',
                  background: active ? `color-mix(in oklch, ${c} 14%, transparent)` : 'transparent',
                  cursor: 'pointer', fontFamily: 'var(--g-font-sans)', textAlign: 'left',
                }}
              >
                <span style={{ color: active ? c : 'var(--g-text-muted)', marginTop: 1, flexShrink: 0 }}>
                  <ModeIcon mode={m} size={13} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: fontVars.sm, fontWeight: active ? 600 : 500, color: active ? c : 'var(--g-text)' }}>
                    {t(`companion.modePicker.${m}`)}
                  </span>
                  <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', lineHeight: 1.4 }}>
                    {t(`companion.modePicker.${m}Hint`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ComposerTool({
  icon, title, label, color, onClick, disabled,
}: {
  icon: ReactNode;
  title: string;
  label?: string;
  color?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...iconBtnStyle(),
        color: color ?? 'var(--g-text-muted)',
        padding: label ? '0 10px' : 0,
        width: label ? 'auto' : 32,
        gap: 4,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {icon}
      {label && <span style={{ fontSize: fontVars.sm }}>{label}</span>}
    </button>
  );
}

// ── 显式关联（「+」→ 关联目标/待办/图鉴卡） ────────────────────────────

function refTypeIcon(type: ChatReference['type'], size = 12) {
  if (type === 'goal') return <IconTarget size={size} />;
  if (type === 'task') return <IconCheck size={size} />;
  return <IconLayers size={size} />;
}

function RefChip({ reference, onRemove }: { reference: ChatReference; onRemove?: () => void }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 999, maxWidth: 240,
        background: 'var(--g-surface-1)', border: '1px solid var(--g-border-hi)',
        color: 'var(--g-text-muted)', fontSize: fontVars.xs,
      }}
    >
      {refTypeIcon(reference.type)}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reference.label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
          aria-label="remove"
        >
          ×
        </button>
      )}
    </span>
  );
}

function PlusMenuItem({ icon, label, tag, disabled, onClick }: {
  icon: ReactNode; label: string; tag?: string; disabled?: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent',
        color: 'var(--g-text)', fontSize: fontVars.sm, textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--g-surface-1)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <span style={{ color: 'var(--g-text-muted)', display: 'inline-flex' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {tag && (
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', border: '1px solid var(--g-border)', borderRadius: 6, padding: '1px 5px' }}>
          {tag}
        </span>
      )}
    </button>
  );
}

/** 关联内容选择器：目标 / 待办 / 图鉴卡三类，搜索 + 多选（上限 5，与后端一致）。 */
function RefPickerPanel({ open, onClose, initial, onConfirm }: {
  open: boolean;
  onClose: () => void;
  initial: ChatReference[];
  onConfirm: (refs: ChatReference[]) => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [tab, setTab] = useState<ChatReference['type']>('goal');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [goals, setGoals] = useState<Array<{ id: string; title: string; status?: string; progress?: number }>>([]);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; status?: string; scheduled_date?: string | null }>>([]);
  const [entities, setEntities] = useState<Array<{ id: string; name: string; relation?: string | null }>>([]);
  const [selected, setSelected] = useState<Map<string, ChatReference>>(new Map());

  useEffect(() => {
    if (!open) return;
    setSelected(new Map(initial.map(r => [`${r.type}:${r.id}`, r])));
    setQuery('');
    setLoading(true);
    void (async () => {
      const [g, tk, e] = await Promise.all([
        api.listGoals().catch(() => ({ items: [] })),
        api.listTasks().catch(() => ({ items: [] })),
        api.listEntities().catch(() => ({ items: [] })),
      ]);
      setGoals(((g as { items?: Array<{ id: string; title: string; status?: string; progress?: number }> })?.items ?? []).filter(x => x.status === 'active'));
      setTasks(((tk as { items?: Array<{ id: string; title: string; status?: string; scheduled_date?: string | null }> })?.items ?? []).filter(x => x.status !== 'done').slice(0, 100));
      setEntities(((e as { items?: Array<{ id: string; name: string; relation?: string | null }> })?.items ?? []));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const rows: Array<{ id: string; label: string; sub?: string }> =
    tab === 'goal' ? goals.filter(g => match(g.title)).map(g => ({ id: g.id, label: g.title, sub: `${g.progress ?? 0}%` }))
    : tab === 'task' ? tasks.filter(x => match(x.title)).map(x => ({ id: x.id, label: x.title, sub: x.scheduled_date || undefined }))
    : entities.filter(x => match(`${x.name} ${x.relation || ''}`)).map(x => ({ id: x.id, label: x.name, sub: x.relation || undefined }));

  const toggle = (item: { id: string; label: string }) => {
    setSelected(prev => {
      const next = new Map(prev);
      const key = `${tab}:${item.id}`;
      if (next.has(key)) next.delete(key);
      else if (next.size < 5) next.set(key, { type: tab, id: item.id, label: item.label });
      return next;
    });
  };

  const tabs: Array<{ key: ChatReference['type']; label: string }> = [
    { key: 'goal', label: t('companion.refPicker.goals') },
    { key: 'task', label: t('companion.refPicker.tasks') },
    { key: 'entity', label: t('companion.refPicker.cards') },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('companion.refPicker.title')}
      eyebrow={t('companion.refPicker.limit')}
      width={400}
      footer={
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => { onConfirm(Array.from(selected.values())); onClose(); }}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10, border: 'none', cursor: selected.size ? 'pointer' : 'default',
            background: 'var(--g-accent)', color: 'var(--g-accent-ink, #06251c)', fontWeight: 700, fontSize: fontVars.sm,
            opacity: selected.size === 0 ? 0.4 : 1,
          }}
        >
          {t('companion.refPicker.confirm', { n: selected.size })}
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {tabs.map(x => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 999,
                border: `1px solid ${tab === x.key ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
                background: tab === x.key ? 'var(--g-accent-soft)' : 'transparent',
                color: tab === x.key ? 'var(--g-accent)' : 'var(--g-text-muted)',
                fontSize: fontVars.sm, cursor: 'pointer',
              }}
            >
              {refTypeIcon(x.key, 13)}{x.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('companion.refPicker.search')}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 10,
            border: '1px solid var(--g-border)', background: 'var(--g-surface-1)', color: 'var(--g-text)',
            fontSize: fontVars.sm, outline: 'none',
          }}
        />
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ color: 'var(--g-text-faint)', fontSize: fontVars.sm, padding: 12 }}>…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: 'var(--g-text-muted)', fontSize: fontVars.sm, padding: 12 }}>{t('companion.refPicker.empty')}</div>
          ) : rows.map(item => {
            const on = selected.has(`${tab}:${item.id}`);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                  padding: '9px 6px', border: 'none', borderBottom: '1px solid var(--g-border)',
                  background: on ? 'var(--g-accent-soft)' : 'transparent', cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 16, height: 16, borderRadius: 5, flexShrink: 0,
                    border: `1.5px solid ${on ? 'var(--g-accent)' : 'var(--g-border-hi)'}`,
                    background: on ? 'var(--g-accent)' : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g-bg)',
                  }}
                >
                  {on ? <IconCheck size={10} /> : null}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--g-text)', fontSize: fontVars.sm }}>
                  {item.label}
                </span>
                {item.sub && <span style={{ color: 'var(--g-text-faint)', fontSize: fontVars.xs }}>{item.sub}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Drawer>
  );
}

// ── Context panel — proactive captures + tool calls from chat ────────
function ContextPanel({
  messages, captures, onDecide, onUndo, embedded = false,
}: {
  messages: ChatMsg[];
  captures: MemoryCandidate[];
  onDecide: (id: string, decision: 'approve' | 'reject', edits?: { content?: string; title?: string }) => void;
  onUndo: (id: string) => void;
  embedded?: boolean;
}) {
  const t = useTranslations('app');
  const allTools = useMemo(
    () => messages.flatMap(m => m.tools ?? []),
    [messages]
  );
  const visibleCaptures = useMemo(
    () => captures.filter(c => c.status !== 'rejected' && c.status !== 'undone').slice(0, 15),
    [captures]
  );
  const pendingCount = useMemo(
    () => captures.filter(c => c.status === 'pending').length,
    [captures]
  );

  return (
    <aside
      className="gedo-aux-sidebar gedo-context-sidebar"
      style={{
        width: embedded ? '100%' : 380,
        flexShrink: 0,
        background: 'var(--g-bg-raised)',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: embedded ? 'none' : '1px solid var(--g-border)',
        minHeight: 0,
        height: embedded ? '100%' : undefined,
      }}
    >
      {!embedded && (
      <div
        style={{
          height: 60,
          flexShrink: 0,
          padding: '0 20px',
          borderBottom: '1px solid var(--g-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconLayers size={14} />
          <span style={{ fontSize: fontVars.base, fontWeight: 500 }}>{t('companion.board.title')}</span>
          <Pill mono>{t('companion.board.items', { n: visibleCaptures.length + allTools.length })}</Pill>
          {pendingCount > 0 && (
            <Pill mono tone="memory">{t('companion.board.pending', { n: pendingCount })}</Pill>
          )}
        </div>
        <button type="button" style={iconBtnStyle()} title={t('companion.board.collapse')}>
          <IconChev size={14} />
        </button>
      </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visibleCaptures.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                fontSize: fontVars.sm,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--g-text-faint)',
                fontFamily: 'var(--g-font-mono)',
              }}
            >
              {t('companion.board.activeCapture')}
            </div>
            {visibleCaptures.map(c => (
              <CaptureCard key={c.id} capture={c} onDecide={onDecide} onUndo={onUndo} />
            ))}
          </div>
        )}

        {visibleCaptures.length === 0 && allTools.length === 0 ? (
          <DemoArtifacts />
        ) : (
          allTools.slice(-15).reverse().map((ev, i) => (
            <ToolArtifact key={i} event={ev} />
          ))
        )}
      </div>

      <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--g-border)' }}>
        <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)', textAlign: 'center', lineHeight: 1.5 }}>
          {t('companion.board.coreHint')}
        </p>
      </div>
    </aside>
  );
}

// ── Proactive capture card — confirm / edit / dismiss / undo ─────────
function CaptureCard({
  capture, onDecide, onUndo,
}: {
  capture: MemoryCandidate;
  onDecide: (id: string, decision: 'approve' | 'reject', edits?: { content?: string; title?: string }) => void;
  onUndo: (id: string) => void;
}) {
  const t = useTranslations('app');
  const isTask = capture.kind === 'task';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(isTask ? (capture.title ?? capture.content) : capture.content);
  const color = isTask ? 'var(--g-dim-exec)' : 'var(--g-dim-memory)';
  const importanceLabel =
    capture.importance === 'core' ? t('companion.capture.importanceCore') :
    capture.importance === 'high' ? t('companion.capture.importanceHigh') : null;
  const statusLabel = t(`companion.capture.status${capture.status.charAt(0).toUpperCase()}${capture.status.slice(1)}` as Parameters<typeof t>[0]);

  const smallBtn = (primary?: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid var(--g-border)',
    background: primary ? 'var(--g-accent)' : 'transparent',
    color: primary ? 'var(--g-accent-ink)' : 'var(--g-text-mid)',
    fontSize: fontVars.xs,
    cursor: 'pointer',
    fontFamily: 'var(--g-font-sans)',
  });

  return (
    <article
      style={{
        background: 'var(--g-surface-1)',
        border: `1px solid ${capture.status === 'pending' ? `color-mix(in oklch, ${color} 38%, transparent)` : 'var(--g-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid var(--g-border)',
          background: 'var(--g-bg-raised)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: fontVars.sm }}>
          {isTask ? <IconCheck size={13} /> : <IconMemory size={13} />}
          <span>{isTask ? t('companion.capture.taskCandidate') : t('companion.capture.memoryCapture')}</span>
        </span>
        {importanceLabel && (
          <span
            style={{
              fontSize: fontVars.sm,
              padding: '1px 6px',
              borderRadius: 999,
              background: `color-mix(in oklch, ${color} 16%, transparent)`,
              color,
              fontFamily: 'var(--g-font-mono)',
            }}
          >
            {importanceLabel}
          </span>
        )}
        {capture.slot_label && (
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {t('companion.capture.hit', { slot: capture.slot_label })}
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: fontVars.sm,
            color: capture.status === 'pending' ? color : 'var(--g-text-faint)',
            fontFamily: 'var(--g-font-mono)',
          }}
        >
          {statusLabel}
        </span>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {editing ? (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              background: 'var(--g-bg-raised)',
              border: '1px solid var(--g-border)',
              borderRadius: 8,
              padding: '8px 10px',
              color: 'var(--g-text)',
              fontSize: fontVars.sm,
              lineHeight: 1.5,
              resize: 'vertical',
              fontFamily: 'var(--g-font-sans)',
            }}
          />
        ) : (
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {isTask ? (capture.title ?? capture.content) : capture.content}
          </p>
        )}
        {isTask && capture.due_date && (
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {t('companion.capture.due', { date: capture.due_date })}
          </span>
        )}

        {capture.status === 'pending' && (
          <div style={{ display: 'flex', gap: 6 }}>
            {editing ? (
              <>
                <button
                  type="button"
                  style={smallBtn(true)}
                  onClick={() => {
                    onDecide(capture.id, 'approve', isTask ? { title: draft } : { content: draft });
                    setEditing(false);
                  }}
                >
                  {t('companion.capture.saveConfirm')}
                </button>
                <button type="button" style={smallBtn()} onClick={() => setEditing(false)}>{t('common.cancel')}</button>
              </>
            ) : (
              <>
                <button type="button" style={smallBtn(true)} onClick={() => onDecide(capture.id, 'approve')}>
                  {isTask ? t('companion.capture.addTask') : t('companion.capture.confirmRemember')}
                </button>
                <button type="button" style={smallBtn()} onClick={() => setEditing(true)}>{t('companion.capture.fix')}</button>
                <button type="button" style={smallBtn()} onClick={() => onDecide(capture.id, 'reject')}>{t('companion.capture.ignore')}</button>
              </>
            )}
          </div>
        )}
        {(capture.status === 'saved' || capture.status === 'confirmed') && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
              {isTask ? t('companion.capture.addedToToday') : t('companion.capture.savedToMemory')}
            </span>
            <button type="button" style={smallBtn()} onClick={() => onUndo(capture.id)}>{t('companion.capture.undo')}</button>
          </div>
        )}
      </div>
    </article>
  );
}

function ToolArtifact({ event }: { event: ToolEvent }) {
  const t = useTranslations('app');
  const tone =
    /memory|capture|recall|忆/i.test(event.name) ? 'memory' :
    /task|plan|exec|执行/i.test(event.name) ? 'exec' :
    /goal|目标/i.test(event.name) ? 'goal' :
    'insight';
  const color =
    tone === 'memory' ? 'var(--g-dim-memory)' :
    tone === 'exec'   ? 'var(--g-dim-exec)'   :
    tone === 'goal'   ? 'var(--g-dim-goal)'   :
    'var(--g-dim-insight)';
  const [expanded, setExpanded] = useState(false);
  const canExpand = canExpandTool(event.name, event.goalId, event.result);

  return (
    <article
      style={{
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={canExpand ? () => setExpanded((e) => !e) : undefined}
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--g-border)',
          background: 'var(--g-bg-raised)',
          cursor: canExpand ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: fontVars.sm }}>
          <IconSpark size={14} />
          <span>{toolLabel(event.name, t)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: fontVars.sm,
              color: event.status === 'running' ? 'var(--g-dim-insight)' : 'var(--g-text-faint)',
              fontFamily: 'var(--g-font-mono)',
            }}
          >
            {event.status === 'running' ? t('companion.callStatus.running') : event.status === 'success' ? t('companion.callStatus.success') : t('companion.callStatus.failed')}
          </span>
          {canExpand && (
            <span style={{ color: 'var(--g-text-faint)', display: 'flex', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <IconChev size={13} />
            </span>
          )}
        </div>
      </div>
      <div style={{ padding: '10px 14px', fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
        {event.detail}
      </div>
      {canExpand && expanded && <ToolExpand name={event.name} goalId={event.goalId} result={event.result} />}
    </article>
  );
}

// Demo artifacts shown only when no real tool calls have happened yet.
function DemoArtifacts() {
  const t = useTranslations('app');
  return (
    <>
      <article
        style={{
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          borderRadius: 12,
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--g-dim-memory)', fontSize: fontVars.sm, marginBottom: 8 }}>
          <IconMemory size={14} />
          <span>{t('companion.board.explainTitle')}</span>
        </div>
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6 }}>
          {t('companion.board.explainBody')}
        </p>
      </article>
    </>
  );
}
