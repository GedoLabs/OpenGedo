-- Rollback: L4 Memory Relations
DROP INDEX IF EXISTS idx_memrel_type;
DROP INDEX IF EXISTS idx_memrel_target;
DROP INDEX IF EXISTS idx_memrel_source;
DROP INDEX IF EXISTS idx_memrel_user;
DROP TABLE IF EXISTS memory_relations;
