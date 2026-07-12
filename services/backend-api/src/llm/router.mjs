/**
 * LLM Router
 * 
 * Manages multiple LLM providers and routes requests:
 * - Claude (Anthropic): Primary for chat, analysis, planning
 * - GPT-4o (OpenAI): Embeddings, backup chat
 * - Automatic fallback on failure
 */

import { AnthropicProvider } from './anthropic.provider.mjs';
import { OpenAIEnhancedProvider } from './openai-enhanced.provider.mjs';
import { GedoProvider } from './gedo.provider.mjs';
import { getTask, resolveRoute, validateTaskOutput, parseJsonLoose, isSovereignMode } from './tasks.mjs';
import { renderPersonaDialect } from '../persona/spec.mjs';

function providerNameOf(provider) {
  return provider?.describe?.().provider || 'unknown';
}

/**
 * 按"实际执行端点"注入人格方言补丁（含 fallback 切换后的端点）。
 * 仅当调用方显式 options.personaDialect=true 才生效，避免污染 JSON 抽取类任务。
 */
function withDialect(messages, providerName, options) {
  if (!options?.personaDialect) return messages;
  const patch = renderPersonaDialect(providerName);
  if (!patch) return messages;
  let applied = false;
  return messages.map(m => {
    if (!applied && m.role === 'system') {
      applied = true;
      return { ...m, content: `${m.content}\n\n${patch}` };
    }
    return m;
  });
}

const PLACEHOLDER_API_KEYS = new Set([
  'your-anthropic-api-key',
  'your-openai-api-key',
  'sk-ant-your-key-here',
  'sk-your-key-here',
]);

/** Normalize env API keys — ignore blanks and env.example placeholders. */
export function resolveApiKey(envName) {
  const raw = process.env[envName];
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (PLACEHOLDER_API_KEYS.has(lower)) return null;
  if (lower.startsWith('your-') || lower.includes('your-api-key')) return null;
  return value;
}

/**
 * Map env LLM_PROVIDER / PRIMARY_LLM to router slot: anthropic | openai
 */
function resolvePrimaryChat(config) {
  if (config.primaryChat) return config.primaryChat;
  const raw = (process.env.LLM_PROVIDER || process.env.PRIMARY_LLM || 'anthropic')
    .toLowerCase()
    .trim();
  const openaiAliases = new Set(['openai', 'gpt', 'gpt-4', 'gpt4', 'gpt-4o', 'gpt4o']);
  if (openaiAliases.has(raw)) return 'openai';
  return 'anthropic';
}

export class LLMRouter {
  constructor(config = {}) {
    this.providers = {};
    this.primaryChat = resolvePrimaryChat(config);

    const anthropicKey = resolveApiKey('ANTHROPIC_API_KEY');
    const openaiKey = resolveApiKey('OPENAI_API_KEY');

    if (anthropicKey || config.anthropic) {
      this.providers.anthropic = new AnthropicProvider({
        ...(config.anthropic || {}),
        ...(anthropicKey ? { apiKey: anthropicKey } : {}),
      });
      const d = this.providers.anthropic.describe?.() || {};
      console.log(`[LLMRouter] Anthropic provider initialized (model=${d.model || 'unknown'})`);
    }

    if (openaiKey || config.openai) {
      this.providers.openai = new OpenAIEnhancedProvider({
        ...(config.openai || {}),
        ...(openaiKey ? { apiKey: openaiKey } : {}),
      });
      const d = this.providers.openai.describe?.() || {};
      console.log(`[LLMRouter] OpenAI provider initialized (model=${d.model || 'unknown'}, embed=${d.embedModel || 'unknown'})`);
    }

    // Gedo Persona 自有模型端点（L1 车道）：现为本地 Ollama 原版 Qwen3，
    // 训练完成后改 GEDO_LLM_BASE_URL / GEDO_LLM_MODEL 即切换（见 gedo.provider.mjs）
    const gedoBase = (process.env.GEDO_LLM_BASE_URL || '').trim();
    if (gedoBase || config.gedo) {
      this.providers.gedo = new GedoProvider(config.gedo || {});
      const d = this.providers.gedo.describe();
      console.log(`[LLMRouter] Gedo provider initialized (model=${d.model}, baseURL=${gedoBase || 'config'})`);
    }

    if (Object.keys(this.providers).length === 0) {
      const hints = [];
      if (process.env.ANTHROPIC_API_KEY !== undefined && !anthropicKey) {
        hints.push('ANTHROPIC_API_KEY is set but empty/placeholder');
      }
      if (process.env.OPENAI_API_KEY !== undefined && !openaiKey) {
        hints.push('OPENAI_API_KEY is set but empty/placeholder');
      }
      console.warn(
        '[LLMRouter] No LLM providers configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in services/backend-api/.env and restart (use npm run dev or ensure .env is loaded).',
        hints.length ? `(${hints.join('; ')})` : '',
      );
    } else {
      const primary = this.providers[this.primaryChat];
      const primaryModel = primary?.describe?.().model || 'unknown';
      const fallbackName = this.primaryChat === 'anthropic' ? 'openai' : 'anthropic';
      const hasFallback = !!this.providers[fallbackName];
      console.log(`[LLMRouter] primaryChat=${this.primaryChat} model=${primaryModel} fallback=${hasFallback ? fallbackName : 'none'}`);
    }
  }

  /**
   * Get the primary chat provider
   */
  getChatProvider() {
    // 断供演习/自托管（GEDO_SOVEREIGN_MODE=1）：外部端点全屏蔽，本地 gedo 兜底
    if (isSovereignMode()) return this.providers.gedo || null;
    return this.providers[this.primaryChat] || this.providers.anthropic || this.providers.openai;
  }

  /**
   * Get the embedding provider (always OpenAI)
   */
  getEmbedProvider() {
    return this.providers.openai;
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name) {
    return this.providers[name];
  }

  /**
   * Standard chat with automatic fallback
   */
  async chat(messages, options = {}) {
    const primary = this.getChatProvider();
    if (!primary) {
      throw new Error('No LLM provider available');
    }

    try {
      return await primary.chat(withDialect(messages, providerNameOf(primary), options), options);
    } catch (error) {
      console.error(`[LLMRouter] Primary chat failed (${this.primaryChat}):`, error.message);

      // Try fallback（断供模式下不再切到另一个外部厂商）
      const fallbackName = this.primaryChat === 'anthropic' ? 'openai' : 'anthropic';
      const fallback = isSovereignMode() ? null : this.providers[fallbackName];

      if (fallback) {
        console.log(`[LLMRouter] Falling back to ${fallbackName}`);
        return await fallback.chat(withDialect(messages, fallbackName, options), options);
      }

      throw error;
    }
  }

  /**
   * Streaming chat accumulated into a single string, returned as { content } —
   * same shape as chat(). Prefer this for long JSON generations: a non-streaming
   * request leaves the socket idle while the model generates, which a local proxy
   * drops ("other side closed"); streaming keeps bytes flowing so the LLM path runs.
   */
  async chatToText(messages, options = {}) {
    let content = '';
    for await (const chunk of this.chatStream(messages, options)) {
      if (chunk.type === 'text') content += chunk.text;
      else if (chunk.type === 'error') throw new Error(chunk.error || 'stream error');
    }
    return { content };
  }

  /**
   * 任务级路由（K4 · 实施方案 P1）
   *
   * 按任务注册表（tasks.mjs）选端点执行，带 schema 校验与降级链：
   *   runTask('memory.extract', messages) → { content, json?, provenance, ... }
   *
   * - route 中 'gedo' 直连自有模型端点；'primary' 走既有主/备链（保留互切）
   * - perceive 任务（有 outputSchema）：宽容解析 JSON + ajv 校验，
   *   失败同端点重试 1 次，再失败降级下一端点
   * - GEDO_SOVEREIGN_MODE=1：路由过滤为本地端点（断供演习）
   * - provenance：{ task, provider, model, ts }——写入 K2 的调用方应随数据落库
   */
  async runTask(taskId, messages, opts = {}) {
    const task = getTask(taskId) || {};
    const options = { ...(task.options || {}), ...(opts.options || {}) };

    let route = resolveRoute(taskId);
    if (isSovereignMode()) {
      route = route.filter(name => name !== 'primary' && this.providers[name]?.local);
      if (route.length === 0 && this.providers.gedo) route = ['gedo'];
    }

    const errors = [];
    for (const name of route) {
      const provider = name === 'primary' ? this.getChatProvider() : this.providers[name];
      if (!provider) {
        errors.push(`${name}: unavailable`);
        continue;
      }
      const maxAttempts = task.outputSchema ? 2 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // 'primary' 复用既有 chat() 以保留主/备互切；具名端点直连。
          // viaText 任务在 primary 车道改走流式聚合（长 JSON 经代理易断流）
          const res = name === 'primary'
            ? (task.viaText
              ? await this.chatToText(messages, options)
              : await this.chat(messages, options))
            : await provider.chat(withDialect(messages, name, options), options);
          const provenance = {
            task: taskId,
            provider: name === 'primary' ? `primary(${this.primaryChat})` : name,
            model: provider.describe?.().model || 'unknown',
            ts: new Date().toISOString(),
          };
          if (task.outputSchema) {
            const json = parseJsonLoose(res.content);
            const check = validateTaskOutput(taskId, json);
            if (!check.ok) throw new Error(`schema invalid: ${check.errors}`);
            return { ...res, json, provenance };
          }
          return { ...res, provenance };
        } catch (error) {
          errors.push(`${name}#${attempt}: ${error.message}`);
        }
      }
    }
    throw new Error(`[runTask ${taskId}] all routes failed: ${errors.join(' | ')}`);
  }

  /**
   * Streaming chat with automatic fallback
   */
  async *chatStream(messages, options = {}) {
    const primary = this.getChatProvider();
    if (!primary) {
      yield { type: 'error', error: 'No LLM provider available' };
      return;
    }

    const fallbackName = this.primaryChat === 'anthropic' ? 'openai' : 'anthropic';
    const fallback = isSovereignMode() ? null : this.providers[fallbackName];

    // A provider signals failure two ways: by throwing, OR by yielding an
    // { type:'error' } chunk (its internal catch swallows the throw). Handle
    // both. Only fall back when nothing user-visible has been emitted yet —
    // once text/tool_call is on the wire, switching providers would duplicate
    // output, so we surface the error instead.
    let emitted = false;
    let primaryError = null;
    try {
      for await (const chunk of primary.chatStream(withDialect(messages, providerNameOf(primary), options), options)) {
        // A deliberate Stop must never fail over to the other provider — that
        // would launch a second, un-aborted request against the same history,
        // exactly the cost/latency leak Stop exists to prevent. Short-circuit
        // ahead of the generic error handling below.
        if (chunk.type === 'aborted') { yield chunk; return; }
        if (chunk.type === 'error') { primaryError = chunk.error || 'stream error'; break; }
        if (chunk.type === 'text' || chunk.type === 'tool_call') emitted = true;
        yield chunk;
      }
    } catch (error) {
      primaryError = error?.message || String(error);
    }

    if (!primaryError) return; // primary finished cleanly

    console.error(`[LLMRouter] Primary stream failed (${this.primaryChat}): ${primaryError}`);
    if (fallback && !emitted) {
      console.log(`[LLMRouter] Stream falling back to ${fallbackName}`);
      yield* fallback.chatStream(withDialect(messages, fallbackName, options), options);
    } else {
      yield { type: 'error', error: primaryError };
    }
  }

  /**
   * Chat with tool results
   */
  async chatWithToolResults(messages, toolResults, options = {}) {
    const primary = this.getChatProvider();
    if (!primary) {
      throw new Error('No LLM provider available');
    }
    return primary.chatWithToolResults(messages, toolResults, options);
  }

  /**
   * Streaming with tool results
   */
  async *chatStreamWithToolResults(messages, toolResults, options = {}) {
    const primary = this.getChatProvider();
    if (!primary) {
      yield { type: 'error', error: 'No LLM provider available' };
      return;
    }
    yield* primary.chatStreamWithToolResults(messages, toolResults, options);
  }

  /**
   * Generate embeddings (always uses OpenAI)
   */
  async embed(text) {
    const provider = this.getEmbedProvider();
    if (!provider) {
      throw new Error('No embedding provider available (need OpenAI)');
    }
    return provider.embed(text);
  }

  /**
   * Batch embeddings
   */
  async embedBatch(texts) {
    const provider = this.getEmbedProvider();
    if (!provider) {
      throw new Error('No embedding provider available (need OpenAI)');
    }
    return provider.embedBatch(texts);
  }

  /**
   * Check if any provider is available
   */
  isAvailable() {
    return Object.keys(this.providers).length > 0;
  }

  /**
   * Get status of all providers
   */
  getStatus() {
    const models = {};
    for (const [name, provider] of Object.entries(this.providers)) {
      const d = provider.describe?.();
      if (d) models[name] = d;
    }
    return {
      available: this.isAvailable(),
      primaryChat: this.primaryChat,
      providers: Object.keys(this.providers),
      models,
      keys: {
        anthropic: !!resolveApiKey('ANTHROPIC_API_KEY'),
        openai: !!resolveApiKey('OPENAI_API_KEY'),
        gedo: !!(process.env.GEDO_LLM_BASE_URL || '').trim(),
      },
      sovereign: isSovereignMode(),
      hint: this.isAvailable()
        ? null
        : 'Create services/backend-api/.env with ANTHROPIC_API_KEY=... then restart via npm run dev',
    };
  }
}

// Singleton instance
let _router = null;

export function getLLMRouter(config) {
  if (!_router || config) {
    _router = new LLMRouter(config || {});
  }
  return _router;
}

export default { LLMRouter, getLLMRouter };
