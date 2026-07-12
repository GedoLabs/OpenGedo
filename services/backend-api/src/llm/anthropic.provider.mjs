/**
 * Anthropic (Claude) Provider
 * 
 * Primary LLM provider for GEDO V2:
 * - Messages API with streaming
 * - Tool use (function calling)
 * - Multi-turn conversation support
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from './provider.mjs';
import { resolveProxyUrl, applyProxy } from './proxy.mjs';

export class AnthropicProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    this.maxTokens =
      config.maxTokens || Number(process.env.ANTHROPIC_MAX_TOKENS) || 4096;
    const baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL || undefined;
    const timeout =
      config.timeout ??
      (process.env.ANTHROPIC_TIMEOUT_MS ? Number(process.env.ANTHROPIC_TIMEOUT_MS) : undefined);

    if (!this.apiKey) {
      console.warn('[AnthropicProvider] No API key provided');
    }

    const clientOpts = { apiKey: this.apiKey };
    if (baseURL) clientOpts.baseURL = baseURL;
    if (timeout != null && !Number.isNaN(timeout)) clientOpts.timeout = timeout;

    // Route through an HTTP proxy when configured (local dev behind a
    // region-restricted network). No proxy env → direct (production default).
    applyProxy(clientOpts, {
      proxyUrl: resolveProxyUrl({ explicitEnvVar: 'ANTHROPIC_PROXY', configProxyUrl: config.proxyUrl }),
      baseURL,
      label: 'AnthropicProvider',
    });

    this.client = new Anthropic(clientOpts);
  }

  describe() {
    return { provider: 'anthropic', model: this.model };
  }

  /**
   * Standard chat completion (non-streaming)
   */
  async chat(messages, options = {}) {
    try {
      const { systemMessage, userMessages } = this._splitMessages(messages);

      const params = {
        model: options.model || this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature ?? 0.7,
        messages: userMessages,
      };

      if (systemMessage) {
        params.system = systemMessage;
      }

      if (options.tools && options.tools.length > 0) {
        params.tools = options.tools.map(t => this._convertTool(t));
      }

      if (options.json) {
        params.system = (params.system || '') + '\n\nYou must respond with valid JSON only.';
      }

      // Per-request timeout (overrides the client default) so callers like the
      // goal planner can fail fast to a fallback instead of hanging the stream.
      const reqOpts = options.timeout ? { timeout: options.timeout } : undefined;
      const response = await this.client.messages.create(params, reqOpts);

      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');

      return {
        content: textBlocks.map(b => b.text).join(''),
        toolCalls: toolBlocks.map(b => ({
          id: b.id,
          name: b.name,
          arguments: b.input,
        })),
        stopReason: response.stop_reason,
        usage: response.usage,
      };
    } catch (error) {
      console.error('[AnthropicProvider] chat error:', error);
      throw error;
    }
  }

  /**
   * Streaming chat completion via SSE
   * Returns an async generator that yields chunks
   */
  async *chatStream(messages, options = {}) {
    const { systemMessage, userMessages } = this._splitMessages(messages);

    const params = {
      model: options.model || this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? 0.7,
      messages: userMessages,
      stream: true,
    };

    if (systemMessage) {
      params.system = systemMessage;
    }

    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools.map(t => this._convertTool(t));
      // Normalized tool_choice: 'any' forces *some* tool, { tool: name } forces
      // a specific one. Used as a deterministic backstop (e.g. goal decompose).
      if (options.toolChoice === 'any') params.tool_choice = { type: 'any' };
      else if (options.toolChoice?.tool) params.tool_choice = { type: 'tool', name: options.toolChoice.tool };
      else if (options.toolChoice && typeof options.toolChoice === 'object') params.tool_choice = options.toolChoice;
    }

    try {
      const stream = this.client.messages.stream(params, { signal: options.signal });

      let currentToolCall = null;
      let toolCallJsonStr = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            // Text block starting
          } else if (event.content_block.type === 'tool_use') {
            currentToolCall = {
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: {},
            };
            toolCallJsonStr = '';
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            toolCallJsonStr += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolCall) {
            try {
              currentToolCall.arguments = JSON.parse(toolCallJsonStr);
            } catch {
              currentToolCall.arguments = {};
            }
            yield { type: 'tool_call', toolCall: currentToolCall };
            currentToolCall = null;
            toolCallJsonStr = '';
          }
        } else if (event.type === 'message_stop') {
          yield { type: 'done' };
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            yield { type: 'usage', usage: event.usage };
          }
        }
      }
      // The SDK's stream can end this loop without throwing when aborted via
      // `signal` — check explicitly rather than relying on the catch below.
      if (options.signal?.aborted) { yield { type: 'aborted' }; return; }
    } catch (error) {
      if (error?.name === 'APIUserAbortError' || options.signal?.aborted) {
        yield { type: 'aborted' };
        return;
      }
      console.error('[AnthropicProvider] chatStream error:', error);
      yield { type: 'error', error: error.message };
    }
  }

  /**
   * Continue a conversation after tool results
   */
  async chatWithToolResults(messages, toolResults, options = {}) {
    const { systemMessage, userMessages } = this._splitMessages(messages);

    const toolResultContent = toolResults.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.id,
      content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
    }));

    userMessages.push({ role: 'user', content: toolResultContent });

    const params = {
      model: options.model || this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? 0.7,
      messages: userMessages,
    };

    if (systemMessage) {
      params.system = systemMessage;
    }

    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools.map(t => this._convertTool(t));
    }

    const response = await this.client.messages.create(params);

    const textBlocks = response.content.filter(b => b.type === 'text');
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    return {
      content: textBlocks.map(b => b.text).join(''),
      toolCalls: toolBlocks.map(b => ({
        id: b.id,
        name: b.name,
        arguments: b.input,
      })),
      stopReason: response.stop_reason,
      usage: response.usage,
    };
  }

  /**
   * Streaming chat with tool results
   */
  async *chatStreamWithToolResults(messages, toolResults, options = {}) {
    const { systemMessage, userMessages } = this._splitMessages(messages);

    const toolResultContent = toolResults.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.id,
      content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
    }));

    userMessages.push({ role: 'user', content: toolResultContent });

    const newMessages = [...messages.filter(m => m.role !== 'system'), { role: 'user', content: toolResultContent }];
    yield* this.chatStream([
      ...(systemMessage ? [{ role: 'system', content: systemMessage }] : []),
      ...userMessages,
    ], options);
  }

  /**
   * Split messages into system + user/assistant messages
   * (Anthropic uses separate system parameter)
   */
  _splitMessages(messages) {
    let systemMessage = '';
    const userMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessage += (systemMessage ? '\n\n' : '') + msg.content;
      } else {
        userMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return { systemMessage, userMessages };
  }

  /**
   * Convert OpenAI-style tool definition to Anthropic format
   */
  _convertTool(tool) {
    if (tool.input_schema) {
      return tool; // Already in Anthropic format
    }

    return {
      name: tool.name || tool.function?.name,
      description: tool.description || tool.function?.description,
      input_schema: tool.parameters || tool.function?.parameters || {
        type: 'object',
        properties: {},
      },
    };
  }
}

export default AnthropicProvider;
