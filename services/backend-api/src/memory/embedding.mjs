/**
 * Embedding Engine (P1) — local-first (Ollama / bge-m3, 1024-dim) by default.
 *
 * Turns episode text into vectors via the configured embedding provider
 * (see ./embedding-providers.mjs). The default keeps sensitive memory on-device;
 * cloud providers (openai/siliconflow/qwen3) are opt-in via env and require a
 * full backfill re-compute (no mixing dims).
 *
 * Every stored vector carries embedding_metadata { provider, model, dim,
 * created_at, source_hash } so we can audit which model produced it, detect
 * stale embeddings when the source text changes, and enforce the dim guard.
 *
 * Best-effort and NEVER throws to callers: if the provider is unavailable or
 * fails (e.g. Ollama not running), embedText returns null and recall falls back
 * to keyword search — the chat path is never blocked.
 */

import crypto from 'node:crypto';
import { nowIso } from '../lib/crypto.mjs';
import { getEmbeddingProvider } from './embedding-providers.mjs';
import { getMemoryStore } from './store/index.mjs';

const MAX_EMBED_CHARS = 8000; // episodes are short; stay well under token limits

/** Active embedding config (for backfill logging / diagnostics). */
export function embeddingInfo() {
  try {
    const p = getEmbeddingProvider();
    return { id: p.id, provider: p.provider, model: p.model, dim: p.dim, available: p.isAvailable() };
  } catch {
    return { id: 'none', provider: null, model: null, dim: null, available: false };
  }
}

export function isEmbeddingAvailable() {
  try { return getEmbeddingProvider().isAvailable(); } catch { return false; }
}

function sourceHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function episodeText(ep) {
  return ep?.content_raw || ep?.content_struct?.summary || '';
}

function buildMeta(provider, text, vec) {
  return {
    provider: provider.provider,
    model: provider.model,
    dim: vec.length,
    created_at: nowIso(),
    source_hash: sourceHash(text),
  };
}

/**
 * Embed a single string. Returns a vector or null (never throws).
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function embedText(text) {
  const clean = (text || '').trim();
  if (!clean) return null;
  let provider;
  try { provider = getEmbeddingProvider(); } catch { return null; }
  if (!provider.isAvailable()) return null;
  try {
    const vec = await provider.embed(clean.slice(0, MAX_EMBED_CHARS));
    return Array.isArray(vec) && vec.length ? vec : null;
  } catch (err) {
    console.warn('[embedding] embedText failed:', err?.message?.slice(0, 80));
    return null;
  }
}

/**
 * Embed one episode and persist its vector + metadata. Fire-and-forget friendly.
 * @returns {Promise<boolean>}
 */
export async function embedEpisode(userId, episode) {
  if (!episode?.id) return false;
  const text = episodeText(episode).trim();
  if (!text) return false;
  const vec = await embedText(text);
  if (!vec) return false;
  const provider = getEmbeddingProvider();
  if (provider.dim && vec.length !== provider.dim) {
    console.warn(`[embedding] dim mismatch: got ${vec.length}, expected ${provider.dim} (${provider.id})`);
  }
  try {
    return getMemoryStore().saveEpisodeEmbedding(userId, episode.id, vec, buildMeta(provider, text, vec));
  } catch {
    return false;
  }
}

/**
 * Embed many episodes (batch where the provider supports it) for backfill.
 * @returns {Promise<number>} vectors stored
 */
export async function embedEpisodesBatch(userId, episodes) {
  if (!episodes?.length || !isEmbeddingAvailable()) return 0;
  const provider = getEmbeddingProvider();
  const store = getMemoryStore();
  const items = episodes
    .map(ep => ({ ep, text: episodeText(ep).trim() }))
    .filter(x => x.ep?.id && x.text);
  if (!items.length) return 0;

  let stored = 0;
  try {
    const vectors = await provider.embedBatch(items.map(x => x.text.slice(0, MAX_EMBED_CHARS)));
    for (let i = 0; i < items.length; i++) {
      const vec = vectors?.[i];
      if (Array.isArray(vec) && vec.length) {
        store.saveEpisodeEmbedding(userId, items[i].ep.id, vec, buildMeta(provider, items[i].text, vec));
        stored++;
      }
    }
  } catch (err) {
    console.warn('[embedding] embedEpisodesBatch failed:', err?.message?.slice(0, 80));
  }
  return stored;
}

export default { embeddingInfo, isEmbeddingAvailable, embedText, embedEpisode, embedEpisodesBatch };
