/**
 * MemoryStore — Port / Interface (P0.5)
 *
 * The single seam through which ALL business code accesses long-term memory.
 * Business code (server endpoints, conversation/extract services, engines,
 * agent cron) MUST depend only on this interface and obtain an instance via
 * `getMemoryStore()` from ./index.mjs — it must NEVER read or write
 * profile.json / working.json / episodes/*.jsonl directly.
 *
 * Why: today the live store is per-user JSON files (FileMemoryStore wraps
 * memory-file.service.mjs). Tomorrow we want to swap in Postgres + pgvector
 * (PgMemoryStore) with zero business-code churn. Keeping every read/write,
 * recall, consolidation and identity update behind this contract makes that
 * migration a one-line factory change.
 *
 * This base class documents the contract and throws for any method an adapter
 * forgets to implement. Adapters: FileMemoryStore (now), PgMemoryStore (later).
 *
 * Shapes (Profile, WorkingMemory, Episode, …) are defined in ../types.mjs;
 * methods here delegate to behaviour identical to the corresponding
 * memory-file.service.mjs functions so the file→pg swap is observable-free.
 *
 * NOTE: the surface below is the *current* (P0.5) surface — exactly the
 * functions that exist today. Later phases extend the interface additively:
 *   P1 Recall  → searchEpisodesByVector(), appendRawEvent()/listRawEvents()
 *   P2 State   → getStateSnapshot()/saveStateSnapshot()
 *   P3 Identity→ getIdentityVersions()/appendIdentityVersion()
 *   P4 Narrative→ getNarrative()/saveNarrative()
 * Each new method is added here (documented) and to every adapter together.
 */

function notImplemented(method) {
  throw new Error(`[MemoryStore] ${method}() not implemented by this adapter`);
}

export class MemoryStore {
  constructor() {
    // Auto-bind every method to the instance so consumers may safely destructure
    // (`const { getProfile } = getMemoryStore()`) without losing `this`. This keeps
    // the migration low-churn (consumers change only their import line) and stays
    // correct for future adapters whose methods DO use `this` (e.g. PgMemoryStore.db).
    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        // Walk child→parent; the most-derived definition wins. Skip names already
        // bound from a subclass so base-class stubs never clobber real overrides.
        if (Object.prototype.hasOwnProperty.call(this, name)) continue;
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        if (desc && typeof desc.value === 'function') this[name] = desc.value.bind(this);
      }
      proto = Object.getPrototypeOf(proto);
    }
  }

  /** Adapter identifier, e.g. 'file' | 'postgres'. Used for logging/diagnostics. */
  get kind() { return 'abstract'; }

  // ── Profile (L1 Core Identity + L3 Semantic Long-Term) ────────────
  /** @param {string} userId @returns {object} profile (auto-created/migrated if absent) */
  getProfile(userId) { return notImplemented('getProfile'); }
  /** Deep-merge a partial patch into the profile. @param {string} userId @param {object} patch */
  updateProfile(userId, patch) { return notImplemented('updateProfile'); }
  /** Replace the whole profile (validated). @param {string} userId @param {object} newProfile */
  replaceProfile(userId, newProfile) { return notImplemented('replaceProfile'); }

  // ── Working Memory (L2) ───────────────────────────────────────────
  /** @param {string} userId @returns {object} working memory (TTL-pruned on read) */
  getWorkingMemory(userId) { return notImplemented('getWorkingMemory'); }
  /** Apply a working-memory patch (goals/context/decisions/…). @param {string} userId @param {object} patch */
  updateWorkingMemory(userId, patch) { return notImplemented('updateWorkingMemory'); }

  // ── Episodic Memory (L4 raw episodes) ─────────────────────────────
  /** Append an episode. @param {string} userId @param {object} data {type,contentRaw,tags,source,contentStruct,reminderDate,confidence,impactScore,aiExcluded} @returns {object} episode */
  addEpisode(userId, data) { return notImplemented('addEpisode'); }
  /** List episodes (newest first). @param {string} userId @param {object} [opts] {type,since,limit,includeExcluded} */
  listEpisodes(userId, opts) { return notImplemented('listEpisodes'); }
  /** Keyword/substring search over episodes. @param {string} userId @param {string} query @param {object} [opts] {limit,includeExcluded} */
  searchEpisodes(userId, query, opts) { return notImplemented('searchEpisodes'); }
  /** Episodes not yet folded into semantic memory. @param {string} userId @param {object} [opts] {limit} */
  getUnconsolidatedEpisodes(userId, opts) { return notImplemented('getUnconsolidatedEpisodes'); }
  /** Mark episodes consolidated. @param {string} userId @param {string[]} episodeIds */
  markEpisodesConsolidated(userId, episodeIds) { return notImplemented('markEpisodesConsolidated'); }
  /** Bump usage_count (TSS access_freq). @param {string} userId @param {string} episodeId */
  incrementEpisodeUsage(userId, episodeId) { return notImplemented('incrementEpisodeUsage'); }
  /** Patch episode flags (e.g. ai_excluded). @param {string} userId @param {string} episodeId @param {object} patch */
  setEpisodeFlag(userId, episodeId, patch) { return notImplemented('setEpisodeFlag'); }
  /** Hard-delete an episode. @param {string} userId @param {string} episodeId @returns {boolean} */
  deleteEpisode(userId, episodeId) { return notImplemented('deleteEpisode'); }

  // ── Episode embeddings (L4 vector index) [P1] ─────────────────────
  /** Persist an episode's embedding vector. @param {string} userId @param {string} episodeId @param {number[]} vector @param {object} [meta] {model} */
  saveEpisodeEmbedding(userId, episodeId, vector, meta) { return notImplemented('saveEpisodeEmbedding'); }
  /** Drop an episode's embedding. @param {string} userId @param {string} episodeId */
  removeEpisodeEmbedding(userId, episodeId) { return notImplemented('removeEpisodeEmbedding'); }
  /** Cosine-rank episodes vs a query vector. @param {string} userId @param {number[]} queryVector @param {object} [opts] {topK,includeExcluded} @returns {Array<object&{vector_score:number}>} */
  searchEpisodesByVector(userId, queryVector, opts) { return notImplemented('searchEpisodesByVector'); }
  /** Episodes lacking an embedding (for backfill). @param {string} userId @param {object} [opts] {limit} */
  getEpisodesMissingEmbedding(userId, opts) { return notImplemented('getEpisodesMissingEmbedding'); }

  // ── Lifecycle ─────────────────────────────────────────────────────
  /** Hard-delete a user's entire memory footprint. @param {string} userId @returns {boolean} */
  wipeUserMemory(userId) { return notImplemented('wipeUserMemory'); }

  // ── Conflict log ──────────────────────────────────────────────────
  /** @param {string} userId @returns {object[]} */
  getConflicts(userId) { return notImplemented('getConflicts'); }
  /** @param {string} userId @param {object} conflict {field,old_value,new_value,old_evidence,new_evidence} */
  addConflict(userId, conflict) { return notImplemented('addConflict'); }
  /** @param {string} userId @param {string} conflictId @param {string} resolution */
  resolveConflict(userId, conflictId, resolution) { return notImplemented('resolveConflict'); }
  /** Write a chosen value into the profile by dot-path. @param {string} userId @param {string} field @param {*} value */
  applyConflictResolution(userId, field, value) { return notImplemented('applyConflictResolution'); }

  // ── Consolidation log ─────────────────────────────────────────────
  /** @param {string} userId @param {object} entry */
  appendConsolidationLog(userId, entry) { return notImplemented('appendConsolidationLog'); }
  /** @param {string} userId @param {object} [opts] {limit} */
  getConsolidationLogs(userId, opts) { return notImplemented('getConsolidationLogs'); }

  // ── Identity versions (L4 dynamic identity model) [P3] ────────────
  /** Append a computed identity snapshot (append-only history). @param {string} userId @param {object} version */
  appendIdentityVersion(userId, version) { return notImplemented('appendIdentityVersion'); }
  /** List identity versions, newest first. @param {string} userId @param {object} [opts] {limit} */
  getIdentityVersions(userId, opts) { return notImplemented('getIdentityVersions'); }
  /** Latest identity version, or null. @param {string} userId */
  getLatestIdentity(userId) { return notImplemented('getLatestIdentity'); }

  // ── Narrative reports (L5 trajectory) [P4] ────────────────────────
  /** Persist the latest narrative for a window. @param {string} userId @param {number} windowDays @param {object} report */
  saveNarrative(userId, windowDays, report) { return notImplemented('saveNarrative'); }
  /** Read the stored narrative for a window, or null. @param {string} userId @param {number} windowDays */
  getNarrative(userId, windowDays) { return notImplemented('getNarrative'); }

  // ── Dimension assessment (生命之花八维 AI 评估 — latest 覆写) ───────
  /** Persist (overwrite) the latest dimension assessment. @param {string} userId @param {object} assessment */
  saveDimensionAssessment(userId, assessment) { return notImplemented('saveDimensionAssessment'); }
  /** Read the stored dimension assessment, or null. @param {string} userId */
  getDimensionAssessment(userId) { return notImplemented('getDimensionAssessment'); }

  // ── Assessment (self-insight report / 自我认知报告) ────────────────
  /** Append a finalized self-insight version (append-only history). @param {string} userId @param {object} version */
  appendAssessmentVersion(userId, version) { return notImplemented('appendAssessmentVersion'); }
  /** List assessment versions, newest first. @param {string} userId @param {object} [opts] {limit} */
  getAssessmentVersions(userId, opts) { return notImplemented('getAssessmentVersions'); }
  /** Latest finalized assessment, or null. @param {string} userId */
  getLatestAssessment(userId) { return notImplemented('getLatestAssessment'); }
  /** Pending clarify-draft, or null. @param {string} userId */
  getAssessmentDraft(userId) { return notImplemented('getAssessmentDraft'); }
  /** Persist (overwrite) the pending clarify-draft. @param {string} userId @param {object} draft */
  saveAssessmentDraft(userId, draft) { return notImplemented('saveAssessmentDraft'); }
  /** Remove the pending clarify-draft. @param {string} userId */
  clearAssessmentDraft(userId) { return notImplemented('clearAssessmentDraft'); }

  // ── Stats ─────────────────────────────────────────────────────────
  /** Aggregate memory stats (counts, profile completeness, …). @param {string} userId */
  getMemoryStats(userId) { return notImplemented('getMemoryStats'); }
}

export default MemoryStore;
