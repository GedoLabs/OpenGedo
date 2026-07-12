/**
 * Embedding Provider Abstraction (P1)
 *
 * Local-first by default: Ollama + bge-m3 (1024-dim). Keeps sensitive long-term
 * memory (goals, behaviour, identity) on-device, costs nothing for frequent
 * backfill/debug, and bge-m3 is solid multilingual (zh/en/ja).
 *
 * Provider is selected by env so cloud/higher-quality models can be added or
 * swapped later WITHOUT touching call sites. NOTE: switching the model/dim
 * requires a full backfill re-compute — embeddings of different dimensions must
 * never be mixed (enforced by FileMemoryStore.searchEpisodesByVector's dim guard).
 *
 *   EMBEDDING_PROVIDER = ollama (default) | openai | siliconflow | qwen3-embedding | openai-compatible
 *   EMBEDDING_MODEL    = bge-m3 (default)
 *   EMBEDDING_DIM      = 1024 (default)
 *   OLLAMA_BASE_URL    = http://localhost:11434
 *   EMBEDDING_BASE_URL / EMBEDDING_API_KEY   (override for cloud/openai-compatible)
 *
 * Each provider exposes: { id, provider, model, dim, isAvailable(), embed(text), embedBatch(texts) }.
 * embed() and embedBatch() may throw; the embedding engine catches and falls
 * back to keyword recall so the chat path is never blocked.
 */

const DEFAULTS = {
  provider: 'ollama',
  model: 'bge-m3',
  dim: 1024,
  ollamaBaseUrl: 'http://localhost:11434',
};

// Known OpenAI-compatible cloud providers (future upgrade options, not default).
const COMPAT_PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', keyEnv: 'SILICONFLOW_API_KEY' },
  'qwen3-embedding': { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyEnv: 'DASHSCOPE_API_KEY' },
};

class OllamaEmbeddingProvider {
  constructor({ model, dim, baseUrl }) {
    this.provider = 'ollama';
    this.model = model;
    this.dim = dim;
    this.baseUrl = (baseUrl || DEFAULTS.ollamaBaseUrl).replace(/\/+$/, '');
    this.id = `ollama/${model}`;
  }
  // Local server assumed reachable; embed() surfaces failures (→ keyword fallback).
  isAvailable() { return true; }
  async embed(text) {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) throw new Error(`ollama embed ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.embedding) ? data.embedding : null;
  }
  async embedBatch(texts) {
    // /api/embeddings is single-prompt; sequential is fine for internal backfill.
    const out = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}

class OpenAICompatibleEmbeddingProvider {
  // Covers openai / siliconflow / qwen3-embedding — all expose POST /embeddings.
  constructor({ provider, model, dim, baseUrl, apiKey }) {
    this.provider = provider;
    this.model = model;
    this.dim = dim;
    this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = apiKey || '';
    this.id = `${provider}/${model}`;
  }
  isAvailable() { return !!this.apiKey; }
  async embed(text) {
    const [v] = await this.embedBatch([text]);
    return v || null;
  }
  async embedBatch(texts) {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`${this.provider} embed ${res.status}`);
    const data = await res.json();
    return (data.data || []).map(d => d.embedding);
  }
}

let _instance = null;

export function getEmbeddingProvider() {
  if (_instance) return _instance;
  const provider = (process.env.EMBEDDING_PROVIDER || DEFAULTS.provider).toLowerCase();
  const model = process.env.EMBEDDING_MODEL || DEFAULTS.model;
  const dim = parseInt(process.env.EMBEDDING_DIM || String(DEFAULTS.dim), 10) || DEFAULTS.dim;

  if (provider === 'ollama') {
    _instance = new OllamaEmbeddingProvider({ model, dim, baseUrl: process.env.OLLAMA_BASE_URL });
  } else if (provider === 'openai-compatible' || provider in COMPAT_PRESETS) {
    const preset = COMPAT_PRESETS[provider] || {};
    _instance = new OpenAICompatibleEmbeddingProvider({
      provider,
      model,
      dim,
      baseUrl: process.env.EMBEDDING_BASE_URL || preset.baseUrl,
      apiKey: process.env.EMBEDDING_API_KEY || (preset.keyEnv ? process.env[preset.keyEnv] : ''),
    });
  } else {
    console.warn(`[embedding] unknown EMBEDDING_PROVIDER="${provider}" — falling back to ollama/${DEFAULTS.model}`);
    _instance = new OllamaEmbeddingProvider({ model: DEFAULTS.model, dim: DEFAULTS.dim, baseUrl: process.env.OLLAMA_BASE_URL });
  }
  console.log(`[embedding] provider=${_instance.id} dim=${_instance.dim} available=${_instance.isAvailable()}`);
  return _instance;
}

/** Test/diagnostics helper: reset the singleton (e.g. after changing env). */
export function _resetEmbeddingProvider() { _instance = null; }

export default { getEmbeddingProvider, _resetEmbeddingProvider };
