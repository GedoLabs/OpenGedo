/**
 * Privacy / data-control tests (internal-beta scope).
 *
 * Covers the Tier 1 + Tier 2 guarantees:
 *   - The chat system prompt no longer leaks the user's email to the LLM.
 *   - Per-memory `ai_excluded` keeps muted episodes out of AI retrieval while
 *     still visible to their owner; toggling + hard-delete work.
 *   - The "pause long-term memory" switch zeroes out injected memory context.
 *   - Account wipe purges every user-scoped store collection + the on-disk dir.
 *
 * Run: npx vitest run test/privacy.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';

import { buildSystemPrompt } from '../src/services/conversation.service.mjs';
import { buildMemoryContext, isMemoryPaused } from '../src/memory/context-builder.mjs';
import {
  addEpisode, listEpisodes, searchEpisodes,
  setEpisodeFlag, deleteEpisode, wipeUserMemory,
} from '../src/memory/memory-file.service.mjs';
import { Store } from '../src/lib/store.mjs';
import { dataPath } from '../src/lib/data-dir.mjs';

const store = Store();
const U = `privacy-test-${Date.now()}`;

afterAll(() => {
  store.wipeUser(U);
  wipeUserMemory(U);
});

describe('Tier 1a — no PII to the LLM', () => {
  it('buildSystemPrompt does not contain the user email', () => {
    const prompt = buildSystemPrompt({ email: 'secret-user@example.com' }, {
      goals: [], todayTasks: [],
    });
    expect(prompt).not.toContain('secret-user@example.com');
    expect(prompt).not.toContain('@example.com');
    expect(prompt).not.toMatch(/用户邮箱/);
  });
});

describe('Tier 2a — per-memory ai_excluded', () => {
  it('excludes flagged episodes from AI retrieval but keeps them owner-visible', () => {
    const open = addEpisode(U, { type: 'important_info', contentRaw: 'OPEN_MEMORY_ alpha', source: 'text' });
    const muted = addEpisode(U, { type: 'important_info', contentRaw: 'MUTED_MEMORY_ beta', source: 'text', aiExcluded: true });

    expect(open.ai_excluded).toBe(false);
    expect(muted.ai_excluded).toBe(true);

    // AI-facing default view filters out the muted row.
    const aiVisible = searchEpisodes(U, '');
    expect(aiVisible.find(e => e.id === open.id)).toBeTruthy();
    expect(aiVisible.find(e => e.id === muted.id)).toBeFalsy();

    // Owner view sees everything.
    const ownerVisible = listEpisodes(U, { includeExcluded: true });
    expect(ownerVisible.find(e => e.id === muted.id)).toBeTruthy();

    // Toggling the open one off removes it from AI view too.
    const patched = setEpisodeFlag(U, open.id, { ai_excluded: true });
    expect(patched.ai_excluded).toBe(true);
    expect(searchEpisodes(U, '').find(e => e.id === open.id)).toBeFalsy();

    // Hard-delete removes it entirely.
    expect(deleteEpisode(U, open.id)).toBe(true);
    expect(listEpisodes(U, { includeExcluded: true }).find(e => e.id === open.id)).toBeFalsy();
  });
});

describe('Tier 2b — pause long-term memory', () => {
  it('returns empty memory context and reports paused when toggled on', () => {
    addEpisode(U, { type: 'important_info', contentRaw: 'PAUSE_PROBE_ gamma', source: 'text' });

    store.updateSettings(U, { privacy_settings: { pause_memory: true } });
    expect(isMemoryPaused(U)).toBe(true);

    const ctx = buildMemoryContext(U, { query: 'PAUSE_PROBE_ gamma' });
    expect(ctx.contextText).toBe('');
    expect(ctx.intent.paused).toBe(true);

    // Turning it back off restores normal behavior (non-empty intent object).
    store.updateSettings(U, { privacy_settings: { pause_memory: false } });
    expect(isMemoryPaused(U)).toBe(false);
  });
});

describe('Tier 1b — account wipe', () => {
  it('purges store collections and the on-disk memory dir', () => {
    const user = store.createUser({ email: `${U}@example.com`, password_hash: 'x' });
    store.createMemoryItem(user.id, { type: 'important_info', content_raw: 'wipe me' });
    store.createGoal(user.id, { title: 'doomed goal' });
    addEpisode(user.id, { type: 'important_info', contentRaw: 'on disk', source: 'text' });

    // Later-added collections that wipeUser must cover too.
    const briefDate = new Date().toISOString().slice(0, 10);
    store.setCompanionBrief(user.id, briefDate, 'zh', 'doomed greeting');
    store.createMcpServer(user.id, { name: 'doomed mcp', slug: 'doomed_mcp', url: 'https://example.com/mcp' });
    const job = store.createImportJob(user.id, { source: 'chatgpt', convs_total: 1 });
    const pack = store.addSimPack({ email: `${U}@example.com`, locale: 'zh', pack: { probe: 'doomed' } });
    store.markSimPackClaimed(pack.id, user.id);
    // Unclaimed packs belong to the email owner, not the account — must survive.
    const unclaimed = store.addSimPack({ email: `${U}@example.com`, locale: 'zh', pack: { probe: 'keep' } });

    const dir = dataPath('memories', user.id);
    expect(fs.existsSync(dir)).toBe(true);

    const removed = store.wipeUser(user.id);
    wipeUserMemory(user.id);

    expect(removed.memoryItems).toBeGreaterThanOrEqual(1);
    expect(removed.goals).toBeGreaterThanOrEqual(1);
    expect(removed.users).toBe(1);
    expect(removed.companionBriefs).toBeGreaterThanOrEqual(1);
    expect(removed.mcpServers).toBeGreaterThanOrEqual(1);
    expect(removed.importJobs).toBeGreaterThanOrEqual(1);
    expect(removed.simPacks).toBeGreaterThanOrEqual(1);
    expect(store.getUserById(user.id)).toBeNull();
    expect(store.listGoals(user.id)).toHaveLength(0);
    expect(store.getCompanionBrief(user.id, briefDate, 'zh')).toBeNull();
    expect(store.listMcpServers(user.id)).toHaveLength(0);
    expect(store.getImportJob(user.id, job.id)).toBeNull();
    expect(store.getSimPack(pack.id)).toBeNull();
    expect(store.getSimPack(unclaimed.id)).toBeTruthy();
    expect(fs.existsSync(dir)).toBe(false);
  });
});
