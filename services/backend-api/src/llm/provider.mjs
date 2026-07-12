/**
 * LLM Provider 接口与实现
 * 
 * 支持多种大模型供应商：
 * - Ollama (本地部署 Qwen2.5, BGE-M3)
 * - DeepSeek (API)
 * - OpenAI (API)
 */

/**
 * 基础 LLM Provider 接口
 */
export class LLMProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * 对话补全
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} options - { temperature, json }
   * @returns {Promise<{content: string}>}
   */
  async chat(messages, options = {}) {
    throw new Error('chat() not implemented');
  }

  /**
   * 文本嵌入
   * @param {string} text
   * @returns {Promise<number[]>} 向量数组
   */
  async embed(text) {
    throw new Error('embed() not implemented');
  }

  /**
   * 批量文本嵌入
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async embedBatch(texts) {
    // 默认串行执行，子类可覆盖优化
    return Promise.all(texts.map(t => this.embed(t)));
  }

  /**
   * 重排序
   * @param {string} query
   * @param {string[]} documents
   * @returns {Promise<Array<{index: number, score: number}>>}
   */
  async rerank(query, documents) {
    throw new Error('rerank() not implemented');
  }
}

/**
 * Ollama 本地部署
 * 
 * 推荐模型：
 * - Chat: qwen2.5:7b-instruct
 * - Embed: bge-m3
 * - Rerank: bge-reranker-v2-m3
 */
export class OllamaProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';
    this.embedModel = config.embedModel || process.env.OLLAMA_EMBED_MODEL || 'bge-m3';
    this.rerankModel = config.rerankModel || 'bge-reranker-v2-m3';
  }

  async chat(messages, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          format: options.json ? 'json' : undefined,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens ?? 2048,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json();
      return { content: data.message?.content || '' };
    } catch (error) {
      console.error('[OllamaProvider] chat error:', error);
      throw error;
    }
  }

  async embed(text) {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.embedModel,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embed error: ${response.status}`);
      }

      const data = await response.json();
      return data.embedding; // [1024] for BGE-M3
    } catch (error) {
      console.error('[OllamaProvider] embed error:', error);
      throw error;
    }
  }

  async rerank(query, documents) {
    // Ollama 目前不原生支持 rerank，使用外部服务或降级
    // 这里提供一个简单的基于 embedding 相似度的降级方案
    try {
      const queryEmbed = await this.embed(query);
      const docEmbeds = await this.embedBatch(documents);

      const scores = docEmbeds.map((docEmbed, index) => ({
        index,
        score: cosineSimilarity(queryEmbed, docEmbed),
      }));

      return scores.sort((a, b) => b.score - a.score);
    } catch (error) {
      console.error('[OllamaProvider] rerank error:', error);
      // 降级：返回原始顺序
      return documents.map((_, index) => ({ index, score: 1 - index * 0.01 }));
    }
  }
}

/**
 * DeepSeek API
 */
export class DeepSeekProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
    this.model = config.model || 'deepseek-chat';
    
    if (!this.apiKey) {
      console.warn('[DeepSeekProvider] No API key provided');
    }
  }

  async chat(messages, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2048,
          response_format: options.json ? { type: 'json_object' } : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`DeepSeek error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      return { content: data.choices?.[0]?.message?.content || '' };
    } catch (error) {
      console.error('[DeepSeekProvider] chat error:', error);
      throw error;
    }
  }

  async embed(text) {
    // DeepSeek 目前不提供 embedding API，降级到 Ollama
    console.warn('[DeepSeekProvider] embed not supported, falling back to Ollama');
    const ollama = new OllamaProvider();
    return ollama.embed(text);
  }
}

/**
 * OpenAI API
 */
export class OpenAIProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    this.model = config.model || 'gpt-4o-mini';
    this.embedModel = config.embedModel || 'text-embedding-3-small';
    
    if (!this.apiKey) {
      console.warn('[OpenAIProvider] No API key provided');
    }
  }

  async chat(messages, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2048,
          response_format: options.json ? { type: 'json_object' } : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      return { content: data.choices?.[0]?.message?.content || '' };
    } catch (error) {
      console.error('[OpenAIProvider] chat error:', error);
      throw error;
    }
  }

  async embed(text) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embedModel,
          input: text,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI embed error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      return data.data?.[0]?.embedding || [];
    } catch (error) {
      console.error('[OpenAIProvider] embed error:', error);
      throw error;
    }
  }

  async embedBatch(texts) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embedModel,
          input: texts,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI embed error: ${error.error?.message || response.status}`);
      }

      const data = await response.json();
      return data.data?.map(d => d.embedding) || [];
    } catch (error) {
      console.error('[OpenAIProvider] embedBatch error:', error);
      throw error;
    }
  }
}

/**
 * 创建 LLM Provider 实例（同步，用于 embed 等）
 * 对话流使用 getLLMRouter()，支持 Claude/GPT streaming。
 */
export function createLLMProvider(type, config = {}) {
  const providerType = type || process.env.LLM_PROVIDER || 'ollama';
  
  switch (providerType) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'deepseek':
      return new DeepSeekProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    default:
      console.warn(`Unknown LLM provider: ${providerType}, falling back to Ollama`);
      return new OllamaProvider(config);
  }
}

/**
 * 异步创建 LLM Provider（可选，用于需要 Claude/GPT 的场景）
 */
export async function createLLMProviderAsync(type, config = {}) {
  const providerType = type || process.env.LLM_PROVIDER || 'anthropic';
  if (providerType === 'anthropic' || providerType === 'claude') {
    const { AnthropicProvider } = await import('./anthropic.provider.mjs');
    return new AnthropicProvider(config);
  }
  if (providerType === 'openai-enhanced' || providerType === 'gpt') {
    const { OpenAIEnhancedProvider } = await import('./openai-enhanced.provider.mjs');
    return new OpenAIEnhancedProvider(config);
  }
  return createLLMProvider(providerType, config);
}

// 辅助函数：余弦相似度
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export default { 
  LLMProvider, 
  OllamaProvider, 
  DeepSeekProvider, 
  OpenAIProvider, 
  createLLMProvider,
  createLLMProviderAsync,
};



















