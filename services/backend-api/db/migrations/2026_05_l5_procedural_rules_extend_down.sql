-- Rollback: L5 Procedural Rules extend
DROP INDEX   IF EXISTS idx_procedural_active;
ALTER TABLE procedural_rules DROP COLUMN IF EXISTS last_triggered_at;
ALTER TABLE procedural_rules DROP COLUMN IF EXISTS scope;
ALTER TABLE procedural_rules DROP COLUMN IF EXISTS context;
-- 注意：evidence_count / confidence 是 P2-B 核心字段，不回滚（避免破坏 P2-B 功能）
