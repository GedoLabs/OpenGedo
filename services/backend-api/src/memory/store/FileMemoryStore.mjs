/**
 * FileMemoryStore — File-system adapter for MemoryStore (P0.5)
 *
 * Wraps the per-user JSON-file implementation in ../memory-file.service.mjs:
 *   data/memories/{uid}/profile.json   (L1 + L3)
 *   data/memories/{uid}/working.json   (L2)
 *   data/memories/{uid}/episodes/*.jsonl (L4)
 *   conflicts.json / consolidation.log
 *
 * This adapter is the ONLY place (besides memory-file.service.mjs itself, the
 * gmp import/export pack tooling, and the file-layer unit tests) that is
 * allowed to touch those files. Every method delegates 1:1 to the service so
 * behaviour is identical to pre-P0.5 — this is a pure indirection seam.
 *
 * When PgMemoryStore lands, it implements the same MemoryStore contract against
 * Postgres + pgvector and the factory in ./index.mjs swaps it in; no business
 * code changes.
 */

import { MemoryStore } from './MemoryStore.mjs';
import * as svc from '../memory-file.service.mjs';

export class FileMemoryStore extends MemoryStore {
  get kind() { return 'file'; }

  // ── Profile ───────────────────────────────────────────────────────
  getProfile(userId) { return svc.getProfile(userId); }
  updateProfile(userId, patch) { return svc.updateProfile(userId, patch); }
  replaceProfile(userId, newProfile) { return svc.replaceProfile(userId, newProfile); }

  // ── Working Memory ────────────────────────────────────────────────
  getWorkingMemory(userId) { return svc.getWorkingMemory(userId); }
  updateWorkingMemory(userId, patch) { return svc.updateWorkingMemory(userId, patch); }

  // ── Episodic Memory ───────────────────────────────────────────────
  addEpisode(userId, data) { return svc.addEpisode(userId, data); }
  listEpisodes(userId, opts) { return svc.listEpisodes(userId, opts); }
  searchEpisodes(userId, query, opts) { return svc.searchEpisodes(userId, query, opts); }
  getUnconsolidatedEpisodes(userId, opts) { return svc.getUnconsolidatedEpisodes(userId, opts); }
  markEpisodesConsolidated(userId, episodeIds) { return svc.markEpisodesConsolidated(userId, episodeIds); }
  incrementEpisodeUsage(userId, episodeId) { return svc.incrementEpisodeUsage(userId, episodeId); }
  setEpisodeFlag(userId, episodeId, patch) { return svc.setEpisodeFlag(userId, episodeId, patch); }
  replaceEntityIdInEpisodes(userId, fromId, toId) { return svc.replaceEntityIdInEpisodes(userId, fromId, toId); }
  deleteEpisode(userId, episodeId) { return svc.deleteEpisode(userId, episodeId); }

  // ── Episode embeddings (L4 vector index) [P1] ─────────────────────
  saveEpisodeEmbedding(userId, episodeId, vector, meta) { return svc.saveEpisodeEmbedding(userId, episodeId, vector, meta); }
  removeEpisodeEmbedding(userId, episodeId) { return svc.removeEpisodeEmbedding(userId, episodeId); }
  searchEpisodesByVector(userId, queryVector, opts) { return svc.searchEpisodesByVector(userId, queryVector, opts); }
  getEpisodesMissingEmbedding(userId, opts) { return svc.getEpisodesMissingEmbedding(userId, opts); }

  // ── Lifecycle ─────────────────────────────────────────────────────
  wipeUserMemory(userId) { return svc.wipeUserMemory(userId); }

  // ── Conflict log ──────────────────────────────────────────────────
  getConflicts(userId) { return svc.getConflicts(userId); }
  addConflict(userId, conflict) { return svc.addConflict(userId, conflict); }
  resolveConflict(userId, conflictId, resolution) { return svc.resolveConflict(userId, conflictId, resolution); }
  applyConflictResolution(userId, field, value) { return svc.applyConflictResolution(userId, field, value); }

  // ── Consolidation log ─────────────────────────────────────────────
  appendConsolidationLog(userId, entry) { return svc.appendConsolidationLog(userId, entry); }
  getConsolidationLogs(userId, opts) { return svc.getConsolidationLogs(userId, opts); }

  // ── Identity versions (L4 dynamic identity model) [P3] ────────────
  appendIdentityVersion(userId, version) { return svc.appendIdentityVersion(userId, version); }
  getIdentityVersions(userId, opts) { return svc.getIdentityVersions(userId, opts); }
  getLatestIdentity(userId) { return svc.getLatestIdentity(userId); }

  // ── Narrative reports (L5 trajectory) [P4] ────────────────────────
  saveNarrative(userId, windowDays, report) { return svc.saveNarrative(userId, windowDays, report); }
  getNarrative(userId, windowDays) { return svc.getNarrative(userId, windowDays); }

  // ── Dimension assessment (生命之花八维 AI 评估 — latest 覆写) ───────
  saveDimensionAssessment(userId, assessment) { return svc.saveDimensionAssessment(userId, assessment); }
  getDimensionAssessment(userId) { return svc.getDimensionAssessment(userId); }

  // ── Assessment (self-insight report / 自我认知报告) ────────────────
  appendAssessmentVersion(userId, version) { return svc.appendAssessmentVersion(userId, version); }
  getAssessmentVersions(userId, opts) { return svc.getAssessmentVersions(userId, opts); }
  getLatestAssessment(userId) { return svc.getLatestAssessment(userId); }
  getAssessmentDraft(userId) { return svc.getAssessmentDraft(userId); }
  saveAssessmentDraft(userId, draft) { return svc.saveAssessmentDraft(userId, draft); }
  clearAssessmentDraft(userId) { return svc.clearAssessmentDraft(userId); }

  // ── Stats ─────────────────────────────────────────────────────────
  getMemoryStats(userId) { return svc.getMemoryStats(userId); }
}

export default FileMemoryStore;
