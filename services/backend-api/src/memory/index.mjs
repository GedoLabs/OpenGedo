/**
 * PCP Memory System Module Index
 *
 * Five-layer cognitive memory architecture:
 *   L0 In-Context Flash  – ephemeral conversation window
 *   L1 Core Identity     – stable personality, values, cognition, expertise
 *   L2 Working Memory    – active goals, context, recent decisions
 *   L3 Semantic Long-Term – compressed knowledge, milestones, learnings
 *   L4 Vector Index      – external DB (pgvector)
 */

export * from './types.mjs';
export * from './memory-file.service.mjs';
export * from './context-builder.mjs';
export { classifyIntent, getRetrievalConfig } from './intent-classifier.mjs';
export { computeTSS, rankByTSS, coneSearch } from './tss.mjs';
export { consolidate, consolidateRuleBased, consolidateSessionEnd, consolidateNightly, consolidateWeekly, consolidateQuarterly } from './consolidation.service.mjs';
export { detectConflicts, resolveAllConflicts, getPendingConflicts } from './conflict-resolver.mjs';
export { migrateMemoryItems, migrateAllUsers } from './migration.mjs';
