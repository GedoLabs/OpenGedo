-- Rollback: L3 Working Memory
DROP FUNCTION IF EXISTS cleanup_expired_working_memory();
DROP TRIGGER  IF EXISTS working_memory_updated_at ON working_memory;
DROP INDEX    IF EXISTS idx_wm_emotion;
DROP INDEX    IF EXISTS idx_wm_expires;
DROP INDEX    IF EXISTS idx_wm_session;
DROP INDEX    IF EXISTS idx_wm_user;
DROP TABLE    IF EXISTS working_memory;
