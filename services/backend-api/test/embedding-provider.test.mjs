/**
 * Embedding provider abstraction tests (P1).
 *
 * Locks the local-first default (ollama/bge-m3 @ 1024) and verifies a cloud
 * provider can be selected purely via env — no call-site changes. No network.
 *
 * Run: npx vitest run test/embedding-provider.test.mjs
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getEmbeddingProvider, _resetEmbeddingProvider } from '../src/memory/embedding-providers.mjs';

const KEYS = ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL', 'EMBEDDING_DIM', 'EMBEDDING_BASE_URL', 'EMBEDDING_API_KEY'];
afterEach(() => { for (const k of KEYS) delete process.env[k]; _resetEmbeddingProvider(); });

describe('P1 embedding provider abstraction', () => {
  it('defaults to local ollama/bge-m3 @ 1024', () => {
    for (const k of KEYS) delete process.env[k];
    _resetEmbeddingProvider();
    const p = getEmbeddingProvider();
    expect(p.provider).toBe('ollama');
    expect(p.model).toBe('bge-m3');
    expect(p.dim).toBe(1024);
    expect(p.id).toBe('ollama/bge-m3');
    expect(p.isAvailable()).toBe(true);
  });

  it('switches to a cloud provider via env only (smooth future swap)', () => {
    process.env.EMBEDDING_PROVIDER = 'openai';
    process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.EMBEDDING_DIM = '1536';
    process.env.EMBEDDING_API_KEY = 'sk-test-dummy';
    _resetEmbeddingProvider();
    const p = getEmbeddingProvider();
    expect(p.provider).toBe('openai');
    expect(p.dim).toBe(1536);
    expect(p.id).toBe('openai/text-embedding-3-small');
    expect(p.isAvailable()).toBe(true);
  });

  it('falls back to ollama for an unknown provider', () => {
    process.env.EMBEDDING_PROVIDER = 'bogus-provider';
    _resetEmbeddingProvider();
    const p = getEmbeddingProvider();
    expect(p.provider).toBe('ollama');
    expect(p.dim).toBe(1024);
  });
});
