-- ============================================================================
-- P3-A Migration: L3 Working Memory
-- 工作记忆层 — 短期对话上下文（TTL 24h，会话结束后异步压缩到 L4）
--
-- 设计原则：
--   - 每用户每 session 一行，session_id 与对话 ID 对应
--   - expires_at 到期后由后台 job 清理（pg-boss cron 每小时扫一次）
--   - context_window 存最近 N 条消息摘要，用于跨 session 上下文注入
--   - 会话结束时把 context_window 中高价值片段写回 L4 memories
-- ============================================================================

CREATE TABLE IF NOT EXISTS working_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,               -- 对话 ID (conversation_id)

  -- 当前会话检测到的用户意图
  current_intent  TEXT,                    -- goal_planning | task_review | venting | ...

  -- 激活的目标 IDs（本会话被提及过的目标）
  active_goal_ids UUID[] NOT NULL DEFAULT '{}',

  -- 最近话题关键词（用于跨 session 上下文注入）
  recent_topics   TEXT[] NOT NULL DEFAULT '{}',

  -- 上下文窗口：最近 N 条消息/事实摘要（JSONB 数组）
  -- e.g. [{ "role":"user","summary":"问到了下周计划","at":"2026-05-03T08:00:00Z" }]
  context_window  JSONB NOT NULL DEFAULT '[]',

  -- 情绪信号（由 CareAgent 读取）
  emotion_signal  TEXT,                    -- neutral | stressed | low | excited
  emotion_updated_at TIMESTAMPTZ,

  -- 是否已压缩到 L4（会话结束标记）
  compressed      BOOLEAN NOT NULL DEFAULT false,
  compressed_at   TIMESTAMPTZ,

  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours'),

  UNIQUE(user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_wm_user         ON working_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_session      ON working_memory(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_wm_expires      ON working_memory(expires_at) WHERE NOT compressed;
CREATE INDEX IF NOT EXISTS idx_wm_emotion      ON working_memory(user_id, emotion_signal) WHERE emotion_signal IS NOT NULL;

CREATE TRIGGER working_memory_updated_at
  BEFORE UPDATE ON working_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 清理过期工作记忆（由 pg-boss cron 调用，不依赖 TRIGGER 以避免误删）
CREATE OR REPLACE FUNCTION cleanup_expired_working_memory()
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM working_memory
  WHERE expires_at < now() AND compressed = true;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE working_memory IS 'L3 工作记忆 — 短期对话上下文，TTL 24h';
