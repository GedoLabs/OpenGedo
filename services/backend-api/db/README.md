# GEDO.AI 数据库设计

## 快速开始

### 1. 安装 Postgres + pgvector

```bash
# macOS
brew install postgresql@16
brew install pgvector

# Docker (推荐)
docker run -d --name gedo-postgres \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=gedoai \
  -p 5432:5432 \
  ankane/pgvector
```

### 2. 初始化 Schema

```bash
psql -h localhost -U postgres -d gedoai -f schema.sql
```

## 数据模型概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         GEDO.AI 数据模型                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐      ┌──────────┐      ┌─────────┐                │
│  │  users  │──────│ memories │──────│ skills  │                │
│  └────┬────┘      └──────────┘      └─────────┘                │
│       │                                                         │
│       │           ┌──────────┐      ┌───────────┐              │
│       ├───────────│  goals   │──────│plan_nodes │              │
│       │           └────┬─────┘      └───────────┘              │
│       │                │                                        │
│       │           ┌────┴─────┐      ┌───────────┐              │
│       ├───────────│  tasks   │──────│ check_ins │              │
│       │           └──────────┘      └─────┬─────┘              │
│       │                                    │                    │
│       │           ┌──────────────┐   ┌────┴──────┐             │
│       ├───────────│ adjustments  │   │reflections│             │
│       │           └──────────────┘   └───────────┘             │
│       │                                                         │
│       │           ┌──────────────────┐                         │
│       └───────────│life_wheel_weights│                         │
│                   └──────────────────┘                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 核心表说明

### 1. memories (智忆)

存储用户的长期记忆，支持：
- 多种类型：重要信息、个人特质、关键事件、日期提醒
- 多种来源：文本、语音、图片、被动抓取
- 自动标签：系统标签 + 用户标签
- 语义检索：pgvector 向量索引

### 2. skills (技能节点)

从记忆中抽取的技能，用于：
- 生命之树的"根节"可视化
- 目标制定时的能力匹配

### 3. goals (目标)

SMART 目标定义，支持：
- 层级结构：愿景 → 里程碑 → 阶段
- 生命之花 8 维度分类
- 进度追踪

### 4. tasks (任务)

日常行动项，支持：
- 关联目标/计划
- 能量等级标记
- 重复任务规则

### 5. check_ins (打卡记录)

任务完成状态记录，包含：
- 完成/未完成原因
- 实际花费时长
- 心情反馈

### 6. adjustments (调整记录)

基于打卡原因的自动调整：
- 重新安排
- 任务拆分
- 顺延
- 取消

## Row Level Security (RLS)

所有表都启用了 RLS，确保用户只能访问自己的数据。

使用前需设置当前用户：
```sql
SET app.current_user_id = 'user-uuid-here';
```

## pgvector 语义检索

记忆表的 `embedding` 字段使用 1536 维向量（适配 OpenAI embedding）。

相似度查询示例：
```sql
SELECT * FROM memories
WHERE user_id = $1
ORDER BY embedding <=> $2  -- 余弦距离
LIMIT 10;
```

## 迁移策略

当前后端使用 JSON 文件存储（开发用），生产环境切换到 Postgres 只需：

1. 运行 `schema.sql` 初始化
2. 配置 `DATABASE_URL` 环境变量
3. 后端自动检测并使用 Postgres







