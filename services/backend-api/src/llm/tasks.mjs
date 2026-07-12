/**
 * K4 任务注册表（实施方案 P0/P1 · 白皮书附录 A 的代码化）
 *
 * 每个 LLM 调用点在此登记为任务：类型、路由链、默认参数、输出 schema。
 * router.runTask(taskId) 按注册表选端点执行：
 *
 *   route  端点偏好序（左→右即降级链）。
 *          'gedo'    = 自有模型端点（L1 车道，Gedo Persona / 现为原版 Qwen3）
 *          'primary' = 既有主/备链（L2 外部厂商，anthropic↔openai 互切）
 *
 *   环境变量可覆盖单个任务的路由（绞杀者模式的开关，改配置即回滚）：
 *     TASK_ROUTE_MEMORY_EXTRACT=gedo,primary   （任务 id 大写、非字母数字转 _）
 *
 *   GEDO_SOVEREIGN_MODE=1 → 全部任务只允许本地端点（断供演习 / 自托管模式）
 *
 * kind：
 *   perceive — NL→结构化，输出过 ajv schema（失败同端点重试 1 次→降级下一端点）
 *   reason   — 结构化推理（规划/分析）
 *   render   — 结构化→NL 表达
 */

import Ajv from 'ajv/dist/2020.js';

const ajv = new Ajv({ allErrors: true, strict: false });

// ── 输出 schema：只校验顶层形状（防碎 JSON/跑题输出），字段级防御留给各服务的 normalize ──

const EXTRACT_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['extractions'],
  properties: {
    should_extract: { type: 'boolean' },
    extractions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          // 模型对"不适用"字段合法地输出 null（如 memory 类的 title），
          // 字段级钳制交给 normalizeExtraction，这里只挡形状错误
          kind: { type: 'string' },
          content: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
          confidence: { type: ['number', 'null'] },
        },
      },
    },
  },
};

export const TASKS = {
  // ── 感知类（L1 主战场：已迁移的走 gedo，未迁移的登记待迁）─────────────
  'memory.extract': {
    kind: 'perceive',
    description: '对话 → 结构化记忆/待办/实体事实抽取',
    route: ['gedo', 'primary'],
    options: { temperature: 0.3, json: true, maxTokens: 1000 },
    outputSchema: EXTRACT_OUTPUT_SCHEMA,
    tier: 'free',
  },
  'memory.consolidate.semantic': {
    kind: 'perceive',
    description: '夜间巩固：episodes → 画像补丁 + 冲突检测',
    route: ['gedo', 'primary'],
    options: { temperature: 0.3, json: true, maxTokens: 4000 },
    outputSchema: { type: 'object' },
    tier: 'free',
  },
  'memory.consolidate.working': {
    kind: 'perceive',
    description: '工作记忆（L2）滚动更新',
    route: ['gedo', 'primary'],
    options: { temperature: 0.3, json: true, maxTokens: 1000 },
    outputSchema: { type: 'object' },
    tier: 'free',
  },
  'memory.consolidate.quarterly': {
    kind: 'perceive',
    description: '季度长期摘要',
    route: ['gedo', 'primary'],
    options: { temperature: 0.3, json: true, maxTokens: 800 },
    outputSchema: {
      type: 'object',
      required: ['summary'],
      properties: { summary: { type: 'string' }, tags: { type: 'array' } },
    },
    tier: 'free',
  },
  'memory.entities.suggest': {
    kind: 'perceive',
    description: '记忆碎片 → 图鉴实体建议',
    route: ['gedo', 'primary'],
    options: { temperature: 0.2, json: true, maxTokens: 500 },
    outputSchema: {
      type: 'object',
      required: ['entities'],
      properties: { entities: { type: 'array' } },
    },
    tier: 'free',
  },
  'memory.conflict': {
    kind: 'perceive',
    description: '记忆冲突自动裁决',
    route: ['gedo', 'primary'],
    options: { temperature: 0.2, json: true, maxTokens: 500 },
    outputSchema: {
      type: 'object',
      required: ['resolution'],
      properties: { resolution: { type: 'string' } },
    },
    tier: 'free',
  },
  'memory.import': {
    kind: 'perceive',
    description: '外部对话导入 → 记忆碎片（JSON 数组）',
    route: ['gedo', 'primary'],
    viaText: true, // primary 车道走流式聚合：长 JSON 经本机代理易断流
    options: { temperature: 0.2, maxTokens: 3000, noThink: true },
    outputSchema: { type: 'array', items: { type: 'object' } },
    tier: 'free',
  },
  'memory.import.doc': {
    kind: 'perceive',
    description: '导入文档/博客/网页正文 → 记忆碎片（JSON 数组，来源中心文档类）',
    route: ['gedo', 'primary'],
    viaText: true, // 同 memory.import：长 JSON 走流式聚合
    options: { temperature: 0.2, maxTokens: 3000, noThink: true },
    outputSchema: { type: 'array', items: { type: 'object' } },
    tier: 'free',
  },
  'memory.compress': {
    kind: 'perceive',
    description: '检索结果 → 注入用摘要（纯文本）',
    route: ['gedo', 'primary'],
    options: { temperature: 0.3, maxTokens: 400, noThink: true },
    tier: 'free',
  },
  'memory.struct.extract': {
    kind: 'perceive',
    description: '记忆内容 → 结构化字段（人物/日期/技能/情绪…）',
    route: ['gedo', 'primary'],
    options: { temperature: 0.3, json: true, maxTokens: 600 },
    outputSchema: { type: 'object' },
    tier: 'free',
  },
  'memory.insights': {
    kind: 'reason',
    description: '目标 × 相关记忆 → 洞察（JSON 数组）',
    route: ['gedo', 'primary'],
    options: { temperature: 0.5, maxTokens: 400, noThink: true },
    outputSchema: { type: 'array' },
    tier: 'free',
  },

  // ── 渲染类（轻量渲染本地可胜任；主对话常态走 L2，gedo 只兜底）──────────
  'entity.summary': {
    kind: 'render',
    description: '图鉴实体卡 → 卡面 AI 总结（60-120 字，事件驱动+存量补跑）',
    route: ['primary'],
    options: { temperature: 0.4, json: true, maxTokens: 800, noThink: true }, // 中文 JSON 给足余量
    outputSchema: {
      type: 'object',
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    },
    tier: 'free',
  },
  'conversation.title': {
    kind: 'render',
    description: '对话 → 5-15 字标题',
    route: ['gedo', 'primary'],
    options: { temperature: 0.3, maxTokens: 50, noThink: true },
    tier: 'free',
  },
  'chat.companion': { kind: 'render', description: '主对话（常态 L2 便宜档）', route: ['primary'], tier: 'free' },
  'chat.brief': { kind: 'render', description: 'companion 每日简报', route: ['primary'], tier: 'free' },
  'persona.digital': { kind: 'render', description: '数字分身应答', route: ['primary'], tier: 'credits' },
  'persona.twin': {
    kind: 'render',
    description: '数字分身 AS 模式·个人 LoRA（T2 接 vLLM 后按请求挂 twin-{uid} adapter）',
    route: ['gedo', 'primary'],
    tier: 'credits',
  },

  // ── Twin 过闸评测（T1，见 persona/twin-gates.mjs）───────────────────
  'twin.style.judge': {
    kind: 'perceive',
    description: 'Twin 风格胜率盲判（过闸1：adapter vs 提示工程，对照真实样本）',
    route: ['primary', 'gedo'],
    options: { temperature: 0.1, json: true, maxTokens: 120 },
    outputSchema: {
      type: 'object',
      required: ['winner'],
      properties: { winner: { enum: ['A', 'B', 'tie'] } },
    },
    tier: 'internal',
  },
  'twin.gate.check': {
    kind: 'perceive',
    description: 'Twin 布尔闸（过闸2/3：能力回归与安全拒绝检查）',
    route: ['primary', 'gedo'],
    options: { temperature: 0, json: true, maxTokens: 120 },
    outputSchema: {
      type: 'object',
      required: ['pass'],
      properties: { pass: { type: 'boolean' }, reason: { type: 'string' } },
    },
    tier: 'internal',
  },

  // ── Twin 数据集构造（T0，见 persona/twin-dataset.mjs）───────────────
  'twin.backtranslate': {
    kind: 'perceive',
    description: 'Twin 指令回译：为孤立写作样本反推 SFT 指令',
    route: ['gedo', 'primary'],
    options: { temperature: 0.4, json: true, maxTokens: 200 },
    outputSchema: {
      type: 'object',
      required: ['instruction'],
      properties: { instruction: { type: 'string' } },
    },
    tier: 'internal',
  },

  // ── 评测内部任务（Style Suite 判卷，见 scripts/eval/style/）──────────
  'eval.style.judge': {
    kind: 'perceive',
    description: '风格评审打分（换模型/改 prompt 的 G2 护栏）',
    route: ['gedo', 'primary'],
    options: { temperature: 0.1, json: true, maxTokens: 300 },
    outputSchema: {
      type: 'object',
      required: ['warmth', 'length', 'opening'],
      properties: {
        warmth: { type: 'number' },
        length: { type: 'number' },
        opening: { type: 'number' },
        format: { type: ['number', 'null'] },
        addressing: { type: ['number', 'null'] },
        memory_use: { type: ['number', 'null'] },
        boundary: { type: ['number', 'null'] },
      },
    },
    tier: 'internal',
  },

  'eval.shadow.judge': {
    kind: 'perceive',
    description: '影子成对判卷（G1 胜率仪表盘，见 scripts/eval/shadow-report.mjs）',
    route: ['primary', 'gedo'],
    options: { temperature: 0.1, json: true, maxTokens: 250 },
    outputSchema: {
      type: 'object',
      required: ['winner'],
      properties: {
        winner: { enum: ['A', 'B', 'tie'] },
        reason: { type: 'string' },
      },
    },
    tier: 'internal',
  },

  // ── 推理类（P4 骨架化后分档）────────────────────────────────────────
  'memory.dimensions.assess': {
    kind: 'reason',
    description: '生命之花八维评估：规则分+信号+记忆采样 → 带内微调分数与解读',
    route: ['primary'],
    options: { temperature: 0.4, json: true, maxTokens: 4000, noThink: true }, // 8 维中文长 JSON 给足余量
    outputSchema: {
      type: 'object',
      required: ['dimensions'],
      properties: { dimensions: { type: 'object' } }, // 顶层形状校验，字段级钳制在 dimension-engine normalize
    },
    tier: 'free',
  },
  'plan.goal': { kind: 'reason', description: '目标拆解/任务规划', route: ['primary'], tier: 'free' },
  'insight.report': { kind: 'reason', description: '自我认知报告（双段）', route: ['primary'], tier: 'credits' },
  'review.generate': {
    kind: 'reason',
    description: '周期复盘：证据聚合 → 四段结构化（概览/亮点/待提升/下期聚焦）',
    route: ['primary'],
    viaText: true, // 长中文 JSON 经本机代理易断流 → 走 chatToText 流式聚合（同 memory.import）
    options: { temperature: 0.4, json: true, maxTokens: 4000, noThink: true },
    outputSchema: {
      type: 'object',
      required: ['summary', 'highlights', 'lowlights', 'next_period_focus'],
      properties: {
        summary: { type: 'string' },
        highlights: { type: 'array', items: { type: 'string' } },
        lowlights: { type: 'array', items: { type: 'string' } },
        next_period_focus: { type: 'array', items: { type: 'string' } },
      },
    },
    tier: 'credits',
  },
};

const validators = {};
for (const [id, task] of Object.entries(TASKS)) {
  if (task.outputSchema) validators[id] = ajv.compile(task.outputSchema);
}

export function getTask(taskId) {
  return TASKS[taskId] || null;
}

/** 任务路由解析：env 覆盖 > 注册表 > primary */
export function resolveRoute(taskId) {
  const envKey = `TASK_ROUTE_${taskId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv.split(',').map(s => s.trim()).filter(Boolean);
  return getTask(taskId)?.route || ['primary'];
}

export function validateTaskOutput(taskId, doc) {
  const fn = validators[taskId];
  if (!fn) return { ok: true };
  if (fn(doc)) return { ok: true };
  return {
    ok: false,
    errors: (fn.errors || []).map(e => `${e.instancePath || '/'} ${e.message}`).join('; '),
  };
}

/** 宽容 JSON 解析：剥 think 段 / 剥代码围栏 / 退而取首尾大括号子串 */
export function parseJsonLoose(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty content');
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    // 对象与数组两种顶层形态都兜（谁先出现取谁）
    const objStart = t.indexOf('{');
    const arrStart = t.indexOf('[');
    const useArr = arrStart >= 0 && (objStart < 0 || arrStart < objStart);
    const start = useArr ? arrStart : objStart;
    const end = useArr ? t.lastIndexOf(']') : t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('no JSON value found in output');
  }
}

/** 断供演习 / 自托管模式：只允许本地端点 */
export function isSovereignMode() {
  return ['1', 'true', 'on', 'yes'].includes(
    String(process.env.GEDO_SOVEREIGN_MODE || '').toLowerCase(),
  );
}

export default { TASKS, getTask, resolveRoute, validateTaskOutput, parseJsonLoose, isSovereignMode };
