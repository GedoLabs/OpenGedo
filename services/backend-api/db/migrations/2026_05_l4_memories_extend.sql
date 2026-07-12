-- ============================================================================
-- P3-A Migration: L4 Episodic Memory — extend existing `memories` table
-- 情节记忆层 — 为 BM25 全文检索 + 衰减分级 + 时间窗口预过滤 做准备
--
-- 纯加法：只加新列 / 新索引，不删改任何现有列。
-- 旧代码在 FEATURE_LAYERED_MEMORY=off 时完全感知不到这些列。
--
-- superseded_by 已在 P1-A 的 schema.sql 增量列区块中添加，此处跳过。
-- ============================================================================

-- 衰减分级：permanent(身份类) > slow(技能/成就) > fast(日常/待办) > volatile(情绪/临时)
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS decay_class TEXT
    NOT NULL DEFAULT 'fast'
    CHECK (decay_class IN ('permanent','slow','fast','volatile'));

-- 全文检索向量（自动生成列，zh/simple 分词器；生产环境可换 zhparser）
-- 注意：GENERATED ALWAYS 列不可手动写入
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(content_raw, ''))
    ) STORED;

-- L4 来源标记（episodic / onboarding / reflection / external）
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS layer_source TEXT
    NOT NULL DEFAULT 'episodic'
    CHECK (layer_source IN ('episodic','onboarding','reflection','external','working_compressed'));

-- 重要性得分（P3-B RRF 排序输入，范围 0-1）
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS importance REAL NOT NULL DEFAULT 0.5;

-- 上次被召回的时间（用于 decay 计算和 usage_count 更新）
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS last_recalled_at TIMESTAMPTZ;

-- GIN 索引：全文检索
CREATE INDEX IF NOT EXISTS idx_memories_fts
  ON memories USING GIN(fts);

-- BTREE 索引：衰减分级 + 时间窗口预过滤（P3-B time.mjs 用）
CREATE INDEX IF NOT EXISTS idx_memories_decay_created
  ON memories(user_id, decay_class, created_at DESC);

-- 复合索引：召回时间（decay 排序用）
CREATE INDEX IF NOT EXISTS idx_memories_recalled
  ON memories(user_id, last_recalled_at DESC NULLS LAST)
  WHERE last_recalled_at IS NOT NULL;

-- 设置现有 personal_trait / key_event 记忆的 decay_class
UPDATE memories SET decay_class = 'slow'
  WHERE type IN ('personal_trait','key_event') AND decay_class = 'fast';

UPDATE memories SET decay_class = 'permanent'
  WHERE type = 'personal_trait'
    AND (system_tags @> ARRAY['self_awareness'] OR user_tags @> ARRAY['identity']);

UPDATE memories SET decay_class = 'volatile'
  WHERE type = 'important_info'
    AND created_at < now() - INTERVAL '7 days'
    AND usage_count = 0;

-- onboarding 答案标记为 permanent（S0-5 回填）
UPDATE memories SET decay_class = 'permanent', layer_source = 'onboarding'
  WHERE user_tags @> ARRAY['onboarding']::text[];
