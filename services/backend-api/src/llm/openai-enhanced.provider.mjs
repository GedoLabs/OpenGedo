/**
 * Enhanced OpenAI Provider
 * 
 * Secondary LLM provider for GEDO V2:
 * - Chat completions with streaming
 * - Function calling (tool use)
 * - Embeddings (text-embedding-3-small)
 * - Backup for Claude when needed
 */

import OpenAI from 'openai';
import { LLMProvider } from './provider.mjs';
import { resolveProxyUrl, applyProxy } from './proxy.mjs';

export class OpenAIEnhancedProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || process.env.OPENAI_MODEL || 'gpt-4o';
    this.embedModel = config.embedModel || process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
    this.maxTokens = config.maxTokens || Number(process.env.OPENAI_MAX_TOKENS) || 4096;
    const baseURL = config.baseURL || process.env.OPENAI_BASE_URL || undefined;

    if (!this.apiKey) {
      console.warn('[OpenAIEnhancedProvider] No API key provided');
    }

    const clientOpts = { apiKey: this.apiKey };
    if (baseURL) clientOpts.baseURL = baseURL;

    // Same proxy handling as Anthropic; auto-skipped when baseURL is a
    // localhost endpoint (e.g. Ollama's OpenAI-compatible API stays direct).
    applyProxy(clientOpts, {
      proxyUrl: resolveProxyUrl({ explicitEnvVar: 'OPENAI_PROXY', configProxyUrl: config.proxyUrl }),
      baseURL,
      label: 'OpenAIEnhancedProvider',
    });

    this.client = new OpenAI(clientOpts);
  }

  describe() {
    return { provider: 'openai', model: this.model, embedModel: this.embedModel };
  }

  /**
   * Standard chat completion (non-streaming)
   */
  async chat(messages, options = {}) {
    try {
      const params = {
        model: options.model || this.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || this.maxTokens,
        // 端点特定参数直通（如 gedo 端点的 reasoning_effort，Ollama/vLLM 均识别）
        ...(options.extraParams || {}),
      };

      if (options.json) {
        params.response_format = { type: 'json_object' };
      }

      if (options.tools && options.tools.length > 0) {
        params.tools = options.tools.map(t => this._convertTool(t));
        params.tool_choice = options.toolChoice || 'auto';
      }

      // Per-request timeout (overrides client default) so callers can fail fast.
      const reqOpts = options.timeout ? { timeout: options.timeout } : undefined;
      const response = await this.client.chat.completions.create(params, reqOpts);
      const choice = response.choices[0];

      return {
        content: choice.message.content || '',
        toolCalls: (choice.message.tool_calls || []).map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        })),
        stopReason: choice.finish_reason,
        usage: response.usage,
      };
    } catch (error) {
      console.error('[OpenAIEnhancedProvider] chat error:', error);
      throw error;
    }
  }

  /**
   * Streaming chat completion
   * Returns an async generator that yields chunks
   */
  async *chatStream(messages, options = {}) {
    const params = {
      model: options.model || this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || this.maxTokens,
      stream: true,
    };

    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools.map(t => this._convertTool(t));
      // Translate the normalized tool_choice into OpenAI's shape.
      const tc = options.toolChoice;
      params.tool_choice = tc === 'any' ? 'required'
        : tc?.tool ? { type: 'function', function: { name: tc.tool } }
        : (typeof tc === 'string' ? tc : 'auto');
    }

    try {
      const stream = await this.client.chat.completions.create(params, { signal: options.signal });

      const toolCalls = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta?.content) {
          yield { type: 'text', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (!toolCalls[index]) {
              toolCalls[index] = { id: tc.id, name: '', arguments: '' };
            }
            if (tc.id) toolCalls[index].id = tc.id;
            if (tc.function?.name) toolCalls[index].name += tc.function.name;
            if (tc.function?.arguments) toolCalls[index].arguments += tc.function.arguments;
          }
        }

        if (finishReason === 'tool_calls') {
          for (const tc of Object.values(toolCalls)) {
            try {
              tc.arguments = JSON.parse(tc.arguments);
            } catch {
              tc.arguments = {};
            }
            yield { type: 'tool_call', toolCall: tc };
          }
        }

        if (finishReason === 'stop') {
          yield { type: 'done' };
        }
      }
      // Defensive, mirrors the Anthropic provider: don't assume this SDK
      // always throws on an aborted signal.
      if (options.signal?.aborted) { yield { type: 'aborted' }; return; }
    } catch (error) {
      if (error?.name === 'APIUserAbortError' || options.signal?.aborted) {
        yield { type: 'aborted' };
        return;
      }
      console.error('[OpenAIEnhancedProvider] chatStream error:', error);
      yield { type: 'error', error: error.message };
    }
  }

  /**
   * Continue a conversation after tool results
   */
  async chatWithToolResults(messages, toolResults, options = {}) {
    const messagesWithResults = [
      ...messages,
      ...toolResults.map(tr => ({
        role: 'tool',
        tool_call_id: tr.id,
        content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
      })),
    ];

    return this.chat(messagesWithResults, options);
  }

  /**
   * Streaming with tool results
   */
  async *chatStreamWithToolResults(messages, toolResults, options = {}) {
    const messagesWithResults = [
      ...messages,
      ...toolResults.map(tr => ({
        role: 'tool',
        tool_call_id: tr.id,
        content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
      })),
    ];

    yield* this.chatStream(messagesWithResults, options);
  }

  /**
   * Text embedding
   */
  async embed(text) {
    try {
      const response = await this.client.embeddings.create({
        model: this.embedModel,
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('[OpenAIEnhancedProvider] embed error:', error);
      throw error;
    }
  }

  /**
   * Batch text embeddings
   */
  async embedBatch(texts) {
    try {
      const response = await this.client.embeddings.create({
        model: this.embedModel,
        input: texts,
      });
      return response.data.map(d => d.embedding);
    } catch (error) {
      console.error('[OpenAIEnhancedProvider] embedBatch error:', error);
      throw error;
    }
  }

  /**
   * Convert Anthropic-style tool to OpenAI format
   */
  _convertTool(tool) {
    if (tool.type === 'function') {
      return tool; // Already in OpenAI format
    }

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema || tool.parameters || {
          type: 'object',
          properties: {},
        },
      },
    };
  }
}

export default OpenAIEnhancedProvider;
