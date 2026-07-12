/**
 * Memory Migration
 *
 * Migrates existing memoryItems from the legacy flat store (store.json)
 * into the new four-layer memory file structure.
 *
 * This is a one-time or on-demand migration that:
 *   1. Reads all memoryItems for a user from store.json
 *   2. Writes them as L4 episodic memories (JSONL files)
 *   3. Runs a rule-based consolidation pass to seed L1+L2
 *   4. Does NOT delete the legacy data (safe, idempotent)
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemoryStore } from './store/index.mjs';
const { addEpisode, listEpisodes, getProfile } = getMemoryStore();
import { consolidateRuleBased } from './consolidation.service.mjs';
import { applyOnboardingAnswers, formatAnswerText, normalizeAnswerValue } from './onboarding-profile.mjs';
import { episodeTypeForQuestion } from './core-slots.mjs';
import { dataPath } from '../lib/data-dir.mjs';

const STORE_FILE = dataPath('store.json');

function readLegacyStore() {
  if (!fs.existsSync(STORE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Migrate a single user's memoryItems to the new episodic layer.
 *
 * @param {string} userId
 * @returns {{ migrated: number, skipped: number, totalLegacy: number, consolidated: boolean }}
 */
export function migrateMemoryItems(userId) {
  const store = readLegacyStore();
  if (!store || !store.memoryItems) {
    return { migrated: 0, skipped: 0, totalLegacy: 0, consolidated: false };
  }

  const userItems = store.memoryItems.filter(m => m.user_id === userId);
  if (userItems.length === 0) {
    return { migrated: 0, skipped: 0, totalLegacy: 0, consolidated: false };
  }

  // Check which items are already migrated (by content dedup)
  const existingEpisodes = listEpisodes(userId, { limit: 10000 });
  const existingContentSet = new Set(
    existingEpisodes.map(ep => `${ep.type}:${ep.content_raw?.slice(0, 100)}`)
  );

  let migrated = 0;
  let skipped = 0;

  // Onboarding answers grouped by day so they can be backfilled into the
  // PCP profile after migration (same mapping as the live route).
  const onboardingAnswersByDay = {};

  for (const item of userItems) {
    const isOnboarding = (item.tags || []).includes('onboarding');
    const questionId = item.content_struct?.question_id || null;
    const onboardingDay = item.content_struct?.onboarding_day
      || Number(((item.tags || []).find(t => /^day\d+$/.test(t)) || '').replace('day', ''))
      || null;

    if (isOnboarding && questionId && onboardingDay) {
      if (!onboardingAnswersByDay[onboardingDay]) onboardingAnswersByDay[onboardingDay] = {};
      onboardingAnswersByDay[onboardingDay][questionId] = normalizeAnswerValue(item.content_raw);
    }

    // Onboarding legacy rows may contain raw JSON — re-type + re-format them
    // the same way the live onboarding route does.
    const type = isOnboarding && questionId
      ? episodeTypeForQuestion(questionId)
      : (item.type || 'important_info');
    const contentRaw = isOnboarding && questionId
      ? formatAnswerText(questionId, item.content_raw)
      : (item.content_raw || '');
    if (!contentRaw.trim()) { skipped++; continue; }

    // Dedup against existing episodes by both the original and re-formatted shape.
    const keys = [
      `${item.type}:${item.content_raw?.slice(0, 100)}`,
      `${type}:${contentRaw.slice(0, 100)}`,
    ];
    if (keys.some(k => existingContentSet.has(k))) {
      skipped++;
      continue;
    }

    try {
      addEpisode(userId, {
        type,
        contentRaw,
        tags: item.tags || [],
        source: item.source || 'text',
        contentStruct: item.content_struct || {},
        reminderDate: null,
        confidence: 1.0,
        impactScore: isOnboarding ? 0.9 : undefined,
      });
      for (const k of keys) existingContentSet.add(k);
      migrated++;
    } catch (e) {
      console.error(`[Migration] Failed to migrate item ${item.id}:`, e);
      skipped++;
    }
  }

  // Backfill onboarding answers into profile.json / working.json (idempotent —
  // array fields are dedup-appended, scalars are restated identity facts).
  let onboardingBackfilled = 0;
  for (const [day, answers] of Object.entries(onboardingAnswersByDay)) {
    try {
      const r = applyOnboardingAnswers(userId, Number(day), answers);
      if (r.profileUpdated || r.workingUpdated) onboardingBackfilled++;
    } catch (e) {
      console.error(`[Migration] Onboarding backfill failed for day ${day}:`, e);
    }
  }

  // Run rule-based consolidation to seed profile from migrated data
  let consolidated = false;
  if (migrated > 0) {
    try {
      consolidateRuleBased(userId);
      consolidated = true;
    } catch (e) {
      console.error('[Migration] Consolidation after migration failed:', e);
    }
  }

  return {
    migrated,
    skipped,
    totalLegacy: userItems.length,
    consolidated,
    onboarding_backfilled_days: onboardingBackfilled,
  };
}

/**
 * Migrate all users' memoryItems.
 * Useful as a one-time script.
 */
export function migrateAllUsers() {
  const store = readLegacyStore();
  if (!store || !store.memoryItems || !store.users) {
    return { users: 0, totalMigrated: 0, totalSkipped: 0 };
  }

  const results = [];
  for (const user of store.users) {
    const result = migrateMemoryItems(user.id);
    results.push({ userId: user.id, email: user.email, ...result });
  }

  return {
    users: results.length,
    totalMigrated: results.reduce((sum, r) => sum + r.migrated, 0),
    totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
    details: results,
  };
}

export default { migrateMemoryItems, migrateAllUsers };
