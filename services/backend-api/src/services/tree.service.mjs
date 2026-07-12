/**
 * Tree Snapshot Service — augments the rule-based tree snapshot with an LLM-generated
 * narrative (roots / skills / branches / fruits summary).
 *
 * The LLM call is expensive so we keep an in-memory per-user cache keyed by
 * userId with a 24h TTL. If the LLM is unavailable or fails, we transparently
 * fall back to the existing rule-based snapshot.
 */

import { getLLMRouter } from '../llm/router.mjs';
import { Store } from '../lib/store.mjs';

const store = Store();
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // userId -> { generated_at, snapshot }

function ruleBasedSnapshot(userId) {
  return store.getTreeSnapshot(userId);
}

/**
 * Build a richer "tree" using the LLM: roots = root patterns / values,
 * branches = active goals as evolving capabilities, fruits = recent wins.
 * Caches result for TTL_MS.
 */
export async function getEnrichedTreeSnapshot(userId, { force = false } = {}) {
  const cached = cache.get(userId);
  if (!force && cached && Date.now() - cached.generated_at < TTL_MS) {
    return cached.snapshot;
  }

  const base = ruleBasedSnapshot(userId);
  const router = getLLMRouter();
  if (!router?.isAvailable()) {
    // No LLM — return the legacy snapshot unchanged.
    return { ...base, source: 'rules' };
  }

  // Gather raw inputs for the LLM. Keep it bounded so prompt cost stays small.
  const memories = store.searchMemory ? store.searchMemory(userId, '').slice(0, 30) : [];
  const goals = store.listGoals ? store.listGoals(userId) : [];
  const tasks = store.listTodayTasks ? store.listTodayTasks(userId) : [];
  const completedTasks = (tasks || []).filter(t => t.status === 'done');

  const prompt = [
    {
      role: 'system',
      content: `你是 GEDO.AI 的"生命之树"分析师。请基于用户最近的记忆、目标和完成情况，提炼出他/她的：\n` +
        `- roots：3-5 条 "根系"（价值观、长期偏好、自我认知；用一句话表达）\n` +
        `- branches：2-4 条 "枝干"（活跃目标方向，对应当前活跃 goals）\n` +
        `- fruits：3-5 条 "果实"（近期实际取得的成果、突破或重要事件）\n` +
        `- summary：80 字以内的本周/本月叙事总结。\n\n` +
        `输出严格的 JSON，结构：{ "roots": [{"label":"","content":""}], "branches":[{"title":"","description":""}], "fruits":[{"title":"","when":""}], "summary":"" }。不要 markdown 包裹。`,
    },
    {
      role: 'user',
      content: `用户最近记忆（${memories.length} 条）：\n` +
        memories.slice(0, 20).map(m => `- [${m.type}] ${m.content_raw?.slice(0, 120) || ''}`).join('\n') +
        `\n\n用户目标（${goals.length} 个，活跃 ${goals.filter(g => g.status === 'active').length}）：\n` +
        goals.slice(0, 10).map(g => `- [${g.status}] ${g.title}`).join('\n') +
        `\n\n最近完成的任务：${completedTasks.length} 条；待办：${(tasks || []).length - completedTasks.length} 条。\n\n` +
        `请用 JSON 输出 roots/branches/fruits/summary。`,
    },
  ];

  let llmJson;
  try {
    const resp = await router.chat(prompt, { temperature: 0.4, json: true, maxTokens: 1500 });
    llmJson = JSON.parse(resp.content);
  } catch (err) {
    console.warn('[TreeService] LLM enrichment failed, falling back to rules:', err?.message || err);
    return { ...base, source: 'rules' };
  }

  const snapshot = {
    ...base,
    roots: Array.isArray(llmJson.roots) && llmJson.roots.length
      ? llmJson.roots.map((r, i) => ({
          id: `root-llm-${i}`,
          label: r.label || r.title || '价值观',
          content: r.content || r.description || '',
        }))
      : base.roots,
    branches: Array.isArray(llmJson.branches) && llmJson.branches.length
      ? llmJson.branches.map((b, i) => ({
          id: `branch-llm-${i}`,
          title: b.title || b.label || '',
          description: b.description || b.content || '',
        }))
      : base.branches,
    fruits: Array.isArray(llmJson.fruits) ? llmJson.fruits.map((f, i) => ({
      id: `fruit-llm-${i}`,
      title: f.title || '',
      when: f.when || f.date || '',
    })) : [],
    summary: typeof llmJson.summary === 'string' ? llmJson.summary : '',
    source: 'llm',
    generated_at: new Date().toISOString(),
  };

  cache.set(userId, { generated_at: Date.now(), snapshot });
  return snapshot;
}

export default { getEnrichedTreeSnapshot };
