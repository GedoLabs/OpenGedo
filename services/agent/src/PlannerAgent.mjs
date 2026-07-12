/**
 * PlannerAgent - 智能规划代理
 * 
 * 负责：
 * 1. 目标澄清：通过多轮对话理解用户真实需求
 * 2. SMART 拆解：将模糊目标转化为可衡量的具体目标
 * 3. 任务生成：基于目标和用户习惯生成行动计划
 * 4. 动态调整：根据执行反馈调整计划
 */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

export class PlannerAgent {
  constructor(token, llmProvider) {
    this.token = token;
    this.llmProvider = llmProvider; // LLM 提供者接口
  }

  /**
   * 调用 Backend API
   */
  async callAPI(path, method, body) {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
  }

  /**
   * 澄清目标
   * 
   * @param {string} prompt - 用户的目标描述
   * @param {Array} relatedMemories - 相关记忆
   * @returns {Object} 澄清问题和选项
   */
  async clarifyGoal(prompt, relatedMemories = []) {
    // 构建 prompt 给 LLM
    const systemPrompt = `你是一个目标规划助手。用户描述了一个目标，你需要通过提问来澄清目标细节。
    
请根据用户的目标描述，生成 3-5 个澄清问题。每个问题应该：
1. 帮助明确目标的具体性、可衡量性、可实现性、相关性或时限性
2. 提供 2-4 个选项供用户选择（降低决策成本）
3. 考虑用户的历史记忆和习惯

输出格式（JSON）：
{
  "questions": [
    {
      "id": "q1",
      "question": "问题内容",
      "options": [
        { "id": "opt1", "label": "选项1" },
        { "id": "opt2", "label": "选项2" }
      ],
      "field": "对应的SMART字段（specific/measurable/achievable/relevant/timeBound）"
    }
  ],
  "suggestedDimension": "建议的生命之花维度",
  "memoryInsights": ["基于用户记忆的洞察"]
}`;

    const userPrompt = `用户目标：${prompt}

${relatedMemories.length > 0 ? `相关记忆：
${relatedMemories.map(m => `- ${m.content}`).join('\n')}` : ''}

请生成澄清问题。`;

    try {
      const response = await this.llmProvider.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      
      return JSON.parse(response.content);
    } catch (error) {
      // 降级：返回默认问题
      return {
        questions: [
          {
            id: 'dimension',
            question: '这个目标属于人生的哪个维度？',
            options: [
              { id: 'career', label: '事业' },
              { id: 'health', label: '健康' },
              { id: 'growth', label: '成长' },
              { id: 'family', label: '家庭' },
            ],
            field: 'relevant',
          },
          {
            id: 'timeframe',
            question: '你希望在什么时间范围内实现？',
            options: [
              { id: '1month', label: '1个月内' },
              { id: '3months', label: '3个月内' },
              { id: '6months', label: '半年内' },
              { id: '1year', label: '1年内' },
            ],
            field: 'timeBound',
          },
          {
            id: 'measurable',
            question: '如何衡量这个目标是否达成？',
            options: [],
            field: 'measurable',
          },
        ],
        suggestedDimension: 'growth',
        memoryInsights: [],
      };
    }
  }

  /**
   * 生成 SMART 目标
   * 
   * @param {string} prompt - 原始目标描述
   * @param {Object} answers - 澄清问题的答案
   * @returns {Object} SMART 目标和任务列表
   */
  async generateSMARTGoal(prompt, answers) {
    const systemPrompt = `你是一个目标规划专家。请将用户的目标转化为 SMART 格式，并生成执行计划。

SMART 原则：
- Specific（具体）：明确要做什么
- Measurable（可衡量）：有明确的指标
- Achievable（可实现）：基于现有资源和能力可达成
- Relevant（相关）：与用户的价值观和长期目标一致
- Time-bound（有时限）：有明确的截止日期

输出格式（JSON）：
{
  "goal": {
    "title": "目标标题",
    "description": "详细描述",
    "specific": "具体内容",
    "measurable": "衡量标准",
    "achievable": "可行性分析",
    "relevant": "相关性说明",
    "timeBound": "时限",
    "dimension": "生命之花维度"
  },
  "tasks": [
    {
      "title": "任务标题",
      "description": "任务描述",
      "scheduledDate": "YYYY-MM-DD",
      "estimatedDuration": 30,
      "energyLevel": "low|medium|high",
      "priority": 1-5
    }
  ],
  "balanceWarning": "生命之花平衡提醒（可选）"
}`;

    const userPrompt = `原始目标：${prompt}

用户回答：
${Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

请生成 SMART 目标和执行计划。`;

    try {
      const response = await this.llmProvider.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      
      return JSON.parse(response.content);
    } catch (error) {
      // 降级：返回基础结构
      return {
        goal: {
          title: prompt,
          description: '',
          specific: prompt,
          measurable: answers.measurable || '完成所有子任务',
          achievable: '基于时间投入可实现',
          relevant: '与个人发展相关',
          timeBound: answers.timeframe || '3个月',
          dimension: answers.dimension || 'growth',
        },
        tasks: [
          { title: '制定详细计划', scheduledDate: this.getTodayDate(), estimatedDuration: 30, energyLevel: 'medium', priority: 4 },
          { title: '开始执行第一步', scheduledDate: this.getTodayDate(1), estimatedDuration: 60, energyLevel: 'high', priority: 4 },
        ],
        balanceWarning: null,
      };
    }
  }

  /**
   * 生成调整建议
   * 
   * @param {Object} task - 未完成的任务
   * @param {string} reasonCode - 未完成原因
   * @param {string} reasonNote - 原因备注
   * @returns {Object} 调整建议
   */
  async generateAdjustment(task, reasonCode, reasonNote) {
    const systemPrompt = `你是一个计划调整助手。用户没有完成某个任务，你需要根据原因提供调整建议。

调整类型：
- split：将任务拆分为更小的部分
- reschedule：重新安排到更合适的时间
- postpone：顺延到明天
- cancel：取消任务

输出格式（JSON）：
{
  "adjustmentType": "split|reschedule|postpone|cancel",
  "reason": "调整原因说明",
  "suggestion": {
    "message": "建议说明",
    "options": [
      { "id": "opt1", "label": "选项说明", "action": "具体操作" }
    ]
  }
}`;

    const userPrompt = `任务：${task.title}
预计时长：${task.estimatedDuration || 30} 分钟
能量等级：${task.energyLevel || 'medium'}
未完成原因：${reasonCode}
${reasonNote ? `备注：${reasonNote}` : ''}

请提供调整建议。`;

    try {
      const response = await this.llmProvider.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      
      return JSON.parse(response.content);
    } catch (error) {
      // 降级：根据原因返回默认建议
      const defaultAdjustments = {
        time_insufficient: {
          adjustmentType: 'split',
          reason: '时间不够，建议拆分任务',
          suggestion: {
            message: '将任务拆分为更小的部分',
            options: [
              { id: 'split_2', label: '拆分为2个子任务', action: 'split_2' },
              { id: 'split_3', label: '拆分为3个子任务', action: 'split_3' },
            ],
          },
        },
        energy_low: {
          adjustmentType: 'reschedule',
          reason: '精力不足，建议调整到高效时段',
          suggestion: {
            message: '调整到你的高效时段',
            options: [
              { id: 'morning', label: '改到明早', action: 'reschedule_morning' },
              { id: 'tomorrow', label: '顺延到明天', action: 'postpone_1day' },
            ],
          },
        },
      };
      
      return defaultAdjustments[reasonCode] || {
        adjustmentType: 'postpone',
        reason: '建议顺延任务',
        suggestion: {
          message: '顺延到明天继续',
          options: [
            { id: 'tomorrow', label: '顺延到明天', action: 'postpone_1day' },
          ],
        },
      };
    }
  }

  /**
   * 检查生命之花平衡
   */
  async checkLifeWheelBalance() {
    const snapshot = await this.callAPI('/v1/lifetree/snapshot', 'GET');
    
    if (!snapshot.goals) return { balanced: true, warnings: [] };
    
    // 统计各维度目标数量
    const dimensionCounts = {};
    snapshot.goals.forEach(g => {
      dimensionCounts[g.life_wheel_dimension] = (dimensionCounts[g.life_wheel_dimension] || 0) + 1;
    });
    
    const warnings = [];
    const total = snapshot.goals.length;
    
    // 检查是否有维度过于集中
    Object.entries(dimensionCounts).forEach(([dim, count]) => {
      if (count / total > 0.5) {
        warnings.push(`目标过于集中在"${dim}"维度，建议关注其他维度的平衡`);
      }
    });
    
    // 检查是否有维度完全空缺
    const allDimensions = ['health', 'career', 'family', 'finance', 'growth', 'social', 'hobby', 'self_realization'];
    const emptyDimensions = allDimensions.filter(d => !dimensionCounts[d]);
    if (emptyDimensions.length > 4) {
      warnings.push(`有 ${emptyDimensions.length} 个维度没有目标，考虑平衡发展`);
    }
    
    return {
      balanced: warnings.length === 0,
      warnings,
      dimensionCounts,
    };
  }

  // 辅助函数
  getTodayDate(daysOffset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return date.toISOString().split('T')[0];
  }
}






















