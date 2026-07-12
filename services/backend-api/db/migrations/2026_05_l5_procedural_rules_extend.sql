-- ============================================================================
-- P3-A Migration: L5 Procedural Rules — extend
-- P2-B 已建 procedural_rules 表并包含 evidence_count / confidence；
-- 本文件为幂等确认 + 补充 P3 所需字段（对 P2-B schema 实例做安全扩展）。
-- ============================================================================

-- evidence_count / confidence 已在 P2-B 建表时定义，IF NOT EXISTS 保证幂等
ALTER TABLE procedural_rules
  ADD COLUMN IF NOT EXISTS evidence_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE procedural_rules
  ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 1.0;

-- P3 新增：规则适用的上下文条件（JSONB，方便 CareAgent 精细匹配）
ALTER TABLE procedural_rules
  ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}';

-- P3 新增：规则的作用域（user级 / goal级 / global）
ALTER TABLE procedural_rules
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user'
    CHECK (scope IN ('user','goal','global'));

-- P3 新增：上次被命中的时间
ALTER TABLE procedural_rules
  ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ;

-- 复合索引：活跃规则快速查找
CREATE INDEX IF NOT EXISTS idx_procedural_active
  ON procedural_rules(user_id, active, rule_type)
  WHERE active = true;

COMMENT ON TABLE procedural_rules IS 'L5 程序性规则 — Agent 自学的行为偏好规则';
