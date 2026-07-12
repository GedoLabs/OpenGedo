'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Search, X } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import type { VisitorSession } from '@/lib/apiClient';
import { Dot, Pill } from '@/app/components/gedo/primitives';
import { SectionTitle, Segmented } from './shared';

const VIA_KEYS = ['invite', 'passcode', 'anonymous'];
const PAGE_SIZE = 10;
type TimeRange = 'all' | '7d' | '30d' | '90d';

function rangeSince(range: TimeRange): string | undefined {
  if (range === 'all') return undefined;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function SessionsView() {
  const { api } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const [sessions, setSessions] = useState<VisitorSession[]>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQuery(searchInput), 220);
    return () => clearTimeout(id);
  }, [searchInput]);

  const fetchPage = useCallback(async (offset: number, q: string, range: TimeRange, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await api.listPersonaSessions({
        q: q.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
        minMessages: 1,
        since: rangeSince(range),
      });
      setTotal(res.total);
      setSessions(prev => (append ? [...prev, ...(res.items || [])] : res.items || []));
      if (!append) setOpenId(null);
    } catch (e) {
      console.error('load sessions failed', e);
      if (!append) {
        setSessions([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [api]);

  useEffect(() => {
    fetchPage(0, query, timeRange, false);
  }, [fetchPage, query, timeRange]);

  const hasMore = sessions.length < total;
  const remaining = total - sessions.length;
  const hasFilters = query.trim().length > 0 || timeRange !== 'all';

  return (
    <section>
      <SectionTitle title={t('avatar.sessions.title')} mono="SESSIONS" desc={t('avatar.sessions.desc')} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 11px',
              borderRadius: 10,
              border: '1px solid var(--g-border)',
              background: 'var(--g-surface-1)',
            }}
          >
            <Search size={15} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} />
            <input
              type="search"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('avatar.sessions.searchPlaceholder')}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: fontVars.sm,
                color: 'var(--g-text)',
                fontFamily: 'var(--g-font-sans)',
              }}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label={t('avatar.sessions.clearSearch')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--g-text-faint)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {!loading && total > 0 && (
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', whiteSpace: 'nowrap' }}>
              {t('avatar.sessions.resultCount', { n: total })}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {t('avatar.sessions.timeFilter')}
          </span>
          <Segmented
            value={timeRange}
            onChange={setTimeRange}
            options={([
              { value: 'all', label: t('avatar.sessions.timeAll') },
              { value: '7d', label: t('avatar.sessions.time7d') },
              { value: '30d', label: t('avatar.sessions.time30d') },
              { value: '90d', label: t('avatar.sessions.time90d') },
            ] as { value: TimeRange; label: string }[])}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm, border: '1px dashed var(--g-border)', borderRadius: 12 }}>
          {t('avatar.activity.loading')}
        </div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm, border: '1px dashed var(--g-border)', borderRadius: 12 }}>
          {hasFilters ? t('avatar.sessions.noResults') : t('avatar.sessions.empty')}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.map(s => {
              const open = openId === s.id;
              const name = s.visitor?.declared_name || (s.visitor?.matched ? t('avatar.sessions.matchedVisitor') : t('avatar.sessions.anonymousVisitor'));
              const turns = s.transcript || [];
              const via = s.visitor?.via;
              const viaLabel = via && VIA_KEYS.includes(via) ? t(`avatar.sessions.via.${via}` as Parameters<typeof t>[0]) : via;
              return (
                <article key={s.id} style={{ background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', borderRadius: 12, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : s.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <Dot color={s.visitor?.matched ? 'var(--g-dim-persona)' : 'var(--g-text-faint)'} size={8} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 500 }}>{name}</div>
                      <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', marginTop: 2 }}>
                        {viaLabel} · {t('avatar.sessions.msgCount', { n: turns.length })} · {relTime(s.last_active_at, t, locale)}
                      </div>
                    </div>
                    {s.finalized && <Pill tone="neutral" mono>{t('avatar.sessions.archived')}</Pill>}
                    <ChevronDown size={16} style={{ color: 'var(--g-text-faint)', transition: 'transform 0.15s ease', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
                  </button>
                  {open && (
                    <div style={{ borderTop: '1px solid var(--g-border)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 340, overflow: 'auto' }}>
                      {turns.length === 0 ? (
                        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('avatar.sessions.emptyTurns')}</span>
                      ) : (
                        turns.map((turn, i) => <Bubble key={i} role={turn.role} content={turn.content} />)
                      )}
                      {s.summary && (
                        <div style={{ marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--g-border)', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
                          {t('avatar.sessions.summaryPrefix')}{s.summary}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => fetchPage(sessions.length, query, timeRange, true)}
              disabled={loadingMore}
              style={{
                width: '100%',
                marginTop: 10,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px dashed var(--g-border)',
                background: 'transparent',
                color: 'var(--g-text-muted)',
                fontSize: fontVars.sm,
                cursor: loadingMore ? 'wait' : 'pointer',
                opacity: loadingMore ? 0.6 : 1,
              }}
            >
              {loadingMore
                ? t('avatar.activity.loading')
                : t('avatar.sessions.loadMore', { n: Math.min(remaining, PAGE_SIZE) })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Bubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '82%',
          padding: '7px 11px',
          borderRadius: 10,
          fontSize: fontVars.sm,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: isUser ? 'color-mix(in oklch, var(--g-dim-persona) 16%, var(--g-surface-1))' : 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          color: 'var(--g-text)',
        }}
      >
        {content}
      </div>
    </div>
  );
}

function relTime(iso: string, t: (key: string, values?: Record<string, string | number>) => string, locale: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const day = 86400000;
    if (diff < day) return t('avatar.sessions.timeToday', { time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` });
    if (diff < 2 * day) return t('avatar.sessions.timeYesterday');
    if (diff < 7 * day) return t('avatar.sessions.timeDaysAgo', { n: Math.floor(diff / day) });
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}
