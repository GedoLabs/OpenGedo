/* eslint-disable @typescript-eslint/no-explicit-any --
 * Thin HTTP-client boundary: most responses are passed straight to callers that
 * type/cast at the use site. Hand-maintaining per-endpoint DTOs here would drift
 * from the server. Full end-to-end typing is tracked as a separate refactor.
 */
import { createCardFenceParser } from './genui/fence';

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | null;
};

/** Billing gate shape returned by backend `quotaError()` (402 responses). */
export type QuotaExceededBody = {
  error: 'quota_exceeded';
  resource: string;
  upgrade_tier: string;
  current_tier: string;
};

/**
 * Thrown by ApiClient.request() on non-2xx responses. `.message` stays a
 * plain string (back-compat with existing `e.message` displays across the
 * app); `.status` and `.body` carry the parsed JSON so callers that need
 * structured fields (e.g. billing gates' `upgrade_tier`/`resource`) don't
 * have to re-parse or guess from the message text.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isQuotaExceeded(e: unknown): e is ApiError & { body: QuotaExceededBody } {
  return e instanceof ApiError && e.status === 402 && (e.body as { error?: string })?.error === 'quota_exceeded';
}

/** 目标规划（记忆驱动 + 每日节奏）。preview 返回、commit 接收的计划结构。 */
/** A connected sign-in method (password / google / apple). */
export interface AuthIdentity { id: string; provider: string; email: string | null; created_at?: string }

export type GoalPlanTask = { title: string; estimatedDuration: number; energyLevel: 'high' | 'medium' | 'low' };
export type GoalPlanPhase = { name: string; focus?: string; startDay: number; endDay: number; dailyTasks: GoalPlanTask[] };
export type GoalPlan = {
  objective: string;
  personalNote?: string;
  keyResults: string[];
  cadence: 'daily' | 'milestone';
  durationDays: number;
  phases: GoalPlanPhase[];
  milestoneTasks: Array<GoalPlanTask & { day: number }>;
};

/** P1-A: shape returned by /v1/memory/import (and dryRun preview). */
export interface MemoryPackImportConflict {
  field: string;
  old_value: unknown;
  new_value: unknown;
  type: string;
}

export interface MemoryPackImportSummary {
  ok: boolean;
  imported_at: string;
  manifest: {
    schema: string;
    exporter: string;
    owner?: { uid_hash: string; display_name?: string };
    created_at: string;
    stats?: Record<string, number>;
  };
  episodes_added: number;
  episodes_skipped_duplicate: number;
  episodes_invalid: Array<{ line: number; reason: string }>;
  identity_changed: boolean;
  semantic_changed: boolean;
  procedural_changed: boolean;
  conflicts_detected: MemoryPackImportConflict[];
  warnings: string[];
}

/** P2-B: Proactive message surfaced by Reflector / CareAgent / StuckDetector / Daily-Plan agents. */
export interface ProactiveMessage {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  feedback?: 'accepted' | 'dismissed' | 'snoozed' | null;
  snoozed_until?: string | null;
  created_at: string;
}

/** Conversation summary returned by GET /v1/conversations. */
export interface ConversationSummary {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message?: string | null;
}

/** Single persisted chat message returned by GET /v1/conversations/:id/messages. */
export interface ConversationMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** Composer attachment — display-only this round (no LLM vision yet). */
export interface ChatAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
}

/** Mode-picker selection — 'auto' sends no tool_hint (today's LLM auto-detection). */
export type ChatMode = 'auto' | 'memory' | 'todo' | 'goal' | 'review';

/** 聊天显式关联（composer「+」→ 关联目标/待办/图鉴卡）。 */
export interface ChatReference {
  type: 'goal' | 'task' | 'entity';
  id: string;
  label: string;
}

/** 智伴首页智能引导（GET /v1/companion/brief）。 */
export interface CompanionBriefSuggestion {
  id: string;
  type: string;
  tone: 'exec' | 'goal' | 'memory' | 'insight';
  label: string;
  action: 'chat' | 'open_conversation' | 'open_pending';
  prompt?: string;
  conversation_id?: string;
}

export interface CompanionBrief {
  greeting: { text: string; source: 'llm' | 'template' };
  suggestions: CompanionBriefSuggestion[];
}

/** 外部工具（MCP server 登记，headers/env/oauth 秘密不回传）。 */
export interface McpServerInfo {
  id: string;
  name: string;
  slug: string;
  transport?: 'http' | 'stdio';
  url: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  has_headers?: boolean;
  oauth_status?: 'none' | 'pending' | 'connected';
  created_at: string;
  updated_at: string;
}

/** MCP 精选目录条目（能力开放 E3，运营维护清单）。 */
export interface McpDirectoryEntry {
  slug: string;
  name: string;
  url: string;
  auth: 'oauth' | 'none';
  icon: string;
  docs_url: string;
  desc: Record<string, string>;
}

/** PAT（个人访问令牌，能力开放 E2）：记忆 MCP 的长效凭证；明文仅创建时回显一次。 */
export interface PatInfo {
  id: string;
  name: string;
  scopes: string[];
  redact_pii: boolean;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  usage_count: number;
  revoked_at: string | null;
}

export interface PatAuditEntry {
  id: string;
  pat_id: string;
  tool: string;
  summary: string;
  ts: string;
}

/** Server-returned summary from POST /v1/memory/import (P1-A). */
export interface ImportSummary {
  ok: boolean;
  imported_at: string;
  manifest: {
    schema: string;
    exporter: string;
    owner?: { display_name?: string; uid_hash?: string };
    created_at?: string;
    stats?: Record<string, number>;
  };
  episodes_added: number;
  episodes_skipped_duplicate: number;
  episodes_invalid: Array<{ line: number; reason: string }>;
  identity_changed: boolean;
  semantic_changed: boolean;
  procedural_changed: boolean;
  conflicts_detected: Array<{
    field: string;
    old_value: unknown;
    new_value: unknown;
    type: string;
  }>;
  warnings: string[];
}

/** 对外数字人配置（owner 视角，GET/PUT /v1/me/digital-persona）。 */
export interface DigitalPersona {
  id: string;
  user_id: string;
  slug: string | null;
  published: boolean;
  setup_completed: boolean;
  display_name: string;
  tagline: string;
  greeting: string;
  avatar_kind: 'preset' | 'uploaded';
  avatar_url: string | null;
  preset_id: string;
  persona_mode: 'ABOUT';
  suggested_questions: string[];
  share_scope: { fields: string[]; topics: string[] };
  theme: string;
  access_mode: 'public' | 'passcode' | 'hybrid';
  passcode: string;
  view_count: number;
  created_at: string;
  updated_at: string;
}

/** 公开数字人档案（visitor 视角，GET /public/v1/persona/:slug）。 */
export interface PublicPersonaProfile {
  slug: string;
  display_name: string;
  tagline: string;
  greeting: string;
  avatar_kind: 'preset' | 'uploaded';
  avatar_url: string | null;
  preset_id: string;
  suggested_questions: string[];
  theme: string;
  access_mode: 'public' | 'passcode' | 'hybrid';
}

/**
 * 人际关系图谱节点（owner 视角）。
 * @deprecated 人脉已升级为图鉴实体卡：请改用 {@link Entity}（entity_type='person'）。
 * 该接口保留供移动端与 persona studio 组件过渡使用。
 */
export interface Relationship {
  id: string;
  user_id: string;
  name: string;
  aliases: string[];
  role: string;
  trust: 'low' | 'med' | 'high';
  tags: string[];
  note: string;
  source: 'manual' | 'pcp' | 'visitor' | 'ai';
  contributed_by: string | null;
  invite_token: string | null;
  last_interaction: string | null;
  interaction_count: number;
  created_at: string;
  updated_at: string;
}

/** 图鉴实体类型（人/宠物/物品/地点/事件/组织/其他）。 */
export type EntityType = 'person' | 'pet' | 'object' | 'place' | 'event' | 'org' | 'other';

/**
 * 图鉴实体卡：与用户有关的稳定存在（人/物/地/事），记忆的锚点层。
 * person 卡是旧 Relationship 的超集（同 id 迁移），分身识别/邀请字段保留。
 */
export interface Entity {
  id: string;
  user_id: string;
  entity_type: EntityType;
  name: string;
  aliases: string[];
  emoji: string;
  image_url: string | null;
  /** 与我的关系（person 卡与 role 双向镜像）。 */
  relation: string;
  /** 结构化事实（机器键，展示标签走 i18n keyLabels）。 */
  facts: { k: string; v: string }[];
  note: string;
  /** 关联的生命之花维度 key。 */
  dimensions: string[];
  tags: string[];
  /** true = 主人对 AI 隐藏这张卡（不注入上下文、不参与提及检测）。 */
  ai_excluded: boolean;
  /** true = 允许对外数字人使用卡上事实（默认 false，逐卡显式开启）。 */
  avatar_visible: boolean;
  source: string;
  // person 专属（数字分身流程）
  role: string;
  trust: 'low' | 'med' | 'high';
  invite_token: string | null;
  contributed_by: string | null;
  interaction_count: number;
  last_interaction: string | null;
  /** 卡面 AI 总结（后端事件驱动生成；''=尚未生成，卡面降级拼接 relation+facts）。 */
  ai_summary: string;
  ai_summary_meta: {
    generated_at: string;
    source_hash: string;
    episode_count: number;
    provenance: string | null;
    status: 'ok' | 'failed';
  } | null;
  created_at: string;
  updated_at: string;
}

/** 访客会话（对外互动留痕）。 */
export interface VisitorSession {
  id: string;
  user_id: string;
  persona_slug: string;
  session_token: string;
  visitor: { declared_name: string | null; relationship_id: string | null; matched: boolean; via: string };
  transcript: { role: 'user' | 'assistant'; content: string; ts: string }[];
  summary: string | null;
  finalized: boolean;
  created_at: string;
  last_active_at: string;
}

/** 对话主动捕获的记忆/待办/图鉴候选（SSE memory_candidate / GET /v1/me/captures）。 */
export interface MemoryCandidate {
  id: string;
  kind: 'memory' | 'task' | 'entity_fact' | 'entity_suggest';
  status: 'pending' | 'saved' | 'confirmed' | 'rejected' | 'undone' | 'expired';
  importance: 'core' | 'high' | 'normal' | 'low';
  confidence: number;
  slot_id: string | null;
  slot_label: string | null;
  type: string | null;
  content: string;
  title: string | null;
  due_date: string | null;
  tags: string[];
  // 图鉴候选（entity_fact / entity_suggest）附加字段
  entity_id?: string | null;
  entity_name?: string | null;
  entity_type?: string | null;
  fact_key?: string | null;
  fact_value?: string | null;
  /** 来源中心：候选所属 Source（对话捕捉为 null） */
  source_id?: string | null;
  created_at: string;
}

// ── 统一收件箱（智忆 IA v2）───────────────────────────────────────────────
export interface MemoryInboxItem {
  /** capture id 或 conflict_<id>（画像变更） */
  id: string;
  origin: 'import' | 'chat' | 'consolidation';
  kind: 'memory' | 'task' | 'entity_fact' | 'entity_suggest' | 'profile_change';
  source_id: string | null;
  confidence: number | null;
  created_at: string | null;
  /** 候选过期时刻（聊天 14 天 / 导入 90 天；画像变更无期限） */
  expires_at?: string;
  /** capture 类条目（origin=import|chat） */
  candidate?: MemoryCandidate;
  /** 画像变更条目（origin=consolidation） */
  conflict?: {
    id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
    old_evidence?: string | null;
    new_evidence?: string | null;
  };
}

export interface MemoryInboxCounts {
  total: number;
  import: number;
  chat: number;
  consolidation: number;
  active_sources?: number;
  by_source: Array<{ source_id: string; name: string | null; count: number }>;
}

export interface MemoryInboxSnapshot {
  counts: MemoryInboxCounts;
  items: MemoryInboxItem[];
  /** 近 7 天导入自动收下（可一键撤销）按来源分组 */
  auto_saved: Array<{ source_id: string; name: string | null; count: number; latest_decided_at: string | null }>;
}

// ── 来源中心（记忆导入 v2）────────────────────────────────────────────────
export type MemorySourceStatus =
  | 'queued' | 'fetching' | 'parsing' | 'extracting' | 'review' | 'done' | 'failed' | 'canceled';

export interface MemorySource {
  id: string;
  type: 'file' | 'url' | 'text' | 'chat_export';
  platform: 'chatgpt' | 'claude' | 'gemini' | 'kimi' | 'doubao' | 'deepseek' | 'generic' | null;
  title: string | null;
  origin: { filename?: string | null; mime?: string | null; size_bytes?: number; url?: string; final_url?: string; chars?: number };
  status: MemorySourceStatus;
  progress: { chunks_done: number; chunks_total: number; candidates_created: number; entities_suggested: number };
  stats: { char_count: number; chunk_count: number; conv_count?: number; accepted: number; rejected: number; extract_failures?: number };
  error: { code: string; message: string } | null;
  job_id: string | null;
  created_at: string;
  updated_at: string;
  queue_position?: number | null;
}

export interface SourceQuota { used: number; limit: number | null }

/** 核心记忆模板槽位状态（/v1/memory/stats → core_slots）。 */
export interface CoreSlotStatus {
  id: string;
  label: string;
  layer: 'L1' | 'L2' | 'L3';
  importance: 'core' | 'high' | 'normal';
  hint?: string;
  filled: boolean;
}

/** 记忆体系统计（GET /v1/memory/stats）。 */
export interface MemoryStats {
  pcp_version: string;
  pcp_size_kb: number;
  total_episodes: number;
  unconsolidated_episodes: number;
  episodes_by_type: Record<string, number>;
  episodes_by_source?: Record<string, number>;
  episodes_by_dimension?: Record<string, number>;
  recent30d_by_dimension?: Record<string, number>;
  core_slots?: { total: number; filled: number; percent: number; slots: CoreSlotStatus[] };
  profile_filled: {
    has_name: boolean;
    has_profession: boolean;
    has_big5: boolean;
    has_cognition: boolean;
    traits_count: number;
    values_count: number;
    relationships_count: number;
    expertise_domains: number;
    filled_dimensions: string[];
    cross_patterns_count: number;
    milestones_count: number;
    failure_learnings_count: number;
    relationship_map_count: number;
  };
  working_memory: {
    active_goals_count: number;
    focus_domain: string | null;
    pending_items_count: number;
    recent_decisions_count: number;
    emotional_state: string | null;
  };
  conflicts: { total: number; unresolved: number };
  last_consolidated: string | null;
}

/** 当前计算出的状态快照（GET /v1/memory/state/current，State Engine P2）。 */
export interface MemoryState {
  computed_at: string;
  window_days: number;
  focus: { domain: string; label: string; source: string } | null;
  active_goal: { id: string; title: string; progress: number | null; dimension: string | null } | null;
  cognitive_mode: string;
  cognitive_mode_label: string;
  energy: string;
  energy_label: string;
  emotion: string;
  emotion_label: string;
  momentum: { score: number; trend: 'up' | 'flat' | 'down'; trend_label: string; completion_rate: number | null };
  confidence: number;
  signals: Array<{ field: string; from: string; detail: string }>;
}

/** 动态人格模型（GET /v1/memory/identity，Identity Engine P3）。 */
export interface MemoryIdentity {
  /** 卡片级证据回溯（IA v2）：推导消费的记忆 id；旧版本无此字段走降级文案 */
  evidence_episode_ids?: string[];
  version: number;
  computed_at: string;
  method: 'rule' | 'llm';
  model: {
    growth_stage: string; growth_stage_label: string;
    decision_style: string; decision_style_label: string;
    risk_tendency: string; risk_tendency_label: string;
    strengths: Array<{ label: string; evidence_count?: number }>;
    weaknesses: Array<{ label: string; evidence_count?: number }>;
    goal_preferences: string[];
    summary?: string | null;
  };
  confidence: { overall: number; [k: string]: number };
  changes: string[];
}

/** 成长轨迹叙事（GET /v1/memory/narrative，Narrative Engine P4）。 */
export interface MemoryNarrative {
  /** 卡片级证据回溯（IA v2）：推导消费的记忆 id；旧版本无此字段走降级文案 */
  evidence_episode_ids?: string[];
  window_days: number;
  generated_at: string;
  stage: string;
  summary: string;
  changes: string[];
  risks: string[];
  opportunities: string[];
  next_steps: string[];
  highlights: string[];
  signals: Record<string, number>;
  confidence: number;
  method: 'rule' | 'llm';
}

// ── 生命之花八维 AI 评估（GET /v1/memory/dimensions，Dimension Engine）──
export type DimLevelKey = 'needs_care' | 'sprouting' | 'growing' | 'thriving' | 'blooming';
export interface MemoryDimensionSignals {
  ep_total: number;
  ep_30d: number;
  ep_90d: number;
  goals_active: number;
  goals_avg_progress: number | null;
  goals_completed_90d: number;
  skills: number;
  has_summary: boolean;
  has_patterns: boolean;
  self_score: number | null;
}
export interface MemoryDimensionEntry {
  /** insufficient = 证据不足不给分（雷达收缩圆心，详情引导多聊） */
  status: 'scored' | 'insufficient';
  score?: number;
  level?: number;
  level_key?: DimLevelKey;
  confidence: number;
  rule_score?: number;
  prev_score?: number;
  insight?: string | null;
  insight_method?: 'rule' | 'llm';
  signals: MemoryDimensionSignals;
  evidence_episode_ids: string[];
}
export interface MemoryDimensionAssessment {
  version: number;
  generated_at: string;
  method: 'rule' | 'llm';
  trigger: string;
  min_confidence: number;
  overall: { score: number | null; scored_dims: number };
  changes: string[];
  dimensions: Record<string, MemoryDimensionEntry>;
}

// ── 自我认知报告（证据驱动、非临床；GET/POST /v1/memory/assessment*）──
export type InsightBig5Key = 'openness' | 'conscientiousness' | 'extraversion' | 'agreeableness' | 'neuroticism';
export type InsightGedoKey = 'motivation' | 'decision_style' | 'energy_rhythm' | 'stress_response' | 'interpersonal';
export interface InsightEvidence { kind: 'episode' | 'profile' | 'life_wheel' | 'identity' | 'clarification'; ref: string | null; quote: string; date?: string }
export interface InsightBig5Dim { score: number; confidence: number; narrative: string; evidence: InsightEvidence[] }
export interface InsightGedoDim { label: string; tags: string[]; confidence: number; narrative: string; evidence: InsightEvidence[] }
export interface InsightQuestion { id: string; dimension: string; kind: 'choice' | 'scale'; question: string; options?: string[]; min_label?: string; max_label?: string }
export interface InsightClarification extends InsightQuestion { answer: string | number }
export interface InsightVersion {
  id: string; version: number; schema: string; language?: string;
  computed_at: string; finalized_at: string; model_used?: string | null;
  evidence_stats?: { episodes_scanned: number; episodes_packed: number; slots_percent: number };
  headline: string; summary: string;
  big5: Record<InsightBig5Key, InsightBig5Dim>;
  gedo: Record<InsightGedoKey, InsightGedoDim>;
  clarifications: InsightClarification[];
}
export interface InsightDraft {
  id: string; expires_at: string; headline: string; summary: string;
  big5: Record<InsightBig5Key, InsightBig5Dim>;
  gedo: Record<InsightGedoKey, InsightGedoDim>;
  questions: InsightQuestion[];
}
export interface InsightState {
  eligibility: { unlocked: boolean; percent: number; required_percent: number };
  latest: InsightVersion | null;
  versions_count: number;
  cooldown: { active: boolean; next_available_at: string | null; days_left: number };
  draft: { active: boolean; id: string | null; expires_at: string | null; questions_count: number };
}
export type InsightStartResult =
  | { status: 'clarify'; resumed: boolean; draft: InsightDraft }
  | { status: 'final'; version: InsightVersion };

/** 待审收件箱候选项。 */
export interface InboxItem {
  id: string;
  user_id: string;
  session_id: string | null;
  source_relationship_id: string | null;
  source_label: string;
  kind: 'task' | 'memory' | 'reminder';
  payload: Record<string, any>;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at: string | null;
}

/** 数字人活动洞察（GET /v1/me/persona/stats）。 */
export interface PersonaStats {
  view_count: number;
  sessions: { total: number; matched: number; anonymous: number };
  inbox: { pending: number; approved: number; rejected: number };
  messages: { total: number; avg_per_session: number };
  top_questions: { q: string; count: number }[];
}

/** Editable subset accepted by PUT /v1/me/digital-persona. */
export type DigitalPersonaPatch = Partial<
  Pick<
    DigitalPersona,
    | 'display_name'
    | 'tagline'
    | 'greeting'
    | 'avatar_kind'
    | 'avatar_url'
    | 'preset_id'
    | 'suggested_questions'
    | 'share_scope'
    | 'theme'
    | 'access_mode'
    | 'passcode'
  >
>;

/**
 * Resolve the backend base URL using the same precedence as ApiClient.
 * Exported so the unauthenticated public persona page can reach the API
 * without constructing an ApiClient/AuthContext.
 */
export function resolveApiBaseUrl(): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envBaseUrl) return envBaseUrl;
  // Browser: same-origin /api proxy (Next rewrites → backend). Required for Cloud Agent
  // preview where the user's browser cannot reach localhost:8787 on the dev machine.
  if (typeof window !== 'undefined') return window.location.origin + '/api';
  // SSR/Node：容器编排下 backend 不在 localhost（compose 注入 BACKEND_ORIGIN=http://backend:8787）。
  return process.env.BACKEND_ORIGIN || 'http://localhost:8787';
}

// ── Twin 分身模型（个人 LoRA · /v1/twin/*，docs/GEDO_TWIN_LORA_PLAN.md）─────
export interface TwinStatus {
  entitled: boolean;
  corpus: {
    consent: { granted: boolean; version?: string; granted_at?: string };
    items: number;
    chars: number;
    thresholds: { min_items: number; min_chars: number };
    progress: number;
    style_ok: boolean;
    eligible: boolean;
    actions: string[];
  };
  active: { id: string; adapter: string; version: number; status: string } | null;
  jobs: Array<{
    id: string; adapter: string; version: number; status: string;
    base_model_version: string; created_at: string; updated_at: string;
  }>;
}

export class ApiClient {
  private baseUrl: string;
  private getToken?: () => string | null;

  constructor(opts: ApiClientOptions = {}) {
    // 优先顺序：
    // 1. 显式传入的 baseUrl（用于覆盖一切场景）
    // 2. NEXT_PUBLIC_API_BASE_URL（推荐在不同环境中配置后端地址）
    // 3. 浏览器端：当前域名 /api（经 Next rewrite 转发，Cloud Agent 预览可用）
    // 4. SSR/Node：本地开发直连 http://localhost:8787
    const envBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    let defaultBaseUrl: string;
    if (envBaseUrl) {
      defaultBaseUrl = envBaseUrl;
    } else if (typeof window !== 'undefined') {
      defaultBaseUrl = window.location.origin + '/api';
    } else {
      // SSR/Node：容器编排下用 BACKEND_ORIGIN（compose 注入），本地开发回退 localhost。
      defaultBaseUrl = process.env.BACKEND_ORIGIN || 'http://localhost:8787';
    }
    this.baseUrl = opts.baseUrl || defaultBaseUrl;
    this.getToken = opts.getToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let errorMessage = `API ${res.status}: ${text || res.statusText}`;
        let errorJson: unknown = null;
        try {
          errorJson = JSON.parse(text);
          if ((errorJson as { error?: string })?.error) {
            errorMessage = (errorJson as { error: string }).error;
          }
        } catch {
          // 忽略 JSON 解析错误，使用原始错误消息
        }
        throw new ApiError(errorMessage, res.status, errorJson);
      }
      return (await res.json()) as T;
    } catch (error) {
      // 如果是网络错误，提供更友好的提示
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Failed to fetch - 无法连接到服务器');
      }
      throw error;
    }
  }

  signup(email: string, password: string, inviteCode?: string) {
    const payload: Record<string, any> = { email, password };
    if (inviteCode && inviteCode.trim().length > 0) {
      payload.invite_code = inviteCode.trim();
    }
    return this.request<{ token: string; user: { id: string; email: string; display_name?: string | null; avatar_url?: string | null } }>('/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  login(email: string, password: string) {
    return this.request<{ token: string; user: { id: string; email: string; display_name?: string | null; avatar_url?: string | null } }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  /** Exchange a Google ID token (GIS `credential`) for a GEDO session. */
  loginWithGoogle(idToken: string, opts: { inviteCode?: string; locale?: string } = {}) {
    const payload: Record<string, any> = { id_token: idToken };
    if (opts.inviteCode && opts.inviteCode.trim().length > 0) payload.invite_code = opts.inviteCode.trim();
    if (opts.locale) payload.locale = opts.locale;
    return this.request<{ token: string; user: { id: string; email: string; display_name?: string | null; avatar_url?: string | null }; is_new?: boolean }>('/v1/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Exchange an Apple identity token for a GEDO session. `fullName` is only
   *  available from Apple on the user's first authorization. */
  loginWithApple(idToken: string, opts: { inviteCode?: string; locale?: string; fullName?: string } = {}) {
    const payload: Record<string, any> = { id_token: idToken };
    if (opts.inviteCode && opts.inviteCode.trim().length > 0) payload.invite_code = opts.inviteCode.trim();
    if (opts.locale) payload.locale = opts.locale;
    if (opts.fullName && opts.fullName.trim()) payload.full_name = opts.fullName.trim();
    return this.request<{ token: string; user: { id: string; email: string; display_name?: string | null; avatar_url?: string | null }; is_new?: boolean }>('/v1/auth/apple', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  me() {
    return this.request<{ id: string; email: string; created_at: string; display_name: string | null; avatar_url: string | null }>('/v1/me');
  }

  // ── 交易邮件流程（找回密码 / 验证邮箱，无需鉴权除 resend 外）──────────────
  /**
   * 发起找回密码。后端恒返 200(不泄露账号是否存在);429 = 限流。
   * 存在的账号会收到 /auth/reset-password?token= 链接(1h 有效)。
   */
  forgotPassword(email: string) {
    return this.request<{ ok: boolean }>('/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  /**
   * 用邮件里的 token 设新密码。400 错误码:
   * invalid_token / used_token / expired_token / weak_password。
   */
  resetPassword(token: string, newPassword: string) {
    return this.request<{ ok: boolean }>('/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  }

  /** 点验证链接后确认邮箱。400 错误码:invalid_token / used_token / expired_token。 */
  verifyEmail(token: string) {
    return this.request<{ ok: boolean; email?: string }>('/v1/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  /** 登录态重发验证信(已验证则 already_verified:true)。 */
  resendVerification() {
    return this.request<{ ok: boolean; already_verified?: boolean }>('/v1/auth/resend-verification', {
      method: 'POST',
    });
  }

  // ── Twin 分身模型（个人 LoRA）─────────────────────────────────────────────

  getTwinStatus() {
    return this.request<TwinStatus>('/v1/twin/status');
  }

  grantTwinConsent() {
    return this.request<{ granted: boolean; version: string }>('/v1/twin/consent', { method: 'POST' });
  }

  /** 撤回 = 训练语料与分身模型物理删除（不可恢复）。 */
  revokeTwinConsent() {
    return this.request<{ granted: boolean; revoked: boolean }>('/v1/twin/consent', { method: 'DELETE' });
  }

  addTwinSample(text: string) {
    return this.request<{ added: boolean; chars: number }>('/v1/twin/samples', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  /** Change the account password (requires the current password). */
  changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ ok: boolean }>('/v1/me/password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  }

  /** Change the account email (requires the password). Returns the updated user. */
  changeEmail(password: string, newEmail: string) {
    return this.request<{ id: string; email: string; created_at: string; display_name: string | null; avatar_url: string | null }>('/v1/me/email', {
      method: 'POST',
      body: JSON.stringify({ password, new_email: newEmail }),
    });
  }

  /** Set the account display name (empty string clears it, falling back to the email prefix). */
  updateProfile(displayName: string) {
    return this.request<{ id: string; email: string; created_at: string; display_name: string | null; avatar_url: string | null }>('/v1/me/profile', {
      method: 'POST',
      body: JSON.stringify({ display_name: displayName }),
    });
  }

  /** Clear the account avatar, reverting to the initial-letter fallback. */
  removeAvatar() {
    return this.request<{ id: string; email: string; created_at: string; display_name: string | null; avatar_url: string | null }>('/v1/me/profile', {
      method: 'POST',
      body: JSON.stringify({ remove_avatar: true }),
    });
  }

  /** Upload a new account avatar (raw image blob, mirrors uploadPersonaAvatar). */
  async uploadAvatar(file: Blob): Promise<{ id: string; email: string; created_at: string; display_name: string | null; avatar_url: string | null }> {
    const headers = new Headers();
    headers.set('content-type', file.type || 'application/octet-stream');
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/me/avatar`, { method: 'POST', headers, body: file });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Avatar upload failed (${res.status}): ${text || res.statusText}`);
    }
    return res.json();
  }

  captureMemory(input: { type: string; content_raw: string; tags?: string[]; source?: string; dimensions?: string[] }) {
    return this.request('/v1/memory/capture', { method: 'POST', body: JSON.stringify(input) });
  }

  searchMemory(q: string) {
    const qs = new URLSearchParams({ q }).toString();
    return this.request<{ items: any[] }>(`/v1/memory/search?${qs}`);
  }

  /** Owner-visible memory list (episodes), including AI-excluded ones, for the control center. */
  listEpisodes(opts: { includeExcluded?: boolean; limit?: number; dimension?: string } = {}) {
    const qs = new URLSearchParams({
      includeExcluded: String(opts.includeExcluded ?? true),
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
      ...(opts.dimension ? { dimension: opts.dimension } : {}),
    }).toString();
    return this.request<{ items: any[] }>(`/v1/me/episodes?${qs}`);
  }

  /** Toggle whether a single memory may be used in AI context. */
  setEpisodeExcluded(id: string, aiExcluded: boolean) {
    return this.request<{ id: string; ai_excluded: boolean }>(`/v1/me/episodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ai_excluded: aiExcluded }),
    });
  }

  /** Adjust a memory's importance (P5 降权/恢复). impactScore 0–1. */
  setEpisodeImportance(id: string, impactScore: number) {
    return this.request<{ id: string; impact_score: number }>(`/v1/me/episodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ impact_score: impactScore }),
    });
  }

  /** Hard-delete a single memory. */
  deleteEpisode(id: string) {
    return this.request<{ ok: boolean }>(`/v1/me/episodes/${id}`, { method: 'DELETE' });
  }

  // ── 四层记忆体系（架构视图）────────────────────────────────────────────
  /** L1 身份画像 + L3 语义记忆（profile.json）。 */
  getMemoryProfile() {
    return this.request<Record<string, unknown>>('/v1/memory/profile');
  }

  /** 部分更新画像（后端按维度深合并；生命之花自评写 semantic_memory.dimensions.<k>.self_score）。 */
  updateMemoryProfile(patch: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/v1/memory/profile', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  /** L2 工作记忆（working.json）。 */
  getMemoryWorking() {
    return this.request<Record<string, unknown>>('/v1/memory/working');
  }

  /** 记忆体系统计（episode 计数、画像完成度、核心槽位状态）。 */
  getMemoryStats() {
    return this.request<MemoryStats>('/v1/memory/stats');
  }

  /** P2: 实时计算的当前状态（focus / 认知模式 / 精力 / 情绪 / 势头）。 */
  getMemoryState() {
    return this.request<MemoryState>('/v1/memory/state/current');
  }

  /** P3: 动态人格模型（最新版本，含变化解释）。 */
  getMemoryIdentity() {
    return this.request<MemoryIdentity>('/v1/memory/identity');
  }

  /** P4: 成长轨迹叙事（window: 7 | 30 | 90 天）。 */
  getMemoryNarrative(window: 7 | 30 | 90 = 30) {
    return this.request<MemoryNarrative>(`/v1/memory/narrative?window=${window}`);
  }

  /** P4: 重新生成轨迹叙事（可选 LLM 精炼）。 */
  refreshMemoryNarrative(window: 7 | 30 | 90 = 30, useLLM = false) {
    return this.request<MemoryNarrative>('/v1/memory/narrative/refresh', {
      method: 'POST',
      body: JSON.stringify({ window, use_llm: useLLM }),
    });
  }

  /** 生命之花八维 AI 评估（首读规则生成，永远有值）。 */
  getMemoryDimensions() {
    return this.request<MemoryDimensionAssessment>('/v1/memory/dimensions');
  }

  /** 重算八维评估（use_llm=true 时带 LLM 解读精炼）。 */
  recomputeMemoryDimensions(useLLM = false) {
    return this.request<MemoryDimensionAssessment>('/v1/memory/dimensions/recompute', {
      method: 'POST',
      body: JSON.stringify({ use_llm: useLLM }),
    });
  }

  /** 自我认知报告：门槛/冷却/最新版本/草稿态。 */
  getInsightState() {
    return this.request<InsightState>('/v1/memory/assessment');
  }
  /** 历史版本（新→旧，画像演变时间线）。 */
  getInsightVersions() {
    return this.request<{ versions: InsightVersion[] }>('/v1/memory/assessment/versions');
  }
  /** 发起/续做生成（LLM call 1 → 草稿+澄清题，或零问题直通 final）。 */
  startInsight(force = false) {
    return this.request<InsightStartResult>('/v1/memory/assessment/start', {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  }
  /** 提交澄清答案（LLM call 2 → 定稿）。 */
  submitInsightAnswers(draftId: string, answers: { id: string; value: string | number }[]) {
    return this.request<{ status: 'final'; version: InsightVersion }>('/v1/memory/assessment/answers', {
      method: 'POST',
      body: JSON.stringify({ draft_id: draftId, answers }),
    });
  }

  /** 触发记忆整合（episodes → profile）。 */
  consolidateMemory(level: 'session' | 'nightly' | 'weekly' | 'quarterly' = 'nightly') {
    return this.request<Record<string, unknown>>('/v1/memory/consolidate', {
      method: 'POST',
      body: JSON.stringify({ level }),
    });
  }

  /** 把 legacy memoryItems（含 onboarding 答案）迁移到 episodes 并回填画像。 */
  migrateMemory() {
    return this.request<{ migrated: number; skipped: number; totalLegacy: number }>('/v1/memory/migrate', {
      method: 'POST',
    });
  }

  /** 一键梳理：大模型全量整理历史 + 智能分流（高置信自动入库，冲突/低置信进待确认）。 */
  reorganizeMemory() {
    return this.request<{ success: boolean; episodesProcessed: number; autoApplied: boolean; conflictsDetected: number; pendingConflicts: number; summary?: string; llm_unavailable?: boolean }>(
      '/v1/memory/reorganize',
      { method: 'POST' },
    );
  }

  /** 待确认的画像变更（冲突项）。 */
  getMemoryConflicts() {
    return this.request<{ conflicts: Array<{ id: string; field: string; old_value: unknown; new_value: unknown; new_evidence?: string | null; detected_at?: string }> }>(
      '/v1/memory/conflicts',
    );
  }

  /** 逐条处理画像变更：accept_new 采用新值并写入画像，keep_old 保留原值。 */
  resolveMemoryConflict(conflictId: string, resolution: 'accept_new' | 'keep_old' | 'merge', resolvedValue?: unknown) {
    return this.request<{ success: boolean; applied?: boolean }>('/v1/memory/conflicts/resolve-single', {
      method: 'POST',
      body: JSON.stringify({ conflict_id: conflictId, resolution, resolved_value: resolvedValue }),
    });
  }

  // ── 主动捕获候选（确认/忽略/撤销）──────────────────────────────────────
  listCaptures(opts: { status?: string; kind?: 'memory' | 'task'; sourceId?: string; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.kind) qs.set('kind', opts.kind);
    if (opts.sourceId) qs.set('source_id', opts.sourceId);
    if (opts.limit) qs.set('limit', String(opts.limit));
    const query = qs.toString();
    return this.request<{ items: MemoryCandidate[] }>(`/v1/me/captures${query ? `?${query}` : ''}`);
  }

  /** 来源中心批量确认：一次接受/拒绝多条候选（部分失败语义，failed[] 带原因）。 */
  decideCapturesBatch(decisions: Array<{
    id: string;
    decision: 'approve' | 'reject';
    edits?: { content?: string; title?: string; type?: string; tags?: string[]; dimensions?: string[] };
  }>) {
    return this.request<{
      confirmed: string[];
      rejected: string[];
      failed: Array<{ id: string | null; error: string; detail?: string; quota?: { resource: string; upgrade_tier: string } }>;
    }>('/v1/me/captures/decide-batch', {
      method: 'POST',
      body: JSON.stringify({ decisions }),
    });
  }

  decideCapture(
    id: string,
    decision: 'approve' | 'reject',
    edits?: { content?: string; title?: string; due_date?: string | null; tags?: string[] }
  ) {
    return this.request<MemoryCandidate>(`/v1/me/captures/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...(edits ? { edits } : {}) }),
    });
  }

  undoCapture(id: string) {
    return this.request<MemoryCandidate>(`/v1/me/captures/${id}/undo`, { method: 'POST' });
  }

  // ── 统一收件箱（智忆 IA v2 批次1）────────────────────────────────────────
  /** 三队列聚合快照：来源候选 + 聊天新发现 + 画像变更；计数为服务端全量口径。 */
  getMemoryInbox(opts: { limit?: number } = {}) {
    const qs = opts.limit != null ? `?limit=${opts.limit}` : '';
    return this.request<MemoryInboxSnapshot>(`/v1/memory/inbox${qs}`);
  }

  /** 收件箱批量裁决：id 可为 capture id 或 conflict_<id>；收下=approve、跳过=reject。 */
  decideInboxBatch(decisions: Array<{
    id: string;
    decision: 'approve' | 'reject';
    edits?: { content?: string; type?: string; tags?: string[]; dimensions?: string[]; resolved_value?: unknown };
  }>) {
    return this.request<{
      confirmed: string[];
      rejected: string[];
      failed: Array<{ id: string | null; error: string; detail?: string; quota?: { resource: string; upgrade_tier: string } }>;
      conflicts: { applied: string[]; kept: string[]; failed: Array<{ id: string; error: string }> };
    }>('/v1/memory/inbox/decide-batch', {
      method: 'POST',
      body: JSON.stringify({ decisions }),
    });
  }

  /** 批量撤销已收下的候选（自动收下的后悔药）：按来源或显式 ids。 */
  undoCapturesBatch(opts: { ids?: string[]; sourceId?: string; since?: string; until?: string }) {
    return this.request<{ undone: string[]; failed: Array<{ id: string; error: string }> }>(
      '/v1/me/captures/undo-batch',
      {
        method: 'POST',
        body: JSON.stringify({
          ...(opts.ids ? { ids: opts.ids } : {}),
          ...(opts.sourceId ? { source_id: opts.sourceId } : {}),
          ...(opts.since ? { since: opts.since } : {}),
          ...(opts.until ? { until: opts.until } : {}),
        }),
      },
    );
  }

  /** Hard-delete the entire account and all of the user's cloud data. Irreversible. Requires password. */
  deleteAccount(password: string) {
    return this.request<{ ok: boolean; removed: Record<string, number> }>('/v1/me/account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
  }

  clarify(prompt: string) {
    return this.request<{ questions: any[] }>('/v1/planner/clarify', { method: 'POST', body: JSON.stringify({ prompt }) });
  }

  generatePlan(prompt: string, answers: Record<string, any>) {
    return this.request<{ goal: any; tasks: any[] }>('/v1/planner/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt, answers }),
    });
  }

  todayTasks() {
    return this.request<{ items: any[] }>('/v1/tasks/today');
  }

  // All tasks across time — used by the execution page to show 今日/未来/历史.
  listTasks() {
    return this.request<{ items: any[] }>('/v1/tasks');
  }

  createTask(input: { title: string; description?: string; scheduled_date?: string | null; due_date?: string | null; priority?: 'high' | 'medium' | 'low'; energy_level?: 'high' | 'medium' | 'low'; estimated_duration?: number; is_mit?: boolean; goal_id?: string | null; key_result_id?: string | null }) {
    return this.request<{ task: any }>('/v1/tasks', { method: 'POST', body: JSON.stringify(input) });
  }

  checkin(taskId: string, input: { status: 'todo' | 'in_progress' | 'done' | 'skipped'; reason_code?: string; note?: string }) {
    return this.request<{ task: any; adjustments?: any[] }>(`/v1/tasks/${taskId}/checkin`, { method: 'POST', body: JSON.stringify(input) });
  }

  /** 逐条编辑任务：改名 / 改排期 / 优先级。 */
  updateTask(taskId: string, patch: { title?: string; description?: string; scheduled_date?: string | null; due_date?: string | null; priority?: number; energy_level?: 'high' | 'medium' | 'low'; estimated_duration?: number; is_mit?: boolean; key_result_id?: string | null }) {
    return this.request<{ task: any }>(`/v1/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  deleteTask(taskId: string) {
    return this.request<{ success: boolean }>(`/v1/tasks/${taskId}`, { method: 'DELETE' });
  }

  /** 「细化」预览：返回大模型建议的子步骤，不落库。 */
  breakdownTask(taskId: string) {
    return this.request<{ subtasks: Array<{ title: string; description?: string; estimated_duration?: number; energy_level?: string }> }>(
      `/v1/tasks/${taskId}/breakdown`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  /** 「细化」确认：把选中的子步骤创建为真实任务（继承父任务排期/目标）。 */
  applyTaskBreakdown(taskId: string, subtasks: Array<{ title: string; description?: string; estimated_duration?: number; energy_level?: string }>) {
    return this.request<{ created: any[] }>(
      `/v1/tasks/${taskId}/breakdown`,
      { method: 'POST', body: JSON.stringify({ apply: true, subtasks }) }
    );
  }

  treeSnapshot() {
    return this.request<any>('/v1/tree/snapshot');
  }

  // 三方记忆导入（P6）：上传 ChatGPT/Claude 导出或纯文本 → 异步分解 → 轮询进度
  async importExternalMemory(format: 'chatgpt' | 'claude' | 'text', body: Blob | string) {
    const headers = new Headers();
    headers.set('content-type', 'application/octet-stream');
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/memory/import/external?format=${format}`, {
      method: 'POST', headers, body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Import failed (${res.status}): ${text || res.statusText}`);
    }
    return (await res.json()) as { job_id: string; convs_total: number; convs_found: number };
  }

  getImportJob(id: string) {
    return this.request<{
      id: string; status: 'processing' | 'done' | 'failed'; source: string;
      progress: { convs_done: number; convs_total: number; episodes_created: number; entities_touched: number };
      report: { episodes_created: number; entities_touched: number; convs_processed: number; convs_skipped: number; extract_failures: number } | null;
      error: string | null;
    }>(`/v1/memory/import/jobs/${id}`);
  }

  // ── 来源中心（记忆导入 v2）：来源 CRUD + 持久队列 + 确认制提取 ─────────────
  /** 粘贴文本 → 新来源（platform 供豆包/DeepSeek 等"指引+粘贴"路径打标）。 */
  createSourceText(text: string, opts: { title?: string; platform?: string } = {}) {
    return this.request<{ source: MemorySource; queue_position: number | null }>('/v1/memory/sources', {
      method: 'POST',
      body: JSON.stringify({ type: 'text', text, ...(opts.title ? { title: opts.title } : {}), ...(opts.platform ? { platform: opts.platform } : {}) }),
    });
  }

  /** 网页链接 → 新来源（后端抓取正文，SSRF 防护）。 */
  createSourceUrl(url: string, title?: string) {
    return this.request<{ source: MemorySource; queue_position: number | null }>('/v1/memory/sources', {
      method: 'POST',
      body: JSON.stringify({ type: 'url', url, ...(title ? { title } : {}) }),
    });
  }

  /** 文件/平台导出包 → 新来源（octet-stream，文件名走 x-source-name）。 */
  async createSourceFile(file: File, opts: { type?: 'file' | 'chat_export'; platform?: string } = {}) {
    const qs = new URLSearchParams();
    qs.set('type', opts.type || 'file');
    if (opts.platform) qs.set('platform', opts.platform);
    const headers = new Headers();
    headers.set('content-type', 'application/octet-stream');
    headers.set('x-source-name', encodeURIComponent(file.name || ''));
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/memory/sources?${qs.toString()}`, {
      method: 'POST', headers, body: file,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null) as { error?: string } | null;
      throw new ApiError(json?.error || `upload failed (${res.status})`, res.status, json ?? undefined);
    }
    return (await res.json()) as { source: MemorySource; queue_position: number | null };
  }

  listSources() {
    return this.request<{ sources: MemorySource[]; quota: SourceQuota }>('/v1/memory/sources');
  }

  getSource(id: string) {
    return this.request<{ source: MemorySource; candidates: { pending: number; total: number } }>(`/v1/memory/sources/${id}`);
  }

  /** 删除来源：取消任务 + 清未决候选 + 删原始数据；已确认碎片保留。 */
  deleteSource(id: string) {
    return this.request<{ ok: boolean }>(`/v1/memory/sources/${id}`, { method: 'DELETE' });
  }

  retrySource(id: string) {
    return this.request<{ source: MemorySource; queue_position: number | null }>(`/v1/memory/sources/${id}/retry`, { method: 'POST' });
  }

  /** 来源转化产物：清洗后正文 + 分块（均分页；chunksLimit=0 只取正文）。 */
  getSourceContent(id: string, opts: { textOffset?: number; textLimit?: number; chunksOffset?: number; chunksLimit?: number } = {}) {
    const qs = new URLSearchParams();
    if (opts.textOffset != null) qs.set('text_offset', String(opts.textOffset));
    if (opts.textLimit != null) qs.set('text_limit', String(opts.textLimit));
    if (opts.chunksOffset != null) qs.set('chunks_offset', String(opts.chunksOffset));
    if (opts.chunksLimit != null) qs.set('chunks_limit', String(opts.chunksLimit));
    const query = qs.toString();
    return this.request<{
      text: { content: string; offset: number; total: number };
      chunks: { items: Array<{ i: number; text: string; meta: { heading?: string; conv_title?: string; part?: number }; has_embedding: boolean }>; offset: number; total: number };
    }>(`/v1/memory/sources/${id}/content${query ? `?${query}` : ''}`);
  }

  /** 下载来源原始附件（带鉴权 fetch → blob 触发浏览器下载）。url 来源无原始文件。 */
  async downloadSourceRaw(id: string, filename: string) {
    const headers = new Headers();
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/memory/sources/${id}/raw`, { headers });
    if (!res.ok) {
      const json = await res.json().catch(() => null) as { error?: string } | null;
      throw new ApiError(json?.error || `download failed (${res.status})`, res.status, json ?? undefined);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'source';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // 智伴首页智能引导（真实数据建议 + 每日开场白）
  getCompanionBrief(lang: string) {
    return this.request<CompanionBrief>(`/v1/companion/brief?lang=${encodeURIComponent(lang)}`);
  }

  // 外部工具（MCP 客户端，P5；stdio=P11 自托管）
  listMcpServers() {
    return this.request<{ items: McpServerInfo[]; stdio_allowed?: boolean }>('/v1/mcp/servers');
  }

  createMcpServer(input: { name: string; url?: string; headers?: Record<string, string>; transport?: 'http' | 'stdio'; command?: string; args?: string[]; env?: Record<string, string> }) {
    return this.request<{ server: McpServerInfo }>('/v1/mcp/servers', { method: 'POST', body: JSON.stringify(input) });
  }

  updateMcpServer(id: string, patch: { name?: string; url?: string; headers?: Record<string, string>; enabled?: boolean }) {
    return this.request<{ server: McpServerInfo }>(`/v1/mcp/servers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  deleteMcpServer(id: string) {
    return this.request<{ success: boolean }>(`/v1/mcp/servers/${id}`, { method: 'DELETE' });
  }

  testMcpServer(id: string) {
    return this.request<{ ok: boolean; tools?: { name: string; description: string }[]; error?: string; auth_required?: boolean }>(
      `/v1/mcp/servers/${id}/test`, { method: 'POST' }
    );
  }

  getMcpDirectory() {
    return this.request<{ items: McpDirectoryEntry[] }>('/v1/mcp/directory');
  }

  startMcpOauth(id: string) {
    return this.request<{ authorization_url?: string; connected?: boolean }>(
      `/v1/mcp/servers/${id}/oauth/start`, { method: 'POST' }
    );
  }

  // PAT / 记忆 MCP（能力开放 E2，「开发者/接入」设置页）
  listPats() {
    return this.request<{ items: PatInfo[]; scopes: string[]; entitled: boolean; tier: string }>('/v1/me/pats');
  }

  createPat(input: { name: string; scopes: string[]; redact_pii?: boolean }) {
    return this.request<{ token: string; pat: PatInfo }>('/v1/me/pats', { method: 'POST', body: JSON.stringify(input) });
  }

  revokePat(id: string) {
    return this.request<{ ok: boolean; pat: PatInfo }>(`/v1/me/pats/${id}`, { method: 'DELETE' });
  }

  listPatAudit(limit = 30) {
    return this.request<{ items: PatAuditEntry[] }>(`/v1/me/pats/audit?limit=${limit}`);
  }

  listMcpTools() {
    return this.request<{ items: { name: string; description: string }[] }>('/v1/mcp/tools');
  }

  // Goals API
  listGoals() {
    return this.request<{ items: any[] }>('/v1/goals');
  }

  createGoal(input: { title: string; description?: string; life_wheel_dimension?: string; wish?: string; outcome?: string; obstacle?: string; parent_id?: string | null; level?: 'objective' | 'key_result' | 'monthly' }) {
    return this.request<{ id: string; title: string }>('/v1/goals', { method: 'POST', body: JSON.stringify(input) });
  }

  updateGoalStatus(goalId: string, status: string) {
    return this.request(`/v1/goals/${goalId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }

  /** 编辑目标本身（标题/描述/维度/WOOP 等）。目标模块的「编辑」用此方法。 */
  updateGoal(goalId: string, patch: {
    title?: string; description?: string; life_wheel_dimension?: string; status?: string;
    wish?: string; outcome?: string; obstacle?: string;
  }) {
    return this.request<any>(`/v1/goals/${goalId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  deleteGoal(goalId: string) {
    return this.request(`/v1/goals/${goalId}`, { method: 'DELETE' });
  }

  /** Decompose an existing goal into a persisted OKR tree (KR → 月 → 任务 child goals). */
  decomposeGoal(goalId: string, input?: { answers?: Record<string, unknown>; woop?: Record<string, unknown>; replace?: boolean; okrStructure?: unknown; regenerate_hint?: string }) {
    // failed:true = LLM generation failed on a replace — the existing tree was kept untouched.
    return this.request<{ goal: any; created: any[]; tasks?: any[]; already?: boolean; failed?: boolean; message?: string }>(
      `/v1/goals/${goalId}/decompose`,
      { method: 'POST', body: JSON.stringify(input || {}) }
    );
  }

  /** 目标规划预览：结合画像/记忆/执行情况/其他目标生成分阶段每日计划（不落库，可反复重生成）。 */
  previewGoalPlan(goalId: string, input?: { durationDays?: number; regenerateHint?: string }) {
    return this.request<{
      goal: { id: string; title: string };
      plan: GoalPlan;
      estimatedTasks: number;
      personalized: boolean;
      isReplan: boolean;
      stats: { total: number; done: number; skipped: number; open: number; completionRate: number };
    }>(
      `/v1/goals/${goalId}/plan/preview`,
      { method: 'POST', body: JSON.stringify(input || {}) }
    );
  }

  /** 确认规划：替换未完成的旧任务（保留已完成历史）+ 建 KR/阶段节点 + 展开每日可执行任务。 */
  commitGoalPlan(goalId: string, plan: GoalPlan) {
    return this.request<{ goal: any; created: any[]; tasks: any[]; taskCount: number; replaced: number; message: string }>(
      `/v1/goals/${goalId}/plan/commit`,
      { method: 'POST', body: JSON.stringify({ plan }) }
    );
  }

  // ── Digital Persona (对外数字人) — owner-side management ──────────────────
  getDigitalPersona() {
    return this.request<DigitalPersona>('/v1/me/digital-persona');
  }

  updateDigitalPersona(patch: DigitalPersonaPatch) {
    return this.request<DigitalPersona>('/v1/me/digital-persona', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  publishDigitalPersona() {
    return this.request<DigitalPersona>('/v1/me/digital-persona/publish', { method: 'POST' });
  }

  unpublishDigitalPersona() {
    return this.request<DigitalPersona>('/v1/me/digital-persona/unpublish', { method: 'POST' });
  }

  /** Upload a raw avatar image (octet-stream). Returns the updated persona. */
  async uploadPersonaAvatar(file: Blob): Promise<DigitalPersona> {
    const headers = new Headers();
    headers.set('content-type', file.type || 'application/octet-stream');
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/me/digital-persona/avatar`, {
      method: 'POST',
      headers,
      body: file,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Avatar upload failed (${res.status}): ${text || res.statusText}`);
    }
    return (await res.json()) as DigitalPersona;
  }

  /** Upload a chat composer attachment (raw octet-stream, mirrors uploadPersonaAvatar). */
  async uploadChatAttachment(file: Blob, name: string): Promise<ChatAttachment> {
    const headers = new Headers();
    headers.set('content-type', file.type || 'application/octet-stream');
    headers.set('x-attachment-name', encodeURIComponent(name));
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/chat/attachments`, {
      method: 'POST',
      headers,
      body: file,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Attachment upload failed (${res.status}): ${text || res.statusText}`);
    }
    return (await res.json()) as ChatAttachment;
  }

  /** Inline-edit a capture_memory tool result (content/tags/type only). */
  updateMemory(id: string, patch: { content_raw?: string; tags?: string[]; type?: string }) {
    return this.request<{ id: string; content_raw: string; tags: string[]; type: string }>(
      `/v1/memory/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  }

  // ── Relationships (人际关系图谱，兼容别名) ───────────────────────────────
  /** @deprecated 请改用 listEntities('person')；此接口保留供移动端/studio 过渡。 */
  listRelationships() {
    return this.request<{ items: Relationship[] }>('/v1/me/relationships');
  }

  /** @deprecated 请改用 createEntity({ entity_type: 'person', ... })。 */
  createRelationship(input: Partial<Relationship>) {
    return this.request<Relationship>('/v1/me/relationships', { method: 'POST', body: JSON.stringify(input) });
  }

  /** @deprecated 请改用 updateEntity(id, patch)。 */
  updateRelationship(id: string, patch: Partial<Relationship>) {
    return this.request<Relationship>(`/v1/me/relationships/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  }

  /** @deprecated 请改用 deleteEntity(id)。 */
  deleteRelationship(id: string) {
    return this.request<{ ok: boolean }>(`/v1/me/relationships/${id}`, { method: 'DELETE' });
  }

  /** @deprecated 请改用 generateEntityInvite(id)。 */
  generateRelationshipInvite(id: string) {
    return this.request<Relationship>(`/v1/me/relationships/${id}/invite`, { method: 'POST' });
  }

  // ── Entities (图鉴：与用户有关的人/物/地/事实体卡) ────────────────────────
  listEntities(type?: EntityType) {
    return this.request<{ items: Entity[] }>(`/v1/me/entities${type ? `?type=${type}` : ''}`);
  }

  createEntity(input: Partial<Entity>) {
    return this.request<Entity>('/v1/me/entities', { method: 'POST', body: JSON.stringify(input) });
  }

  updateEntity(id: string, patch: Partial<Entity>) {
    return this.request<Entity>(`/v1/me/entities/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  }

  deleteEntity(id: string) {
    return this.request<{ ok: boolean }>(`/v1/me/entities/${id}`, { method: 'DELETE' });
  }

  /** 实体合并：sourceId 卡并入 targetId 卡（facts 缺键补齐/别名维度并集/碎片回链），删源卡。 */
  mergeEntity(sourceId: string, targetId: string) {
    return this.request<{ entity: Entity; relinked_episodes: number }>(`/v1/me/entities/${sourceId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ target_id: targetId }),
    });
  }

  /** 仅 person 卡可生成邀请链接（数字分身访客识别）。 */
  generateEntityInvite(id: string) {
    return this.request<Entity>(`/v1/me/entities/${id}/invite`, { method: 'POST' });
  }

  /** 手动重新生成卡面 AI 总结（同步等待，返回更新后实体）。 */
  regenerateEntitySummary(id: string) {
    return this.request<Entity>(`/v1/me/entities/${id}/summary`, { method: 'POST' });
  }

  /** 引用了这张卡的记忆碎片（图鉴详情页）。 */
  listEntityEpisodes(id: string, limit = 50) {
    return this.request<{ items: any[] }>(`/v1/me/entities/${id}/episodes?limit=${limit}`);
  }

  // ── Visitor sessions + review inbox ─────────────────────────────────────
  listPersonaSessions(opts?: { q?: string; limit?: number; offset?: number; minMessages?: number; since?: string; until?: string }) {
    const params = new URLSearchParams();
    if (opts?.q) params.set('q', opts.q);
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    if (opts?.offset != null) params.set('offset', String(opts.offset));
    if (opts?.minMessages != null) params.set('min_messages', String(opts.minMessages));
    if (opts?.since) params.set('since', opts.since);
    if (opts?.until) params.set('until', opts.until);
    const qs = params.toString();
    return this.request<{ items: VisitorSession[]; total: number }>(
      `/v1/me/persona/sessions${qs ? `?${qs}` : ''}`,
    );
  }

  getPersonaStats() {
    return this.request<PersonaStats>('/v1/me/persona/stats');
  }

  getInbox(status: 'pending' | 'approved' | 'rejected' = 'pending') {
    return this.request<{ items: InboxItem[] }>(`/v1/me/inbox?status=${status}`);
  }

  decideInboxItem(id: string, decision: 'approved' | 'rejected') {
    return this.request<InboxItem>(`/v1/me/inbox/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  }

  // Chat API (数字人对话) - legacy non-streaming
  chat(input: { message: string; context?: Record<string, any> }) {
    return this.request<{ 
      reply: string; 
      mood?: string;
      functionCall?: { name: string; arguments: Record<string, any>; result?: any };
      quickActions?: Array<{ id: string; label: string; type: string }>;
    }>('/v1/chat', { method: 'POST', body: JSON.stringify(input) });
  }

  // V2 Streaming Chat API
  async chatStream(
    input: {
      message: string;
      conversation_id?: string;
      /** P3-C: which persona mode the user is talking in. */
      persona_mode?: 'FOR' | 'AS' | 'ABOUT';
      /** Mode-picker forced tool name (e.g. 'capture_memory') — omit/undefined for 'auto'. */
      tool_hint?: string;
      /** Composer attachments — display-only this round. */
      attachments?: ChatAttachment[];
      /** 显式关联的业务对象（服务端校验归属、注入上下文并落 metadata）。 */
      references?: { type: 'goal' | 'task' | 'entity'; id: string }[];
      /** Edit flow: truncate this message + everything after it, then send
       *  `message` as the replacement turn. */
      edit_message_id?: string;
    },
    callbacks: {
      onText?: (text: string) => void;
      onCard?: (card: import('./genui/schemas').GedoCard) => void;
      onToolCall?: (toolCall: { name: string; arguments: Record<string, any> }) => void;
      onToolResult?: (result: { tool: string; result: any }) => void;
      /** Proactive capture event — auto-saved or pending memory/todo candidate. */
      onMemoryCandidate?: (candidate: MemoryCandidate) => void;
      onDone?: (data: { conversation_id: string; title?: string; full_content?: string; user_message_id?: string; assistant_message_id?: string }) => void;
      onError?: (error: string) => void;
      onConversation?: (data: { id: string }) => void;
      /** Fired when `options.signal` (not the internal stall watchdog) triggered
       *  the abort — i.e. the caller clicked Stop. Distinct from onError so a
       *  deliberate stop never renders as a failure. */
      onAborted?: () => void;
    },
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // ---- gedo:card:v1 fence parser: splits card fences out of the text stream,
    // emitting plain text via onText and parsed cards via onCard. Extracted to
    // genui/fence.ts (shared sentinels with the replay parser; unit-tested). ----
    const fence = createCardFenceParser({ onText: callbacks.onText, onCard: callbacks.onCard });

    // ---- stall watchdog: abort a stream that goes silent (server stalled
    // inside a slow tool call, or no 'done' event) so the UI never hangs. ----
    const STALL_MS = 120_000;
    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { stalled = true; controller.abort(); }, STALL_MS);
    };
    const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };

    // ---- force-stop: forward the caller's signal into the fetch controller.
    // Plain manual forwarding (not AbortSignal.any — newer API, no upside here). ----
    let userAborted = false;
    if (options?.signal) {
      if (options.signal.aborted) { userAborted = true; controller.abort(); }
      else options.signal.addEventListener('abort', () => { userAborted = true; controller.abort(); });
    }

    try {
      armStall();
      const res = await fetch(`${this.baseUrl}/v1/chat/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        callbacks.onError?.(`API ${res.status}: ${text}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError?.('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armStall(); // got data → reset the silence timer

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) continue;
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            try {
              const data = JSON.parse(dataStr);
              if (data.text !== undefined && !data.tool && !data.conversation_id) {
                fence.push(data.text);
              } else if (data.name && data.arguments) {
                callbacks.onToolCall?.(data);
              } else if (data.tool && data.result) {
                callbacks.onToolResult?.(data);
              } else if (data.memory_candidate) {
                callbacks.onMemoryCandidate?.(data.memory_candidate as MemoryCandidate);
              } else if (data.conversation_id && data.full_content !== undefined) {
                // Flush any remaining buffered text before done
                fence.flush();
                callbacks.onDone?.(data);
              } else if (data.id && !data.text) {
                callbacks.onConversation?.(data);
              } else if (data.error) {
                callbacks.onError?.(data.error);
              }
            } catch {
              // Skip malformed data lines
            }
          }
        }
      }
      // Flush any remaining text (stream ended without done event)
      fence.flush();
    } catch (error) {
      // The server-side 'aborted' SSE event (if any) will never reach us —
      // aborting the fetch tears down the read stream immediately. This local
      // catch is what drives the UI; server.mjs's res 'close' handler is what
      // actually stops the LLM call, independently.
      if (userAborted) { callbacks.onAborted?.(); return; }
      callbacks.onError?.(stalled ? 'stream_stalled' : (error instanceof Error ? error.message : 'Stream failed'));
    } finally {
      clearStall();
    }
  }

  // P1-B: Task adjust actions
  applyTaskAdjust(items: import('./genui/schemas').TaskAdjustItem[]) {
    return this.request<{ ok: boolean; undo_token: string; applied: number }>('/v1/tasks/batch-adjust', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  undoTaskAdjust(undoToken: string) {
    return this.request('/v1/tasks/batch-adjust/undo', {
      method: 'POST',
      body: JSON.stringify({ undo_token: undoToken }),
    });
  }

  // Feature flags (short-cached by client session)
  meFlags() {
    return this.request<Record<string, boolean>>('/v1/me/flags');
  }

  // Conversations API
  listConversations() {
    return this.request<{ conversations: ConversationSummary[] }>('/v1/conversations');
  }

  getConversationMessages(conversationId: string) {
    return this.request<{ messages: ConversationMessage[] }>(`/v1/conversations/${conversationId}/messages`);
  }

  deleteConversation(conversationId: string) {
    return this.request(`/v1/conversations/${conversationId}`, { method: 'DELETE' });
  }

  /** Recall (hard-delete) a single message — no cascade to the rest of the thread. */
  deleteConversationMessage(conversationId: string, messageId: string) {
    return this.request(`/v1/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
  }

  // LLM status
  llmStatus() {
    return this.request<{ available: boolean; primaryChat: string; providers: string[] }>('/v1/llm/status');
  }

  // P2-B: Proactive messages (Reflector / CareAgent / StuckDetector output)
  listProactiveMessages() {
    return this.request<{ items: ProactiveMessage[] }>('/v1/proactive/messages');
  }

  proactiveFeedback(
    messageId: string,
    input: { feedback: 'accepted' | 'dismissed' | 'snoozed'; snooze_minutes?: number }
  ) {
    return this.request<{ ok: boolean; message: ProactiveMessage }>(
      `/v1/proactive/messages/${messageId}/feedback`,
      { method: 'POST', body: JSON.stringify(input) }
    );
  }

  // P1-A: GEDO Memory Pack — open, signable, importable.
  // Export downloads a .gmp ZIP; the server sets Content-Disposition.
  async exportMemoryGmp(): Promise<{ blob: Blob; filename: string; stats?: Record<string, number> }> {
    const headers = new Headers();
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/memory/export.gmp`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Export failed (${res.status}): ${text || res.statusText}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^";]+)"?/i.exec(cd);
    const filename = m?.[1] || `gedo-${new Date().toISOString().slice(0, 10)}.gmp`;
    let stats: Record<string, number> | undefined;
    try {
      const raw = res.headers.get('x-gmp-stats');
      if (raw) stats = JSON.parse(raw);
    } catch { /* ignore */ }
    return { blob, filename, stats };
  }

  /**
   * Import a .gmp pack. Pass `dryRun: true` to validate + return a
   * preview (episode count, conflicts, identity_changed) without writing.
   */
  async importMemoryGmp(file: Blob, opts: { dryRun?: boolean } = {}): Promise<ImportSummary> {
    const headers = new Headers();
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    headers.set('content-type', 'application/octet-stream');
    const qs = opts.dryRun ? '?dryRun=true' : '';
    const res = await fetch(`${this.baseUrl}/v1/memory/import${qs}`, {
      method: 'POST',
      headers,
      body: file,
    });
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const detail = (json as { detail?: string }).detail || res.statusText;
      const code = (json as { code?: string }).code;
      throw new Error(code ? `${code}: ${detail}` : detail);
    }
    return json as ImportSummary;
  }

  // S0-5 Onboarding Quest
  getOnboardingStep() {
    return this.request<{ step: number }>('/v1/onboarding/step');
  }

  submitOnboardingStep(input: {
    day: number;
    answers?: Record<string, unknown>;
    skip?: boolean;
  }) {
    return this.request<{ step: number }>('/v1/onboarding/step', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // P1-A GEDO Memory Pack (.gmp)
  async exportMemoryPack(): Promise<{ blob: Blob; filename: string; stats: Record<string, number> }> {
    const headers = new Headers();
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`${this.baseUrl}/v1/memory/export.gmp`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Export failed: ${res.status}`);
    }
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const filename = m ? m[1] : `gedo-${new Date().toISOString().slice(0, 10)}.gmp`;
    let stats: Record<string, number> = {};
    try { stats = JSON.parse(res.headers.get('x-gmp-stats') || '{}'); } catch { /* ignore */ }
    const blob = await res.blob();
    return { blob, filename, stats };
  }

  async importMemoryPack(file: Blob, opts: { dryRun?: boolean } = {}): Promise<MemoryPackImportSummary> {
    const headers = new Headers({ 'content-type': 'application/octet-stream' });
    const token = this.getToken?.();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const qs = opts.dryRun ? '?dryRun=true' : '';
    const res = await fetch(`${this.baseUrl}/v1/memory/import${qs}`, {
      method: 'POST',
      headers,
      body: file,
    });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!res.ok) {
      const message = body?.detail || body?.error || `Import failed: ${res.status}`;
      const err = new Error(message) as Error & { code?: string; details?: unknown };
      if (body?.code) err.code = body.code;
      if (body?.details) err.details = body.details;
      throw err;
    }
    return body as MemoryPackImportSummary;
  }

  // S0-4 Daily Planner manual trigger
  runDailyPlanNow(skipPost = false) {
    return this.request<{
      plan: {
        greeting: string;
        opener: string;
        tasks: Array<{ title: string; why?: string; energy?: 'low' | 'medium' | 'high' }>;
        care_message: string | null;
      };
      source: 'llm' | 'fallback';
      conversation_id: string | null;
      message_id: string | null;
    }>('/v1/agent/daily-plan/run-now', {
      method: 'POST',
      body: JSON.stringify({ skipPost }),
    });
  }

  getTodayTasks() {
    return this.request<{ tasks: any[] }>('/v1/tasks/today');
  }

  // Obstacles API
  listObstacleCards(params?: { goal_id?: string; obstacle_type?: string }) {
    const qs = new URLSearchParams();
    if (params?.goal_id) qs.set('goal_id', params.goal_id);
    if (params?.obstacle_type) qs.set('obstacle_type', params.obstacle_type);
    const query = qs.toString();
    return this.request<{ items: any[] }>(`/v1/obstacles/cards${query ? `?${query}` : ''}`);
  }

  createObstacleCard(input: {
    goal_id?: string; goal_title?: string; obstacle_type: string;
    obstacle_description: string; if_condition: string; then_action: string;
    until_condition?: string;
  }) {
    return this.request('/v1/obstacles/cards', { method: 'POST', body: JSON.stringify(input) });
  }

  deleteObstacleCard(cardId: string) {
    return this.request(`/v1/obstacles/cards/${cardId}`, { method: 'DELETE' });
  }

  triggerObstacleCard(cardId: string, executed: boolean) {
    return this.request(`/v1/obstacles/cards/${cardId}/trigger`, {
      method: 'POST', body: JSON.stringify({ executed }),
    });
  }

  matchObstacle(reasonCode: string) {
    return this.request<{ matched: boolean; type?: string; cards: any[] }>(
      '/v1/obstacles/match', { method: 'POST', body: JSON.stringify({ reason_code: reasonCode }) }
    );
  }

  createObstacleEvent(input: any) {
    return this.request('/v1/obstacles/events', { method: 'POST', body: JSON.stringify(input) });
  }

  listObstacleEvents() {
    return this.request<{ items: any[] }>('/v1/obstacles/events');
  }

  getObstacleStats() {
    return this.request<any>('/v1/obstacles/stats');
  }

  // ECS API
  recordECS(input: { completion_rate: number; plan_stability: number; reflection_completed: boolean; total: number }) {
    return this.request('/v1/ecs/record', { method: 'POST', body: JSON.stringify(input) });
  }

  getECSHistory(days?: number) {
    return this.request<{ items: any[] }>(`/v1/ecs/history${days ? `?days=${days}` : ''}`);
  }

  // Reflections API
  createReflection(input: any) {
    return this.request('/v1/reflections', { method: 'POST', body: JSON.stringify(input) });
  }

  listReflections() {
    return this.request<{ items: any[] }>('/v1/reflections');
  }

  // Reviews API
  listReviews() {
    return this.request<{ items: any[] }>('/v1/reviews');
  }

  generateReview(periodType: 'weekly' | 'monthly' = 'weekly') {
    return this.request('/v1/reviews/generate', {
      method: 'POST', body: JSON.stringify({ period_type: periodType }),
    });
  }

  // Insights API
  getInsightStats(period: 'weekly' | 'monthly' = 'weekly') {
    return this.request<any>(`/v1/insights/stats?period=${period}`);
  }

  getInsightSuggestions() {
    return this.request<{ suggestions: any[] }>('/v1/insights/suggestions');
  }

  // Settings API
  getSettings() {
    return this.request<any>('/v1/settings');
  }

  getEntitlements() {
    return this.request<any>('/v1/me/entitlements');
  }

  getBillingStatus() {
    return this.request<any>('/v1/billing/status');
  }

  getAccountOverview() {
    return this.request<any>('/v1/me/account');
  }

  getAuthIdentities() {
    return this.request<{ identities: AuthIdentity[] }>('/v1/me/auth-identities');
  }

  /** Link a Google identity to the signed-in account (settings → connect). */
  linkGoogle(idToken: string) {
    return this.request<{ identities: AuthIdentity[] }>('/v1/me/auth-identities/google', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });
  }

  /** Link an Apple identity to the signed-in account. */
  linkApple(idToken: string, opts: { fullName?: string } = {}) {
    const payload: Record<string, any> = { id_token: idToken };
    if (opts.fullName && opts.fullName.trim()) payload.full_name = opts.fullName.trim();
    return this.request<{ identities: AuthIdentity[] }>('/v1/me/auth-identities/apple', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Unlink a connected sign-in method by its identity id. */
  unlinkIdentity(id: string) {
    return this.request<{ identities: AuthIdentity[] }>(`/v1/me/auth-identities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  updateSettings(input: any) {
    return this.request('/v1/settings', { method: 'PUT', body: JSON.stringify(input) });
  }

  // Goals AI
  woopGenerate(input: { prompt: string; diagnosis_answers?: any; woop?: any; regenerate_hint?: string }) {
    return this.request<{ okrStructure: any; ifThenCards: any[] }>(
      '/v1/goals/woop-generate', { method: 'POST', body: JSON.stringify(input) }
    );
  }

  diagnoseGoal(input: { prompt: string; answers?: any }) {
    return this.request<any>('/v1/goals/diagnose', { method: 'POST', body: JSON.stringify(input) });
  }

  // Daily Plan AI
  generateDailyPlan() {
    return this.request<{ tasks: any[]; adjustmentNote?: string; adjustment_note?: string; energyForecast?: string; energy_forecast?: string }>(
      '/v1/plan/daily-generate', { method: 'POST', body: JSON.stringify({}) }
    );
  }

  // Memory AI Analysis
  analyzeMemory(content: string) {
    return this.request<any>('/v1/memory/analyze', { method: 'POST', body: JSON.stringify({ content }) });
  }
}

// ════════════════════════════════════════════════════════════════════════
//  Public digital-persona helpers (无需鉴权)
//  Used by the published page at /p/[slug]; no ApiClient/AuthContext needed.
// ════════════════════════════════════════════════════════════════════════

/** Fetch a published persona's public profile. Throws on 404 / not-published. */
export async function getPublicPersona(slug: string): Promise<PublicPersonaProfile> {
  const res = await fetch(`${resolveApiBaseUrl()}/public/v1/persona/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : `API ${res.status}`);
  return (await res.json()) as PublicPersonaProfile;
}

/** 注册模式配置（GET /public/v1/auth/config 的响应）。 */
export interface AuthConfig {
  /** 是否需要邀请码才能注册（开放期为 false；达容量或显式强制后为 true）。 */
  invite_required: boolean;
  /** 是否处于限量开放模式（cloud + 设置了容量）。false 时不展示名额。 */
  limited: boolean;
  /** 开放注册总容量；limited 为 false 时为 null。 */
  capacity: number | null;
  /** 已占用名额（注册用户 + 平行人生/候补预约邮箱，去重）；limited 为 false 时为 null。 */
  used: number | null;
  /** 剩余名额；limited 为 false 时为 null。 */
  remaining: number | null;
}

/**
 * 拉取注册模式配置（公开、无需鉴权）。注册页据此决定是否要求邀请码 + 展示限量名额。
 * 失败时由调用方兜底（默认按开放注册处理，后端仍是唯一权威）。
 */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch(`${resolveApiBaseUrl()}/public/v1/auth/config`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as AuthConfig;
}

/**
 * 提交内测候补名单（公开、无需鉴权）。
 * 非 2xx 时抛出携带后端 error 码（invalid_email / already_on_waitlist / …）的 Error，
 * 供候补弹窗映射到本地化文案。
 */
export async function joinWaitlist(input: {
  email: string;
  name?: string;
  reason?: string;
  locale?: string;
}): Promise<{ ok: true }> {
  const res = await fetch(`${resolveApiBaseUrl()}/v1/waitlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let reason = `API ${res.status}`;
    try { reason = (await res.json()).error || reason; } catch { /* ignore */ }
    throw new Error(reason);
  }
  return (await res.json()) as { ok: true };
}

/**
 * 投递平行人生存档到邮箱名下（公开、无需鉴权）。注册同邮箱后经
 * GET /v1/sim/pending + POST /v1/sim/claim/:id 导入为记忆。
 * 非 2xx 抛出携带后端 error 码（invalid_email / invalid_pack / pack_too_large /
 * rate_limited / …）的 Error。
 */
export async function postSimPack(input: {
  email: string;
  locale?: string;
  pack: Record<string, unknown>;
}): Promise<{ ok: true; pending_count: number }> {
  const res = await fetch(`${resolveApiBaseUrl()}/public/v1/sim/pack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let reason = `API ${res.status}`;
    try { reason = (await res.json()).error || reason; } catch { /* ignore */ }
    throw new Error(reason);
  }
  return (await res.json()) as { ok: true; pending_count: number };
}

export interface VerifyResult {
  session_token: string;
  trusted: boolean;
  visitor: { matched: boolean; name: string | null; role: string | null };
}

/** Clear the access gate and open a visitor session. Throws 'passcode_required'/'bad_invite' on 403. */
export async function verifyPersona(
  slug: string,
  input: { passcode?: string; invite_token?: string }
): Promise<VerifyResult> {
  const res = await fetch(`${resolveApiBaseUrl()}/public/v1/persona/${encodeURIComponent(slug)}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let reason = `API ${res.status}`;
    try { reason = (await res.json()).error || reason; } catch { /* ignore */ }
    throw new Error(reason);
  }
  return (await res.json()) as VerifyResult;
}

/** Visitor self-declares a name; server fuzzy-matches to the owner's relationship graph. */
export async function identifyVisitor(
  slug: string,
  input: { session_token: string; declared_name: string }
): Promise<{ matched: boolean; name: string | null; role: string | null }> {
  const res = await fetch(`${resolveApiBaseUrl()}/public/v1/persona/${encodeURIComponent(slug)}/identify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return await res.json();
}

/** Finalize a session → analyze into the owner's review inbox (best-effort). */
export async function finalizePersonaSession(slug: string, session_token: string): Promise<void> {
  try {
    await fetch(`${resolveApiBaseUrl()}/public/v1/persona/${encodeURIComponent(slug)}/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_token }),
      keepalive: true,
    });
  } catch { /* best-effort */ }
}

/**
 * Stream an ABOUT-mode answer from a published persona (SSE).
 * Requires a `session_token` from verifyPersona; server records turns for ingestion.
 */
export async function publicPersonaChatStream(
  slug: string,
  input: { message: string; session_token: string },
  callbacks: {
    onText?: (text: string) => void;
    onDone?: (full: string) => void;
    onError?: (error: string) => void;
  }
): Promise<void> {
  try {
    const res = await fetch(
      `${resolveApiBaseUrl()}/public/v1/persona/${encodeURIComponent(slug)}/chat/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: input.message, session_token: input.session_token }),
      }
    );
    if (!res.ok) {
      callbacks.onError?.(res.status === 429 ? 'rate_limited' : `API ${res.status}`);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) { callbacks.onError?.('No response body'); return; }

    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let doneEmitted = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6).trim());
          if (data.text !== undefined && data.full_content === undefined) {
            full += data.text;
            callbacks.onText?.(data.text);
          } else if (data.full_content !== undefined) {
            doneEmitted = true;
            callbacks.onDone?.(data.full_content);
          } else if (data.error) {
            callbacks.onError?.(data.error);
          }
        } catch {
          // skip malformed line
        }
      }
    }
    if (!doneEmitted) callbacks.onDone?.(full);
  } catch (error) {
    callbacks.onError?.(error instanceof Error ? error.message : 'Stream failed');
  }
}





