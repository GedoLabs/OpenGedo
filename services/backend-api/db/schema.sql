-- GEDO.AI Database Schema (Postgres + pgvector + RLS)
-- 运行前请先启用 pgvector 扩展: CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 1. 用户与鉴权
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================================================
-- 2. 智忆 (Memory → Capability Evidence)
-- ============================================================================
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 类型：important_info | personal_trait | key_event | date_reminder
  type TEXT NOT NULL CHECK (type IN ('important_info', 'personal_trait', 'key_event', 'date_reminder')),
  
  -- 原始内容
  content_raw TEXT NOT NULL,
  
  -- LLM 抽取后的结构化字段 (人名/日期/偏好/技能/情绪/结论等)
  content_struct JSONB DEFAULT '{}',
  
  -- 来源：text | voice | image | passive_event
  source TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice', 'image', 'passive_event')),
  
  -- 附件 URL (语音/图片)
  attachment_url TEXT,
  
  -- 标签：system_tags (自我认知/成长历程/目标关联/人际管理) + user_tags
  system_tags TEXT[] DEFAULT '{}',
  user_tags TEXT[] DEFAULT '{}',
  
  -- 语义向量 (用于 pgvector 检索，1024 维适配 BGE-M3)
  embedding vector(1024),
  
  -- 被动抓取/抽取可信度 (0-1)
  confidence REAL DEFAULT 1.0,
  
  -- 影响度/复用度 (用于生命之树根系粗细)
  impact_score REAL DEFAULT 0.0,
  usage_count INTEGER DEFAULT 0,
  
  -- 是否已确认 (被动抓取需用户确认)
  confirmed BOOLEAN DEFAULT true,
  
  -- 关联的重要日期 (用于场景化唤醒)
  reminder_date DATE,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_tags ON memories USING GIN(system_tags);
CREATE INDEX idx_memories_user_tags ON memories USING GIN(user_tags);
CREATE INDEX idx_memories_reminder ON memories(reminder_date) WHERE reminder_date IS NOT NULL;
-- pgvector 索引 (IVFFlat 用于大规模向量检索)
-- CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- 3. 技能节点 (Skill - 从记忆抽取/用户标签形成)
-- ============================================================================
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- 系统四大标签之一：self_awareness | growth_journey | goal_related | relationship
  category TEXT CHECK (category IN ('self_awareness', 'growth_journey', 'goal_related', 'relationship')),
  
  -- 熟练度/证据数量
  proficiency_level REAL DEFAULT 0.0,
  evidence_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, name)
);

CREATE INDEX idx_skills_user ON skills(user_id);

-- 技能与记忆的关联 (多对多)
CREATE TABLE IF NOT EXISTS skill_memories (
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  PRIMARY KEY (skill_id, memory_id)
);

-- ============================================================================
-- 4. 智引：目标 (Goal)
-- ============================================================================
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  title TEXT NOT NULL,
  description TEXT,
  
  -- SMART 字段
  specific TEXT,
  measurable TEXT,
  achievable TEXT,
  relevant TEXT,
  time_bound TIMESTAMPTZ,
  
  -- 目标层级：vision (5年) | milestone (3年/1年) | phase (季度/月)
  level TEXT NOT NULL DEFAULT 'phase' CHECK (level IN ('vision', 'milestone', 'phase')),
  
  -- 父目标 (用于层级拆解)
  parent_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  
  -- 生命之花维度：health | career | family | finance | growth | social | hobby | self_realization
  life_wheel_dimension TEXT CHECK (life_wheel_dimension IN (
    'health', 'career', 'family', 'finance', 'growth', 'social', 'hobby', 'self_realization'
  )),
  
  -- 状态：draft | active | paused | completed | cancelled
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  
  -- 进度 (0-100)
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  
  -- 开始/结束时间
  start_date DATE,
  end_date DATE,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_goals_user ON goals(user_id);
CREATE INDEX idx_goals_parent ON goals(parent_id);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_dimension ON goals(life_wheel_dimension);

-- ============================================================================
-- 5. 计划节点 (PlanNode - 目标的分解树)
-- ============================================================================
CREATE TABLE IF NOT EXISTS plan_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  title TEXT NOT NULL,
  description TEXT,
  
  -- 层级：year | quarter | month | week | day
  granularity TEXT NOT NULL CHECK (granularity IN ('year', 'quarter', 'month', 'week', 'day')),
  
  -- 父节点
  parent_id UUID REFERENCES plan_nodes(id) ON DELETE CASCADE,
  
  -- 排序
  sort_order INTEGER DEFAULT 0,
  
  -- 状态
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  
  -- 时间范围
  start_date DATE,
  end_date DATE,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_plan_nodes_goal ON plan_nodes(goal_id);
CREATE INDEX idx_plan_nodes_user ON plan_nodes(user_id);
CREATE INDEX idx_plan_nodes_parent ON plan_nodes(parent_id);

-- ============================================================================
-- 6. 任务 (Task - 日常行动项)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 关联目标/计划节点 (可选)
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  plan_node_id UUID REFERENCES plan_nodes(id) ON DELETE SET NULL,
  
  title TEXT NOT NULL,
  description TEXT,
  
  -- 预计时长 (分钟)
  estimated_duration INTEGER,
  
  -- 能量等级：low | medium | high
  energy_level TEXT DEFAULT 'medium' CHECK (energy_level IN ('low', 'medium', 'high')),
  
  -- 优先级：1-5 (5最高)
  priority INTEGER DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
  
  -- 状态：pending | in_progress | completed | skipped | postponed
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'postponed')),
  
  -- 计划日期/截止日期
  scheduled_date DATE,
  due_date DATE,
  
  -- 实际完成时间
  completed_at TIMESTAMPTZ,
  
  -- 是否重复任务
  is_recurring BOOLEAN DEFAULT false,
  recurrence_rule JSONB, -- iCal RRULE 格式
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_goal ON tasks(goal_id);
CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_date);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ============================================================================
-- 7. 打卡记录 (CheckIn)
-- ============================================================================
CREATE TABLE IF NOT EXISTS check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 状态：completed | not_completed | partial
  status TEXT NOT NULL CHECK (status IN ('completed', 'not_completed', 'partial')),
  
  -- 未完成原因代码：time_insufficient | energy_low | priority_changed | external_interrupt | forgot | other
  reason_code TEXT,
  reason_note TEXT,
  
  -- 实际花费时长 (分钟)
  actual_duration INTEGER,
  
  -- 心情/能量反馈 (1-5)
  mood_rating INTEGER CHECK (mood_rating >= 1 AND mood_rating <= 5),
  
  checked_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_check_ins_task ON check_ins(task_id);
CREATE INDEX idx_check_ins_user ON check_ins(user_id);
CREATE INDEX idx_check_ins_date ON check_ins(checked_at);

-- ============================================================================
-- 8. 调整记录 (Adjustment - 基于原因的自动改排/拆分/顺延)
-- ============================================================================
CREATE TABLE IF NOT EXISTS adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 触发来源
  trigger_check_in_id UUID REFERENCES check_ins(id) ON DELETE SET NULL,
  
  -- 调整类型：reschedule | split | postpone | cancel
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('reschedule', 'split', 'postpone', 'cancel')),
  
  -- 原任务
  original_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  
  -- 新任务列表 (拆分后的任务 ID)
  new_task_ids UUID[],
  
  -- 调整原因描述
  reason TEXT,
  
  -- AI 建议的调整方案
  ai_suggestion JSONB,
  
  -- 用户是否接受
  accepted BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_adjustments_user ON adjustments(user_id);
CREATE INDEX idx_adjustments_task ON adjustments(original_task_id);

-- ============================================================================
-- 9. 复盘记忆 (ReflectionMemory - 反馈总结写回智忆)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 关联目标
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  
  -- 复盘类型：daily | weekly | monthly | goal_complete
  reflection_type TEXT NOT NULL CHECK (reflection_type IN ('daily', 'weekly', 'monthly', 'goal_complete')),
  
  -- 复盘内容
  content TEXT NOT NULL,
  
  -- AI 生成的洞察
  ai_insights JSONB,
  
  -- 关联的记忆 ID (写回智忆后生成)
  memory_id UUID REFERENCES memories(id) ON DELETE SET NULL,
  
  -- 时间范围
  period_start DATE,
  period_end DATE,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_reflections_user ON reflections(user_id);
CREATE INDEX idx_reflections_goal ON reflections(goal_id);
CREATE INDEX idx_reflections_type ON reflections(reflection_type);

-- ============================================================================
-- 10. 生命之花维度权重 (LifeWheel)
-- ============================================================================
CREATE TABLE IF NOT EXISTS life_wheel_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 8 维度权重 (0-10)
  health REAL DEFAULT 5.0 CHECK (health >= 0 AND health <= 10),
  career REAL DEFAULT 5.0 CHECK (career >= 0 AND career <= 10),
  family REAL DEFAULT 5.0 CHECK (family >= 0 AND family <= 10),
  finance REAL DEFAULT 5.0 CHECK (finance >= 0 AND finance <= 10),
  growth REAL DEFAULT 5.0 CHECK (growth >= 0 AND growth <= 10),
  social REAL DEFAULT 5.0 CHECK (social >= 0 AND social <= 10),
  hobby REAL DEFAULT 5.0 CHECK (hobby >= 0 AND hobby <= 10),
  self_realization REAL DEFAULT 5.0 CHECK (self_realization >= 0 AND self_realization <= 10),
  
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 11. Row Level Security (RLS) Policies
-- ============================================================================

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_wheel_weights ENABLE ROW LEVEL SECURITY;

-- 创建策略函数：获取当前用户 ID (从 JWT 中提取)
-- 注意：实际使用时需要配合 Supabase/PostgREST 或自定义 auth 中间件
-- CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
--   SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
-- $$ LANGUAGE SQL STABLE;

-- 用户只能访问自己的数据
CREATE POLICY users_self ON users FOR ALL USING (id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY memories_owner ON memories FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY skills_owner ON skills FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY goals_owner ON goals FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY plan_nodes_owner ON plan_nodes FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY tasks_owner ON tasks FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY check_ins_owner ON check_ins FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY adjustments_owner ON adjustments FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY reflections_owner ON reflections FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
CREATE POLICY life_wheel_owner ON life_wheel_weights FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- skill_memories 需要通过 skill 的 user_id 来验证
CREATE POLICY skill_memories_owner ON skill_memories FOR ALL 
  USING (skill_id IN (SELECT id FROM skills WHERE user_id = current_setting('app.current_user_id', true)::uuid));

-- ============================================================================
-- 12. 更新时间触发器
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER memories_updated_at BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER skills_updated_at BEFORE UPDATE ON skills FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER goals_updated_at BEFORE UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER plan_nodes_updated_at BEFORE UPDATE ON plan_nodes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER life_wheel_updated_at BEFORE UPDATE ON life_wheel_weights FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 13. 常用查询视图
-- ============================================================================

-- 今日任务视图
CREATE OR REPLACE VIEW today_tasks AS
SELECT t.*, g.title as goal_title, g.life_wheel_dimension
FROM tasks t
LEFT JOIN goals g ON t.goal_id = g.id
WHERE t.scheduled_date = CURRENT_DATE
  AND t.status IN ('pending', 'in_progress');

-- 生命之树快照视图 (用于前端渲染)
CREATE OR REPLACE VIEW life_tree_snapshot AS
SELECT 
  u.id as user_id,
  (SELECT json_agg(row_to_json(s)) FROM skills s WHERE s.user_id = u.id) as skills,
  (SELECT json_agg(row_to_json(g)) FROM goals g WHERE g.user_id = u.id AND g.status = 'active') as active_goals,
  (SELECT json_agg(row_to_json(t)) FROM tasks t WHERE t.user_id = u.id AND t.scheduled_date = CURRENT_DATE) as today_tasks,
  (SELECT row_to_json(lw) FROM life_wheel_weights lw WHERE lw.user_id = u.id) as life_wheel
FROM users u;

COMMENT ON TABLE users IS '用户表';
COMMENT ON TABLE memories IS '智忆 - 个人长期记忆存储，沉淀为能力证据';

-- ============================================================================
-- 14. 增量列（纯加法，旧代码无感）
-- ============================================================================

-- S0-5: 7 天人生快照 onboarding 进度 (0 = 未开始, 1-7 = 当天完成, 7 = 全部完成)
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 0;

-- P1-A: .gmp 导入时记录被取代的旧记忆（软删除链）
ALTER TABLE memories ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES memories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by) WHERE superseded_by IS NOT NULL;

-- ============================================================================
-- 15. P2-B 主动 Agent 表
-- ============================================================================

-- 主动消息（Stuck Detector / Care Agent / Reflector 输出落地）
CREATE TABLE IF NOT EXISTS proactive_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 消息来源 Agent
  agent        TEXT NOT NULL CHECK (agent IN ('stuck_detector','care_agent','reflector','daily_planner')),

  -- 消息内容（LLM 生成，前端可渲染 Markdown）
  content      TEXT NOT NULL,

  -- 可选：关联的任务/目标/记忆 ID（用于"跳转"操作）
  ref_type     TEXT,
  ref_id       UUID,

  -- 用户反馈（null=未读）
  feedback     TEXT CHECK (feedback IN ('accepted','dismissed','snoozed')),
  feedback_at  TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,

  -- 是否已推送 Web Push 通知
  pushed       BOOLEAN NOT NULL DEFAULT false,
  pushed_at    TIMESTAMPTZ,

  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_user     ON proactive_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_proactive_unread   ON proactive_messages(user_id, feedback) WHERE feedback IS NULL;
CREATE INDEX IF NOT EXISTS idx_proactive_snoozed  ON proactive_messages(snoozed_until) WHERE snoozed_until IS NOT NULL;

-- 行为规则（Care Agent 从用户反馈中自学"第 N 次拒绝后停推"）
CREATE TABLE IF NOT EXISTS procedural_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 规则类型，e.g. 'suppress_care:stress', 'suppress_care:loneliness'
  rule_type       TEXT NOT NULL,
  agent           TEXT NOT NULL,

  -- 是否仍然激活
  active          BOOLEAN NOT NULL DEFAULT true,

  -- 触发次数 / 拒绝次数（Care Agent 用来判断是否停推）
  trigger_count   INTEGER NOT NULL DEFAULT 0,
  dismiss_count   INTEGER NOT NULL DEFAULT 0,

  -- P3-A 扩展字段（当前为 0/null，Phase 3 回填）
  evidence_count  INTEGER NOT NULL DEFAULT 0,
  confidence      REAL NOT NULL DEFAULT 1.0,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, rule_type)
);

CREATE INDEX IF NOT EXISTS idx_procedural_user ON procedural_rules(user_id);

-- Web Push 订阅（P2-C）
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
COMMENT ON TABLE skills IS '技能节点 - 从记忆抽取的技能';
COMMENT ON TABLE goals IS '目标 - SMART 目标定义';
COMMENT ON TABLE plan_nodes IS '计划节点 - 目标的层级分解';
COMMENT ON TABLE tasks IS '任务 - 日常行动项';
COMMENT ON TABLE check_ins IS '打卡记录 - 任务完成状态';
COMMENT ON TABLE adjustments IS '调整记录 - 计划动态调整';
COMMENT ON TABLE reflections IS '复盘记忆 - 定期总结写回智忆，增强能力根系';
COMMENT ON TABLE life_wheel_weights IS '生命之花 - 8维度权重配置';




