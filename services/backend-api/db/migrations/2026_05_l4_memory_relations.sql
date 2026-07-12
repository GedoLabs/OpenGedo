-- ============================================================================
-- P3-A Migration: L4 Memory Relations
-- 记忆关系图 — 支持 P3-B graph.mjs 的 2-3 hop 关联检索
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  source_id   UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  -- 关系类型
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'supports',      -- source 为 target 提供证据
    'contradicts',   -- source 与 target 矛盾
    'elaborates',    -- source 补充说明 target
    'supersedes',    -- source 取代 target（与 memories.superseded_by 保持一致）
    'related',       -- 弱相关
    'causes',        -- source 导致 target（因果链）
    'temporal'       -- 时序前后（日期型记忆用）
  )),

  -- 关系强度 (0-1)；1=确定，0.5=推断
  weight      REAL NOT NULL DEFAULT 0.5
              CHECK (weight >= 0 AND weight <= 1),

  -- 关系来源：'llm_inferred' | 'user_confirmed' | 'rule_based'
  origin      TEXT NOT NULL DEFAULT 'llm_inferred'
              CHECK (origin IN ('llm_inferred','user_confirmed','rule_based')),

  created_at  TIMESTAMPTZ DEFAULT now(),

  -- 防止重复
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_memrel_user   ON memory_relations(user_id);
CREATE INDEX IF NOT EXISTS idx_memrel_source ON memory_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_memrel_target ON memory_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_memrel_type   ON memory_relations(user_id, relation_type);

COMMENT ON TABLE memory_relations IS 'L4 记忆关系图 — 支持 2-3 hop 图遍历检索';
