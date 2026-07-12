-- ============================================================================
-- P3-A Migration: L1 Identity Profile
-- 身份锚点层 — 用户的核心自我认知（更新频率：月 / 季度）
--
-- 设计原则：
--   - 每用户一行（UPSERT），不保留历史版本（版本由 baseline_snapshot_at 标记）
--   - 所有文字字段均可为 NULL（渐进填充，onboarding 完成后回填）
--   - personality_traits / important_relationships 存 JSONB 方便前端直接渲染
--   - core_values / strengths / growth_edges 存 TEXT[] 方便 @> 集合查询
-- ============================================================================

CREATE TABLE IF NOT EXISTS identity_profile (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- 基础信息
  display_name    TEXT,
  birth_year      SMALLINT,
  timezone        TEXT DEFAULT 'UTC',
  language        TEXT DEFAULT 'zh-CN',

  -- 人生愿景（S0-5 Day 7 答案）
  life_vision     TEXT,                       -- ≤500字

  -- 核心价值观（S0-5 Day 2 答案，如 ['自由','家庭','成长']）
  core_values     TEXT[] NOT NULL DEFAULT '{}',

  -- 性格特征（Big-5 / MBTI 风格，LLM 萃取后存储）
  -- e.g. { "openness": 0.8, "conscientiousness": 0.7, "label": "INTJ" }
  personality_traits  JSONB NOT NULL DEFAULT '{}',

  -- 能力地图：擅长 / 成长边界
  strengths       TEXT[] NOT NULL DEFAULT '{}',
  growth_edges    TEXT[] NOT NULL DEFAULT '{}',

  -- 重要关系（S0-5 Day 4，JSONB 数组）
  -- e.g. [{ "name":"妈妈", "role":"支持者", "importance":"high" }]
  important_relationships JSONB NOT NULL DEFAULT '[]',

  -- 焦虑/担忧快照（S0-5 Day 6）
  anxiety_snapshot  TEXT,                     -- ≤300字

  -- 基线快照时间（用于 Persona AS 模式的 alignment check）
  baseline_snapshot_at  TIMESTAMPTZ,

  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_user     ON identity_profile(user_id);
CREATE INDEX IF NOT EXISTS idx_identity_values   ON identity_profile USING GIN(core_values);
CREATE INDEX IF NOT EXISTS idx_identity_strengths ON identity_profile USING GIN(strengths);

CREATE TRIGGER identity_profile_updated_at
  BEFORE UPDATE ON identity_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE identity_profile IS 'L1 身份锚点 — 用户核心自我认知，每用户一行';
