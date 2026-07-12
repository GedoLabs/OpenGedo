-- ============================================================================
-- P3-A Migration: L2 Semantic Profile
-- 语义画像层 — 8 维度动态画像（更新频率：每次对话后异步更新）
--
-- 8 个维度（对应分析文档 §3.3 semantic.schema.json）：
--   self_concept   — 自我认知（我是谁）
--   capabilities   — 能力与技能
--   values         — 价值观与信念
--   life_events    — 重要人生事件
--   relationships  — 人际关系网络
--   career         — 职业与事业
--   habits         — 习惯与日常模式
--   aspirations    — 愿望与渴望
--
-- 每用户每维度一行（UPSERT），embedding 用于 P3-B 跨维度检索。
-- ============================================================================

CREATE TABLE IF NOT EXISTS semantic_profile (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 维度枚举
  dimension  TEXT NOT NULL CHECK (dimension IN (
    'self_concept', 'capabilities', 'values', 'life_events',
    'relationships', 'career', 'habits', 'aspirations'
  )),

  -- LLM 生成的维度摘要（每次对话增量更新）
  summary    TEXT,

  -- 关键词列表（用于快速匹配）
  keywords   TEXT[] NOT NULL DEFAULT '{}',

  -- 维度摘要的向量嵌入（1024 维，BGE-M3）
  embedding  vector(1024),

  -- 该维度的最近原始记忆 IDs（最多保留 20 条引用）
  source_memory_ids  UUID[] NOT NULL DEFAULT '{}',

  -- 置信度 (0-1)，来源记忆越多越高
  confidence REAL NOT NULL DEFAULT 0.0,

  -- 维度"新鲜度"：上次对话更新时间
  refreshed_at  TIMESTAMPTZ DEFAULT now(),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, dimension)
);

CREATE INDEX IF NOT EXISTS idx_semantic_user      ON semantic_profile(user_id);
CREATE INDEX IF NOT EXISTS idx_semantic_dim       ON semantic_profile(user_id, dimension);
CREATE INDEX IF NOT EXISTS idx_semantic_keywords  ON semantic_profile USING GIN(keywords);
-- 向量索引（数据量大时启用，预留注释）
-- CREATE INDEX idx_semantic_emb ON semantic_profile USING ivfflat(embedding vector_cosine_ops) WITH (lists=50);

CREATE TRIGGER semantic_profile_updated_at
  BEFORE UPDATE ON semantic_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE semantic_profile IS 'L2 语义画像 — 8维度动态摘要，每维度一行';
