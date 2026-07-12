# GEDO.AI Agent

智能代理模块，提供目标规划和记忆召回的 AI 能力。

## 核心 Agent

### PlannerAgent - 智能规划代理

负责：
- **目标澄清**：通过多轮对话理解用户真实需求
- **SMART 拆解**：将模糊目标转化为可衡量的具体目标
- **任务生成**：基于目标和用户习惯生成行动计划
- **动态调整**：根据执行反馈调整计划

```javascript
import { PlannerAgent, OpenAIProvider } from '@gedo/agent';

const llm = new OpenAIProvider(process.env.OPENAI_API_KEY);
const planner = new PlannerAgent(userToken, llm);

// 澄清目标
const clarification = await planner.clarifyGoal('我想半年内月薪涨30%');

// 生成 SMART 目标
const { goal, tasks } = await planner.generateSMARTGoal(prompt, userAnswers);

// 生成调整建议
const adjustment = await planner.generateAdjustment(task, 'time_insufficient');

// 检查生命之花平衡
const balance = await planner.checkLifeWheelBalance();
```

### RecallAgent - 记忆召回代理

负责：
- **场景化唤醒**：在特定场景下主动召回相关记忆
- **重要日期提醒**：提前唤醒日期相关记忆
- **模式识别**：识别用户的行为模式并提取为技能/特质
- **目标关联**：创建目标时自动关联相关经验和能力

```javascript
import { RecallAgent, OpenAIProvider } from '@gedo/agent';

const llm = new OpenAIProvider(process.env.OPENAI_API_KEY);
const recall = new RecallAgent(userToken, llm);

// 创建目标时召回相关记忆
const related = await recall.recallForGoalCreation('转型产品经理', 'career');

// 获取即将到来的重要日期
const upcoming = await recall.recallUpcomingDates(7);

// 检测行为模式
const patterns = await recall.detectPatterns();

// 生成复盘洞察
const insights = await recall.generateReflectionInsights('weekly');
```

## LLM Provider

Agent 需要一个 LLM Provider 来生成智能响应。提供了以下实现：

### MockLLMProvider（开发/测试用）

返回空响应，让 Agent 走降级逻辑。

### OpenAIProvider

```javascript
import { OpenAIProvider } from '@gedo/agent';

const provider = new OpenAIProvider(
  process.env.OPENAI_API_KEY,
  'gpt-4' // 模型名称
);
```

### 自定义 Provider

实现 `chat(messages)` 方法即可：

```javascript
class CustomProvider {
  async chat(messages) {
    // messages: [{ role: 'system'|'user'|'assistant', content: string }]
    const response = await yourLLMAPI(messages);
    return { content: response };
  }
}
```

## 环境变量

- `GEDO_API_TOKEN` - 用户的 API Token
- `API_BASE_URL` - Backend API 地址（默认 http://localhost:8787）
- `OPENAI_API_KEY` - OpenAI API Key（使用 OpenAIProvider 时需要）

## 架构原则

1. **统一通过 Backend API**：Agent 不直接访问数据库，所有操作都通过 Backend API 完成
2. **优雅降级**：当 LLM 调用失败时，返回预设的默认响应
3. **可插拔 LLM**：通过 Provider 接口抽象 LLM 调用，方便切换不同供应商






















