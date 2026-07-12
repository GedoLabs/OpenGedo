-- GEDO.AI V2 Schema Extension
-- Adds conversation, message, user preferences, and avatar state tables

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) DEFAULT '新对话',
  summary TEXT,
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(user_id, updated_at DESC);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  tool_calls JSONB,
  tool_call_id VARCHAR(255),
  tool_result JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avatar_name VARCHAR(100) DEFAULT '智伴',
  avatar_personality TEXT DEFAULT 'friendly',
  language VARCHAR(10) DEFAULT 'zh',
  timezone VARCHAR(50) DEFAULT 'Asia/Shanghai',
  notification_enabled BOOLEAN DEFAULT true,
  theme VARCHAR(20) DEFAULT 'dark',
  llm_preference VARCHAR(50) DEFAULT 'auto',
  custom_settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Avatar state table (digital twin state)
CREATE TABLE IF NOT EXISTS avatar_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER DEFAULT 1,
  experience INTEGER DEFAULT 0,
  current_mood VARCHAR(50) DEFAULT 'neutral',
  appearance JSONB DEFAULT '{"style": "default", "accessories": []}',
  dimension_scores JSONB DEFAULT '{"health": 0, "career": 0, "family": 0, "finance": 0, "growth": 0, "social": 0, "hobby": 0, "self_realization": 0}',
  streak_days INTEGER DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  stats JSONB DEFAULT '{"total_conversations": 0, "total_memories": 0, "total_goals": 0, "total_tasks_completed": 0}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Row Level Security for new tables
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE avatar_state ENABLE ROW LEVEL SECURITY;

-- RLS policies (conversations)
DO $$ BEGIN
  CREATE POLICY conversations_user_policy ON conversations
    FOR ALL USING (user_id = current_setting('app.user_id')::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS policies (messages via conversation ownership)
DO $$ BEGIN
  CREATE POLICY messages_user_policy ON messages
    FOR ALL USING (
      conversation_id IN (
        SELECT id FROM conversations WHERE user_id = current_setting('app.user_id')::UUID
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS policies (user_preferences)
DO $$ BEGIN
  CREATE POLICY user_preferences_policy ON user_preferences
    FOR ALL USING (user_id = current_setting('app.user_id')::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS policies (avatar_state)
DO $$ BEGIN
  CREATE POLICY avatar_state_policy ON avatar_state
    FOR ALL USING (user_id = current_setting('app.user_id')::UUID);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
