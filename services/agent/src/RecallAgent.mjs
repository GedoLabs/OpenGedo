/**
 * RecallAgent - 记忆召回代理
 * 
 * 负责：
 * 1. 场景化唤醒：在特定场景下主动召回相关记忆
 * 2. 重要日期提醒：提前唤醒日期相关记忆
 * 3. 模式识别：识别用户的行为模式并提取为技能/特质
 * 4. 目标关联：创建目标时自动关联相关经验和能力
 */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8787';

export class RecallAgent {
  constructor(token, llmProvider) {
    this.token = token;
    this.llmProvider = llmProvider;
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
   * 场景化召回：创建目标时
   * 
   * @param {string} goalTitle - 目标标题
   * @param {string} goalDimension - 目标维度
   * @returns {Array} 相关记忆和洞察
   */
  async recallForGoalCreation(goalTitle, goalDimension) {
    // 1. 语义搜索相关记忆
    const searchResult = await this.callAPI('/v1/memory/search', 'POST', {
      query: goalTitle,
      limit: 10,
    });
    
    const memories = searchResult.memories || [];
    
    // 2. 搜索相关技能
    const skillResult = await this.callAPI('/v1/memory/search', 'POST', {
      query: `擅长 能力 技能 ${goalTitle}`,
      type: 'personal_trait',
      limit: 5,
    });
    
    const skills = skillResult.memories || [];
    
    // 3. 搜索相关经验
    const experienceResult = await this.callAPI('/v1/memory/search', 'POST', {
      query: `经验 做过 参与 ${goalTitle}`,
      type: 'key_event',
      limit: 5,
    });
    
    const experiences = experienceResult.memories || [];
    
    // 4. 使用 LLM 生成洞察
    const insights = await this.generateInsights(goalTitle, [...memories, ...skills, ...experiences]);
    
    return {
      relatedMemories: memories.slice(0, 3).map(m => ({
        id: m.id,
        content: m.content_raw,
        type: m.type,
        relevance: this.getRelevanceLabel(m),
      })),
      relatedSkills: skills.map(s => ({
        id: s.id,
        content: s.content_raw,
        relevance: '可作为能力证据',
      })),
      relatedExperiences: experiences.map(e => ({
        id: e.id,
        content: e.content_raw,
        relevance: '相关经验',
      })),
      insights,
    };
  }

  /**
   * 场景化召回：重要日期提醒
   * 
   * @param {number} daysAhead - 提前天数
   * @returns {Array} 即将到来的重要日期
   */
  async recallUpcomingDates(daysAhead = 7) {
    // 获取未来 N 天的日期提醒
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + daysAhead);
    
    const result = await this.callAPI('/v1/memory/search', 'POST', {
      query: '',
      type: 'date_reminder',
      limit: 20,
    });
    
    const memories = result.memories || [];
    
    // 筛选即将到来的日期
    const upcoming = memories.filter(m => {
      if (!m.reminder_date) return false;
      const reminderDate = new Date(m.reminder_date);
      return reminderDate >= today && reminderDate <= futureDate;
    });
    
    // 为每个日期生成行动建议
    const withSuggestions = await Promise.all(
      upcoming.map(async (m) => {
        const suggestion = await this.generateDateSuggestion(m);
        return {
          id: m.id,
          content: m.content_raw,
          reminderDate: m.reminder_date,
          daysUntil: this.getDaysUntil(m.reminder_date),
          suggestion,
        };
      })
    );
    
    return withSuggestions;
  }

  /**
   * 模式识别：检测重复记录
   * 
   * @returns {Array} 识别到的模式
   */
  async detectPatterns() {
    // 获取最近的记忆
    const result = await this.callAPI('/v1/memory/search', 'POST', {
      query: '',
      limit: 100,
    });
    
    const memories = result.memories || [];
    
    // 简单的模式检测：查找重复出现的关键词
    const patterns = [];
    const keywordCounts = {};
    
    memories.forEach(m => {
      // 提取关键词（这里用简单的分词，实际应该用 NLP）
      const words = m.content_raw.split(/[\s,，。！？、]+/).filter(w => w.length > 2);
      words.forEach(w => {
        keywordCounts[w] = (keywordCounts[w] || 0) + 1;
      });
    });
    
    // 找出高频关键词
    Object.entries(keywordCounts)
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([keyword, count]) => {
        patterns.push({
          keyword,
          count,
          suggestion: `你多次提到"${keyword}"，是否要将其标记为技能或特质？`,
          action: 'create_skill',
        });
      });
    
    return patterns;
  }

  /**
   * 生成复盘洞察
   * 
   * @param {string} period - 周期（daily/weekly/monthly）
   * @returns {Object} 复盘洞察
   */
  async generateReflectionInsights(period = 'weekly') {
    // 获取周期内的打卡记录
    const checkinsResult = await this.callAPI('/v1/execution/checkins', 'POST', {
      period,
    });
    
    const checkins = checkinsResult.checkins || [];
    
    // 统计完成情况
    const stats = {
      total: checkins.length,
      completed: checkins.filter(c => c.status === 'completed').length,
      notCompleted: checkins.filter(c => c.status === 'not_completed').length,
      partial: checkins.filter(c => c.status === 'partial').length,
    };
    
    // 统计未完成原因
    const reasonCounts = {};
    checkins
      .filter(c => c.reason_code)
      .forEach(c => {
        reasonCounts[c.reason_code] = (reasonCounts[c.reason_code] || 0) + 1;
      });
    
    // 生成洞察
    const insights = [];
    
    // 完成率洞察
    const completionRate = stats.total > 0 ? (stats.completed / stats.total * 100).toFixed(0) : 0;
    if (completionRate >= 80) {
      insights.push(`完成率 ${completionRate}%，保持得很好！`);
    } else if (completionRate >= 60) {
      insights.push(`完成率 ${completionRate}%，还有提升空间。`);
    } else {
      insights.push(`完成率 ${completionRate}%，建议调整任务安排或预期。`);
    }
    
    // 未完成原因洞察
    const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
    if (topReason) {
      const reasonLabels = {
        time_insufficient: '时间不够',
        energy_low: '精力不足',
        priority_changed: '优先级变更',
        external_interrupt: '外部打断',
        forgot: '忘记了',
      };
      insights.push(`"${reasonLabels[topReason[0]] || topReason[0]}"是最常见的未完成原因（${topReason[1]}次），建议针对性优化。`);
    }
    
    return {
      period,
      stats,
      reasonCounts,
      insights,
      suggestedActions: this.getSuggestedActions(stats, reasonCounts),
    };
  }

  /**
   * 生成记忆相关洞察
   */
  async generateInsights(goalTitle, memories) {
    if (memories.length === 0) return [];
    
    const systemPrompt = `根据用户的目标和相关记忆，生成 2-3 条洞察。
洞察应该：
1. 指出用户可以利用的优势
2. 提醒潜在的挑战
3. 建议可借鉴的经验

输出格式（JSON 数组）：
["洞察1", "洞察2", "洞察3"]`;

    const userPrompt = `目标：${goalTitle}

相关记忆：
${memories.slice(0, 5).map(m => `- ${m.content_raw}`).join('\n')}

请生成洞察。`;

    try {
      const response = await this.llmProvider.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      
      return JSON.parse(response.content);
    } catch {
      return ['基于你的历史记录，这个目标是可实现的'];
    }
  }

  /**
   * 为日期提醒生成建议
   */
  async generateDateSuggestion(memory) {
    const daysUntil = this.getDaysUntil(memory.reminder_date);
    
    if (daysUntil <= 1) {
      return '就在明天！请确认准备工作已完成。';
    } else if (daysUntil <= 3) {
      return '即将到来，建议开始准备。';
    } else {
      return '还有时间，可以提前规划。';
    }
  }

  /**
   * 根据统计生成建议行动
   */
  getSuggestedActions(stats, reasonCounts) {
    const actions = [];
    
    if (reasonCounts.time_insufficient > 2) {
      actions.push({
        type: 'split_tasks',
        message: '建议将大任务拆分为更小的部分',
      });
    }
    
    if (reasonCounts.energy_low > 2) {
      actions.push({
        type: 'reschedule',
        message: '建议将重要任务安排在高能量时段',
      });
    }
    
    if (stats.notCompleted > stats.completed) {
      actions.push({
        type: 'reduce_load',
        message: '建议减少每日任务数量，提高完成质量',
      });
    }
    
    return actions;
  }

  // 辅助函数
  getRelevanceLabel(memory) {
    switch (memory.type) {
      case 'personal_trait':
        return '可作为能力证据';
      case 'key_event':
        return '相关经验';
      case 'important_info':
        return '参考信息';
      default:
        return '相关记忆';
    }
  }

  getDaysUntil(dateStr) {
    const target = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = target - today;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}






















