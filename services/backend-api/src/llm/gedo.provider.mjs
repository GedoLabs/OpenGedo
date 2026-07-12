/**
 * Gedo Persona Provider — 自有模型端点（L1 车道）
 *
 * OpenAI 兼容端点的薄封装。当前指向本地 Ollama 上的原版 Qwen3-14B（训练管线
 * 打通用）；Gedo Persona v0.1 训练完成后**只改环境变量即切换**（改后需重启，
 * 后端 dev 无热重载）：
 *
 *   GEDO_LLM_BASE_URL = http://localhost:11434/v1     ← Ollama（现在）
 *                     → http://<gpu-host>:8000/v1     ← vLLM（训练后）
 *   GEDO_LLM_MODEL    = qwen3:14b → gedo-persona-14b-v0.1
 *   GEDO_LLM_API_KEY  = 可选（Ollama 忽略；vLLM 开 --api-key 时填）
 *
 * Qwen3 适配（仅本 provider 内部，不影响其他端点）：
 *   - json/noThink 任务通过 reasoning_effort:'none' 关闭思考（实测本机
 *     Ollama 0.31 生效；/no_think 软开关与 think:false 均无效；该参数为
 *     OpenAI 标准字段，vLLM 亦识别），防思考段吃掉 token 预算导致截断
 *   - 输出统一剥离 <think>…</think>（其他运行时可能内联思考段，双保险）
 */

import { OpenAIEnhancedProvider } from './openai-enhanced.provider.mjs';

export function stripThink(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*<think>[\s\S]*$/, '')
    .trim();
}

export class GedoProvider extends OpenAIEnhancedProvider {
  constructor(config = {}) {
    super({
      ...config,
      apiKey: config.apiKey || process.env.GEDO_LLM_API_KEY || 'gedo-local',
      model: config.model || process.env.GEDO_LLM_MODEL || 'qwen3:14b',
      baseURL: config.baseURL || process.env.GEDO_LLM_BASE_URL,
      maxTokens: config.maxTokens || Number(process.env.GEDO_LLM_MAX_TOKENS) || 2048,
    });
    this.local = true;
  }

  describe() {
    return { provider: 'gedo', model: this.model, local: true };
  }

  async chat(messages, options = {}) {
    const opts = { ...options };
    if ((opts.json || opts.noThink) && !opts.keepThink) {
      opts.extraParams = { reasoning_effort: 'none', ...(opts.extraParams || {}) };
    }
    const res = await super.chat(messages, opts);
    if (typeof res.content === 'string') res.content = stripThink(res.content);
    return res;
  }
}

export default GedoProvider;
