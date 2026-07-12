-- Rollback: L2 Semantic Profile
DROP TRIGGER IF EXISTS semantic_profile_updated_at ON semantic_profile;
DROP INDEX   IF EXISTS idx_semantic_keywords;
DROP INDEX   IF EXISTS idx_semantic_dim;
DROP INDEX   IF EXISTS idx_semantic_user;
DROP TABLE   IF EXISTS semantic_profile;
