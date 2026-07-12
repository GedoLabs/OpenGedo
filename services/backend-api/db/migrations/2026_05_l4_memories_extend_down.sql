-- Rollback: L4 Episodic Memory extend
-- 注意：GENERATED 列必须先删，否则其他列无法 DROP
DROP INDEX IF EXISTS idx_memories_recalled;
DROP INDEX IF EXISTS idx_memories_decay_created;
DROP INDEX IF EXISTS idx_memories_fts;

ALTER TABLE memories DROP COLUMN IF EXISTS last_recalled_at;
ALTER TABLE memories DROP COLUMN IF EXISTS importance;
ALTER TABLE memories DROP COLUMN IF EXISTS layer_source;
ALTER TABLE memories DROP COLUMN IF EXISTS fts;          -- GENERATED 列
ALTER TABLE memories DROP COLUMN IF EXISTS decay_class;
