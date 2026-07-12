/**
 * GEDO.AI Agent 模块
 *
 * 核心 Agents：
 *   PlannerAgent    — 目标澄清、SMART 拆解、动态调整
 *   RecallAgent     — 场景化记忆召回、模式识别、复盘洞察
 *   DailyPlanner    — 早安简报（S0-4）
 *   StuckDetector   — Reflexion 根因诊断（P2-B）
 *   CareAgent       — 情绪/日期关怀推送（P2-B）
 *   Reflector       — 周末/月末复盘（P2-B）
 *
 * 队列 & 触发器（P2-A/B）：
 *   queue/pgboss.mjs          — pg-boss 封装（dev: in-memory fallback）
 *   triggers/cron.mjs         — pg-boss cron 任务注册
 *   triggers/listenNotify.mjs — PostgreSQL LISTEN/NOTIFY 事件总线
 */

export { PlannerAgent } from './PlannerAgent.mjs';
export { RecallAgent } from './RecallAgent.mjs';
export { generateDailyPlan, renderPlanText } from './agents/DailyPlanner.mjs';
export { runStuckDetector } from './agents/StuckDetector.mjs';
export { runCareAgent, recordCareDismiss } from './agents/CareAgent.mjs';
export { runReflector } from './agents/Reflector.mjs';
export { registerJob as registerScheduledJob, listJobs as listScheduledJobs, stopAll as stopAllScheduledJobs } from './scheduler.mjs';
export { getBoss, scheduleRecurring, work, sendOnce } from './queue/pgboss.mjs';
export { registerCronTriggers } from './triggers/cron.mjs';
export { startListening, onCheckInDone, emitCheckInDone } from './triggers/listenNotify.mjs';

/**
 * 简单的 LLM Provider 接口
 * 实际使用时需要替换为真实的 LLM 调用
 */
export class MockLLMProvider {
  async chat(messages) {
    // Mock 响应，实际应该调用 OpenAI/Claude 等 API
    console.log('[MockLLM] Received messages:', messages.length);
    return {
      content: '{}', // 返回空 JSON，让 Agent 走降级逻辑
    };
  }
}

/**
 * OpenAI Provider 示例
 */
export class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || '{}',
    };
  }
}

// 使用示例
async function main() {
  const token = process.env.GEDO_API_TOKEN;
  const llmProvider = new MockLLMProvider();
  
  // 创建 Agent 实例
  const { PlannerAgent, RecallAgent } = await import('./index.mjs');
  
  const planner = new PlannerAgent(token, llmProvider);
  const recall = new RecallAgent(token, llmProvider);
  
  console.log('[Agent] PlannerAgent and RecallAgent initialized');
  
  // 示例：检查生命之花平衡
  // const balance = await planner.checkLifeWheelBalance();
  // console.log('[Agent] Life wheel balance:', balance);
  
  // 示例：检测行为模式
  // const patterns = await recall.detectPatterns();
  // console.log('[Agent] Detected patterns:', patterns);
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}






















