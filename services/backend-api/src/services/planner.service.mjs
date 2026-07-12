/**
 * Planner Service - AI 智能规划引擎
 * 
 * 功能：
 * - 目标澄清问题生成
 * - SMART 原则目标拆解
 * - 任务自动生成
 * - 生命之花平衡检查
 */

import { getLLMRouter } from '../llm/router.mjs';
import { outputLanguageDirective } from '../lib/language.mjs';

// Use the LLM router for intelligent provider selection
function getLLM() {
  const router = getLLMRouter();
  return {
    async chat(messages, options) {
      if (!router.isAvailable()) {
        throw new Error('No LLM provider available');
      }
      return router.chat(messages, options);
    },
    // Stream + accumulate into a single string. Used for long JSON generations
    // (e.g. the goal planner): a non-streaming request leaves the socket idle
    // while the model generates, which a local HTTP proxy will drop ("other
    // side closed"); streaming keeps bytes flowing so it stays alive and is
    // also faster. Returns the same { content } shape as chat().
    async chatToText(messages, options = {}) {
      if (!router.isAvailable()) {
        throw new Error('No LLM provider available');
      }
      let content = '';
      for await (const chunk of router.chatStream(messages, options)) {
        if (chunk.type === 'text') content += chunk.text;
        else if (chunk.type === 'error') throw new Error(chunk.error || 'stream error');
      }
      return { content };
    },
  };
}

const llm = getLLM();

// 生命之花 8 维度
const LIFE_WHEEL_DIMENSIONS = [
  { key: 'health', label: '健康', desc: '身体健康、运动、睡眠' },
  { key: 'career', label: '事业', desc: '工作、职业发展、专业技能' },
  { key: 'family', label: '家庭', desc: '家人关系、陪伴、责任' },
  { key: 'finance', label: '财务', desc: '收入、储蓄、投资' },
  { key: 'growth', label: '成长', desc: '学习、阅读、自我提升' },
  { key: 'social', label: '社交', desc: '朋友、人脉、社交活动' },
  { key: 'hobby', label: '兴趣', desc: '爱好、娱乐、创造' },
  { key: 'self_realization', label: '自我实现', desc: '价值观、人生意义、梦想' },
];

/**
 * 生成目标澄清问题
 * @param {string} prompt - 用户输入的目标描述
 * @param {Object} userMemories - 用户相关记忆（用于个性化）
 * @returns {Promise<Array<{id: string, prompt: string, options: Array<{value: string, label: string}>}>>}
 */
export async function generateClarifyQuestions(prompt, userMemories = [], language) {
  const systemPrompt = `你是一个专业的目标规划助手。用户提出了一个目标，你需要通过几个关键问题来帮助澄清目标细节。

要求：
1. 生成 3-5 个关键问题（必须包含下面两道 WOOP 题），每题给 3-4 个推荐选项；用户也可另选「其他」自填。
2. 覆盖：成功标准(field:quantifiable)、时间期限(field:timeline)、当前基础/可投入资源(field:resources)，以及两道 WOOP：
   - 一道「最佳结果想象」field:outcome —— 完成后生活的具体不同；给 3-4 个可能的理想结果做选项。
   - 一道「最大障碍识别」field:obstacle —— 最可能让 TA 中途放弃的事；给 3-4 个常见障碍做选项。
3. 选项简洁；尽量结合用户记忆做个性化。
4. ${outputLanguageDirective(language)}

返回 JSON 格式：
{
  "questions": [
    {
      "id": "unique_id",
      "field": "quantifiable|timeline|resources|outcome|obstacle",
      "prompt": "问题内容",
      "options": [
        { "value": "option_value", "label": "选项显示文本" }
      ]
    }
  ]
}`;

  const userPrompt = `用户目标：${prompt}

${userMemories.length > 0 ? `用户相关记忆：\n${userMemories.map(m => `- ${m.content_raw}`).join('\n')}` : ''}

请生成澄清问题（JSON格式）：`;

  try {
    // Streamed (not one-shot json): a non-streaming call leaves the socket idle
    // while the model generates, which the local proxy drops → always fell back
    // to the template. Streaming keeps bytes flowing so the LLM path actually runs.
    const response = await llm.chatToText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.7, maxTokens: 1024 });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
    return parsed.questions || [];
  } catch (error) {
    console.error('[PlannerService] generateClarifyQuestions error:', error);
    // 降级：返回通用问题
    return [
      {
        id: 'timebound', field: 'timeline',
        prompt: '这个目标的期望完成时间是？',
        options: [
          { value: '1m', label: '1 个月' },
          { value: '3m', label: '3 个月' },
          { value: '6m', label: '6 个月' },
          { value: '1y', label: '1 年' },
        ],
      },
      {
        id: 'weekly_hours', field: 'resources',
        prompt: '你每周可投入的时间大约是？',
        options: [
          { value: '3', label: '3 小时' },
          { value: '6', label: '6 小时' },
          { value: '10', label: '10 小时' },
          { value: '20', label: '20 小时以上' },
        ],
      },
      {
        id: 'outcome', field: 'outcome',
        prompt: '完成后，你最希望生活有什么不同？',
        options: [
          { value: 'confidence', label: '更自信、更自律' },
          { value: 'income', label: '收入 / 职业提升' },
          { value: 'health', label: '状态更好、更健康' },
          { value: 'relations', label: '关系 / 影响力更好' },
        ],
      },
      {
        id: 'obstacle', field: 'obstacle',
        prompt: '最可能让你中途放弃的是什么？',
        options: [
          { value: 'no_time', label: '时间不够 / 太忙' },
          { value: 'procrastination', label: '拖延、不敢开始' },
          { value: 'energy', label: '精力不足 / 疲惫' },
          { value: 'unclear', label: '不知道怎么做' },
        ],
      },
    ];
  }
}

/**
 * SMART 原则目标拆解 + 任务生成
 * @param {string} prompt - 用户目标描述
 * @param {Object} answers - 澄清问题的答案
 * @param {Object} userMemories - 用户相关记忆
 * @returns {Promise<{goal: Object, tasks: Array}>}
 */
export async function generateSmartPlan(prompt, answers = {}, userMemories = [], language) {
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `你是一个专业的目标规划师，精通 SMART 原则。根据用户的目标和补充信息，生成：
1. 符合 SMART 原则的目标定义
2. 分层任务计划（里程碑 → 周任务）

${outputLanguageDirective(language)}

SMART 原则：
- Specific（具体）：目标清晰明确
- Measurable（可衡量）：有量化指标
- Achievable（可达成）：结合用户实际情况
- Relevant（相关性）：与用户价值观/长期目标一致
- Time-bound（时限性）：有明确的时间节点

输出约束（务必遵守）：
- 控制规模：最多 3-4 个里程碑，每个里程碑 2-3 个任务，总任务数不超过 10 个；精炼优先，便于用户落地。
- 今天是 ${today}，所有 deadline 必须晚于今天、并按里程碑顺序递进，覆盖用户给出的时间跨度。

返回 JSON 格式：
{
  "goal": {
    "title": "精炼的目标标题",
    "description": "详细描述",
    "specific": "具体化说明",
    "measurable": "可衡量指标",
    "achievable": "可行性分析",
    "relevant": "相关性说明",
    "time_bound": "时间期限",
    "life_wheel_dimension": "对应的生命之花维度（health/career/family/finance/growth/social/hobby/self_realization）"
  },
  "milestones": [
    {
      "title": "里程碑名称",
      "deadline": "截止日期（YYYY-MM-DD）",
      "tasks": [
        {
          "title": "具体任务",
          "estimated_duration": 30,
          "energy_level": "high/medium/low",
          "suggested_schedule": "建议执行时段描述"
        }
      ]
    }
  ]
}`;

  const userPrompt = `用户目标：${prompt}

用户补充信息：
${Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

${userMemories.length > 0 ? `用户相关记忆/技能：\n${userMemories.map(m => `- ${m.content_raw || m.label}`).join('\n')}` : ''}

请生成 SMART 目标和任务计划（JSON格式）：`;

  try {
    // Streamed (not one-shot) so a local proxy can't drop the idle socket
    // while the model generates the full plan. Far faster + reliable here.
    const response = await llm.chatToText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.5, maxTokens: 4096 });

    // Tolerant parse: a streamed reply may wrap the JSON in prose / code fences.
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response.content);

    // 扁平化任务列表
    const tasks = [];
    for (const milestone of parsed.milestones || []) {
      for (const task of milestone.tasks || []) {
        tasks.push({
          title: task.title,
          milestone: milestone.title,
          deadline: milestone.deadline,
          estimated_duration: task.estimated_duration || 30,
          energy_level: task.energy_level || 'medium',
        });
      }
    }

    return {
      goal: parsed.goal || { title: prompt },
      milestones: parsed.milestones || [],
      tasks,
    };
  } catch (error) {
    console.error('[PlannerService] generateSmartPlan error:', error);
    // 降级：返回基础计划
    return {
      goal: {
        title: prompt,
        description: '',
        life_wheel_dimension: 'growth',
      },
      milestones: [],
      tasks: [
        { title: `拆解目标：${prompt}`, estimated_duration: 30, energy_level: 'medium' },
        { title: `收集资料：为「${prompt}」准备资源清单`, estimated_duration: 30, energy_level: 'low' },
        { title: `执行第一步：完成 1 个最小行动`, estimated_duration: 30, energy_level: 'high' },
      ],
    };
  }
}

/**
 * 动态调整建议
 * @param {Object} task - 未完成的任务
 * @param {string} reasonCode - 原因代码
 * @param {string} reasonNote - 原因说明
 * @returns {Promise<Object>} 调整建议
 */
export async function generateAdjustmentSuggestion(task, reasonCode, reasonNote = '', language) {
  const systemPrompt = `你是一个目标管理助手。用户有一个任务未能完成，你需要分析原因并给出调整建议。

可能的调整类型：
1. split_task - 拆分任务为更小的步骤
2. reschedule - 顺延到更合适的时间
3. change_time - 调整执行时段（如从晚上改到早上）
4. reduce_scope - 降低任务范围/难度
5. delegate - 建议寻求帮助或委托
6. drop - 建议放弃（如果持续无法完成）

${outputLanguageDirective(language)}

返回 JSON 格式：
{
  "adjustment_type": "调整类型",
  "suggestion": "具体建议说明",
  "new_tasks": [
    { "title": "新任务（如果是拆分）", "estimated_duration": 15 }
  ],
  "encouragement": "鼓励性的话"
}`;

  const reasonLabels = {
    no_time: '时间不够',
    too_tired: '太累了',
    forgot: '忘记了',
    too_hard: '任务太难',
    no_motivation: '缺乏动力',
    external_block: '外部阻碍',
    other: '其他原因',
  };

  const userPrompt = `任务：${task.title}
预计时长：${task.estimated_duration || 30} 分钟
未完成原因：${reasonLabels[reasonCode] || reasonCode}
${reasonNote ? `补充说明：${reasonNote}` : ''}

请给出调整建议（JSON格式）：`;

  try {
    const response = await llm.chatToText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.6, maxTokens: 1024 });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
  } catch (error) {
    console.error('[PlannerService] generateAdjustmentSuggestion error:', error);
    // 降级：基于规则的简单建议
    const suggestions = {
      no_time: { adjustment_type: 'split_task', suggestion: '建议将任务拆分为 2-3 个 15 分钟的小任务' },
      too_tired: { adjustment_type: 'change_time', suggestion: '建议调整到精力充沛的时段执行' },
      forgot: { adjustment_type: 'reschedule', suggestion: '建议设置提醒，顺延到明天' },
      too_hard: { adjustment_type: 'reduce_scope', suggestion: '建议降低任务难度，从最简单的部分开始' },
      no_motivation: { adjustment_type: 'split_task', suggestion: '建议先完成一个 5 分钟的"启动任务"' },
    };
    return suggestions[reasonCode] || { adjustment_type: 'reschedule', suggestion: '建议顺延到明天' };
  }
}

/**
 * 生命之花平衡检查
 * @param {Array} goals - 用户的目标列表
 * @param {string} newGoalDimension - 新目标的维度
 * @returns {Promise<Object>} 平衡建议
 */
export async function checkLifeWheelBalance(goals, newGoalDimension) {
  // 统计各维度目标数量
  const dimensionCounts = {};
  LIFE_WHEEL_DIMENSIONS.forEach(d => {
    dimensionCounts[d.key] = 0;
  });
  
  for (const goal of goals) {
    const dim = goal.life_wheel_dimension || 'growth';
    if (dimensionCounts[dim] !== undefined) {
      dimensionCounts[dim]++;
    }
  }

  // 添加新目标后的分布
  dimensionCounts[newGoalDimension] = (dimensionCounts[newGoalDimension] || 0) + 1;

  // 计算最高和最低
  const counts = Object.values(dimensionCounts);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const avgWithNew = counts.reduce((a, b) => a + b, 0) / counts.length;

  // 找出被忽略的维度
  const neglectedDimensions = LIFE_WHEEL_DIMENSIONS
    .filter(d => dimensionCounts[d.key] === 0)
    .map(d => d.label);

  // 找出过度关注的维度
  const overFocusedDimensions = LIFE_WHEEL_DIMENSIONS
    .filter(d => dimensionCounts[d.key] >= avgWithNew * 2)
    .map(d => d.label);

  const isBalanced = max - min <= 2 && neglectedDimensions.length <= 2;

  let suggestion = '';
  if (!isBalanced) {
    if (neglectedDimensions.length > 0) {
      suggestion = `建议关注「${neglectedDimensions.slice(0, 2).join('」和「')}」维度，保持生活平衡。`;
    }
    if (overFocusedDimensions.length > 0) {
      suggestion += ` 「${overFocusedDimensions.join('」「')}」维度目标较多，注意避免过度投入。`;
    }
  }

  return {
    isBalanced,
    distribution: dimensionCounts,
    neglectedDimensions,
    overFocusedDimensions,
    suggestion: suggestion || '目标分布较为均衡，继续保持！',
    newDimensionLabel: LIFE_WHEEL_DIMENSIONS.find(d => d.key === newGoalDimension)?.label || newGoalDimension,
  };
}

/**
 * 数字人对话响应生成
 * @param {string} message - 用户消息
 * @param {Object} context - 对话上下文（记忆、目标、任务等）
 * @returns {Promise<{reply: string, mood: string, functionCall?: Object, quickActions?: Array}>}
 */
export async function generateChatResponse(message, context = {}) {
  const systemPrompt = `你是用户的数字分身「智伴」，既是他们的镜像，也是成长伙伴。

## 用户当前状态
- 今日任务：已完成 ${context.todayCompleted || 0}/${context.todayTotal || 0}
- 连续打卡：${context.streakDays || 0} 天
${context.activeGoals?.length > 0 ? `- 进行中目标：${context.activeGoals.map(g => g.title).join('、')}` : ''}

${context.recentMemories?.length > 0 ? `## 最近记忆\n${context.recentMemories.map(m => `- ${m.summary}`).join('\n')}` : ''}

## 你的能力
你可以通过 function call 帮用户：
1. capture_memory - 记录想法/经历到智忆
2. create_goal - 创建新目标
3. complete_task - 打卡完成任务
4. search_memory - 搜索历史记忆

## 交互原则
1. 语气亲切温暖，像老朋友
2. 主动关联用户的记忆和目标，体现"懂你"
3. 适时给予鼓励和建议，但不说教
4. 回复简洁，通常 2-4 句话即可
5. 如果用户想记录/规划/打卡，返回对应的 function_call
6. ${outputLanguageDirective(context.language)}

返回 JSON 格式：
{
  "reply": "回复内容",
  "mood": "你此刻的情绪(happy/excited/thinking/encouraging/neutral)",
  "function_call": {
    "name": "函数名（可选）",
    "arguments": { "参数": "值" }
  },
  "quick_actions": [
    { "id": "action_id", "label": "按钮文字", "type": "confirm/cancel" }
  ]
}`;

  const userPrompt = `用户说：${message}

请用 JSON 格式回复：`;

  try {
    const response = await llm.chatToText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.7, maxTokens: 1024 });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
    
    return {
      reply: parsed.reply || '',
      mood: parsed.mood || 'neutral',
      functionCall: parsed.function_call,
      quickActions: parsed.quick_actions,
    };
  } catch (error) {
    console.error('[PlannerService] generateChatResponse error:', error);
    // 返回 null 让调用方使用本地规则
    return null;
  }
}

/**
 * 生成四层 OKR 结构（O → KR → 月目标 → 任务）+ 可选 If-Then 障碍卡。
 * 供 WOOP 向导（/v1/goals/woop-generate）和目标拆解（/v1/goals/:id/decompose）共用。
 * 无 LLM 可用时降级为确定性模板。
 *
 * @param {Object} params
 * @param {string} params.prompt - 目标描述
 * @param {Object} [params.diagnosisAnswers] - 诊断回答
 * @param {Object} [params.woop] - { wish, outcome, obstacle }
 * @param {boolean} [params.enableLLM=true]
 * @returns {Promise<{ okrStructure: Object, ifThenCards: Array }>}
 */
export async function generateOkrStructure({ prompt, diagnosisAnswers = {}, woop = {}, enableLLM = true, language, regenerateHint = '', allowFallback = true }) {
  let okrStructure = null;
  let ifThenCards = [];

  const router = getLLMRouter();
  if (enableLLM && router.isAvailable()) {
    const llmPrompt = `作为目标规划专家，基于以下信息生成一套**可立刻执行**的 OKR 结构和障碍预案。

目标描述: ${prompt}
诊断回答: ${JSON.stringify(diagnosisAnswers || {})}
WOOP信息: 愿望=${woop?.wish || prompt}, 最佳结果=${woop?.outcome || ''}, 最大障碍=${woop?.obstacle || ''}
${regenerateHint ? `\n本次调整意图（用户对上一版不满意，请据此重新拆解、不要照搬旧结构）: ${regenerateHint}\n` : ''}
要求（控制规模，确保快速生成、便于用户落地）：
- objective：一句话定义可衡量的季度目标
- keyResults：2-3 个可量化的关键成果
- monthlyGoals：每个 KR 给 1-2 条月目标，**总数不超过 4 条**；第一个月要尽量具体
- tasks：把「第一个月」拆成 4-6 个**具体、当天就能动手**的小任务。每个任务必须：动词开头、一次专注内可完成、给出 estimatedDuration(分钟)、energyLevel、dayOffset(0=今天,1=明天，依次递增)、是否 isMIT(每天最多一个)、一句 reasoning 说明为何先做
- ifThenCards：针对最大障碍给 1-2 张 If-Then 预案
- ${outputLanguageDirective(language)}
- **JSON 合法性**：字符串值内部禁止出现英文双引号 " （需要引用或表示分秒时用中文引号「」或单引号），确保整体可被 JSON.parse 解析

只返回 JSON：
{
  "objective": {"title": "O目标", "description": "描述", "timeframe": "3个月"},
  "keyResults": [{"id":"kr1","title":"KR标题","description":"描述","timeframe":"月"}],
  "monthlyGoals": [{"id":"m1","keyResultId":"kr1","title":"月目标","description":"描述"}],
  "tasks": [{"id":"t1","monthlyGoalId":"m1","title":"具体任务","description":"怎么做","estimatedDuration":30,"energyLevel":"high|medium|low","dayOffset":0,"isMIT":true,"reasoning":"为何先做"}],
  "ifThenCards": [{"obstacleType":"procrastination_fear","obstacleDescription":"描述","ifCondition":"如果...","thenAction":"那么..."}]
}`;
    // Up to 2 attempts: a transient proxy hiccup or an occasional malformed/
    // truncated reply shouldn't immediately dump the user into the generic
    // fallback template below — that's a much worse experience than a retry.
    for (let attempt = 1; attempt <= 2 && !okrStructure; attempt++) {
      try {
        // Streamed (not one-shot) so a local proxy can't drop the idle socket
        // mid-generation (which silently falls back to the generic template).
        // maxTokens raised from 4096: 2-3 KR + up to 4 monthly + 6 tasks each
        // with a reasoning field can run past 4096 and get cut off mid-JSON.
        const result = await llm.chatToText([{ role: 'user', content: llmPrompt }], { temperature: 0.6, maxTokens: 8192 });
        // Tolerant parse: a streamed reply may wrap JSON in prose / code fences.
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
        // A structurally-valid-but-empty response (no keyResults) must still
        // fall through to the deterministic fallback below — otherwise
        // decomposeGoalToOkr gets zero KR nodes to mount tasks under, and the
        // goal never looks "decomposed" (child_count/task_count stay 0).
        if (Array.isArray(parsed.keyResults) && parsed.keyResults.length > 0) {
          okrStructure = {
            objective: parsed.objective,
            keyResults: parsed.keyResults,
            monthlyGoals: parsed.monthlyGoals || [],
            tasks: parsed.tasks || [],
          };
          ifThenCards = parsed.ifThenCards || [];
        } else {
          console.error(`[PlannerService] generateOkrStructure attempt ${attempt}: parsed but keyResults empty`);
        }
      } catch (e) {
        console.error(`[PlannerService] generateOkrStructure attempt ${attempt} failed:`, e?.message || e);
      }
    }
  }

  // Callers that would rather surface an honest failure than persist a
  // generic skeleton (e.g. the chat plan_goal tool) pass allowFallback:false.
  if (!okrStructure && !allowFallback) {
    return { okrStructure: null, ifThenCards: [] };
  }

  if (!okrStructure) {
    // No task-level items here on purpose: without real LLM personalization
    // there's nothing genuine to hand the user, and a fabricated to-do like
    // "拆解这个目标为具体步骤" reads as the system asking the user to do the
    // system's own job — confusing and not actually actionable. Keep just the
    // O/KR/M skeleton so the goal still shows as decomposed; the user adds
    // their own first ToDo, or retries decompose once the LLM is back.
    okrStructure = {
      objective: { title: prompt, description: `实现「${prompt}」`, timeframe: '3个月' },
      keyResults: [
        { id: 'kr1', title: `完成「${prompt}」的核心成果`, description: '可衡量的关键成果', timeframe: '3个月' },
      ],
      monthlyGoals: [
        { id: 'm1', keyResultId: 'kr1', title: `第一个月：${prompt}基础准备`, description: '打好基础' },
      ],
      tasks: [],
    };
    if (woop?.obstacle) {
      ifThenCards = [{
        obstacleType: 'procrastination_fear',
        obstacleDescription: woop.obstacle,
        ifCondition: `如果遇到「${woop.obstacle}」`,
        thenAction: '那么先完成最小的5分钟行动',
      }];
    }
  }

  return { okrStructure, ifThenCards };
}

// ── 目标规划（记忆驱动 + 每日节奏）──────────────────────────────────
const ENERGY = ['high', 'medium', 'low'];
const clampDuration = (n, d = 30) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.min(240, Math.round(v)) : d; };

/**
 * 生成「目标规划」：结合个人画像/记忆，由大模型产出 objective + 关键成果 +
 * 分阶段的**每日节奏**（如 90 天每天 3 件事）或里程碑任务。仅返回计划，不落库
 * （供预览 → 编辑 → 确认）。无 LLM 时给出非空泛的确定性 fallback。
 *
 * @param {Object} p
 * @param {string} p.goalTitle
 * @param {string} [p.goalDescription]
 * @param {number} [p.durationDays=30]
 * @param {string} [p.personalContext]  画像/记忆摘要，用于个性化
 * @param {string} [p.regenerateHint]   「重新生成」时的调整意图
 * @param {boolean} [p.enableLLM=true]
 * @returns {Promise<Object>} plan
 */
export async function generateGoalPlan({ goalTitle, goalDescription = '', durationDays = 30, personalContext = '', progressContext = '', isReplan = false, regenerateHint = '', enableLLM = true, language }) {
  const days = clampDuration(durationDays, 30);
  const router = getLLMRouter();

  if (enableLLM && router.isAvailable()) {
    const prompt = `你是一位贴身成长教练。请**结合这个人的真实情况**，为下面的目标制定一份可执行的规划，并把它拆成可以每天照着做的内容。

目标：${goalTitle}
${goalDescription ? `补充：${goalDescription}\n` : ''}计划周期：${days} 天
${personalContext ? `\n# 关于这个人（务必结合，不要泛泛而谈）\n${personalContext}\n` : ''}${progressContext ? `\n# 执行情况 / 其他目标（重规划时务必结合）\n${progressContext}\n` : ''}${isReplan ? '\n# 这是【重新规划】：请基于上面的完成情况调整难度与节奏（做得好就加码、老是跳过就降难度或换时间），并与其他目标错峰、避免精力打架；不要简单照搬旧计划。\n' : ''}${regenerateHint ? `\n# 这次重新生成的调整意图：${regenerateHint}\n` : ''}
要求：
1. 不要套模板、不要空话。objective 用一句话、可衡量；keyResults 给 2-4 个可量化关键成果。
2. personalNote：一句话说明你**结合 TA 的情况**做了哪些取舍（引用上面的个人信息）。
3. 选择节奏 cadence：
   - 习惯/技能/训练类 → "daily"：把 ${days} 天分成 2-3 个阶段(phases)，每个阶段给出**每天要做的 2-4 件事**(dailyTasks)，随阶段递进。
   - 项目/产出类 → "milestone"：给出若干关键任务(milestoneTasks)，标注在第几天(day)。
4. 每个任务：动词开头、具体、给 estimatedDuration(分钟) 和 energyLevel(high/medium/low)。
5. ${outputLanguageDirective(language)}

只返回 JSON：
{
  "objective": "一句话目标",
  "personalNote": "结合你…所以…",
  "keyResults": ["KR1","KR2"],
  "cadence": "daily",
  "durationDays": ${days},
  "phases": [
    {"name":"第 1–X 天 · 阶段名","startDay":1,"endDay":X,"focus":"阶段重点",
     "dailyTasks":[{"title":"每天做的事","estimatedDuration":30,"energyLevel":"high"}]}
  ],
  "milestoneTasks": [{"title":"关键任务","day":14,"estimatedDuration":60,"energyLevel":"high"}]
}`;
    try {
      // Streamed (not one-shot): keeps the socket busy so a local proxy can't
      // drop it mid-generation (which would hang the request → Next proxy 500).
      const res = await llm.chatToText([{ role: 'user', content: prompt }], { temperature: 0.7, maxTokens: 4096 });
      const jsonMatch = res.content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : res.content);
      const plan = normalizePlan(parsed, goalTitle, days);
      if (plan) return plan;
    } catch (e) {
      console.error('[PlannerService] generateGoalPlan error:', e?.message || e);
    }
  }

  return fallbackGoalPlan(goalTitle, days);
}

/** 校验/规整 LLM 计划，结构不合法则返回 null（触发 fallback）。 */
function normalizePlan(raw, goalTitle, days) {
  if (!raw || typeof raw !== 'object') return null;
  const cadence = raw.cadence === 'milestone' ? 'milestone' : 'daily';
  const norm = (t) => ({
    title: String(t?.title || '').trim(),
    estimatedDuration: clampDuration(t?.estimatedDuration, 30),
    energyLevel: ENERGY.includes(t?.energyLevel) ? t.energyLevel : 'medium',
  });
  const plan = {
    objective: String(raw.objective || goalTitle).trim(),
    personalNote: String(raw.personalNote || '').trim(),
    keyResults: Array.isArray(raw.keyResults) ? raw.keyResults.map(String).map(s => s.trim()).filter(Boolean).slice(0, 5) : [],
    cadence,
    durationDays: clampDays(raw.durationDays, days),
    phases: [],
    milestoneTasks: [],
  };
  if (cadence === 'milestone') {
    plan.milestoneTasks = (Array.isArray(raw.milestoneTasks) ? raw.milestoneTasks : [])
      .map(t => ({ ...norm(t), day: Math.max(1, Math.min(plan.durationDays, Math.round(Number(t?.day) || 1)) ) }))
      .filter(t => t.title).slice(0, 60);
    if (!plan.milestoneTasks.length) return null;
  } else {
    plan.phases = (Array.isArray(raw.phases) ? raw.phases : [])
      .map((ph, i, arr) => {
        const span = Math.round(plan.durationDays / arr.length);
        return {
          name: String(ph?.name || `阶段 ${i + 1}`).trim(),
          focus: String(ph?.focus || '').trim(),
          startDay: Math.max(1, Math.round(Number(ph?.startDay) || i * span + 1)),
          endDay: Math.max(1, Math.round(Number(ph?.endDay) || (i + 1) * span)),
          dailyTasks: (Array.isArray(ph?.dailyTasks) ? ph.dailyTasks : []).map(norm).filter(t => t.title).slice(0, 5),
        };
      })
      .filter(ph => ph.dailyTasks.length);
    if (!plan.phases.length) return null;
  }
  return plan;
}

function clampDays(n, d = 30) { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.min(366, Math.round(v)) : d; }

/** 非模板化的确定性兜底：按周期切 3 个递进阶段，每天 3 件事。 */
function fallbackGoalPlan(goalTitle, days) {
  const p1 = Math.max(1, Math.round(days / 3));
  const p2 = Math.max(p1 + 1, Math.round((2 * days) / 3));
  return {
    objective: `用 ${days} 天稳定推进「${goalTitle}」并产出可见成果`,
    personalNote: '',
    keyResults: [`坚持每日投入完成「${goalTitle}」`, '形成可持续的每日节奏', '产出阶段性可见成果'],
    cadence: 'daily',
    durationDays: days,
    phases: [
      { name: `第 1–${p1} 天 · 起步`, focus: '建立每日节奏', startDay: 1, endDay: p1, dailyTasks: [
        { title: `为「${goalTitle}」投入一个专注块`, estimatedDuration: 30, energyLevel: 'high' },
        { title: '复盘今日进展并记录一句', estimatedDuration: 10, energyLevel: 'low' },
        { title: '为明天准备一个最小行动', estimatedDuration: 5, energyLevel: 'low' },
      ] },
      { name: `第 ${p1 + 1}–${p2} 天 · 加速`, focus: '提升强度、攻克卡点', startDay: p1 + 1, endDay: p2, dailyTasks: [
        { title: `深入推进「${goalTitle}」核心任务`, estimatedDuration: 45, energyLevel: 'high' },
        { title: '解决一个卡点或学一个新点', estimatedDuration: 20, energyLevel: 'medium' },
        { title: '记录与复盘', estimatedDuration: 10, energyLevel: 'low' },
      ] },
      { name: `第 ${p2 + 1}–${days} 天 · 冲刺收尾`, focus: '产出成果、查漏补缺', startDay: p2 + 1, endDay: days, dailyTasks: [
        { title: `输出「${goalTitle}」阶段成果`, estimatedDuration: 45, energyLevel: 'high' },
        { title: '查漏补缺、打磨细节', estimatedDuration: 25, energyLevel: 'medium' },
        { title: '复盘并规划次日', estimatedDuration: 10, energyLevel: 'low' },
      ] },
    ],
    milestoneTasks: [],
  };
}

/**
 * 把规划展开成可执行任务列表（不落库）。
 * daily：每个阶段的每一天都生成该阶段的 dailyTasks；milestone：按 day 生成。
 * @returns {Array<{title,description,estimated_duration,energy_level,scheduled_date,is_mit,milestone}>}
 */
export function expandPlanToTasks(plan, { startDate = null, cap = 400 } = {}) {
  const out = [];
  // Parse + format in LOCAL time (no toISOString round-trip) so day 1 == today.
  const base = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
  base.setHours(0, 0, 0, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateFor = (day) => { const d = new Date(base); d.setDate(d.getDate() + (day - 1)); return fmt(d); };
  const mk = (t, day, extra = {}) => ({
    title: t.title,
    description: t.description || '',
    estimated_duration: clampDuration(t.estimatedDuration ?? t.estimated_duration, 30),
    energy_level: ENERGY.includes(t.energyLevel ?? t.energy_level) ? (t.energyLevel ?? t.energy_level) : 'medium',
    scheduled_date: dateFor(day),
    ...extra,
  });

  if (plan?.cadence === 'milestone') {
    for (const t of plan.milestoneTasks || []) {
      out.push(mk(t, t.day || 1, { is_mit: true }));
      if (out.length >= cap) return out;
    }
    return out;
  }
  for (const ph of plan?.phases || []) {
    const start = Math.max(1, ph.startDay || 1);
    const end = Math.max(start, ph.endDay || start);
    for (let day = start; day <= end; day++) {
      let idx = 0;
      for (const t of ph.dailyTasks || []) {
        out.push(mk(t, day, { is_mit: idx === 0, milestone: ph.name }));
        idx++;
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

/**
 * 把一条「粗任务」拆成 2-4 个具体小步骤（用于执行页的「细化」动作）。
 * 仅返回建议，不落库；由调用方确认后再创建。
 * 无 LLM 可用时降级为按时长机械二分。
 * @param {Object} task - { title, description?, estimated_duration? }
 * @returns {Promise<Array<{title, description, estimated_duration, energy_level}>>}
 */
export async function breakdownTask(task, language) {
  const systemPrompt = `你是任务拆解助手。用户有一个比较粗的任务，请把它拆成 2-4 个「具体、可立刻动手、一次专注内能完成」的小步骤。
要求：每步动词开头、说清做什么、给出 estimated_duration(分钟) 和 energy_level(high/medium/low)。${outputLanguageDirective(language)}
只返回 JSON：
{
  "subtasks": [
    { "title": "小步骤", "description": "怎么做", "estimated_duration": 20, "energy_level": "medium" }
  ]
}`;
  const userPrompt = `任务：${task.title}
${task.description ? `说明：${task.description}\n` : ''}预计时长：${task.estimated_duration || 30} 分钟

请拆解（JSON格式）：`;

  try {
    const response = await llm.chatToText([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.5, maxTokens: 1024 });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
    const subtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
    const cleaned = subtasks
      .slice(0, 6)
      .map((s) => ({
        title: String(s.title || '').trim(),
        description: String(s.description || ''),
        estimated_duration: Number(s.estimated_duration) || 20,
        energy_level: ['high', 'medium', 'low'].includes(s.energy_level) ? s.energy_level : 'medium',
      }))
      .filter((s) => s.title);
    if (cleaned.length) return cleaned;
    throw new Error('empty breakdown');
  } catch (error) {
    console.error('[PlannerService] breakdownTask error:', error);
    // 降级：按时长机械二分
    const dur = task.estimated_duration || 30;
    const half = Math.max(10, Math.round(dur / 2));
    return [
      { title: `${task.title}（第一步）`, description: '先完成开头最小的一步', estimated_duration: half, energy_level: 'medium' },
      { title: `${task.title}（第二步）`, description: '接着完成剩余部分', estimated_duration: half, energy_level: 'medium' },
    ];
  }
}

/**
 * Decompose a goal into the OKR sub-goal tree (key results → monthly → task
 * nodes) and materialize the first month's near-term tasks (scheduled from
 * today). Shared by the goals-page `/decompose` endpoint and the chat
 * `plan_goal` tool so both entry points produce the same visible structure.
 * `store` is passed in to avoid a module-level store dependency here.
 */
export async function decomposeGoalToOkr(store, userId, goal, { answers = {}, woop = null, enableLLM = true, replace = false, okrStructure: providedOkr = null, regenerateHint = '', allowFallback = true } = {}) {
  const existing = store.listGoals(userId).filter((g) => g.parent_id === goal.id);
  if (existing.length > 0 && !replace) {
    return { goal, created: [], tasks: [], already: true, message: '该目标已完成规划' };
  }

  // If the caller already previewed an OKR (e.g. the WOOP 向导 via woop-generate),
  // commit that exact structure instead of regenerating — so the preview the user
  // saw and the committed tree match. Fall back to generation otherwise.
  const okrStructure = (providedOkr && Array.isArray(providedOkr.keyResults))
    ? providedOkr
    : (await generateOkrStructure({
        prompt: goal.title,
        diagnosisAnswers: answers,
        woop: woop || { wish: goal.title },
        regenerateHint,
        enableLLM,
        allowFallback,
        language: store.getSettings(userId)?.language,
      })).okrStructure;
  // allowFallback:false + generation failed → report honestly, mutate nothing
  // (the old tree, if replacing, is still intact — see ordering note below).
  if (!okrStructure) {
    return { goal, created: [], tasks: [], failed: true, message: '规划生成失败（模型输出异常），未做任何修改' };
  }

  // Clear the old tree only AFTER the new structure is in hand — clearing
  // first left a ~60s LLM window where a crash or failed generation destroyed
  // the user's existing plan with nothing to replace it.
  if (existing.length > 0) {
    // 重新拆解：清掉旧子目标树 + 作废未完成的旧任务（已完成保留为历史），再重建。
    if (store.cancelOpenTasksByGoal) store.cancelOpenTasksByGoal(userId, goal.id);
    if (store.deleteDescendantGoals) store.deleteDescendantGoals(userId, goal.id);
  }

  const dim = goal.life_wheel_dimension || 'growth';
  const created = [];
  const krMap = {};
  const mMap = {};
  // month(original id) → its KR's real db id, resolved once at creation time.
  const monthToRealKr = {};

  for (const kr of okrStructure.keyResults || []) {
    const node = store.createGoal(userId, {
      title: kr.title, description: kr.description || '',
      life_wheel_dimension: dim, parent_id: goal.id, level: 'key_result', status: 'active',
    });
    if (kr.id) krMap[kr.id] = node.id;
    created.push(node);
  }
  // Best-effort fallback when a monthly goal's keyResultId doesn't match any
  // KR above (LLM id drift/hallucination): attach it to the first KR instead
  // of silently falling back to the O, which would otherwise strand its
  // tasks with key_result_id=null further down.
  const firstKrId = created.find((g) => g.level === 'key_result')?.id || null;
  for (const m of okrStructure.monthlyGoals || []) {
    const resolvedKrId = krMap[m.keyResultId] || firstKrId || goal.id;
    const node = store.createGoal(userId, {
      title: m.title, description: m.description || '',
      life_wheel_dimension: dim, parent_id: resolvedKrId, level: 'monthly', status: 'active',
    });
    if (m.id) {
      mMap[m.id] = node.id;
      monthToRealKr[m.id] = resolvedKrId === goal.id ? null : resolvedKrId;
    }
    created.push(node);
  }
  // OKR 树到 KR / 月度为止;具体待办只存在 tasks 表(挂 key_result_id),不再建
  // level='task' 伪节点(避免「目标节点」与「可执行待办」两份重复)。

  // Materialize near-term tasks as real, scheduled-from-today execution items
  // so 今日/未来 immediately has actionable work. Each ToDo links up to its KR
  // (key_result_id) so progress rolls ToDo→KR→O. Prefer the first month, but
  // a task whose monthlyGoalId doesn't match any generated month (id drift)
  // is still mounted via the fallback below instead of silently dropped.
  const firstMonthId = (okrStructure.monthlyGoals || [])[0]?.id;
  const monthNodeId = firstMonthId ? (mMap[firstMonthId] || null) : null;
  const firstMonthKrId = firstMonthId ? (monthToRealKr[firstMonthId] || null) : null;
  const knownMonthIds = new Set((okrStructure.monthlyGoals || []).map((m) => m.id).filter(Boolean));
  const nearTermTasks = (okrStructure.tasks || [])
    .filter((t) => !firstMonthId || t.monthlyGoalId === firstMonthId || !knownMonthIds.has(t.monthlyGoalId))
    .slice(0, 8);
  const taskDrafts = nearTermTasks.map((t, i) => {
    const offset = Number.isFinite(t.dayOffset) ? Math.max(0, t.dayOffset) : i;
    const dt = new Date();
    dt.setDate(dt.getDate() + offset);
    // t.monthlyGoalId only counts as "own" if it resolved to a real node above;
    // otherwise fall back to the first month/KR rather than leaving both null.
    const ownMonthId = mMap[t.monthlyGoalId] ? t.monthlyGoalId : null;
    const planNodeId = ownMonthId ? mMap[ownMonthId] : monthNodeId;
    const keyResultId = ownMonthId ? (monthToRealKr[ownMonthId] || firstKrId) : (firstMonthKrId || firstKrId);
    return {
      title: t.title,
      description: t.description || '',
      estimated_duration: t.estimatedDuration || t.estimated_duration || 30,
      energy_level: t.energyLevel || t.energy_level || 'medium',
      is_mit: !!t.isMIT || i === 0,
      scheduled_date: dt.toISOString().slice(0, 10),
      goal_id: goal.id,
      key_result_id: keyResultId || null,
      plan_node_id: planNodeId || null,
    };
  });
  const materializedTasks = taskDrafts.length ? store.createTasks(userId, taskDrafts) : [];

  return {
    goal, created, tasks: materializedTasks,
    message: `已规划为 ${created.length} 个节点，并生成 ${materializedTasks.length} 个近期可执行待办`,
  };
}

export default {
  generateClarifyQuestions,
  generateSmartPlan,
  generateAdjustmentSuggestion,
  checkLifeWheelBalance,
  generateChatResponse,
  generateOkrStructure,
  generateGoalPlan,
  expandPlanToTasks,
  breakdownTask,
  decomposeGoalToOkr,
};


