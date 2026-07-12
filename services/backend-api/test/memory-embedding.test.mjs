/**
 * Episode embedding / vector-recall tests (P1).
 *
 * Covers the file-layer vector index (saveEpisodeEmbedding /
 * searchEpisodesByVector / getEpisodesMissingEmbedding) with synthetic vectors —
 * no LLM required. Verifies cosine ranking, the episode join, ai_excluded
 * filtering, backfill detection, and embedding cleanup on delete.
 *
 * Run: npx vitest run test/memory-embedding.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  addEpisode,
  saveEpisodeEmbedding,
  searchEpisodesByVector,
  getEpisodesMissingEmbedding,
  deleteEpisode,
  wipeUserMemory,
} from '../src/memory/memory-file.service.mjs';

const U = `embed-test-${Date.now()}`;
afterAll(() => wipeUserMemory(U));

describe('P1 episode embeddings — cosine vector recall', () => {
  it('ranks episodes by cosine similarity to the query vector', () => {
    const a = addEpisode(U, { type: 'important_info', contentRaw: 'apple red fruit', source: 'text' });
    const b = addEpisode(U, { type: 'important_info', contentRaw: 'bicycle commute', source: 'text' });
    const c = addEpisode(U, { type: 'important_info', contentRaw: 'apple orchard harvest', source: 'text' });

    saveEpisodeEmbedding(U, a.id, [1, 0, 0]);
    saveEpisodeEmbedding(U, b.id, [0, 1, 0]);
    saveEpisodeEmbedding(U, c.id, [0.9, 0.1, 0]); // close to `a`

    const res = searchEpisodesByVector(U, [1, 0, 0], { topK: 2 });
    expect(res.map(r => r.id)).toEqual([a.id, c.id]); // b (orthogonal) excluded
    expect(res[0].vector_score).toBeGreaterThan(res[1].vector_score);
    expect(res[0].vector_score).toBeCloseTo(1, 5);
    // returns full episode objects, not just ids
    expect(res[0].content_raw).toBe('apple red fruit');
  });

  it('skips dimension-mismatched vectors instead of throwing', () => {
    const res = searchEpisodesByVector(U, [1, 0, 0, 0], { topK: 5 }); // wrong dim
    expect(res).toEqual([]);
  });

  it('excludes ai_excluded episodes by default, includes them on request', () => {
    const muted = addEpisode(U, { type: 'important_info', contentRaw: 'muted apple note', source: 'text', aiExcluded: true });
    saveEpisodeEmbedding(U, muted.id, [1, 0, 0]);

    const aiView = searchEpisodesByVector(U, [1, 0, 0], { topK: 10 });
    expect(aiView.find(r => r.id === muted.id)).toBeUndefined();

    const ownerView = searchEpisodesByVector(U, [1, 0, 0], { topK: 10, includeExcluded: true });
    expect(ownerView.find(r => r.id === muted.id)).toBeTruthy();
  });

  it('reports episodes missing an embedding (backfill target)', () => {
    const noVec = addEpisode(U, { type: 'important_info', contentRaw: 'no embedding yet', source: 'text' });
    const missing = getEpisodesMissingEmbedding(U, { limit: 100 });
    expect(missing.find(e => e.id === noVec.id)).toBeTruthy();
  });

  it('drops the embedding when the episode is hard-deleted', () => {
    const tmp = addEpisode(U, { type: 'important_info', contentRaw: 'temp apple', source: 'text' });
    saveEpisodeEmbedding(U, tmp.id, [1, 0, 0]);
    expect(searchEpisodesByVector(U, [1, 0, 0], { topK: 50 }).some(r => r.id === tmp.id)).toBe(true);

    deleteEpisode(U, tmp.id);
    expect(searchEpisodesByVector(U, [1, 0, 0], { topK: 50 }).some(r => r.id === tmp.id)).toBe(false);
  });
});
