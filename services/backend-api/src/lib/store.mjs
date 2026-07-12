import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic, cleanupTempFiles } from './fs-atomic.mjs';
import * as Analytics from './analytics-store.mjs';
import { nowIso, randomId, randomToken, hashToken } from './crypto.mjs';
import { normalizeForDedup, isNearDuplicate, captureText, captureDedupKey } from './dedup.mjs';
import { LIFE_DIMENSIONS } from '../memory/types.mjs';
import { DATA_DIR } from './data-dir.mjs';

const STORE_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_STORE = {
  users: [],
  memoryItems: [],
  goals: [],
  tasks: [],
  adjustments: [],
  ifThenCards: [],
  obstacleEvents: [],
  ecsHistory: [],
  reflections: [],
  reviews: [],
  settings: [],
  conversations: [],
  conversationMessages: [],
  proactiveMessages: [],
  proceduralRules: [],
  checkIns: [],
  digitalPersonas: [],
  relationships: [],
  entities: [],
  visitorSessions: [],
  interactionInbox: [],
  pendingCaptures: [],
  waitlist: [],
  simPacks: [],
  // 智伴首页 brief 的每日 LLM 开场白缓存：{ user_id, brief_date, lang, greeting_text, created_at }
  companionBriefs: [],
  // 外部工具（MCP 客户端）server 登记：{ id, user_id, name, slug, url, headers, enabled, created_at, updated_at }
  mcpServers: [],
  // 三方记忆导入任务：{ id, user_id, status, source, progress, report, error, created_at, updated_at }
  importJobs: [],
  billing_customers: [],
  usage_events: [],
  auth_identities: [],
  // ── 运营后台（admin-console，独立服务共享同一 store）────────────────
  admin_accounts: [],   // { id, username, password_hash, role, allowed_ips, disabled, created_at, last_login_at }
  admin_audit: [],      // { id, admin_id, admin_username, action, target_type, target_id, detail, ip, created_at }
  admin_settings: { global_ip_allowlist: [] },
  // 邀请码：静态 env INVITE_CODES 之外，可动态发放/关联申请人、限次数/限期。
  invite_codes: [],     // { id, code, created_by, note, lead_id, max_uses, used_count, expires_at, disabled, created_at }
  // 访问埋点：web 前端 + 平行人生专题页上报，channel 区分渠道（'web' | 'sim'）。
  analytics_events: [], // { id, ts, channel, page, visitor_id, referrer, locale }
  // 交易邮件单次令牌（邮箱验证 / 找回密码）：只存 sha256,明文只在邮件链接里。
  email_tokens: [],     // { id, user_id, kind, token_hash, email, expires_at, used_at, created_at }
};

let _tempSweepDone = false;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!_tempSweepDone) {
    _tempSweepDone = true;
    cleanupTempFiles(DATA_DIR);
  }
  if (!fs.existsSync(STORE_FILE)) {
    writeJsonAtomic(STORE_FILE, DEFAULT_STORE);
    return;
  }
  // Migrate older stores that lack the newer collections so subsequent
  // reads/writes don't crash with `undefined.push`.
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    let dirty = false;
    for (const key of Object.keys(DEFAULT_STORE)) {
      const def = DEFAULT_STORE[key];
      if (Array.isArray(def)) {
        if (!Array.isArray(raw[key])) {
          raw[key] = [];
          dirty = true;
        }
      } else if (def && typeof def === 'object') {
        if (!raw[key] || typeof raw[key] !== 'object' || Array.isArray(raw[key])) {
          raw[key] = structuredClone(def);
          dirty = true;
        }
      }
    }
    if (dirty) writeJsonAtomic(STORE_FILE, raw);
  } catch {
    // Corrupt store — leave as-is; readStore() will throw with a real message.
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  writeJsonAtomic(STORE_FILE, store);
}

/**
 * One-shot drain of the legacy store.json analytics_events array into the
 * append-only JSONL log (analytics-store.mjs). Marker-guarded so backend-api
 * and admin-console (separate processes on the same data dir) run it once;
 * the reader dedupes by id, so a rare race only costs duplicate appends.
 */
function _ensureAnalyticsMigrated() {
  if (Analytics.isMigrated()) return;
  const s = readStore();
  const legacy = Array.isArray(s.analytics_events) ? s.analytics_events : [];
  const count = Analytics.migrateLegacyRows(legacy);
  if (legacy.length) {
    s.analytics_events = [];
    writeStore(s);
  }
  if (count) console.log(`[store] migrated ${count} analytics events to data/analytics/*.jsonl`);
}

// ── Dedup internals (operate on a store snapshot) ─────────────────────────
const DONE_GOAL_STATES = new Set(['completed', 'archived', 'cancelled']);

// Canonical obstacle types — must match web/mobile OBSTACLE_TYPE_LABELS keys.
const OBSTACLE_TYPES = new Set([
  'time_limited', 'attention_scattered', 'procrastination_fear',
  'info_insufficient', 'energy_low', 'external_dependency',
]);

// ── Entity internals (图鉴实体卡) ──────────────────────────────────────────
const ENTITY_TYPES = new Set(['person', 'pet', 'object', 'place', 'event', 'org', 'other']);
const ENTITY_MAX_FACTS = 30;

/** Clamp facts to a clean ordered [{ k, v }] string list. */
function _sanitizeFacts(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const f of list) {
    const k = String(f?.k ?? '').trim();
    const v = String(f?.v ?? '').trim();
    if (!k || !v) continue;
    out.push({ k, v });
    if (out.length >= ENTITY_MAX_FACTS) break;
  }
  return out;
}

/** Default missing fields in place (legacy/migrated rows). */
function _normalizeEntity(e) {
  if (!e) return e;
  if (!ENTITY_TYPES.has(e.entity_type)) e.entity_type = 'other';
  if (!Array.isArray(e.aliases)) e.aliases = [];
  if (!Array.isArray(e.facts)) e.facts = [];
  if (!Array.isArray(e.dimensions)) e.dimensions = [];
  if (!Array.isArray(e.tags)) e.tags = [];
  e.ai_excluded = e.ai_excluded === true;
  e.avatar_visible = e.avatar_visible === true;
  // 卡面 AI 总结（系统字段，entity-summary.service 生成；不在 EDITABLE 白名单）
  if (typeof e.ai_summary !== 'string') e.ai_summary = '';
  if (!e.ai_summary_meta || typeof e.ai_summary_meta !== 'object') e.ai_summary_meta = null;
  return e;
}

/**
 * Ensure the entities collection exists and lazily migrate legacy
 * `relationships` rows into person entities exactly once. Original ids are
 * PRESERVED — visitorSessions.visitor.relationship_id,
 * interactionInbox.source_relationship_id and live invite tokens all point
 * at them. The legacy rows are left in place for rollback; after migration
 * they are dead data (all relationship methods read entities). Returns true
 * when the snapshot was mutated and needs a writeStore().
 */
function _ensureEntities(s) {
  let dirty = false;
  if (!Array.isArray(s.entities)) { s.entities = []; dirty = true; }
  if (!s.entities_migrated_at) {
    const known = new Set(s.entities.map((e) => e.id));
    for (const r of s.relationships || []) {
      if (known.has(r.id)) continue;
      s.entities.push({
        id: r.id,
        user_id: r.user_id,
        entity_type: 'person',
        name: r.name || '',
        aliases: Array.isArray(r.aliases) ? r.aliases : [],
        emoji: '',
        image_url: null,
        relation: r.role || '',
        facts: [],
        note: r.note || '',
        dimensions: [],
        tags: Array.isArray(r.tags) ? r.tags : [],
        ai_excluded: false,
        avatar_visible: false,
        source: r.source || 'migrated',
        role: r.role || '',
        trust: r.trust || 'med',
        invite_token: r.invite_token ?? null,
        contributed_by: r.contributed_by ?? null,
        interaction_count: r.interaction_count || 0,
        last_interaction: r.last_interaction ?? null,
        created_at: r.created_at || nowIso(),
        updated_at: r.updated_at || nowIso(),
      });
    }
    s.entities_migrated_at = nowIso();
    dirty = true;
  }
  return dirty;
}

/** Live goal (not completed/archived/cancelled) whose title matches, else null. */
function _findDuplicateGoal(s, userId, title) {
  if (!title) return null;
  const norm = normalizeForDedup(title);
  let nearest = null;
  for (const g of s.goals || []) {
    if (g.user_id !== userId || DONE_GOAL_STATES.has(g.status) || !g.title) continue;
    if (normalizeForDedup(g.title) === norm) return g;
    if (!nearest && isNearDuplicate(g.title, title, 0.85)) nearest = g;
  }
  return nearest;
}

/**
 * Existing capture that is the same item as { kind, payload }, else null.
 *   - pending / saved / confirmed → always a duplicate (live or accepted)
 *   - rejected / undone / expired → duplicate only within `withinDays` so a
 *     dismissal sticks for a while but a genuinely recurring item can resurface
 */
function _findDuplicateCapture(s, userId, { kind, payload = {}, withinDays = 7 } = {}) {
  const key = captureDedupKey(kind, payload);
  const text = captureText(kind, payload);
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  let nearest = null;
  for (const c of s.pendingCaptures || []) {
    if (c.user_id !== userId || c.kind !== kind) continue;
    const live = c.status === 'pending' || c.status === 'saved' || c.status === 'confirmed';
    if (!live) {
      const when = new Date(c.decided_at || c.created_at || 0).getTime();
      if (when < cutoff) continue; // stale dismissal — allow resurface
    }
    if (captureDedupKey(c.kind, c.payload || {}) === key) return c;
    if (!nearest && isNearDuplicate(captureText(c.kind, c.payload || {}), text)) nearest = c;
  }
  return nearest;
}

/** Flip never-decided pending captures older than `days` to 'expired'. Returns true if any changed. */
function _expireStaleCaptures(s, userId, days = 14) {
  if (!Array.isArray(s.pendingCaptures) || days <= 0) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const c of s.pendingCaptures) {
    if (c.source_id) continue; // 来源导入候选不走 14 天机会式过期：随来源生命周期管理（删除来源清理 + janitor 90 天兜底）
    if (c.user_id === userId && c.status === 'pending'
      && new Date(c.created_at || 0).getTime() < cutoff) {
      c.status = 'expired';
      c.decided_at = nowIso();
      changed = true;
    }
  }
  return changed;
}

/**
 * Slugify a display name into a URL-safe base, then append a short random
 * suffix and ensure uniqueness against existing personas.
 */
function makeUniqueSlug(personas, displayName) {
  const base = String(displayName || 'persona')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'persona';
  const taken = new Set((personas || []).map((p) => p.slug).filter(Boolean));
  let slug;
  do {
    slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  } while (taken.has(slug));
  return slug;
}

export function Store() {
  return {
    getUserByEmail(email) {
      const s = readStore();
      return s.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()) || null;
    },
    getUserById(userId) {
      const s = readStore();
      return s.users.find((u) => u.id === userId) || null;
    },
    listUsers() {
      const s = readStore();
      return (s.users || []).slice();
    },
    createUser({ email, password_hash = null, locale = null, display_name, avatar_url, email_verified = false }) {
      const s = readStore();
      const verified = !!email_verified;
      const user = {
        id: randomId(),
        email,
        // Social-only accounts have no password (login via provider ID token only);
        // verifyPassword() already returns false for a null hash, so they simply
        // can't password-login. A password can be added later via reset-password.
        password_hash: password_hash || null,
        onboarding_step: 0,
        // 邮件语言的兜底信号（注册漏斗捕获);email 验证走"发信不拦"策略。
        locale: locale || null,
        // Google/Apple already proved the address; carry that through so social
        // users aren't nagged to re-verify.
        email_verified: verified,
        email_verified_at: verified ? nowIso() : null,
        created_at: nowIso(),
      };
      if (display_name !== undefined && display_name !== null) user.display_name = display_name;
      if (avatar_url !== undefined && avatar_url !== null) user.avatar_url = avatar_url;
      s.users.push(user);
      writeStore(s);
      return user;
    },
    /** 内测候补名单：按邮箱查重（大小写无关）。 */
    getWaitlistByEmail(email) {
      const s = readStore();
      const target = String(email || '').trim().toLowerCase();
      return (s.waitlist || []).find((w) => w.email === target) || null;
    },
    /** 写入一条候补记录。email 已规范化；name/reason 由调用方截断。 */
    createWaitlistEntry({ email, name, reason, locale }) {
      const s = readStore();
      const entry = {
        id: randomId(),
        email: String(email || '').trim().toLowerCase(),
        name: name || null,
        reason: reason || null,
        locale: locale || null,
        status: 'pending',
        created_at: nowIso(),
      };
      if (!Array.isArray(s.waitlist)) s.waitlist = [];
      s.waitlist.push(entry);
      writeStore(s);
      return entry;
    },
    /** 发码时人工/脚本查阅用。 */
    listWaitlist() {
      const s = readStore();
      return (s.waitlist || []).slice();
    },

    /**
     * 开放注册名额统计（按邮箱去重、大小写无关）：
     *   users    — 已注册账号数
     *   reserved — 仅预约（平行人生 sim / 候补名单）但尚未注册的邮箱数
     *   consumed — users + reserved，即已占用的名额
     * 平行人生预约邮箱也算一个名额；一旦用同邮箱注册即并入 users，不会重复计数
     * （waitlist 与 simPacks 双写的同一邮箱也只算一次）。
     */
    registrationStats() {
      const s = readStore();
      const norm = (e) => String(e || '').trim().toLowerCase();
      const users = new Set();
      for (const u of (s.users || [])) { const e = norm(u.email); if (e) users.add(e); }
      const reserved = new Set();
      for (const w of (s.waitlist || [])) { const e = norm(w.email); if (e && !users.has(e)) reserved.add(e); }
      for (const p of (s.simPacks || [])) { const e = norm(p.email); if (e && !users.has(e)) reserved.add(e); }
      return { users: users.size, reserved: reserved.size, consumed: users.size + reserved.size };
    },

    // ── 平行人生存档暂存（sim packs — 邮箱认领，注册后导入）────────────
    /**
     * 暂存一个 sim pack。惰性清理 90 天过期项；同邮箱最多 3 个未认领（挤掉最旧）；
     * pack 序列化后 >100KB 抛 code='pack_too_large'。
     */
    addSimPack({ email, locale, pack }) {
      const packStr = JSON.stringify(pack || {});
      if (packStr.length > 100 * 1024) {
        const err = new Error('pack_too_large');
        err.code = 'pack_too_large';
        throw err;
      }
      const s = readStore();
      if (!Array.isArray(s.simPacks)) s.simPacks = [];
      const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
      s.simPacks = s.simPacks.filter(p => p.claimed_at || new Date(p.created_at).getTime() >= cutoff);
      const target = String(email || '').trim().toLowerCase();
      const mine = s.simPacks.filter(p => p.email === target && !p.claimed_at);
      if (mine.length >= 3) {
        const oldest = mine.reduce((a, b) => (a.created_at < b.created_at ? a : b));
        s.simPacks = s.simPacks.filter(p => p.id !== oldest.id);
      }
      const entry = {
        id: randomId(),
        email: target,
        locale: locale || null,
        pack,
        created_at: nowIso(),
        claimed_at: null,
        claimed_by: null,
      };
      s.simPacks.push(entry);
      writeStore(s);
      return entry;
    },
    /** 某邮箱未认领且未过期的存档（新→旧）。 */
    listSimPacksByEmail(email) {
      const s = readStore();
      const target = String(email || '').trim().toLowerCase();
      const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
      return (s.simPacks || [])
        .filter(p => p.email === target && !p.claimed_at && new Date(p.created_at).getTime() >= cutoff)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    getSimPack(id) {
      const s = readStore();
      return (s.simPacks || []).find(p => p.id === id) || null;
    },
    markSimPackClaimed(id, userId) {
      const s = readStore();
      const p = (s.simPacks || []).find(x => x.id === id);
      if (!p) return null;
      p.claimed_at = nowIso();
      p.claimed_by = userId;
      writeStore(s);
      return p;
    },
    /** S0-5 — onboarding gate: 0..7 (0 = not started, 7 = finished). */
    getOnboardingStep(userId) {
      const s = readStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) return null;
      return Number.isInteger(u.onboarding_step) ? u.onboarding_step : 0;
    },
    setOnboardingStep(userId, step) {
      const next = Math.max(0, Math.min(7, Number(step) || 0));
      const s = readStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) return null;
      u.onboarding_step = next;
      writeStore(s);
      return next;
    },
    /** 修改密码：写入新的 password_hash（由调用方计算）。 */
    updateUserPassword(userId, password_hash) {
      const s = readStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) return null;
      u.password_hash = password_hash;
      u.password_changed_at = nowIso();
      writeStore(s);
      return u;
    },
    /** 更改账号邮箱（已规范化；唯一性由调用方校验）。 */
    updateUserEmail(userId, email) {
      const s = readStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) return null;
      u.email = String(email).trim().toLowerCase();
      u.email_changed_at = nowIso();
      writeStore(s);
      return u;
    },
    /** 编辑个人资料（显示名 / 头像）。白名单字段，值为 undefined 的键不动。 */
    updateUserProfile(userId, { display_name, avatar_url } = {}) {
      const s = readStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) return null;
      if (display_name !== undefined) u.display_name = display_name;
      if (avatar_url !== undefined) u.avatar_url = avatar_url;
      writeStore(s);
      return u;
    },
    createMemoryItem(userId, { type, content_raw, tags = [], source = 'text', content_struct = {} }) {
      const s = readStore();
      const item = {
        id: randomId(),
        user_id: userId,
        type,
        content_raw,
        content_struct,
        tags,
        source,
        created_at: nowIso(),
      };
      s.memoryItems.push(item);
      writeStore(s);
      return item;
    },
    searchMemory(userId, q) {
      const s = readStore();
      const query = (q || '').toLowerCase().trim();
      const items = s.memoryItems.filter((m) => m.user_id === userId);
      if (!query) return items.slice(-50).reverse();
      return items
        .filter((m) => (m.content_raw || '').toLowerCase().includes(query) || (m.tags || []).some((t) => t.includes(query)))
        .slice(-50)
        .reverse();
    },
    // Dedup guard: an active task (todo/in_progress) with the same normalized
    // title is treated as the same item — re-running plan_goal or re-extracting
    // the same todo across turns reuses it instead of duplicating. Conservative
    // (exact-normalized match only) to avoid merging genuinely distinct tasks.
    createTasks(userId, tasks) {
      const s = readStore();
      const isActive = (t) => t.status !== 'done' && t.status !== 'cancelled';
      // Dedup key = normalized title + scheduled_date + goal_id. The date lets a
      // recurring daily plan repeat the same title across days; the goal scopes it
      // so two goals' generic daily items ("复盘") don't collapse into each other.
      // Undated extraction tasks (no date, no goal) still dedup by title alone.
      const keyOf = (title, sched, goalId) => `${normalizeForDedup(title)}|${sched || ''}|${goalId || ''}`;
      const activeNorms = new Map();
      for (const t of s.tasks) {
        if (t.user_id === userId && isActive(t) && t.title) {
          activeNorms.set(keyOf(t.title, t.scheduled_date, t.goal_id), t);
        }
      }
      const created = [];
      const newRows = [];
      for (const t of tasks) {
        const norm = normalizeForDedup(t.title);
        const key = norm ? keyOf(t.title, t.scheduled_date, t.goal_id) : '';
        const existing = key ? activeNorms.get(key) : null;
        if (existing) {
          created.push(existing); // reuse — keeps caller's array length/ids valid
          continue;
        }
        const row = {
          id: randomId(),
          user_id: userId,
          title: t.title,
          description: t.description || '',
          status: 'todo',
          priority: t.priority || t.energy_level || 'medium',
          energy_level: t.energy_level || 'medium',
          estimated_duration: t.estimated_duration || 30,
          due_date: t.due_date || t.deadline || null,
          scheduled_date: t.scheduled_date || null,
          scheduled_time: t.scheduled_time || null,
          is_mit: !!t.is_mit,
          goal_id: t.goal_id || null,
          key_result_id: t.key_result_id || null,
          plan_node_id: t.plan_node_id || null,
          milestone: t.milestone || null,
          // 扩展字段透传（P5 架构预留）：metadata.action 约定见 docs/task-automation.md，
          // P14 的执行器会消费它；本期只存不执行。
          ...(t.metadata && typeof t.metadata === 'object' ? { metadata: t.metadata } : {}),
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        if (key) activeNorms.set(key, row); // dedup within this batch too
        newRows.push(row);
        created.push(row);
      }
      if (newRows.length) {
        s.tasks.push(...newRows);
        writeStore(s);
      }
      return created;
    },
    /** Active task (todo/in_progress) matching a title, else null. Fuzzy by default. */
    findActiveTaskByTitle(userId, title, { fuzzy = true } = {}) {
      if (!title) return null;
      const s = readStore();
      const norm = normalizeForDedup(title);
      let nearest = null;
      for (const t of s.tasks || []) {
        if (t.user_id !== userId || t.status === 'done' || t.status === 'cancelled' || !t.title) continue;
        if (normalizeForDedup(t.title) === norm) return t;
        if (fuzzy && !nearest && isNearDuplicate(t.title, title)) nearest = t;
      }
      return nearest;
    },
    /**
     * Today's task list — surfaces tasks the user can act on right now.
     * Sort: due_date asc (null last) → priority desc → created_at desc.
     * Hides done tasks completed more than 24h ago so the list doesn't bloat.
     */
    listTodayTasks(userId) {
      const s = readStore();
      const prioRank = { high: 3, medium: 2, low: 1 };
      const now = Date.now();
      return (s.tasks || [])
        .filter((t) => t.user_id === userId)
        .filter((t) => {
          if (t.status !== 'done') return true;
          const finishedAt = new Date(t.updated_at || t.created_at || 0).getTime();
          return now - finishedAt < 24 * 60 * 60 * 1000;
        })
        .sort((a, b) => {
          const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
          const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
          if (aDue !== bDue) return aDue - bDue;
          const ap = prioRank[a.priority] || 0;
          const bp = prioRank[b.priority] || 0;
          if (ap !== bp) return bp - ap;
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        })
        .slice(0, 20)
        .map((t) => ({ ...t }));
    },
    /**
     * All tasks for the user across time — powers the execution page's
     * 今日 / 未来 / 历史 scopes. Unlike listTodayTasks it keeps completed
     * tasks regardless of age so history stays visible; only hard-cancelled
     * tasks are dropped. Sorted by schedule date (scheduled_date ‖ due_date)
     * asc with nulls last, then priority desc, then created_at desc. The
     * client partitions these into today / upcoming / history.
     */
    listAllTasks(userId) {
      const s = readStore();
      const prioRank = { high: 3, medium: 2, low: 1 };
      const schedOf = (t) => t.scheduled_date || t.due_date || null;
      return (s.tasks || [])
        .filter((t) => t.user_id === userId && t.status !== 'cancelled')
        .sort((a, b) => {
          const aSched = schedOf(a) ? new Date(schedOf(a)).getTime() : Number.POSITIVE_INFINITY;
          const bSched = schedOf(b) ? new Date(schedOf(b)).getTime() : Number.POSITIVE_INFINITY;
          if (aSched !== bSched) return aSched - bSched;
          const ap = prioRank[a.priority] || 0;
          const bp = prioRank[b.priority] || 0;
          if (ap !== bp) return bp - ap;
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        })
        .slice(0, 500)
        .map((t) => ({ ...t }));
    },
    updateTaskStatus(userId, taskId, status) {
      const s = readStore();
      const task = s.tasks.find((t) => t.user_id === userId && t.id === taskId);
      if (!task) return null;
      task.status = status;
      task.updated_at = nowIso();
      // Timeline markers for the 待办→进行中→完成 flow. `started_at` is set once
      // (first 开始) so a paused/resumed task keeps its original elapsed clock.
      if (status === 'in_progress' && !task.started_at) task.started_at = nowIso();
      if (status === 'done' && !task.completed_at) task.completed_at = nowIso();
      writeStore(s);
      return task;
    },
    createAdjustment(userId, type, detail = {}) {
      const s = readStore();
      const adj = { id: randomId(), user_id: userId, type, detail, created_at: nowIso() };
      s.adjustments.push(adj);
      writeStore(s);
      return adj;
    },
    getTreeSnapshot(userId) {
      const s = readStore();
      const memoryItems = s.memoryItems.filter((m) => m.user_id === userId);
      const tasks = s.tasks.filter((t) => t.user_id === userId).slice(-20).reverse();
      const goals = s.goals.filter((g) => g.user_id === userId);

      // MVP：非常轻量的"根系/技能"抽取占位（后续改为 LLM 抽取 + 向量召回）
      const roots = memoryItems.slice(-10).reverse().map((m) => ({
        id: m.id,
        label: m.type,
        content: m.content_raw.slice(0, 60),
        tags: m.tags,
      }));
      const skills = [];
      const skillSet = new Set();
      for (const m of memoryItems) {
        for (const tag of m.tags || []) {
          if (tag.startsWith('skill:')) skillSet.add(tag.replace(/^skill:/, ''));
        }
      }
      for (const sk of Array.from(skillSet).slice(0, 12)) {
        skills.push({ id: `skill:${sk}`, label: sk });
      }

      const branches = []; // 规划/执行完成后补齐

      return { roots, skills, branches, goals, tasks };
    },

    // Goals CRUD
    createGoal(userId, { title, description, life_wheel_dimension, parent_id, level, status }) {
      const s = readStore();
      // Dedup guard only for top-level objectives: reuse a live goal with the
      // same (fuzzy) title instead of creating a second copy when the model
      // calls create_goal twice. Child nodes (KR / 月 / 任务) are part of an OKR
      // tree and may legitimately repeat titles, so they skip the dedup.
      if (!parent_id) {
        const dup = _findDuplicateGoal(s, userId, title);
        if (dup) return dup;
      }
      const goal = {
        id: randomId(),
        user_id: userId,
        title,
        description: description || '',
        life_wheel_dimension: life_wheel_dimension || 'growth',
        parent_id: parent_id || null,
        level: level || 'objective',
        status: status || 'draft',
        progress: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      s.goals.push(goal);
      writeStore(s);
      return goal;
    },
    /** Live goal (not completed/archived/cancelled) matching a title, else null. */
    findDuplicateGoal(userId, title) {
      return _findDuplicateGoal(readStore(), userId, title);
    },
    listGoals(userId) {
      const s = readStore();
      return s.goals.filter((g) => g.user_id === userId);
    },
    updateGoalStatus(userId, goalId, status) {
      const s = readStore();
      const goal = s.goals.find((g) => g.user_id === userId && g.id === goalId);
      if (!goal) return null;
      goal.status = status;
      goal.progress = status === 'completed' ? 100 : goal.progress;
      goal.updated_at = nowIso();
      writeStore(s);
      return goal;
    },
    /** 编辑目标本身（标题/描述/维度/WOOP/SMART/状态）。白名单字段，避免改坏内部字段。 */
    updateGoal(userId, goalId, patch = {}) {
      const s = readStore();
      const goal = s.goals.find((g) => g.user_id === userId && g.id === goalId);
      if (!goal) return null;
      const ALLOWED = [
        'title', 'description', 'life_wheel_dimension', 'status', 'progress',
        'wish', 'outcome', 'obstacle',
        'specific', 'measurable', 'achievable', 'relevant', 'time_bound',
        'start_date', 'end_date',
      ];
      for (const k of ALLOWED) {
        if (patch[k] !== undefined) goal[k] = patch[k];
      }
      goal.updated_at = nowIso();
      writeStore(s);
      return goal;
    },
    deleteGoal(userId, goalId) {
      const s = readStore();
      const index = s.goals.findIndex((g) => g.user_id === userId && g.id === goalId);
      if (index === -1) return null;
      // Cascade: collect the goal and all descendant OKR nodes (KR / 月).
      const toDelete = new Set([goalId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const g of s.goals) {
          if (g.user_id === userId && g.parent_id && toDelete.has(g.parent_id) && !toDelete.has(g.id)) {
            toDelete.add(g.id);
            changed = true;
          }
        }
      }
      // Process linked ToDos before removing the goals: 未开始(todo)→移除;
      // 已完成/已跳过(历史) 与 进行中(在做)→保留但脱钩——清掉指向被删子树的
      // 引用,保留指向幸存上级的引用(删 KR 时任务回挂父 O,删 O 时变自由任务)。
      const summary = { deleted: true, keptDone: 0, keptInProgress: 0, removedTodo: 0 };
      const survivors = [];
      for (const tk of s.tasks) {
        const linked = tk.user_id === userId && (toDelete.has(tk.goal_id) || toDelete.has(tk.key_result_id) || toDelete.has(tk.plan_node_id));
        if (!linked) { survivors.push(tk); continue; }
        if (tk.status === 'todo') { summary.removedTodo++; continue; }
        if (toDelete.has(tk.goal_id)) tk.goal_id = null;
        if (toDelete.has(tk.key_result_id)) tk.key_result_id = null;
        if (toDelete.has(tk.plan_node_id)) tk.plan_node_id = null;
        tk.updated_at = nowIso();
        if (tk.status === 'in_progress') summary.keptInProgress++; else summary.keptDone++;
        survivors.push(tk);
      }
      s.tasks = survivors;
      s.goals = s.goals.filter((g) => !(g.user_id === userId && toDelete.has(g.id)));
      writeStore(s);
      return summary;
    },

    // Conversation management (persisted to data/store.json)
    listConversations(userId) {
      const s = readStore();
      const messages = s.conversationMessages || [];
      return (s.conversations || [])
        .filter(c => c.user_id === userId)
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .map(c => {
          const convMsgs = messages.filter(m => m.conversation_id === c.id);
          const last = convMsgs.reduce((a, b) => (!a || new Date(b.created_at) > new Date(a.created_at)) ? b : a, null);
          return { ...c, last_message: last ? last.content : null };
        });
    },

    getConversation(conversationId, userId) {
      const s = readStore();
      return (s.conversations || []).find(
        c => c.id === conversationId && (!userId || c.user_id === userId)
      ) || null;
    },

    getConversationMessages(conversationId) {
      const s = readStore();
      return (s.conversationMessages || [])
        .filter(m => m.conversation_id === conversationId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(m => ({ ...m }));
    },

    addConversationMessage(conversationId, userId, { role, content, metadata, title }) {
      const s = readStore();
      if (!Array.isArray(s.conversations)) s.conversations = [];
      if (!Array.isArray(s.conversationMessages)) s.conversationMessages = [];

      let conv = s.conversations.find(c => c.id === conversationId);
      if (!conv) {
        conv = {
          id: conversationId,
          user_id: userId,
          title: title || '新对话',
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        s.conversations.push(conv);
      } else if (title && conv.title === '新对话') {
        conv.title = title;
      }
      conv.updated_at = nowIso();

      const msg = {
        id: randomId(),
        conversation_id: conversationId,
        user_id: userId,
        role,
        content,
        metadata: metadata || {},
        created_at: nowIso(),
      };
      s.conversationMessages.push(msg);
      writeStore(s);
      return msg;
    },

    updateConversationTitle(conversationId, userId, title) {
      const s = readStore();
      const conv = (s.conversations || []).find(
        c => c.id === conversationId && c.user_id === userId
      );
      if (!conv) return null;
      conv.title = title;
      conv.updated_at = nowIso();
      writeStore(s);
      return { ...conv };
    },

    deleteConversation(conversationId, userId) {
      const s = readStore();
      const idx = (s.conversations || []).findIndex(
        c => c.id === conversationId && c.user_id === userId
      );
      if (idx === -1) return false;
      s.conversations.splice(idx, 1);
      s.conversationMessages = (s.conversationMessages || []).filter(
        m => m.conversation_id !== conversationId
      );
      writeStore(s);
      return true;
    },

    /** Hard-delete a single message (撤回) — no cascade, no soft-delete/tombstone. */
    deleteConversationMessage(conversationId, userId, messageId) {
      const s = readStore();
      const before = (s.conversationMessages || []).length;
      s.conversationMessages = (s.conversationMessages || []).filter(
        m => !(m.id === messageId && m.conversation_id === conversationId && m.user_id === userId)
      );
      const removed = s.conversationMessages.length < before;
      if (removed) writeStore(s);
      return removed;
    },

    /** Edit flow: hard-delete `fromMessageId` and every message after it (by
     *  send order) so the edited text can be resent through the normal
     *  pipeline. Returns the number removed; 0 (no-op) if the id isn't found
     *  or doesn't belong to this user/conversation. */
    truncateConversationFrom(conversationId, userId, fromMessageId) {
      const s = readStore();
      const sorted = (s.conversationMessages || [])
        .filter(m => m.conversation_id === conversationId && m.user_id === userId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const idx = sorted.findIndex(m => m.id === fromMessageId);
      if (idx === -1) return 0;
      const dropIds = new Set(sorted.slice(idx).map(m => m.id));
      const before = s.conversationMessages.length;
      s.conversationMessages = s.conversationMessages.filter(m => !dropIds.has(m.id));
      const removed = before - s.conversationMessages.length;
      if (removed > 0) writeStore(s);
      return removed;
    },

    // =============================================
    // If-Then Cards (Obstacles)
    // =============================================
    createIfThenCard(userId, data) {
      const s = readStore();
      if (!s.ifThenCards) s.ifThenCards = [];
      const card = {
        id: randomId(),
        user_id: userId,
        goal_id: data.goal_id || null,
        goal_title: data.goal_title || '',
        // Clamp to the canonical 6 types — LLM-generated ifThenCards (woop-generate)
        // return free-text obstacleType, and an off-list value crashes every UI
        // lookup keyed on it (OBSTACLE_TYPE_LABELS[type]).
        obstacle_type: OBSTACLE_TYPES.has(data.obstacle_type) ? data.obstacle_type : 'procrastination_fear',
        obstacle_description: data.obstacle_description,
        if_condition: data.if_condition,
        then_action: data.then_action,
        until_condition: data.until_condition || null,
        triggered_count: 0,
        executed_count: 0,
        status: 'active',
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      s.ifThenCards.push(card);
      writeStore(s);
      return card;
    },

    listIfThenCards(userId, { goalId, obstacleType } = {}) {
      const s = readStore();
      let cards = (s.ifThenCards || []).filter(c => c.user_id === userId);
      if (goalId) cards = cards.filter(c => c.goal_id === goalId);
      if (obstacleType) cards = cards.filter(c => c.obstacle_type === obstacleType);
      return cards.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    updateIfThenCard(userId, cardId, data) {
      const s = readStore();
      if (!s.ifThenCards) s.ifThenCards = [];
      const card = s.ifThenCards.find(c => c.user_id === userId && c.id === cardId);
      if (!card) return null;
      Object.assign(card, data, { updated_at: nowIso() });
      writeStore(s);
      return card;
    },

    deleteIfThenCard(userId, cardId) {
      const s = readStore();
      if (!s.ifThenCards) s.ifThenCards = [];
      const idx = s.ifThenCards.findIndex(c => c.user_id === userId && c.id === cardId);
      if (idx === -1) return false;
      s.ifThenCards.splice(idx, 1);
      writeStore(s);
      return true;
    },

    triggerIfThenCard(userId, cardId, executed) {
      const s = readStore();
      if (!s.ifThenCards) s.ifThenCards = [];
      const card = s.ifThenCards.find(c => c.user_id === userId && c.id === cardId);
      if (!card) return null;
      card.triggered_count = (card.triggered_count || 0) + 1;
      if (executed) card.executed_count = (card.executed_count || 0) + 1;
      card.updated_at = nowIso();
      writeStore(s);
      return card;
    },

    // Obstacle Events
    createObstacleEvent(userId, data) {
      const s = readStore();
      if (!s.obstacleEvents) s.obstacleEvents = [];
      const event = {
        id: randomId(),
        user_id: userId,
        task_id: data.task_id || null,
        task_title: data.task_title || '',
        obstacle_type: data.obstacle_type,
        matched_predicted: data.matched_predicted || false,
        if_then_card_id: data.if_then_card_id || null,
        if_then_triggered: data.if_then_triggered || false,
        if_then_executed: data.if_then_executed || false,
        reason_code: data.reason_code || null,
        reason_note: data.reason_note || '',
        occurred_at: nowIso(),
      };
      s.obstacleEvents.push(event);
      writeStore(s);
      return event;
    },

    listObstacleEvents(userId, { limit = 20 } = {}) {
      const s = readStore();
      return (s.obstacleEvents || [])
        .filter(e => e.user_id === userId)
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
        .slice(0, limit);
    },

    matchObstacle(userId, reasonCode) {
      const s = readStore();
      const cards = (s.ifThenCards || []).filter(c => c.user_id === userId && c.status === 'active');
      // reason_code → obstacle_type. Superset so every client (mobile skip
      // sheet, web execution, historical events) maps to the same 6 types.
      const reasonToType = {
        // canonical (mobile skip sheet)
        no_time: 'time_limited',
        too_tired: 'energy_low',
        distracted: 'attention_scattered',
        procrastination: 'procrastination_fear',
        unclear: 'info_insufficient',
        external_block: 'external_dependency',
        not_relevant: null,
        // legacy / web-execution aliases
        time_insufficient: 'time_limited',
        energy_low: 'energy_low',
        mood_dip: 'energy_low',
        priority_changed: 'attention_scattered',
        forgot: 'attention_scattered',
        procrastination_fear: 'procrastination_fear',
        unclear_step: 'info_insufficient',
        external_interrupt: 'external_dependency',
        other: null,
      };
      const matchedType = reasonToType[reasonCode] || null;
      if (!matchedType) return { matched: false, cards: [] };
      const matched = cards.filter(c => c.obstacle_type === matchedType);
      return { matched: matched.length > 0, type: matchedType, cards: matched };
    },

    getObstacleStats(userId) {
      const s = readStore();
      const cards = (s.ifThenCards || []).filter(c => c.user_id === userId);
      const events = (s.obstacleEvents || []).filter(e => e.user_id === userId);
      const totalTriggers = cards.reduce((sum, c) => sum + (c.triggered_count || 0), 0);
      const totalExecuted = cards.reduce((sum, c) => sum + (c.executed_count || 0), 0);
      const byType = {};
      for (const e of events) {
        byType[e.obstacle_type] = (byType[e.obstacle_type] || 0) + 1;
      }
      return {
        totalCards: cards.length,
        totalEvents: events.length,
        hitRate: events.length > 0
          ? Math.round((events.filter(e => e.matched_predicted).length / events.length) * 100)
          : 0,
        triggerCount: totalTriggers,
        executeCount: totalExecuted,
        executeRate: totalTriggers > 0 ? Math.round((totalExecuted / totalTriggers) * 100) : 0,
        byType,
      };
    },

    // =============================================
    // ECS History
    // =============================================
    recordECS(userId, data) {
      const s = readStore();
      if (!s.ecsHistory) s.ecsHistory = [];
      const today = new Date().toISOString().split('T')[0];
      const existing = s.ecsHistory.find(e => e.user_id === userId && e.date === today);
      if (existing) {
        Object.assign(existing, data);
        writeStore(s);
        return existing;
      }
      const record = {
        id: randomId(),
        user_id: userId,
        date: today,
        completion_rate: data.completion_rate || 0,
        plan_stability: data.plan_stability || 0,
        reflection_completed: data.reflection_completed || false,
        total: data.total || 0,
        created_at: nowIso(),
      };
      s.ecsHistory.push(record);
      writeStore(s);
      return record;
    },

    getECSHistory(userId, { days = 30 } = {}) {
      const s = readStore();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return (s.ecsHistory || [])
        .filter(e => e.user_id === userId && new Date(e.date) >= cutoff)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    },

    // =============================================
    // Reflections
    // =============================================
    createReflection(userId, data) {
      const s = readStore();
      if (!s.reflections) s.reflections = [];
      const reflection = {
        id: randomId(),
        user_id: userId,
        date: data.date || new Date().toISOString().split('T')[0],
        q1_obstacle_tag: data.q1_obstacle_tag || null,
        q2_most_valuable: data.q2_most_valuable || '',
        q3_adjustment_tag: data.q3_adjustment_tag || 'no_change',
        ecs_score: data.ecs_score || null,
        created_at: nowIso(),
      };
      s.reflections.push(reflection);
      writeStore(s);
      return reflection;
    },

    listReflections(userId, { limit = 30 } = {}) {
      const s = readStore();
      return (s.reflections || [])
        .filter(r => r.user_id === userId)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, limit);
    },

    // =============================================
    // Reviews
    // =============================================
    createReview(userId, data) {
      const s = readStore();
      if (!s.reviews) s.reviews = [];
      const review = {
        id: randomId(),
        user_id: userId,
        period_type: data.period_type || 'weekly',
        period_start: data.period_start,
        period_end: data.period_end,
        stats: data.stats || {},
        summary: data.summary || '',
        // 结构化四段（web ReviewDetailModal / 移动端 ReviewDetailSheet 消费）
        highlights: data.highlights || [],
        lowlights: data.lowlights || [],
        next_period_focus: data.next_period_focus || [],
        // 派生指标（详情弹窗 pill）——来自 stats 快照
        ecs_avg: data.ecs_avg ?? null,
        completion_rate: data.completion_rate ?? null,
        // 兼容别名：聊天 ReviewExpand 卡仍读 ai_insights/ai_suggestions
        ai_insights: data.ai_insights || data.highlights || [],
        ai_suggestions: data.ai_suggestions || data.next_period_focus || [],
        created_at: nowIso(),
      };
      s.reviews.push(review);
      writeStore(s);
      return review;
    },

    listReviews(userId, { limit = 20 } = {}) {
      const s = readStore();
      return (s.reviews || [])
        .filter(r => r.user_id === userId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
    },

    // =============================================
    // User Settings / Preferences
    // =============================================
    getSettings(userId) {
      const s = readStore();
      if (!s.settings) s.settings = [];
      return s.settings.find(st => st.user_id === userId) || {
        user_id: userId,
        avatar_name: '智伴',
        avatar_personality: 'friendly',
        language: 'zh',
        timezone: 'Asia/Shanghai',
        theme: 'dark',
        llm_preference: 'auto',
        notification_prefs: { morning: true, checkin: true, evening: true },
        privacy_settings: {},
      };
    },

    updateSettings(userId, data) {
      const s = readStore();
      if (!s.settings) s.settings = [];
      let settings = s.settings.find(st => st.user_id === userId);
      if (!settings) {
        settings = { id: randomId(), user_id: userId, created_at: nowIso() };
        s.settings.push(settings);
      }
      Object.assign(settings, data, { updated_at: nowIso() });
      writeStore(s);
      return settings;
    },

    /**
     * Raw settings row or null — unlike getSettings, does NOT synthesize a
     * default. Email language resolution needs this to distinguish "user chose
     * zh" from "no row → defaulted to zh".
     */
    getSettingsRow(userId) {
      const s = readStore();
      return (s.settings || []).find(st => st.user_id === userId) || null;
    },

    /** Merge a patch into settings.email_prefs (e.g. { updates: false } for unsubscribe). */
    updateEmailPrefs(userId, patch) {
      const s = readStore();
      if (!s.settings) s.settings = [];
      let settings = s.settings.find(st => st.user_id === userId);
      if (!settings) {
        settings = { id: randomId(), user_id: userId, created_at: nowIso() };
        s.settings.push(settings);
      }
      settings.email_prefs = { ...(settings.email_prefs || {}), ...(patch || {}) };
      settings.updated_at = nowIso();
      writeStore(s);
      return settings.email_prefs;
    },

    // ── 交易邮件令牌 + 邮箱验证状态 ──────────────────────────────────────────
    setEmailVerified(userId, verified = true) {
      const s = readStore();
      const u = s.users.find(x => x.id === userId);
      if (!u) return null;
      u.email_verified = !!verified;
      u.email_verified_at = verified ? nowIso() : null;
      writeStore(s);
      return u;
    },

    /**
     * Create a single-use email token. Only the sha256 is stored; the returned
     * plaintext goes in the emailed link and is never persisted.
     * @returns {{ token: string, row: object }}
     */
    createEmailToken({ user_id, kind, email, ttlMs }) {
      const token = randomToken(32);
      const s = readStore();
      if (!Array.isArray(s.email_tokens)) s.email_tokens = [];
      // 同 user+kind 的旧令牌作废（重发即失效前一封),并顺手清理过期项。
      const now = Date.now();
      s.email_tokens = s.email_tokens.filter(t =>
        !(t.user_id === user_id && t.kind === kind && !t.used_at) &&
        new Date(t.expires_at).getTime() > now - 24 * 3600 * 1000
      );
      const row = {
        id: randomId(),
        user_id,
        kind,
        token_hash: hashToken(token),
        email: email ? String(email).trim().toLowerCase() : null,
        expires_at: new Date(now + (ttlMs || 24 * 3600 * 1000)).toISOString(),
        used_at: null,
        created_at: nowIso(),
      };
      s.email_tokens.push(row);
      writeStore(s);
      return { token, row };
    },

    /**
     * Consume a token: returns the row if valid+unused+unexpired and marks it
     * used; otherwise { error }. Kind-scoped so a verify token can't reset.
     * @returns {object|{ error: string }}
     */
    consumeEmailToken(kind, token) {
      if (!token) return { error: 'missing_token' };
      const s = readStore();
      if (!Array.isArray(s.email_tokens)) return { error: 'invalid_token' };
      const hash = hashToken(token);
      const row = s.email_tokens.find(t => t.kind === kind && t.token_hash === hash);
      if (!row) return { error: 'invalid_token' };
      if (row.used_at) return { error: 'used_token' };
      if (new Date(row.expires_at).getTime() < Date.now()) return { error: 'expired_token' };
      row.used_at = nowIso();
      writeStore(s);
      return row;
    },

    // =============================================
    // Companion home brief — daily LLM greeting cache
    // =============================================
    getCompanionBrief(userId, briefDate, lang) {
      const s = readStore();
      return (s.companionBriefs || []).find(
        b => b.user_id === userId && b.brief_date === briefDate && b.lang === lang
      ) || null;
    },

    /** payload: 字符串（v1 只有开场白）或 { greeting_text, fingerprint?, suggestions? }（v2）。 */
    setCompanionBrief(userId, briefDate, lang, payload) {
      const s = readStore();
      if (!Array.isArray(s.companionBriefs)) s.companionBriefs = [];
      // 该用户只保留当天的缓存（旧日期条目顺带清理，避免文件膨胀）
      s.companionBriefs = s.companionBriefs.filter(
        b => !(b.user_id === userId && (b.brief_date !== briefDate || b.lang === lang))
      );
      const body = typeof payload === 'string' ? { greeting_text: payload } : (payload || {});
      const entry = { user_id: userId, brief_date: briefDate, lang, ...body, created_at: nowIso() };
      s.companionBriefs.push(entry);
      writeStore(s);
      return entry;
    },

    // =============================================
    // 三方记忆导入任务（P6）
    // =============================================
    createImportJob(userId, { source, convs_total }) {
      const s = readStore();
      if (!Array.isArray(s.importJobs)) s.importJobs = [];
      const entry = {
        id: randomId(),
        user_id: userId,
        status: 'processing',
        source,
        progress: { convs_done: 0, convs_total, episodes_created: 0, entities_touched: 0 },
        report: null,
        error: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      // 每用户最多保留最近 5 条任务记录
      const mine = s.importJobs.filter(j => j.user_id === userId);
      if (mine.length >= 5) {
        const oldest = mine.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
        s.importJobs = s.importJobs.filter(j => j.id !== oldest.id);
      }
      s.importJobs.push(entry);
      writeStore(s);
      return entry;
    },

    getImportJob(userId, id) {
      const s = readStore();
      return (s.importJobs || []).find(j => j.user_id === userId && j.id === id) || null;
    },

    updateImportJob(userId, id, patch) {
      const s = readStore();
      const entry = (s.importJobs || []).find(j => j.user_id === userId && j.id === id);
      if (!entry) return null;
      Object.assign(entry, patch, { updated_at: nowIso() });
      writeStore(s);
      return entry;
    },

    // =============================================
    // MCP servers（外部工具，P5）
    // =============================================
    listMcpServers(userId) {
      const s = readStore();
      return (s.mcpServers || []).filter(m => m.user_id === userId);
    },

    getMcpServer(userId, id) {
      const s = readStore();
      return (s.mcpServers || []).find(m => m.user_id === userId && m.id === id) || null;
    },

    createMcpServer(userId, { name, slug, url, headers, transport, command, args, env }) {
      const s = readStore();
      if (!Array.isArray(s.mcpServers)) s.mcpServers = [];
      // slug 需要用户内唯一（聊天工具命名空间 mcp__{slug}__{tool} 的解析键）
      let unique = slug;
      let i = 2;
      while (s.mcpServers.some(m => m.user_id === userId && m.slug === unique)) unique = `${slug}_${i++}`;
      const entry = {
        id: randomId(),
        user_id: userId,
        name: String(name || '').slice(0, 60),
        slug: unique,
        transport: transport === 'stdio' ? 'stdio' : 'http',
        url: String(url || ''),
        command: String(command || ''),
        args: Array.isArray(args) ? args.map(String).slice(0, 20) : [],
        env: env && typeof env === 'object' ? env : {},
        headers: headers && typeof headers === 'object' ? headers : {},
        enabled: true,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      s.mcpServers.push(entry);
      writeStore(s);
      return entry;
    },

    updateMcpServer(userId, id, patch) {
      const s = readStore();
      const entry = (s.mcpServers || []).find(m => m.user_id === userId && m.id === id);
      if (!entry) return null;
      if (patch.name !== undefined) entry.name = String(patch.name).slice(0, 60);
      if (patch.url !== undefined) entry.url = String(patch.url);
      if (patch.transport !== undefined) entry.transport = patch.transport === 'stdio' ? 'stdio' : 'http';
      if (patch.command !== undefined) entry.command = String(patch.command);
      if (patch.args !== undefined) entry.args = Array.isArray(patch.args) ? patch.args.map(String).slice(0, 20) : [];
      if (patch.env !== undefined) entry.env = patch.env && typeof patch.env === 'object' ? patch.env : {};
      if (patch.headers !== undefined) entry.headers = patch.headers && typeof patch.headers === 'object' ? patch.headers : {};
      if (patch.enabled !== undefined) entry.enabled = patch.enabled !== false;
      entry.updated_at = nowIso();
      writeStore(s);
      return entry;
    },

    deleteMcpServer(userId, id) {
      const s = readStore();
      const before = (s.mcpServers || []).length;
      s.mcpServers = (s.mcpServers || []).filter(m => !(m.user_id === userId && m.id === id));
      writeStore(s);
      return s.mcpServers.length < before;
    },

    /**
     * MCP OAuth 客户端状态（能力开放 E3）：DCR client_information / tokens /
     * PKCE code_verifier / 授权 state 等全部收在 entry.oauth，与 headers 一样
     * 属于秘密——路由层序列化时必须剥掉，只回传布尔状态。patch 里值为 null 的
     * 键做删除（清 state / 吊销 tokens 用）。
     */
    updateMcpServerOauth(userId, id, patch) {
      const s = readStore();
      const entry = (s.mcpServers || []).find(m => m.user_id === userId && m.id === id);
      if (!entry) return null;
      const oauth = { ...(entry.oauth || {}) };
      for (const [k, v] of Object.entries(patch || {})) {
        if (v === null) delete oauth[k];
        else oauth[k] = v;
      }
      entry.oauth = oauth;
      entry.updated_at = nowIso();
      writeStore(s);
      return entry;
    },

    /** 授权回调按 state 反查（回调无登录态，state 即绑定凭据）。 */
    getMcpServerByOauthState(state) {
      if (!state) return null;
      const s = readStore();
      return (s.mcpServers || []).find(m => m.oauth?.state === state) || null;
    },

    // =============================================
    // PAT（个人访问令牌，能力开放 E2）——记忆 MCP 的长效凭证。
    // 明文不落库：只存 sha256（hash 由路由层算好传入）；吊销保留行以供审计。
    // =============================================
    listPats(userId) {
      const s = readStore();
      return (s.pats || []).filter(p => p.user_id === userId).map(({ token_hash, ...pub }) => pub);
    },

    getPatByHash(tokenHash) {
      if (!tokenHash) return null;
      const s = readStore();
      return (s.pats || []).find(p => p.token_hash === tokenHash) || null;
    },

    createPat(userId, { name, scopes, redact_pii, token_hash, token_prefix }) {
      const s = readStore();
      if (!Array.isArray(s.pats)) s.pats = [];
      const entry = {
        id: randomId(),
        user_id: userId,
        name: String(name || '').slice(0, 60) || 'Token',
        scopes: Array.isArray(scopes) ? scopes.map(String).slice(0, 8) : [],
        redact_pii: redact_pii !== false, // 默认脱敏；关闭需显式选择（密钥类内容始终拦截）
        token_hash: String(token_hash),
        token_prefix: String(token_prefix || '').slice(0, 16),
        created_at: nowIso(),
        last_used_at: null,
        usage_count: 0,
        revoked_at: null,
      };
      s.pats.push(entry);
      writeStore(s);
      const { token_hash: _h, ...pub } = entry;
      return pub;
    },

    revokePat(userId, id) {
      const s = readStore();
      const entry = (s.pats || []).find(p => p.user_id === userId && p.id === id);
      if (!entry || entry.revoked_at) return null;
      entry.revoked_at = nowIso();
      writeStore(s);
      const { token_hash: _h, ...pub } = entry;
      return pub;
    },

    touchPat(id) {
      const s = readStore();
      const entry = (s.pats || []).find(p => p.id === id);
      if (!entry) return;
      entry.last_used_at = nowIso();
      entry.usage_count = (entry.usage_count || 0) + 1;
      writeStore(s);
    },

    /** 审计留痕（每 PAT 每次工具调用一条），按用户截断保留最近 300 条。 */
    addPatAudit(userId, { pat_id, tool, summary }) {
      const s = readStore();
      if (!Array.isArray(s.patAudit)) s.patAudit = [];
      s.patAudit.unshift({
        id: randomId(),
        user_id: userId,
        pat_id: String(pat_id || ''),
        tool: String(tool || '').slice(0, 60),
        summary: String(summary || '').slice(0, 120),
        ts: nowIso(),
      });
      const mine = s.patAudit.filter(a => a.user_id === userId);
      if (mine.length > 300) {
        const keep = new Set(mine.slice(0, 300).map(a => a.id));
        s.patAudit = s.patAudit.filter(a => a.user_id !== userId || keep.has(a.id));
      }
      writeStore(s);
    },

    listPatAudit(userId, { limit = 50 } = {}) {
      const s = readStore();
      return (s.patAudit || []).filter(a => a.user_id === userId).slice(0, Math.min(200, limit));
    },

    // =============================================
    // Aggregated Stats for Insights
    // =============================================
    getInsightStats(userId, { periodType = 'weekly' } = {}) {
      const s = readStore();
      const now = new Date();
      const daysBack = periodType === 'monthly' ? 30 : 7;
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - daysBack);

      const tasks = (s.tasks || []).filter(t =>
        t.user_id === userId && new Date(t.created_at) >= cutoff
      );
      const goals = (s.goals || []).filter(g => g.user_id === userId && g.status === 'active');
      const memories = (s.memoryItems || []).filter(m =>
        m.user_id === userId && new Date(m.created_at) >= cutoff
      );
      const reflections = (s.reflections || []).filter(r =>
        r.user_id === userId && new Date(r.date) >= cutoff
      );
      const ecsRecords = (s.ecsHistory || []).filter(e =>
        e.user_id === userId && new Date(e.date) >= cutoff
      );

      const completedTasks = tasks.filter(t => t.status === 'done');
      const completionRate = tasks.length > 0
        ? Math.round((completedTasks.length / tasks.length) * 100)
        : 0;

      const dailyCompletion = {};
      for (const t of tasks) {
        const day = t.created_at?.split('T')[0] || 'unknown';
        if (!dailyCompletion[day]) dailyCompletion[day] = { total: 0, done: 0 };
        dailyCompletion[day].total++;
        if (t.status === 'done') dailyCompletion[day].done++;
      }

      return {
        period: periodType,
        totalTasks: tasks.length,
        completedTasks: completedTasks.length,
        completionRate,
        activeGoals: goals.length,
        newMemories: memories.length,
        reflectionCount: reflections.length,
        avgECS: ecsRecords.length > 0
          ? Math.round(ecsRecords.reduce((s, e) => s + (e.total || 0), 0) / ecsRecords.length)
          : 0,
        dailyCompletion,
      };
    },

    // ── 目标重规划支持（执行情况统计 + 替换旧计划）──────────────────
    /** 某目标下任务的完成情况（喂给重规划上下文）。 */
    getTaskStatsByGoal(userId, goalId) {
      const s = readStore();
      let total = 0, done = 0, skipped = 0, open = 0;
      for (const t of s.tasks) {
        if (t.user_id !== userId || t.goal_id !== goalId || t.status === 'cancelled') continue;
        total++;
        if (t.status === 'done') done++;
        else if (t.status === 'skipped') skipped++;
        else if (t.status === 'todo' || t.status === 'in_progress') open++;
      }
      return { total, done, skipped, open, completionRate: total ? Math.round((done / total) * 100) : 0 };
    },
    /** 重规划时取消某目标下「未完成」的任务（todo/in_progress → cancelled），保留已完成历史。 */
    cancelOpenTasksByGoal(userId, goalId) {
      const s = readStore();
      let n = 0;
      for (const t of s.tasks) {
        if (t.user_id === userId && t.goal_id === goalId && (t.status === 'todo' || t.status === 'in_progress')) {
          t.status = 'cancelled';
          t.updated_at = nowIso();
          n++;
        }
      }
      if (n) writeStore(s);
      return n;
    },
    /** 删除某目标的所有后代节点（KR/阶段/任务节点），用于重规划前清场。 */
    deleteDescendantGoals(userId, rootId) {
      const s = readStore();
      const byParent = {};
      for (const g of s.goals) { if (g.user_id === userId) (byParent[g.parent_id] ||= []).push(g); }
      const toDelete = new Set();
      const queue = [rootId];
      while (queue.length) {
        const pid = queue.shift();
        for (const child of byParent[pid] || []) {
          if (!toDelete.has(child.id)) { toDelete.add(child.id); queue.push(child.id); }
        }
      }
      if (toDelete.size) {
        s.goals = s.goals.filter(g => !(g.user_id === userId && toDelete.has(g.id)));
        writeStore(s);
      }
      return toDelete.size;
    },

    // P1-B: Task CRUD helpers (used by batch-adjust)
    getTask(userId, taskId) {
      return readStore().tasks.find(t => t.user_id === userId && t.id === taskId) || null;
    },
    updateTask(userId, taskId, patch) {
      const s = readStore();
      const task = s.tasks.find(t => t.user_id === userId && t.id === taskId);
      if (!task) return null;
      Object.assign(task, patch);
      writeStore(s);
      return task;
    },

    // P1-B: Undo snapshot store (persisted, keyed by undo_token, TTL 10 min).
    // Persisted into the store file so a backend restart between "apply" and
    // "undo" doesn't strand the rollback (was in-memory only — a restart lost
    // every pending undo and the撤销 button 404'd).
    setUndoSnapshot(token, snapshots) {
      const s = readStore();
      if (!s.undoSnapshots) s.undoSnapshots = {};
      s.undoSnapshots[token] = { snapshots, expires: Date.now() + 10 * 60 * 1000 };
      // Purge expired tokens on every write.
      const now = Date.now();
      for (const k of Object.keys(s.undoSnapshots)) {
        if (s.undoSnapshots[k].expires < now) delete s.undoSnapshots[k];
      }
      writeStore(s);
    },
    getUndoSnapshot(token) {
      const entry = readStore().undoSnapshots?.[token];
      if (!entry || entry.expires < Date.now()) return null;
      return entry.snapshots;
    },
    deleteUndoSnapshot(token) {
      const s = readStore();
      if (s.undoSnapshots?.[token]) {
        delete s.undoSnapshots[token];
        writeStore(s);
      }
    },

    // ── P2-B: Proactive Messages (persisted) ───────────────────────────────
    async countProactiveToday(userId) {
      const s = readStore();
      const today = new Date().toISOString().slice(0, 10);
      return (s.proactiveMessages || []).filter(m =>
        m.userId === userId && (m.created_at || '').startsWith(today)
      ).length;
    },

    async createProactiveMessage({ userId, type, title, body, payload }) {
      const s = readStore();
      if (!Array.isArray(s.proactiveMessages)) s.proactiveMessages = [];
      const msg = {
        id:            `pm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userId,
        type:          type || 'generic',
        title:         String(title || '').slice(0, 100),
        body:          String(body  || '').slice(0, 500),
        payload:       payload || {},
        feedback:      null,
        snoozed_until: null,
        created_at:    new Date().toISOString(),
      };
      s.proactiveMessages.push(msg);
      writeStore(s);
      return { ...msg };
    },

    listProactiveMessages(userId, { unreadOnly = true } = {}) {
      const s = readStore();
      const now = new Date();
      return (s.proactiveMessages || []).filter(m => {
        if (m.userId !== userId) return false;
        if (unreadOnly && m.feedback) return false;
        if (m.snoozed_until && new Date(m.snoozed_until) > now) return false;
        return true;
      }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .map(m => ({ ...m }));
    },

    updateProactiveMessage(userId, msgId, { feedback, snoozed_until }) {
      const s = readStore();
      const msg = (s.proactiveMessages || []).find(m => m.id === msgId && m.userId === userId);
      if (!msg) return null;
      if (feedback      !== undefined) msg.feedback      = feedback;
      if (snoozed_until !== undefined) msg.snoozed_until = snoozed_until;
      writeStore(s);
      return { ...msg };
    },

    // ── P2-B: Procedural Rules ─────────────────────────────────────────────
    async listProceduralRules(userId) {
      const s = readStore();
      return (s.proceduralRules || []).filter(r => r.userId === userId).map(r => ({ ...r }));
    },

    async createProceduralRule({ userId, rule_type, description, context, evidence_count, active }) {
      const s = readStore();
      if (!Array.isArray(s.proceduralRules)) s.proceduralRules = [];
      const rule = {
        id:             `pr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userId,
        rule_type:      rule_type || 'suppress_care',
        description:    String(description || '').slice(0, 200),
        context:        context || {},
        evidence_count: evidence_count ?? 1,
        active:         active ?? true,
        created_at:     new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      };
      s.proceduralRules.push(rule);
      writeStore(s);
      return { ...rule };
    },

    async updateProceduralRule(ruleId, { evidence_count, active }) {
      const s = readStore();
      const rule = (s.proceduralRules || []).find(r => r.id === ruleId);
      if (!rule) return null;
      if (evidence_count !== undefined) rule.evidence_count = evidence_count;
      if (active         !== undefined) rule.active         = active;
      rule.updated_at = new Date().toISOString();
      writeStore(s);
      return { ...rule };
    },

    // ── P2-B: helpers for Stuck/Care/Daily-Planner context ────────────────
    listCheckIns(userId, { days = 3, since } = {}) {
      const s = readStore();
      const cutoff = since
        ? new Date(since).getTime()
        : Date.now() - days * 86400000;
      return (s.checkIns || []).filter(c =>
        c.user_id === userId &&
        new Date(c.created_at || 0).getTime() >= cutoff
      ).map(c => ({ ...c }));
    },

    listRecentMemories(userId, { days = 7 } = {}) {
      const s = readStore();
      const cutoff = Date.now() - days * 86400000;
      return (s.memoryItems || []).filter(m =>
        m.user_id === userId &&
        new Date(m.created_at || 0).getTime() >= cutoff
      ).map(m => ({ ...m }));
    },

    listAllUsers() {
      const s = readStore();
      return (s.users || []).slice();
    },

    // ── Digital Persona (对外可发布的数字人) ──────────────────────────────
    // One persona row per user. Defaults are materialised lazily on first read
    // so the owner studio always has something to edit.
    getDigitalPersonaByUser(userId) {
      const s = readStore();
      let p = (s.digitalPersonas || []).find((x) => x.user_id === userId);
      if (!p) {
        const user = s.users.find((u) => u.id === userId);
        p = {
          id: randomId(),
          user_id: userId,
          slug: null,
          published: false,
          setup_completed: false,
          display_name: '',
          tagline: '',
          greeting: '你好！我是这位用户的智能助理，有什么可以帮你了解的吗？',
          avatar_kind: 'preset',
          avatar_url: null,
          preset_id: 'default',
          persona_mode: 'ABOUT',
          suggested_questions: [],
          share_scope: { fields: [], topics: [] },
          theme: 'emerald',
          access_mode: 'public',
          passcode: '',
          view_count: 0,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        if (!Array.isArray(s.digitalPersonas)) s.digitalPersonas = [];
        s.digitalPersonas.push(p);
        // Seed display_name from the user's email local-part as a friendly default.
        if (user?.email) p.display_name = user.email.split('@')[0];
        writeStore(s);
      }
      // One-time compatibility migration for personas created before the
      // explicit onboarding state existed. After this write, clients never
      // need to infer setup state from profile fields again.
      if (typeof p.setup_completed !== 'boolean') {
        p.setup_completed = Boolean(
          p.published || p.tagline || p.suggested_questions?.length ||
          p.share_scope?.fields?.length || p.share_scope?.topics?.length
        );
        writeStore(s);
      }
      return p;
    },
    getDigitalPersonaBySlug(slug) {
      if (!slug) return null;
      const s = readStore();
      return (s.digitalPersonas || []).find((x) => x.slug === slug && x.published) || null;
    },
    upsertDigitalPersona(userId, patch = {}) {
      const s = readStore();
      if (!Array.isArray(s.digitalPersonas)) s.digitalPersonas = [];
      let p = s.digitalPersonas.find((x) => x.user_id === userId);
      if (!p) {
        p = {
          id: randomId(),
          user_id: userId,
          slug: null,
          published: false,
          setup_completed: false,
          display_name: '',
          tagline: '',
          greeting: '',
          avatar_kind: 'preset',
          avatar_url: null,
          preset_id: 'default',
          persona_mode: 'ABOUT',
          suggested_questions: [],
          share_scope: { fields: [], topics: [] },
          theme: 'emerald',
          access_mode: 'public',
          passcode: '',
          view_count: 0,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        s.digitalPersonas.push(p);
      }
      // Whitelist editable fields — never let a client overwrite id/user_id/slug/published/view_count here.
      const EDITABLE = [
        'display_name', 'tagline', 'greeting', 'avatar_kind', 'avatar_url',
        'preset_id', 'suggested_questions', 'share_scope', 'theme',
        'access_mode', 'passcode',
      ];
      for (const key of EDITABLE) {
        if (key in patch) p[key] = patch[key];
      }
      // A successful owner-side config save completes first-use setup.
      if (EDITABLE.some((key) => key in patch)) p.setup_completed = true;
      // persona_mode is fixed to ABOUT in v1.
      p.persona_mode = 'ABOUT';
      p.updated_at = nowIso();
      writeStore(s);
      return p;
    },
    /**
     * Toggle publish state. On first publish, mint a unique slug derived from
     * display_name + a short random suffix. Unpublish keeps the slug row but
     * flips `published` so getDigitalPersonaBySlug returns null (link revoked).
     */
    setPersonaPublished(userId, published) {
      const s = readStore();
      if (!Array.isArray(s.digitalPersonas)) s.digitalPersonas = [];
      const p = s.digitalPersonas.find((x) => x.user_id === userId);
      if (!p) return null;
      if (published && !p.slug) {
        p.slug = makeUniqueSlug(s.digitalPersonas, p.display_name || 'persona');
      }
      p.published = !!published;
      p.updated_at = nowIso();
      writeStore(s);
      return p;
    },
    incPersonaView(slug) {
      const s = readStore();
      const p = (s.digitalPersonas || []).find((x) => x.slug === slug);
      if (!p) return;
      p.view_count = (p.view_count || 0) + 1;
      writeStore(s);
    },

    // ── Entities (图鉴：与用户有关的人/物/地/事实体卡) ────────────────────
    // The stable "anchor layer" of memory: people, pets, objects, places,
    // events and organizations that episodes keep referring to. Persons
    // subsume the legacy relationships collection (lazily migrated with the
    // SAME ids by _ensureEntities) and carry the persona fields (role/trust/
    // invite_token/…) so the digital-persona flows keep working unchanged.
    listEntities(userId, { type } = {}) {
      const s = readStore();
      if (_ensureEntities(s)) writeStore(s);
      return s.entities
        .filter((e) => e.user_id === userId && (!type || e.entity_type === type))
        .map(_normalizeEntity);
    },
    getEntity(userId, id) {
      const s = readStore();
      if (_ensureEntities(s)) writeStore(s);
      return _normalizeEntity(s.entities.find((e) => e.user_id === userId && e.id === id) || null);
    },
    upsertEntity(userId, patch = {}) {
      const s = readStore();
      _ensureEntities(s);
      let e = patch.id ? s.entities.find((x) => x.user_id === userId && x.id === patch.id) : null;
      if (!e) {
        e = {
          id: randomId(),
          user_id: userId,
          entity_type: 'other',
          name: '',
          aliases: [],
          emoji: '',
          image_url: null,
          relation: '',
          facts: [],
          note: '',
          dimensions: [],
          tags: [],
          ai_excluded: false,
          avatar_visible: false,
          source: 'manual',
          role: '',
          trust: 'med',
          invite_token: null,
          contributed_by: null,
          interaction_count: 0,
          last_interaction: null,
          ai_summary: '',
          ai_summary_meta: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        s.entities.push(e);
      }
      const EDITABLE = [
        'entity_type', 'name', 'aliases', 'emoji', 'image_url', 'relation',
        'facts', 'note', 'dimensions', 'tags', 'ai_excluded', 'avatar_visible',
        'source', 'role', 'trust', 'contributed_by',
      ];
      for (const key of EDITABLE) if (key in patch) e[key] = patch[key];
      if (!ENTITY_TYPES.has(e.entity_type)) e.entity_type = 'other';
      e.facts = _sanitizeFacts(e.facts);
      e.dimensions = (Array.isArray(e.dimensions) ? e.dimensions : [])
        .filter((d) => LIFE_DIMENSIONS.includes(d));
      e.ai_excluded = e.ai_excluded === true;
      e.avatar_visible = e.avatar_visible === true;
      // Persons: keep codex-facing `relation` and persona-facing `role`
      // mirrored so buildVisitorBlock works whichever side edits.
      if (e.entity_type === 'person') {
        if ('relation' in patch && !('role' in patch)) e.role = e.relation;
        else if ('role' in patch && !('relation' in patch)) e.relation = e.role;
      }
      e.updated_at = nowIso();
      writeStore(s);
      return _normalizeEntity(e);
    },
    /**
     * 写卡面 AI 总结（entity-summary.service 专用）。系统字段：刻意不动
     * updated_at —— 总结生成不该看起来像一次用户编辑。
     */
    setEntityAiSummary(userId, id, summary, meta = null) {
      const s = readStore();
      _ensureEntities(s);
      const e = s.entities.find((x) => x.user_id === userId && x.id === id);
      if (!e) return null;
      e.ai_summary = typeof summary === 'string' ? summary : '';
      e.ai_summary_meta = meta && typeof meta === 'object' ? meta : null;
      writeStore(s);
      return _normalizeEntity(e);
    },
    deleteEntity(userId, id) {
      const s = readStore();
      _ensureEntities(s);
      const before = s.entities.length;
      s.entities = s.entities.filter((e) => !(e.user_id === userId && e.id === id));
      // Drop the legacy relationships twin too so a deleted card can't linger.
      s.relationships = (s.relationships || []).filter((r) => !(r.user_id === userId && r.id === id));
      writeStore(s);
      return s.entities.length < before;
    },
    /**
     * Set/replace one fact on a card. v = null/'' removes the key (undo of an
     * append). Returns { entity, prev } so callers can build an undo payload.
     */
    upsertEntityFact(userId, id, { k, v } = {}) {
      const key = String(k || '').trim();
      if (!key) return null;
      const s = readStore();
      _ensureEntities(s);
      const e = s.entities.find((x) => x.user_id === userId && x.id === id);
      if (!e) return null;
      _normalizeEntity(e);
      const idx = e.facts.findIndex((f) => f.k === key);
      const prev = idx >= 0 ? e.facts[idx].v : null;
      const val = v === null || v === undefined ? '' : String(v).trim();
      if (!val) {
        if (idx >= 0) e.facts.splice(idx, 1);
      } else if (idx >= 0) {
        e.facts[idx] = { k: key, v: val };
      } else {
        if (e.facts.length >= ENTITY_MAX_FACTS) return null;
        e.facts.push({ k: key, v: val });
      }
      e.updated_at = nowIso();
      writeStore(s);
      return { entity: _normalizeEntity(e), prev };
    },
    /**
     * 实体合并（IA v2 批次3）：source 卡并入 target 卡——aliases 并集（含
     * source 名字）、facts 缺键补齐（同键保留 target 的）、维度并集、
     * interaction_count 相加、备注拼接，然后删除 source 卡；顺手把待确认
     * 队列里指向 source 的候选改指 target（避免收下后又建回重复卡）。
     * episodes 的 entity_ids 回链由调用方经 MemoryFileService 重写。
     */
    mergeEntities(userId, sourceId, targetId) {
      if (!sourceId || !targetId || sourceId === targetId) return null;
      const s = readStore();
      _ensureEntities(s);
      const src = s.entities.find((x) => x.user_id === userId && x.id === sourceId);
      const dst = s.entities.find((x) => x.user_id === userId && x.id === targetId);
      if (!src || !dst) return null;
      _normalizeEntity(src);
      _normalizeEntity(dst);

      const aliasSet = new Set([...(dst.aliases || []), ...(src.aliases || [])]);
      if (src.name && src.name !== dst.name) aliasSet.add(src.name);
      dst.aliases = [...aliasSet].filter(Boolean).slice(0, 12);

      const dstKeys = new Set(dst.facts.map((f) => f.k));
      for (const f of src.facts) {
        if (dst.facts.length >= ENTITY_MAX_FACTS) break;
        if (!dstKeys.has(f.k)) { dst.facts.push({ k: f.k, v: f.v }); dstKeys.add(f.k); }
      }

      dst.dimensions = [...new Set([...(dst.dimensions || []), ...(src.dimensions || [])])]
        .filter((d) => LIFE_DIMENSIONS.includes(d));
      dst.interaction_count = (dst.interaction_count || 0) + (src.interaction_count || 0);
      if ((src.last_interaction || '') > (dst.last_interaction || '')) dst.last_interaction = src.last_interaction;
      if (src.note && src.note !== dst.note) {
        dst.note = dst.note ? `${dst.note}\n${src.note}` : src.note;
      }
      // 合并改变了总结素材：清 source_hash 置脏，调用方触发重生成
      if (dst.ai_summary_meta) dst.ai_summary_meta = { ...dst.ai_summary_meta, source_hash: '' };
      dst.updated_at = nowIso();

      // 待确认候选回链：entity_fact/entity_suggest 指向 source 的改指 target
      for (const c of s.pendingCaptures || []) {
        if (c.user_id === userId && c.payload?.entity_id === sourceId) c.payload.entity_id = targetId;
      }

      s.entities = s.entities.filter((e) => !(e.user_id === userId && e.id === sourceId));
      s.relationships = (s.relationships || []).filter((r) => !(r.user_id === userId && r.id === sourceId));
      writeStore(s);
      return _normalizeEntity(dst);
    },
    /** Fuzzy match a name to a card (exact → alias → contains), optionally by type. */
    matchEntityByName(userId, name, { type } = {}) {
      const q = String(name || '').toLowerCase().trim();
      if (!q) return null;
      const list = this.listEntities(userId, { type });
      const norm = (v) => String(v || '').toLowerCase().trim();
      let hit = list.find((e) => norm(e.name) === q || (e.aliases || []).some((a) => norm(a) === q));
      if (hit) return hit;
      hit = list.find((e) => {
        const n = norm(e.name);
        if (n && (n.includes(q) || q.includes(n))) return true;
        return (e.aliases || []).some((a) => { const an = norm(a); return an && (an.includes(q) || q.includes(an)); });
      });
      return hit || null;
    },
    touchEntity(userId, id, ts = nowIso()) {
      const s = readStore();
      _ensureEntities(s);
      const e = s.entities.find((x) => x.user_id === userId && x.id === id);
      if (!e) return null;
      e.last_interaction = ts;
      e.interaction_count = (e.interaction_count || 0) + 1;
      writeStore(s);
      return e;
    },

    // ── Relationships（人脉 → 图鉴 person 卡的兼容层）─────────────────────
    // Legacy surface kept for the mobile app (/v1/me/relationships), the
    // persona studio components and the public identify/invite flows. All
    // methods delegate to person entities; returned rows are a superset of
    // the old relationship shape (role/trust/invite_token/… preserved).
    listRelationships(userId) {
      return this.listEntities(userId, { type: 'person' });
    },
    getRelationship(userId, id) {
      const e = this.getEntity(userId, id);
      return e && e.entity_type === 'person' ? e : null;
    },
    getRelationshipByInviteToken(token) {
      if (!token) return null;
      const s = readStore();
      if (_ensureEntities(s)) writeStore(s);
      return s.entities.find((e) => e.entity_type === 'person' && e.invite_token === token) || null;
    },
    upsertRelationship(userId, patch = {}) {
      return this.upsertEntity(userId, { ...patch, entity_type: 'person' });
    },
    deleteRelationship(userId, id) {
      return this.deleteEntity(userId, id);
    },
    /** Fuzzy match a declared name to a known person card (exact → alias → contains). */
    matchRelationshipByName(userId, name) {
      return this.matchEntityByName(userId, name, { type: 'person' });
    },
    generateInviteToken(userId, id) {
      const s = readStore();
      _ensureEntities(s);
      const e = s.entities.find((x) => x.user_id === userId && x.id === id && x.entity_type === 'person');
      if (!e) return null;
      e.invite_token = randomId();
      e.updated_at = nowIso();
      writeStore(s);
      return _normalizeEntity(e);
    },
    touchRelationship(userId, id, ts = nowIso()) {
      return this.touchEntity(userId, id, ts);
    },
    /** One-time seed from PCP relationship_map / key_relationships. Skips names that already exist. */
    seedRelationshipsFromPcp(userId, entries = []) {
      if (!Array.isArray(entries) || entries.length === 0) return 0;
      const s = readStore();
      const migrated = _ensureEntities(s);
      const existing = new Set(
        s.entities
          .filter((e) => e.user_id === userId && e.entity_type === 'person')
          .map((e) => String(e.name || '').toLowerCase().trim())
      );
      let added = 0;
      for (const entry of entries) {
        const name = String(entry?.name || '').trim();
        if (!name || existing.has(name.toLowerCase())) continue;
        s.entities.push({
          id: randomId(),
          user_id: userId,
          entity_type: 'person',
          name,
          aliases: [],
          emoji: '',
          image_url: null,
          relation: entry.role || '',
          facts: [],
          note: '',
          dimensions: [],
          tags: [],
          ai_excluded: false,
          avatar_visible: false,
          source: 'pcp',
          role: entry.role || '',
          trust: entry.trust || 'med',
          invite_token: null,
          contributed_by: null,
          interaction_count: 0,
          last_interaction: entry.last_interaction || null,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        existing.add(name.toLowerCase());
        added += 1;
      }
      if (added || migrated) writeStore(s);
      return added;
    },

    // ── Visitor Sessions (对外互动留痕) ───────────────────────────────────
    createVisitorSession({ userId, persona_slug, visitor = {} }) {
      const s = readStore();
      if (!Array.isArray(s.visitorSessions)) s.visitorSessions = [];
      const session = {
        id: randomId(),
        user_id: userId,
        persona_slug,
        session_token: randomId(),
        visitor: {
          declared_name: visitor.declared_name || null,
          relationship_id: visitor.relationship_id || null,
          matched: !!visitor.matched,
          via: visitor.via || 'anonymous',
        },
        transcript: [],
        summary: null,
        finalized: false,
        created_at: nowIso(),
        last_active_at: nowIso(),
      };
      s.visitorSessions.push(session);
      writeStore(s);
      return session;
    },
    getVisitorSessionByToken(token) {
      if (!token) return null;
      const s = readStore();
      return (s.visitorSessions || []).find((x) => x.session_token === token) || null;
    },
    appendVisitorTurn(token, turn) {
      const s = readStore();
      const sess = (s.visitorSessions || []).find((x) => x.session_token === token);
      if (!sess) return null;
      sess.transcript.push({ role: turn.role, content: turn.content, ts: nowIso() });
      sess.last_active_at = nowIso();
      writeStore(s);
      return sess;
    },
    bindVisitorIdentity(token, { declared_name, relationship_id, matched, via }) {
      const s = readStore();
      const sess = (s.visitorSessions || []).find((x) => x.session_token === token);
      if (!sess) return null;
      if (declared_name !== undefined) sess.visitor.declared_name = declared_name;
      if (relationship_id !== undefined) sess.visitor.relationship_id = relationship_id;
      if (matched !== undefined) sess.visitor.matched = matched;
      if (via !== undefined) sess.visitor.via = via;
      sess.last_active_at = nowIso();
      writeStore(s);
      return sess;
    },
    finalizeVisitorSession(token, summary = null) {
      const s = readStore();
      const sess = (s.visitorSessions || []).find((x) => x.session_token === token);
      if (!sess || sess.finalized) return null;
      sess.finalized = true;
      if (summary) sess.summary = summary;
      writeStore(s);
      return sess;
    },
    listVisitorSessions(userId, opts = {}) {
      const { q, limit = 20, offset = 0, minMessages = 1, since, until } = opts;
      const s = readStore();
      let list = (s.visitorSessions || [])
        .filter((x) => x.user_id === userId)
        .sort((a, b) => new Date(b.last_active_at) - new Date(a.last_active_at));

      if (minMessages > 0) {
        list = list.filter((sess) => (sess.transcript || []).length >= minMessages);
      }

      if (since) {
        const sinceMs = new Date(since).getTime();
        if (!Number.isNaN(sinceMs)) {
          list = list.filter((sess) => new Date(sess.last_active_at).getTime() >= sinceMs);
        }
      }
      if (until) {
        const untilMs = new Date(until).getTime();
        if (!Number.isNaN(untilMs)) {
          list = list.filter((sess) => new Date(sess.last_active_at).getTime() <= untilMs);
        }
      }

      const needle = (q || '').trim().toLowerCase();
      if (needle) {
        list = list.filter((sess) => {
          const name = (sess.visitor?.declared_name || '').toLowerCase();
          const summary = (sess.summary || '').toLowerCase();
          if (name.includes(needle) || summary.includes(needle)) return true;
          return (sess.transcript || []).some((t) => (t.content || '').toLowerCase().includes(needle));
        });
      }

      const total = list.length;
      const items = list.slice(offset, offset + limit);
      return { items, total };
    },
    /**
     * Aggregate stats for the owner insights panel. All metrics are derived
     * from data already on hand (persona view_count + visitorSessions +
     * interactionInbox) — no extra tracking. "Top questions" is the histogram
     * of each session's first visitor message (the opening question).
     */
    getPersonaStats(userId) {
      const s = readStore();
      const persona = (s.digitalPersonas || []).find((x) => x.user_id === userId);
      const sessions = (s.visitorSessions || []).filter((x) => x.user_id === userId);
      const inbox = (s.interactionInbox || []).filter((x) => x.user_id === userId);

      let matched = 0;
      let anonymous = 0;
      let totalMessages = 0;
      const questionCounts = new Map();
      for (const sess of sessions) {
        if (sess.visitor?.matched) matched += 1; else anonymous += 1;
        const turns = sess.transcript || [];
        totalMessages += turns.filter((t) => t.role === 'user').length;
        const firstUser = turns.find((t) => t.role === 'user');
        const q = (firstUser?.content || '').trim().slice(0, 80);
        if (q) questionCounts.set(q, (questionCounts.get(q) || 0) + 1);
      }

      const inboxByStatus = { pending: 0, approved: 0, rejected: 0 };
      for (const it of inbox) {
        if (it.status in inboxByStatus) inboxByStatus[it.status] += 1;
      }

      const topQuestions = [...questionCounts.entries()]
        .map(([q, count]) => ({ q, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const total = sessions.length;
      return {
        view_count: persona?.view_count || 0,
        sessions: { total, matched, anonymous },
        inbox: inboxByStatus,
        messages: {
          total: totalMessages,
          avg_per_session: total ? Math.round((totalMessages / total) * 10) / 10 : 0,
        },
        top_questions: topQuestions,
      };
    },

    // ── Interaction Inbox (待审收件箱) ────────────────────────────────────
    createInboxItems(userId, items = []) {
      if (!Array.isArray(items) || items.length === 0) return [];
      const s = readStore();
      if (!Array.isArray(s.interactionInbox)) s.interactionInbox = [];
      const created = items.map((it) => ({
        id: randomId(),
        user_id: userId,
        session_id: it.session_id || null,
        source_relationship_id: it.source_relationship_id || null,
        source_label: it.source_label || '',
        kind: it.kind || 'memory',
        payload: it.payload || {},
        confidence: typeof it.confidence === 'number' ? it.confidence : 0.5,
        status: 'pending',
        created_at: nowIso(),
        decided_at: null,
      }));
      s.interactionInbox.push(...created);
      writeStore(s);
      return created;
    },
    listInbox(userId, { status } = {}) {
      const s = readStore();
      return (s.interactionInbox || [])
        .filter((x) => x.user_id === userId && (!status || x.status === status))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },
    getInboxItem(userId, id) {
      const s = readStore();
      return (s.interactionInbox || []).find((x) => x.user_id === userId && x.id === id) || null;
    },
    decideInboxItem(userId, id, decision) {
      const s = readStore();
      const item = (s.interactionInbox || []).find((x) => x.user_id === userId && x.id === id);
      if (!item || item.status !== 'pending') return null;
      item.status = decision === 'approved' ? 'approved' : 'rejected';
      item.decided_at = nowIso();
      writeStore(s);
      return item;
    },

    // ── Proactive Captures (对话主动捕获的记忆/待办候选) ─────────────────
    // Lifecycle: pending → confirmed | rejected     (medium-importance items)
    //            saved   → undone                  (auto-saved high-importance items)
    createCapture(userId, {
      kind = 'memory', status = 'pending', payload = {},
      confidence = 0.5, importance = 'normal', slot_id = null,
      episode_id = null, memory_item_id = null, task_id = null,
      conversation_id = null, source = 'auto_extract', source_id = null,
    } = {}) {
      const s = readStore();
      if (!Array.isArray(s.pendingCaptures)) s.pendingCaptures = [];
      // Defense-in-depth dedup: callers should pre-check via findDuplicateCapture,
      // but guard here too so no path can write a duplicate candidate.
      const dup = _findDuplicateCapture(s, userId, { kind, payload });
      if (dup) return dup;
      const capture = {
        id: randomId(),
        user_id: userId,
        kind,            // 'memory' | 'task'
        status,          // 'pending' | 'saved' | 'confirmed' | 'rejected' | 'undone'
        payload,         // { type, content, title, due_date, tags, reminder_date }
        confidence,
        importance,      // 'core' | 'high' | 'normal'
        slot_id,
        episode_id,
        memory_item_id,
        task_id,
        conversation_id,
        source,
        source_id,       // 来源中心：所属 Source（记忆导入候选），null=对话捕捉
        created_at: nowIso(),
        decided_at: null,
      };
      s.pendingCaptures.push(capture);
      writeStore(s);
      return capture;
    },
    findDuplicateCapture(userId, opts = {}) {
      return _findDuplicateCapture(readStore(), userId, opts);
    },
    listCaptures(userId, { status, kind, sourceId, limit = 50, maxAgeDays = 14 } = {}) {
      const s = readStore();
      // Opportunistic GC: long-pending candidates the user never decided on
      // get expired so the context panel doesn't accumulate forever.
      if (_expireStaleCaptures(s, userId, maxAgeDays)) writeStore(s);
      return (s.pendingCaptures || [])
        .filter((x) => x.user_id === userId
          && (!status || x.status === status)
          && (!kind || x.kind === kind)
          && (!sourceId || x.source_id === sourceId))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
    },
    getCapture(userId, id) {
      const s = readStore();
      return (s.pendingCaptures || []).find((x) => x.user_id === userId && x.id === id) || null;
    },
    /**
     * 来源导入候选的兜底过期（janitor 每日跑，全用户）：导入候选豁免了 14 天
     * 机会式过期（见 _expireStaleCaptures），用 90 天这条防 pendingCaptures 无限膨胀。
     */
    expireImportCaptures(days = 90) {
      const s = readStore();
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      let changed = 0;
      for (const c of s.pendingCaptures || []) {
        if (c.source_id && c.status === 'pending'
          && new Date(c.created_at || 0).getTime() < cutoff) {
          c.status = 'expired';
          c.decided_at = nowIso();
          changed += 1;
        }
      }
      if (changed > 0) writeStore(s);
      return changed;
    },
    /** 删除某来源的未决候选（删除来源时调用）。已确认/已拒绝的保留作历史。 */
    deleteCapturesBySource(userId, sourceId) {
      if (!sourceId) return 0;
      const s = readStore();
      const before = (s.pendingCaptures || []).length;
      s.pendingCaptures = (s.pendingCaptures || []).filter(
        (x) => !(x.user_id === userId && x.source_id === sourceId && x.status === 'pending'),
      );
      const removed = before - s.pendingCaptures.length;
      if (removed > 0) writeStore(s);
      return removed;
    },
    updateCapture(userId, id, patch = {}) {
      const s = readStore();
      const capture = (s.pendingCaptures || []).find((x) => x.user_id === userId && x.id === id);
      if (!capture) return null;
      const EDITABLE = ['status', 'payload', 'episode_id', 'memory_item_id', 'task_id', 'decided_at'];
      for (const key of EDITABLE) if (key in patch) capture[key] = patch[key];
      writeStore(s);
      return capture;
    },

    /** Patch a single legacy memory item in place (route layer whitelists `patch`). */
    updateMemoryItem(userId, id, patch = {}) {
      const s = readStore();
      const item = (s.memoryItems || []).find((m) => m.user_id === userId && m.id === id);
      if (!item) return null;
      Object.assign(item, patch);
      writeStore(s);
      return item;
    },

    /** Hard-delete a single legacy memory item (undo of an auto-capture). */
    deleteMemoryItem(userId, id) {
      const s = readStore();
      const before = (s.memoryItems || []).length;
      s.memoryItems = (s.memoryItems || []).filter((m) => !(m.user_id === userId && m.id === id));
      const removed = s.memoryItems.length < before;
      if (removed) writeStore(s);
      return removed;
    },

    /** Hard-delete a single task (undo of a confirmed todo capture). */
    deleteTask(userId, id) {
      const s = readStore();
      const before = (s.tasks || []).length;
      s.tasks = (s.tasks || []).filter((t) => !(t.user_id === userId && t.id === id));
      const removed = s.tasks.length < before;
      if (removed) writeStore(s);
      return removed;
    },

    // ── Account wipe (硬删除：清空该用户的全部云端数据) ──────────────────────
    // Hard-deletes every user-scoped row across store.json. The on-disk PCP
    // memory dir (data/memories/{userId}) is purged separately by
    // MemoryFileService.wipeUserMemory(). Idempotent. Returns per-collection
    // removed counts. No soft-delete / no backup retention — by product
    // decision for the internal beta, deletion is immediate and irreversible.
    wipeUser(userId) {
      // Collection → the field that holds the owning user id. Most use
      // `user_id`; proactiveMessages/proceduralRules use `userId`.
      const SCOPED = {
        memoryItems: 'user_id', goals: 'user_id', tasks: 'user_id',
        adjustments: 'user_id', ifThenCards: 'user_id', obstacleEvents: 'user_id',
        ecsHistory: 'user_id', reflections: 'user_id', reviews: 'user_id',
        settings: 'user_id', conversations: 'user_id', conversationMessages: 'user_id',
        proactiveMessages: 'userId', proceduralRules: 'userId', checkIns: 'user_id',
        digitalPersonas: 'user_id', relationships: 'user_id', entities: 'user_id',
        visitorSessions: 'user_id',
        interactionInbox: 'user_id', pendingCaptures: 'user_id',
        billing_customers: 'user_id', usage_events: 'user_id', auth_identities: 'user_id',
        companionBriefs: 'user_id', mcpServers: 'user_id', importJobs: 'user_id',
      };
      const s = readStore();
      const removed = {};
      for (const [coll, key] of Object.entries(SCOPED)) {
        if (!Array.isArray(s[coll])) continue;
        const before = s[coll].length;
        s[coll] = s[coll].filter((row) => row[key] !== userId);
        removed[coll] = before - s[coll].length;
      }
      // simPacks are keyed by email until claimed; only claimed rows carry the
      // account id (claimed_by). Unclaimed rows stay with the email owner and
      // expire via the 90-day lazy cleanup in addSimPack().
      if (Array.isArray(s.simPacks)) {
        const before = s.simPacks.length;
        s.simPacks = s.simPacks.filter((p) => p.claimed_by !== userId);
        removed.simPacks = before - s.simPacks.length;
      }
      // Remove the user record itself last.
      if (Array.isArray(s.users)) {
        const before = s.users.length;
        s.users = s.users.filter((u) => u.id !== userId);
        removed.users = before - s.users.length;
      }
      writeStore(s);
      // In-memory, per-process caches keyed by user.
      if (this._personaModes) delete this._personaModes[userId];
      return removed;
    },

    // ── P3-C: Persona mode per user ───────────────────────────────────────
    getUserPersonaMode(userId) {
      return this._personaModes?.[userId] || 'FOR';
    },

    setUserPersonaMode(userId, mode) {
      if (!this._personaModes) this._personaModes = {};
      this._personaModes[userId] = mode;
    },

    // ── Billing customers (Stripe mirror) ───────────────────────────────────
    getBillingCustomer(userId) {
      const s = readStore();
      return (s.billing_customers || []).find((b) => b.user_id === userId) || null;
    },

    /** Reverse lookup for Stripe invoice.* webhooks (payload carries only customerId). */
    getUserByStripeCustomerId(customerId) {
      if (!customerId) return null;
      const s = readStore();
      const bc = (s.billing_customers || []).find((b) => b.stripe_customer_id === customerId);
      if (!bc) return null;
      return (s.users || []).find((u) => u.id === bc.user_id) || null;
    },

    upsertBillingCustomer(data) {
      const s = readStore();
      if (!Array.isArray(s.billing_customers)) s.billing_customers = [];
      const idx = s.billing_customers.findIndex((b) => b.user_id === data.user_id);
      const prev = idx >= 0 ? s.billing_customers[idx] : null;
      const row = {
        user_id: data.user_id,
        stripe_customer_id: data.stripe_customer_id ?? prev?.stripe_customer_id ?? null,
        stripe_subscription_id: data.stripe_subscription_id ?? prev?.stripe_subscription_id ?? null,
        // 订阅来源渠道:stripe | app_store | play_store | promo(RevenueCat 汇入后按 store 字段写)
        provider: data.provider ?? prev?.provider ?? 'stripe',
        tier: data.tier || 'free',
        interval: data.interval || null,
        status: data.status || null,
        current_period_end: data.current_period_end ?? null,
        cancel_at_period_end: data.cancel_at_period_end ?? false,
        updated_at: nowIso(),
      };
      if (idx >= 0) s.billing_customers[idx] = { ...s.billing_customers[idx], ...row };
      else s.billing_customers.push(row);
      writeStore(s);
      return row;
    },

    // 运营后台聚合用：一次性读取全部 billing_customers（避免逐用户多次读盘）。
    listBillingCustomers() {
      const s = readStore();
      return (s.billing_customers || []).slice();
    },

    // ── Usage events ────────────────────────────────────────────────────────
    listUsageEvents(userId, { billingPeriod, limit = 10000 } = {}) {
      const s = readStore();
      let rows = (s.usage_events || []).filter((e) => e.user_id === userId);
      if (billingPeriod) rows = rows.filter((e) => e.billing_period === billingPeriod);
      return rows.slice(-limit);
    },

    // 运营后台聚合用：一次性读取某计费周期内的全部用量事件。
    listAllUsageEvents({ billingPeriod } = {}) {
      const s = readStore();
      let rows = (s.usage_events || []).slice();
      if (billingPeriod) rows = rows.filter((e) => e.billing_period === billingPeriod);
      return rows;
    },

    addUsageEvent(data) {
      const s = readStore();
      if (!Array.isArray(s.usage_events)) s.usage_events = [];
      const event = {
        id: randomId(),
        user_id: data.user_id,
        feature: data.feature,
        model: data.model || null,
        input_tokens: data.input_tokens || 0,
        output_tokens: data.output_tokens || 0,
        image_count: data.image_count || 0,
        estimated_cost_usd: data.estimated_cost_usd || 0,
        credits_deducted: data.credits_deducted || 0,
        visitor_credits_deducted: data.visitor_credits_deducted || 0,
        billing_period: data.billing_period,
        created_at: nowIso(),
      };
      s.usage_events.push(event);
      writeStore(s);
      return event;
    },

    // ── Auth identities (OAuth prep) ────────────────────────────────────────
    listAuthIdentities(userId) {
      const s = readStore();
      return (s.auth_identities || []).filter((a) => a.user_id === userId);
    },

    /** Resolve a social identity (provider + subject) back to its user, or null. */
    getUserByProviderSubject(provider, providerSubject) {
      const s = readStore();
      const row = (s.auth_identities || []).find(
        (a) => a.provider === provider && a.provider_subject === providerSubject
      );
      if (!row) return null;
      return s.users.find((u) => u.id === row.user_id) || null;
    },

    upsertAuthIdentity({ user_id, provider, provider_subject, email }) {
      const s = readStore();
      if (!Array.isArray(s.auth_identities)) s.auth_identities = [];
      const existing = s.auth_identities.find(
        (a) => a.provider === provider && a.provider_subject === provider_subject
      );
      if (existing) return existing;
      const row = {
        id: randomId(),
        user_id,
        provider,
        provider_subject,
        email: email || null,
        created_at: nowIso(),
      };
      s.auth_identities.push(row);
      writeStore(s);
      return row;
    },

    ensurePasswordIdentity(userId, email) {
      return this.upsertAuthIdentity({
        user_id: userId,
        provider: 'password',
        provider_subject: email,
        email,
      });
    },

    /** Remove a linked identity by id, scoped to its owning user. */
    deleteAuthIdentity(userId, identityId) {
      const s = readStore();
      if (!Array.isArray(s.auth_identities)) return { ok: false };
      const idx = s.auth_identities.findIndex(
        (a) => a.id === identityId && a.user_id === userId,
      );
      if (idx === -1) return { ok: false };
      const [removed] = s.auth_identities.splice(idx, 1);
      writeStore(s);
      return { ok: true, removed };
    },

    // ── 运营后台：管理员账号 ──────────────────────────────────────────────
    listAdminAccounts() {
      const s = readStore();
      return (s.admin_accounts || []).slice();
    },
    getAdminByUsername(username) {
      const s = readStore();
      const target = String(username || '').trim().toLowerCase();
      return (s.admin_accounts || []).find((a) => a.username === target) || null;
    },
    getAdminById(id) {
      const s = readStore();
      return (s.admin_accounts || []).find((a) => a.id === id) || null;
    },
    createAdminAccount({ username, password_hash, role = 'staff', allowed_ips = null }) {
      const s = readStore();
      if (!Array.isArray(s.admin_accounts)) s.admin_accounts = [];
      const row = {
        id: randomId(),
        username: String(username || '').trim().toLowerCase(),
        password_hash,
        role: role === 'super' ? 'super' : 'staff',
        allowed_ips: Array.isArray(allowed_ips) ? allowed_ips : null,
        disabled: false,
        created_at: nowIso(),
        last_login_at: null,
      };
      s.admin_accounts.push(row);
      writeStore(s);
      return row;
    },
    updateAdminAccount(id, patch = {}) {
      const s = readStore();
      const a = (s.admin_accounts || []).find((x) => x.id === id);
      if (!a) return null;
      const allowed = ['password_hash', 'role', 'allowed_ips', 'disabled', 'last_login_at'];
      for (const k of allowed) {
        if (k in patch) a[k] = patch[k];
      }
      writeStore(s);
      return a;
    },

    // ── 运营后台：审计日志 ────────────────────────────────────────────────
    addAdminAudit({ admin_id, admin_username, action, target_type, target_id, detail, ip }) {
      const s = readStore();
      if (!Array.isArray(s.admin_audit)) s.admin_audit = [];
      const row = {
        id: randomId(),
        admin_id: admin_id || null,
        admin_username: admin_username || null,
        action: action || null,
        target_type: target_type || null,
        target_id: target_id || null,
        detail: detail ?? null,
        ip: ip || null,
        created_at: nowIso(),
      };
      s.admin_audit.push(row);
      // 只保留最近 5000 条，避免文件无限膨胀
      if (s.admin_audit.length > 5000) s.admin_audit = s.admin_audit.slice(-5000);
      writeStore(s);
      return row;
    },
    listAdminAudit({ limit = 100, offset = 0 } = {}) {
      const s = readStore();
      const rows = (s.admin_audit || []).slice().reverse(); // 新→旧
      return { total: rows.length, items: rows.slice(offset, offset + limit) };
    },

    // ── 运营后台：全局 IP 白名单设置 ─────────────────────────────────────
    getAdminSettings() {
      const s = readStore();
      const cfg = s.admin_settings || {};
      return { global_ip_allowlist: Array.isArray(cfg.global_ip_allowlist) ? cfg.global_ip_allowlist : [] };
    },
    setGlobalIpAllowlist(list) {
      const s = readStore();
      if (!s.admin_settings || typeof s.admin_settings !== 'object' || Array.isArray(s.admin_settings)) {
        s.admin_settings = { global_ip_allowlist: [] };
      }
      s.admin_settings.global_ip_allowlist = Array.isArray(list) ? list.filter(Boolean) : [];
      writeStore(s);
      return s.admin_settings.global_ip_allowlist;
    },

    // ── 运营后台：用户检索（分页 + 邮箱/昵称模糊）────────────────────────
    listUsers({ q = '', limit = 50, offset = 0 } = {}) {
      const s = readStore();
      let rows = (s.users || []).slice();
      const query = String(q || '').trim().toLowerCase();
      if (query) {
        rows = rows.filter((u) =>
          String(u.email || '').toLowerCase().includes(query) ||
          String(u.display_name || '').toLowerCase().includes(query)
        );
      }
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // 新→旧
      const items = rows.slice(offset, offset + limit).map((u) => ({
        id: u.id,
        email: u.email,
        display_name: u.display_name ?? null,
        avatar_url: u.avatar_url ?? null,
        onboarding_step: u.onboarding_step ?? 0,
        created_at: u.created_at,
      }));
      return { total: rows.length, items };
    },
    getUserById(id) {
      const s = readStore();
      return (s.users || []).find((u) => u.id === id) || null;
    },

    // ── 运营后台：用量重置（删除某用户的 usage_events）──────────────────
    // billingPeriod 传 'YYYY-MM' 只删该月；不传则清空该用户全部用量记录。
    deleteUsageEvents(userId, billingPeriod) {
      const s = readStore();
      const before = (s.usage_events || []).length;
      s.usage_events = (s.usage_events || []).filter((e) => {
        if (e.user_id !== userId) return true;
        if (billingPeriod) return e.billing_period !== billingPeriod;
        return false;
      });
      const removed = before - s.usage_events.length;
      writeStore(s);
      return removed;
    },

    // ── 运营后台：线索（候补名单）状态更新 ───────────────────────────────
    updateWaitlistStatus(id, { status, note } = {}) {
      const s = readStore();
      const w = (s.waitlist || []).find((x) => x.id === id);
      if (!w) return null;
      if (status !== undefined) w.status = status;
      if (note !== undefined) w.note = note;
      w.updated_at = nowIso();
      writeStore(s);
      return w;
    },

    // ── 邀请码：动态发放，独立于静态 env INVITE_CODES ────────────────────
    listInviteCodes({ leadId, limit = 200, offset = 0 } = {}) {
      const s = readStore();
      let rows = (s.invite_codes || []).slice();
      if (leadId) rows = rows.filter((c) => c.lead_id === leadId);
      rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { total: rows.length, items: rows.slice(offset, offset + limit) };
    },
    getInviteCodeByCode(code) {
      const s = readStore();
      const target = String(code || '').trim().toUpperCase();
      return (s.invite_codes || []).find((c) => c.code === target) || null;
    },
    getInviteCodeById(id) {
      const s = readStore();
      return (s.invite_codes || []).find((c) => c.id === id) || null;
    },
    /** code 留空则自动生成（8 位十六进制，形如 A1B2-C3D4），保证唯一。 */
    createInviteCode({ code, created_by, note, lead_id, max_uses = 1, expires_at } = {}) {
      const s = readStore();
      if (!Array.isArray(s.invite_codes)) s.invite_codes = [];
      let value = code ? String(code).trim().toUpperCase() : null;
      if (!value) {
        do {
          const raw = randomId().replace(/-/g, '').toUpperCase().slice(0, 8);
          value = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
        } while (s.invite_codes.some((c) => c.code === value));
      } else if (s.invite_codes.some((c) => c.code === value)) {
        const err = new Error('code_exists');
        err.code = 'code_exists';
        throw err;
      }
      const row = {
        id: randomId(),
        code: value,
        created_by: created_by || null,
        note: note || null,
        lead_id: lead_id || null,
        max_uses: max_uses === null ? null : Number(max_uses) || 1,
        used_count: 0,
        expires_at: expires_at || null,
        disabled: false,
        created_at: nowIso(),
      };
      s.invite_codes.push(row);
      writeStore(s);
      return row;
    },
    updateInviteCode(id, patch = {}) {
      const s = readStore();
      const c = (s.invite_codes || []).find((x) => x.id === id);
      if (!c) return null;
      const allowed = ['note', 'max_uses', 'expires_at', 'disabled'];
      for (const k of allowed) {
        if (k in patch) c[k] = patch[k];
      }
      writeStore(s);
      return c;
    },
    /** 校验 + 原子消费一次邀请码。返回 { ok:true, row } 或 { ok:false, error }。 */
    redeemInviteCode(code) {
      const s = readStore();
      const target = String(code || '').trim().toUpperCase();
      const c = (s.invite_codes || []).find((x) => x.code === target);
      if (!c) return { ok: false, error: 'not_found' };
      if (c.disabled) return { ok: false, error: 'disabled' };
      if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { ok: false, error: 'expired' };
      if (c.max_uses !== null && c.used_count >= c.max_uses) return { ok: false, error: 'exhausted' };
      c.used_count += 1;
      writeStore(s);
      return { ok: true, row: c };
    },

    // ── 访问埋点：web + 平行人生专题页上报，仅存聚合分析所需字段 ──────────
    // P0 写放大修复：事件走 data/analytics/*.jsonl 追加（analytics-store.mjs），
    // 不再进 store.json——公开 beacon 端点从此不触发全库重写。保留 180 天。
    addAnalyticsEvent({ channel, page, visitor_id, referrer, locale }) {
      _ensureAnalyticsMigrated();
      const row = {
        id: randomId(),
        ts: nowIso(),
        channel: String(channel || 'web').slice(0, 32),
        page: String(page || '/').slice(0, 300),
        visitor_id: String(visitor_id || '').slice(0, 100),
        referrer: referrer ? String(referrer).slice(0, 300) : null,
        locale: locale ? String(locale).slice(0, 8) : null,
      };
      Analytics.appendAnalyticsEvent(row);
      return row;
    },
    listAnalyticsEventsSince(sinceIso) {
      _ensureAnalyticsMigrated();
      return Analytics.listAnalyticsEventsSince(sinceIso);
    },
  };
}






