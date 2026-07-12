-- Rollback: L1 Identity Profile
DROP TRIGGER  IF EXISTS identity_profile_updated_at ON identity_profile;
DROP INDEX    IF EXISTS idx_identity_values;
DROP INDEX    IF EXISTS idx_identity_strengths;
DROP INDEX    IF EXISTS idx_identity_user;
DROP TABLE    IF EXISTS identity_profile;
