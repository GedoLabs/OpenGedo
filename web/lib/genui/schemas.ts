/**
 * Generative UI — card schema definitions (P1-B)
 *
 * LLM outputs a ```gedo:card:v1 ... ``` fenced block whose body is one of
 * these JSON objects. The fence is parsed by apiClient.chatStream and surfaced
 * to CompanionScreen as an `onCard` event, then validated in CardRenderer.
 *
 * Two layout types:
 *  - InlineCard — rendered inline in the message thread (read-only summary)
 *  - ActionCard — has action buttons (apply / undo) that write back to API
 *
 * (A `drawer` variant was specced but never implemented — dropped to keep the
 * schema honest; re-add when there's a real drawer renderer.)
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type CardVariant = 'inline' | 'action';

export interface BaseCard {
  /** Discriminator — must match one of the concrete types */
  card_type: string;
  /** Layout hint: inline | action. Currently unused by the renderers. */
  variant?: CardVariant;
  /** Optional card-level title (overrides per-card defaults) */
  title?: string;
}

// ---------------------------------------------------------------------------
// 1. SnapshotCard  — 周/月状态快照 (inline / action)
// ---------------------------------------------------------------------------

export interface SnapshotStat {
  label: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface SnapshotCard extends BaseCard {
  card_type: 'snapshot';
  period: 'today' | 'week' | 'month';
  stats: SnapshotStat[];
  summary?: string;
}

// ---------------------------------------------------------------------------
// 2. TaskAdjustCard  — 任务批量调整 (action)
// ---------------------------------------------------------------------------

export interface TaskAdjustItem {
  task_id: string;
  task_title: string;
  action: 'postpone' | 'reschedule' | 'remove' | 'priority_up' | 'priority_down';
  new_date?: string;      // ISO date for reschedule/postpone
  reason?: string;
}

export interface TaskAdjustCard extends BaseCard {
  card_type: 'task_adjust';
  items: TaskAdjustItem[];
  /** Unique token used to undo the batch — provided by backend after apply */
  undo_token?: string;
}

// ---------------------------------------------------------------------------
// 3. GoalProgressCard  — 目标进度 (inline / action)
// ---------------------------------------------------------------------------

export interface GoalProgressItem {
  goal_id: string;
  title: string;
  progress: number;       // 0-100
  status: 'on_track' | 'at_risk' | 'behind' | 'completed';
  life_wheel_dimension?: string;
  next_task?: string;
}

export interface GoalProgressCard extends BaseCard {
  card_type: 'goal_progress';
  goals: GoalProgressItem[];
}

// ---------------------------------------------------------------------------
// 4. MemoryListCard  — 记忆列表 (inline)
// ---------------------------------------------------------------------------

export interface MemoryListItem {
  memory_id: string;
  content: string;
  tags?: string[];
  created_at?: string;
}

export interface MemoryListCard extends BaseCard {
  card_type: 'memory_list';
  items: MemoryListItem[];
  query?: string;         // original user query that triggered this recall
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type GedoCard =
  | SnapshotCard
  | TaskAdjustCard
  | GoalProgressCard
  | MemoryListCard;

// ---------------------------------------------------------------------------
// Runtime validation
//
// No zod dependency — hand-rolled per-card guards. A card whose declared
// card_type doesn't carry the array field that its renderer will map over is
// rejected here and rendered as a raw-JSON fallback instead of crashing the
// message tree (LLM output drifts: goal_progress has shipped as `milestones`
// with no `goals` array, which would throw at `card.goals.map`).
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate that an already-JSON-parsed value is a renderable card. Returns the
 * card (typed) when its shape matches its card_type, otherwise null. Keep the
 * checks aligned with the four card interfaces above and with the backend
 * prompt contract in conversation.service.mjs::_genUIBlock().
 */
export function validateGedoCard(input: unknown): GedoCard | null {
  if (!isRecord(input) || typeof input.card_type !== 'string') return null;
  switch (input.card_type) {
    case 'snapshot':
      return Array.isArray(input.stats) ? (input as unknown as SnapshotCard) : null;
    case 'task_adjust':
      return Array.isArray(input.items) ? (input as unknown as TaskAdjustCard) : null;
    case 'goal_progress':
      return Array.isArray(input.goals) ? (input as unknown as GoalProgressCard) : null;
    case 'memory_list':
      return Array.isArray(input.items) ? (input as unknown as MemoryListCard) : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Runtime fence sentinel (used by apiClient parser)
// ---------------------------------------------------------------------------

export const CARD_FENCE_OPEN  = '```gedo:card:v1';
export const CARD_FENCE_CLOSE = '```';

/**
 * Parse a complete stored message body, extracting every `gedo:card:v1` fenced
 * card and returning the remaining display text. Used to rehydrate cards from
 * persisted history (the streaming parser in apiClient handles the live path).
 * Invalid-JSON blocks are kept verbatim in the text so nothing is silently lost.
 */
export function parseGedoCards(raw: string): { text: string; cards: GedoCard[] } {
  if (!raw) return { text: '', cards: [] };
  const cards: GedoCard[] = [];
  const re = /```gedo:card:v1\s*([\s\S]*?)```/g;
  const text = raw.replace(re, (whole, body) => {
    try { cards.push(JSON.parse(String(body).trim()) as GedoCard); return ''; }
    catch { return whole; }
  });
  return { text: text.trim(), cards };
}
