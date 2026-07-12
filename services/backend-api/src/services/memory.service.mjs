/**
 * 智忆服务 - 混合检索实现（记忆 → 能力证据链）
 * 
 * 结合结构化查询和向量检索，通过 Rerank 精排返回最相关结果
 */

import { createLLMProvider } from '../llm/provider.mjs';
import { getLLMRouter } from '../llm/router.mjs';

/**
 * 记忆类型配置
 */
const MEMORY_TYPES = {
  important_info: { isKey: false, label: '重要信息' },
  personal_trait: { isKey: true, label: '个人特质' },
  key_event: { isKey: true, label: '关键事件' },
  date_reminder: { isKey: true, label: '日期提醒' },
};

/**
 * 系统标签
 */
const SYSTEM_TAGS = ['self_awareness', 'growth_journey', 'goal_related', 'relationship'];

export class MemoryService {
  constructor(db) {
    this.db = db;
    this.llm = createLLMProvider();
  }

  /**
   * 创建记忆
   */
  async createMemory(userId, input) {
    const { type, content_raw, source, user_tags, reminder_date, attachment_url } = input;

    // 1. LLM 提取结构化信息
    const extracted = await this.extractStructuredInfo(content_raw, type);

    // 2. 生成向量嵌入
    const embedding = await this.llm.embed(content_raw);

    // 3. 存储记忆
    const memory = await this.db.query(
      `INSERT INTO memories (
        user_id, type, content_raw, content_struct, source,
        system_tags, user_tags, embedding, confidence,
        reminder_date, attachment_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        userId,
        type,
        content_raw,
        JSON.stringify(extracted.content_struct),
        source || 'text',
        extracted.system_tags,
        user_tags || [],
        JSON.stringify(embedding), // pgvector 需要数组格式
        1.0, // 主动记录的可信度为 1
        reminder_date,
        attachment_url,
      ]
    );

    // 4. 如果提取到技能，更新技能表
    if (extracted.skills && extracted.skills.length > 0) {
      await this.updateSkills(userId, memory.id, extracted.skills);
    }

    return memory;
  }

  /**
   * LLM 提取结构化信息
   */
  async extractStructuredInfo(content, type) {
    const prompt = `请从以下内容中提取结构化信息。

内容：${content}

请输出 JSON 格式：
{
  "system_tags": ["self_awareness" | "growth_journey" | "goal_related" | "relationship"],
  "people": ["提取的人名"],
  "dates": ["提取的日期"],
  "skills": ["提取的技能关键词"],
  "traits": ["提取的性格特征"],
  "emotions": ["提取的情绪"],
  "conclusions": ["提取的关键结论"],
  "locations": ["提取的地点"]
}

只输出 JSON，不要其他内容。`;

    try {
      // chat 类调用走任务路由（gedo 优先）；this.llm 仅保留给 embed/rerank
      const response = await getLLMRouter().runTask('memory.struct.extract', [
        { role: 'system', content: '你是一个信息提取助手，请从文本中提取结构化信息。' },
        { role: 'user', content: prompt },
      ]);

      const extracted = response.json;
      
      // 验证 system_tags
      const validTags = (extracted.system_tags || []).filter(t => SYSTEM_TAGS.includes(t));
      
      return {
        content_struct: {
          people: extracted.people || [],
          dates: extracted.dates || [],
          skills: extracted.skills || [],
          traits: extracted.traits || [],
          emotions: extracted.emotions || [],
          conclusions: extracted.conclusions || [],
          locations: extracted.locations || [],
        },
        system_tags: validTags.length > 0 ? validTags : ['self_awareness'],
        skills: extracted.skills || [],
      };
    } catch (error) {
      console.error('[MemoryService] extract error:', error);
      // 降级：根据类型自动打标
      const defaultTags = {
        personal_trait: ['self_awareness'],
        key_event: ['growth_journey'],
        date_reminder: ['relationship'],
        important_info: ['goal_related'],
      };
      return {
        content_struct: {},
        system_tags: defaultTags[type] || ['self_awareness'],
        skills: [],
      };
    }
  }

  /**
   * 更新技能表
   */
  async updateSkills(userId, memoryId, skills) {
    for (const skillName of skills) {
      // 创建或更新技能
      const skill = await this.db.query(
        `INSERT INTO skills (user_id, name, evidence_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, name) 
         DO UPDATE SET evidence_count = skills.evidence_count + 1, updated_at = now()
         RETURNING id`,
        [userId, skillName]
      );

      // 关联记忆
      await this.db.query(
        `INSERT INTO skill_memories (skill_id, memory_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [skill.id, memoryId]
      );
    }
  }

  /**
   * 混合检索
   * 
   * 1. 结构化查询：根据类型、标签、日期筛选
   * 2. 向量检索：语义相似度
   * 3. Rerank 精排
   */
  async hybridSearch(userId, query, options = {}) {
    // ── FEATURE_HYBRID_V2: 4-way retrieval + RRF + rerank ─────────────────
    if (process.env.FEATURE_HYBRID_V2 === 'true') {
      const { run } = await import('../memory/retrieval/index.mjs');
      return run(this.db, this.llm, userId, query, {
        topK:          options.limit ?? 10,
        type:          options.type,
        tags:          options.tags,
        intentType:    options.intentType ?? 'default',
        compress:      options.compress ?? false,
        useLLMCompress: options.useLLMCompress ?? false,
      });
    }

    const { type, tags, limit = 10, includeVector = true } = options;

    // 1. 生成查询向量
    const queryEmbedding = includeVector ? await this.llm.embed(query) : null;

    // 2. 构建 SQL 查询
    let sql = `
      SELECT 
        m.*,
        CASE WHEN $3::vector IS NOT NULL 
          THEN 1 - (m.embedding <=> $3::vector) 
          ELSE 0 
        END as vector_score
      FROM memories m
      WHERE m.user_id = $1
    `;
    const params = [userId, query, queryEmbedding ? JSON.stringify(queryEmbedding) : null];
    let paramIndex = 4;

    // 类型筛选
    if (type) {
      sql += ` AND m.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // 标签筛选
    if (tags && tags.length > 0) {
      sql += ` AND (m.system_tags && $${paramIndex} OR m.user_tags && $${paramIndex})`;
      params.push(tags);
      paramIndex++;
    }

    // 全文搜索（简单实现）
    if (query) {
      sql += ` AND m.content_raw ILIKE $${paramIndex}`;
      params.push(`%${query}%`);
      paramIndex++;
    }

    // 排序和限制
    sql += `
      ORDER BY 
        CASE WHEN m.type IN ('personal_trait', 'key_event', 'date_reminder') THEN 0 ELSE 1 END,
        vector_score DESC,
        m.impact_score DESC,
        m.created_at DESC
      LIMIT $${paramIndex}
    `;
    params.push(limit * 3); // 取 3 倍用于 rerank

    // 3. 执行查询
    const candidates = await this.db.queryAll(sql, params);

    if (candidates.length === 0) {
      return [];
    }

    // 4. Rerank 精排
    if (includeVector && candidates.length > limit) {
      const reranked = await this.llm.rerank(
        query,
        candidates.map(c => c.content_raw)
      );

      // 按 rerank 分数重新排序
      const rerankedResults = reranked
        .slice(0, limit)
        .map(r => ({
          ...candidates[r.index],
          rerank_score: r.score,
        }));

      return rerankedResults;
    }

    return candidates.slice(0, limit);
  }

  /**
   * 场景化召回
   */
  async contextualRecall(userId, context, params = {}) {
    switch (context) {
      case 'goal_creation':
        return this.recallForGoal(userId, params.goalTitle);

      case 'upcoming_dates':
        return this.recallUpcomingDates(userId, params.daysAhead || 7);

      case 'skill_evidence':
        return this.recallSkillEvidence(userId, params.skillName);

      case 'reflection':
        return this.recallForReflection(userId, params.period);

      default:
        return [];
    }
  }

  /**
   * 创建目标时召回相关记忆
   */
  async recallForGoal(userId, goalTitle) {
    // 1. 语义搜索相关经验
    const experiences = await this.hybridSearch(userId, goalTitle, {
      type: 'key_event',
      limit: 5,
    });

    // 2. 搜索相关技能
    const traits = await this.hybridSearch(userId, goalTitle, {
      type: 'personal_trait',
      limit: 5,
    });

    // 3. 搜索相关信息
    const info = await this.hybridSearch(userId, goalTitle, {
      type: 'important_info',
      limit: 5,
    });

    // 4. 去重合并
    const all = [...experiences, ...traits, ...info];
    const unique = all.filter((m, i, arr) => 
      arr.findIndex(x => x.id === m.id) === i
    );

    // 5. 生成洞察
    const insights = await this.generateInsights(goalTitle, unique);

    return {
      memories: unique.slice(0, 5).map(m => ({
        id: m.id,
        content: m.content_raw,
        type: m.type,
        relevance: this.getRelevanceLabel(m, goalTitle),
      })),
      insights,
    };
  }

  /**
   * 召回即将到来的重要日期
   */
  async recallUpcomingDates(userId, daysAhead) {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + daysAhead);

    const memories = await this.db.queryAll(
      `SELECT * FROM memories 
       WHERE user_id = $1 
         AND type = 'date_reminder'
         AND reminder_date >= $2
         AND reminder_date <= $3
       ORDER BY reminder_date ASC`,
      [userId, today.toISOString().split('T')[0], futureDate.toISOString().split('T')[0]]
    );

    return memories.map(m => ({
      id: m.id,
      content: m.content_raw,
      reminderDate: m.reminder_date,
      daysUntil: Math.ceil((new Date(m.reminder_date) - today) / (1000 * 60 * 60 * 24)),
    }));
  }

  /**
   * 召回技能证据
   */
  async recallSkillEvidence(userId, skillName) {
    const memories = await this.db.queryAll(
      `SELECT m.* FROM memories m
       JOIN skill_memories sm ON m.id = sm.memory_id
       JOIN skills s ON sm.skill_id = s.id
       WHERE s.user_id = $1 AND s.name ILIKE $2
       ORDER BY m.impact_score DESC, m.created_at DESC
       LIMIT 10`,
      [userId, `%${skillName}%`]
    );

    return memories;
  }

  /**
   * 复盘召回
   */
  async recallForReflection(userId, period) {
    const periodDays = {
      daily: 1,
      weekly: 7,
      monthly: 30,
    };
    const days = periodDays[period] || 7;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const memories = await this.db.queryAll(
      `SELECT * FROM memories 
       WHERE user_id = $1 
         AND created_at >= $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId, since.toISOString()]
    );

    return memories;
  }

  /**
   * 生成记忆相关洞察
   */
  async generateInsights(goalTitle, memories) {
    if (memories.length === 0) return [];

    const prompt = `基于用户的目标和相关记忆，生成 2-3 条简短洞察。

目标：${goalTitle}

相关记忆：
${memories.slice(0, 5).map(m => `- ${m.content_raw}`).join('\n')}

请输出 JSON 数组格式：
["洞察1", "洞察2", "洞察3"]`;

    try {
      const response = await getLLMRouter().runTask('memory.insights', [
        { role: 'user', content: prompt },
      ]);
      return Array.isArray(response.json) ? response.json : [];
    } catch {
      return ['基于你的历史记录，这个目标是可实现的'];
    }
  }

  /**
   * 获取相关性标签
   */
  getRelevanceLabel(memory, context) {
    const labels = {
      personal_trait: '可作为能力证据',
      key_event: '相关经验',
      date_reminder: '时间节点',
      important_info: '参考信息',
    };
    return labels[memory.type] || '相关记忆';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // P3-A: L1-L5 Layer Abstraction
  // 通过 FEATURE_LAYERED_MEMORY 环境变量控制开关。
  // 所有新方法不改动上方任何已有签名，RecallAgent / PlannerAgent 仅在 flag
  // 开启后切换到新路径。
  // ══════════════════════════════════════════════════════════════════════════

  _layerEnabled() {
    return process.env.FEATURE_LAYERED_MEMORY === 'true';
  }

  // ── L1: Identity Profile ─────────────────────────────────────────────────

  /**
   * 获取用户身份画像（L1）。若不存在则创建空行。
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async getL1(userId) {
    const existing = await this.db.queryOne(
      'SELECT * FROM identity_profile WHERE user_id = $1',
      [userId]
    ).catch(() => null);
    if (existing) return existing;

    // 首次：插入空行
    return this.db.queryOne(
      `INSERT INTO identity_profile (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [userId]
    ).catch(() => null);
  }

  /**
   * 更新身份画像字段（只更新非 null 字段）。
   * @param {string} userId
   * @param {Partial<IdentityProfile>} patch
   */
  async upsertL1(userId, patch) {
    const allowed = [
      'display_name','birth_year','timezone','language',
      'life_vision','core_values','personality_traits',
      'strengths','growth_edges','important_relationships','anxiety_snapshot',
    ];
    const updates = [];
    const vals    = [userId];
    let   idx     = 2;
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        updates.push(`${key} = $${idx}`);
        vals.push(patch[key]);
        idx++;
      }
    }
    if (!updates.length) return null;

    return this.db.queryOne(
      `INSERT INTO identity_profile (user_id, ${allowed.filter(k => patch[k] !== undefined).join(', ')})
       VALUES ($1, ${vals.slice(1).map((_, i) => `$${i+2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE
         SET ${updates.join(', ')}, updated_at = now()
       RETURNING *`,
      vals
    ).catch(() => null);
  }

  // ── L2: Semantic Profile ─────────────────────────────────────────────────

  /**
   * 获取指定维度的语义画像，或全部 8 个维度。
   * @param {string} userId
   * @param {string} [dimension]
   */
  async getL2(userId, dimension) {
    if (dimension) {
      return this.db.queryOne(
        'SELECT * FROM semantic_profile WHERE user_id = $1 AND dimension = $2',
        [userId, dimension]
      ).catch(() => null);
    }
    return this.db.queryAll(
      'SELECT * FROM semantic_profile WHERE user_id = $1 ORDER BY dimension',
      [userId]
    ).catch(() => []);
  }

  /**
   * 增量更新某个维度的语义摘要。
   * @param {string} userId
   * @param {string} dimension
   * @param {{ summary?, keywords?, embedding?, source_memory_ids?, confidence? }} data
   */
  async upsertL2(userId, dimension, data) {
    const { summary, keywords, embedding, source_memory_ids, confidence } = data;
    return this.db.queryOne(
      `INSERT INTO semantic_profile
         (user_id, dimension, summary, keywords, embedding, source_memory_ids, confidence, refreshed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_id, dimension) DO UPDATE
         SET summary           = COALESCE($3, semantic_profile.summary),
             keywords          = COALESCE($4, semantic_profile.keywords),
             embedding         = COALESCE($5, semantic_profile.embedding),
             source_memory_ids = COALESCE($6, semantic_profile.source_memory_ids),
             confidence        = COALESCE($7, semantic_profile.confidence),
             refreshed_at      = now(),
             updated_at        = now()
       RETURNING *`,
      [userId, dimension, summary ?? null, keywords ?? null,
       embedding ? JSON.stringify(embedding) : null,
       source_memory_ids ?? null, confidence ?? null]
    ).catch(() => null);
  }

  // ── L3: Working Memory ────────────────────────────────────────────────────

  /**
   * 获取或初始化工作记忆（会话级）。
   * @param {string} userId
   * @param {string} sessionId  — conversation_id
   */
  async getL3(userId, sessionId) {
    return this.db.queryOne(
      'SELECT * FROM working_memory WHERE user_id = $1 AND session_id = $2',
      [userId, sessionId]
    ).catch(() => null);
  }

  /**
   * 更新工作记忆（UPSERT）。
   * @param {string} userId
   * @param {string} sessionId
   * @param {{ current_intent?, active_goal_ids?, recent_topics?, context_window?, emotion_signal? }} patch
   */
  async upsertL3(userId, sessionId, patch) {
    const {
      current_intent, active_goal_ids, recent_topics,
      context_window, emotion_signal,
    } = patch;

    return this.db.queryOne(
      `INSERT INTO working_memory
         (user_id, session_id, current_intent, active_goal_ids, recent_topics, context_window,
          emotion_signal, emotion_updated_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
         CASE WHEN $7 IS NOT NULL THEN now() END,
         now() + INTERVAL '24 hours')
       ON CONFLICT (user_id, session_id) DO UPDATE
         SET current_intent   = COALESCE($3,  working_memory.current_intent),
             active_goal_ids  = COALESCE($4,  working_memory.active_goal_ids),
             recent_topics    = COALESCE($5,  working_memory.recent_topics),
             context_window   = COALESCE($6,  working_memory.context_window),
             emotion_signal   = COALESCE($7,  working_memory.emotion_signal),
             emotion_updated_at = CASE WHEN $7 IS NOT NULL THEN now()
                                       ELSE working_memory.emotion_updated_at END,
             expires_at       = now() + INTERVAL '24 hours',
             updated_at       = now()
       RETURNING *`,
      [userId, sessionId,
       current_intent   ?? null,
       active_goal_ids  ?? null,
       recent_topics    ?? null,
       context_window   ? JSON.stringify(context_window) : null,
       emotion_signal   ?? null]
    ).catch(() => null);
  }

  // ── L4: Episodic Search (layered-aware) ──────────────────────────────────

  /**
   * L4 感知的混合检索：在 FEATURE_LAYERED_MEMORY=on 时
   * 增加 decay_class 权重 + FTS 候选 + time 窗口预过滤。
   * 否则 fallback 到原 hybridSearch。
   *
   * @param {string} userId
   * @param {string} query
   * @param {object} options
   */
  async searchL4(userId, query, options = {}) {
    if (!this._layerEnabled()) {
      return this.hybridSearch(userId, query, options);
    }

    // When FEATURE_HYBRID_V2 is on, delegate to the full retrieval pipeline
    // (it already handles decay through RRF weights and reranking)
    if (process.env.FEATURE_HYBRID_V2 === 'true') {
      return this.hybridSearch(userId, query, options);
    }

    const { limit = 10, decayFilter, timeWindowDays } = options;

    // 时间窗口预过滤
    let timeClause = '';
    const extraParams = [];
    if (timeWindowDays) {
      extraParams.push(`now() - INTERVAL '${parseInt(timeWindowDays, 10)} days'`);
      timeClause = `AND m.created_at >= now() - INTERVAL '${parseInt(timeWindowDays, 10)} days'`;
    }

    // FTS 候选 + 向量候选并行，再 decay 权重加权
    const queryEmbedding = await this.llm.embed(query).catch(() => null);
    const decayWeight = { permanent: 1.5, slow: 1.2, fast: 1.0, volatile: 0.6 };

    const sql = `
      SELECT m.*,
        (CASE WHEN $3::vector IS NOT NULL
              THEN (1 - (m.embedding <=> $3::vector)) * 0.6
              ELSE 0 END
         + CASE WHEN m.fts @@ plainto_tsquery('simple', $2)
                THEN ts_rank_cd(m.fts, plainto_tsquery('simple', $2)) * 0.3
                ELSE 0 END
         + COALESCE(m.importance, 0.5) * 0.1
        ) *
        CASE m.decay_class
          WHEN 'permanent' THEN 1.5
          WHEN 'slow'      THEN 1.2
          WHEN 'fast'      THEN 1.0
          WHEN 'volatile'  THEN 0.6
          ELSE 1.0
        END AS l4_score
      FROM memories m
      WHERE m.user_id = $1
        AND m.superseded_by IS NULL
        ${decayFilter ? `AND m.decay_class = ANY($4::text[])` : ''}
        ${timeClause}
      ORDER BY l4_score DESC
      LIMIT $${decayFilter ? 5 : 4}
    `;

    const params = [userId, query,
      queryEmbedding ? JSON.stringify(queryEmbedding) : null];
    if (decayFilter) params.push(decayFilter);
    params.push(limit * 2);

    const candidates = await this.db.queryAll(sql, params).catch(() => []);

    // Update last_recalled_at (async, non-blocking)
    if (candidates.length) {
      const ids = candidates.slice(0, limit).map(c => c.id);
      this.db.query(
        'UPDATE memories SET last_recalled_at = now(), usage_count = usage_count + 1 WHERE id = ANY($1)',
        [ids]
      ).catch(() => {});
    }

    return candidates.slice(0, limit);
  }

  // ── L5: Procedural Rules ──────────────────────────────────────────────────

  /**
   * 查询当前激活的程序性规则（L5）。
   * @param {string} userId
   * @param {string} [ruleType]
   */
  async getL5(userId, ruleType) {
    const whereType = ruleType ? 'AND rule_type = $2' : '';
    const params    = ruleType ? [userId, ruleType] : [userId];
    return this.db.queryAll(
      `SELECT * FROM procedural_rules WHERE user_id = $1 AND active = true ${whereType}
       ORDER BY confidence DESC, evidence_count DESC`,
      params
    ).catch(() => []);
  }

  /**
   * 根据 L5 规则过滤/修改 Agent 输出（应用规则）。
   * 目前主要用于 Care Agent 的"拒绝 N 次停推"检查。
   * @param {string} userId
   * @param {string} intent   — 当前 Agent 意图（如 'care_stress'）
   * @returns {Promise<{ blocked: boolean, rule?: object }>}
   */
  async applyL5(userId, intent) {
    if (!this._layerEnabled()) return { blocked: false };

    const rules = await this.getL5(userId);
    const blocking = rules.find(r =>
      r.rule_type === 'suppress_care' &&
      r.context?.care_type === intent.replace('care_', '') &&
      r.active === false
    );
    if (blocking) return { blocked: true, rule: blocking };
    return { blocked: false };
  }
}

export default MemoryService;




