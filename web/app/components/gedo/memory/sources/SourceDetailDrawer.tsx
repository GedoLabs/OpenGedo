'use client';

// 来源详情抽屉：提交后随时回看原文与解析过程。
//   概览 = 管线时间线（收集→抓取→解析分块→提取→确认，每步带产出数字）+ 元信息 + 原始附件下载
//   原文 = 转化产物 text.txt（分页加载）
//   分块 = chunks.jsonl 逐块内容 + 嵌入状态（RAG 原始层可见化）
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { MemorySource } from '@/lib/apiClient';
import { Drawer } from '@/app/components/gedo/Drawer';
import { fontVars } from '@/app/components/gedo/typography';
import { ghostBtnStyle, chipBtnStyle } from '@/app/components/gedo/primitives';
import { IconCheck } from '@/app/components/gedo/icons';

type Tab = 'overview' | 'text' | 'chunks';
type ChunkItem = { i: number; text: string; meta: { heading?: string; conv_title?: string; part?: number }; has_embedding: boolean };

const TEXT_PAGE = 20_000;
const CHUNK_PAGE = 30;

/** 状态 → 时间线各步的进展（-1=未到 0=进行中 1=完成 2=失败 3=取消）。 */
function stepStates(source: MemorySource): number[] {
  const isUrl = source.type === 'url';
  const steps = isUrl ? ['fetch', 'parse', 'extract', 'review'] : ['parse', 'extract', 'review'];
  const failedAt = (code?: string) => {
    if (!code) return steps.indexOf('extract');
    if (/SSRF|FETCH|BAD_URL|UNSUPPORTED|DNS/.test(code)) return Math.max(0, steps.indexOf('fetch'));
    if (/PARSE|ZIP|NO_TEXT|NO_CONTENT|NO_DATA|EMPTY|PARSER/.test(code)) return steps.indexOf('parse');
    return steps.indexOf('extract');
  };
  const activeIdx = source.status === 'queued' ? 0
    : source.status === 'fetching' ? steps.indexOf('fetch')
      : source.status === 'parsing' ? steps.indexOf('parse')
        : source.status === 'extracting' ? steps.indexOf('extract')
          : source.status === 'review' ? steps.indexOf('review')
            : steps.length; // done
  return steps.map((_, i) => {
    if (source.status === 'failed') {
      const f = failedAt(source.error?.code);
      return i < f ? 1 : i === f ? 2 : -1;
    }
    if (source.status === 'canceled') return i < activeIdx ? 1 : i === activeIdx ? 3 : -1;
    if (source.status === 'done') return 1;
    if (source.status === 'review') return i < activeIdx ? 1 : i === activeIdx ? 0 : -1;
    return i < activeIdx ? 1 : i === activeIdx ? 0 : -1;
  });
}

export function SourceDetailDrawer({
  source,
  pendingCount,
  onClose,
  onGoReview,
}: {
  source: MemorySource | null;
  pendingCount: number;
  onClose: () => void;
  onGoReview: (sourceId: string) => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const [tab, setTab] = useState<Tab>('overview');
  const [text, setText] = useState<{ content: string; total: number } | null>(null);
  const [chunks, setChunks] = useState<{ items: ChunkItem[]; total: number } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const open = !!source;
  const sourceId = source?.id || null;

  useEffect(() => {
    if (open) { setTab('overview'); setText(null); setChunks(null); setExpanded({}); }
  }, [open, sourceId]);

  // 原文/分块懒加载（切到对应页签才拉）
  useEffect(() => {
    if (!sourceId || loading) return;
    if (tab === 'text' && !text) {
      setLoading(true);
      api.getSourceContent(sourceId, { textLimit: TEXT_PAGE, chunksLimit: 0 })
        .then((r) => setText({ content: r.text.content, total: r.text.total }))
        .catch(() => setText({ content: '', total: 0 }))
        .finally(() => setLoading(false));
    }
    if (tab === 'chunks' && !chunks) {
      setLoading(true);
      api.getSourceContent(sourceId, { textLimit: 0, chunksLimit: CHUNK_PAGE })
        .then((r) => setChunks({ items: r.chunks.items, total: r.chunks.total }))
        .catch(() => setChunks({ items: [], total: 0 }))
        .finally(() => setLoading(false));
    }
  }, [tab, sourceId, text, chunks, loading, api]);

  const loadMoreText = useCallback(() => {
    if (!sourceId || !text || loading) return;
    setLoading(true);
    api.getSourceContent(sourceId, { textOffset: text.content.length, textLimit: TEXT_PAGE, chunksLimit: 0 })
      .then((r) => setText({ content: text.content + r.text.content, total: r.text.total }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, sourceId, text, loading]);

  const loadMoreChunks = useCallback(() => {
    if (!sourceId || !chunks || loading) return;
    setLoading(true);
    api.getSourceContent(sourceId, { textLimit: 0, chunksOffset: chunks.items.length, chunksLimit: CHUNK_PAGE })
      .then((r) => setChunks({ items: [...chunks.items, ...r.chunks.items], total: r.chunks.total }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, sourceId, chunks, loading]);

  const download = useCallback(() => {
    if (!source || downloading) return;
    setDownloading(true);
    const filename = source.origin?.filename
      || `${(source.title || source.id).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)}${source.type === 'text' ? '.txt' : ''}`;
    api.downloadSourceRaw(source.id, filename).catch(() => {}).finally(() => setDownloading(false));
  }, [api, source, downloading]);

  const steps = useMemo(() => {
    if (!source) return [];
    const states = stepStates(source);
    const isUrl = source.type === 'url';
    const defs: Array<{ key: string; line: string | null; action?: React.ReactNode }> = [];
    if (isUrl) {
      defs.push({
        key: 'fetch',
        line: source.origin?.final_url ? source.origin.final_url : (source.origin?.url || null),
      });
    }
    defs.push({
      key: 'parse',
      line: source.stats.char_count
        ? td('memory.sources.detail.parseLine', { chars: source.stats.char_count, chunks: source.stats.chunk_count })
          + (source.stats.conv_count ? td('memory.sources.detail.convSuffix', { convs: source.stats.conv_count }) : '')
        : null,
    });
    defs.push({
      key: 'extract',
      line: source.progress.chunks_total
        ? td('memory.sources.detail.extractLine', {
          done: source.progress.chunks_done,
          total: source.progress.chunks_total,
          cand: source.progress.candidates_created,
        }) + (source.stats.extract_failures ? td('memory.sources.detail.failSuffix', { n: source.stats.extract_failures }) : '')
        : null,
    });
    defs.push({
      key: 'review',
      line: td('memory.sources.detail.reviewLine', {
        pending: pendingCount,
        accepted: source.stats.accepted,
        rejected: source.stats.rejected,
      }),
      action: pendingCount > 0 ? (
        <button type="button" style={chipBtnStyle(true)} onClick={() => { onClose(); onGoReview(source.id); }}>
          {t('memory.sources.card.goReview')} →
        </button>
      ) : undefined,
    });
    return defs.map((d, i) => ({ ...d, state: states[i] ?? -1 }));
  }, [source, pendingCount, td, t, onClose, onGoReview]);

  const infoRows = useMemo(() => {
    if (!source) return [];
    const rows: Array<[string, React.ReactNode]> = [];
    rows.push([t('memory.sources.detail.info.type'), td(`memory.sources.typeNames.${source.type}`)]);
    if (source.platform) rows.push([t('memory.sources.detail.info.platform'), td(`memory.sources.platforms.${source.platform}`)]);
    if (source.origin?.filename) rows.push([t('memory.sources.detail.info.file'), source.origin.filename]);
    if (source.origin?.url) {
      rows.push([t('memory.sources.detail.info.link'), (
        <a href={source.origin.final_url || source.origin.url} target="_blank" rel="noreferrer" style={{ color: 'var(--g-accent)', wordBreak: 'break-all' }}>
          {source.origin.url}
        </a>
      )]);
    }
    if (source.origin?.size_bytes) rows.push([t('memory.sources.detail.info.size'), `${Math.max(1, Math.round(source.origin.size_bytes / 1024))} KB`]);
    rows.push([t('memory.sources.detail.info.created'), new Date(source.created_at).toLocaleString()]);
    rows.push([t('memory.sources.detail.info.updated'), new Date(source.updated_at).toLocaleString()]);
    return rows;
  }, [source, t, td]);

  const stateColor = (s: number) => s === 1 ? 'var(--g-accent)' : s === 0 ? 'var(--g-accent)' : s === 2 ? 'oklch(0.65 0.18 25)' : s === 3 ? 'var(--g-text-faint)' : 'var(--g-border)';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={t('memory.sources.detail.eyebrow')}
      title={source?.title || (source ? td(`memory.sources.typeNames.${source.type}`) : '')}
      width={620}
    >
      {source && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 20px 24px', fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
          {/* 状态行 + 页签 + 下载 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 8, padding: 2 }}>
              {(['overview', 'text', 'chunks'] as const).map((tb) => (
                <button
                  key={tb}
                  type="button"
                  onClick={() => setTab(tb)}
                  style={{
                    padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                    background: tab === tb ? 'var(--g-surface-2)' : 'transparent',
                    color: tab === tb ? 'var(--g-text)' : 'var(--g-text-muted)',
                    fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)',
                  }}
                >
                  {td(`memory.sources.detail.tabs.${tb}`)}
                  {tb === 'chunks' && source.stats.chunk_count ? ` (${source.stats.chunk_count})` : ''}
                </button>
              ))}
            </div>
            {source.type !== 'url' && (
              <button type="button" disabled={downloading} style={{ ...ghostBtnStyle(), opacity: downloading ? 0.5 : 1 }} onClick={download}>
                ↓ {t('memory.sources.detail.download')}
              </button>
            )}
          </div>

          {tab === 'overview' && (
            <>
              {/* 管线时间线（解析过程可视化） */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '4px 2px' }}>
                {steps.map((s, i) => (
                  <div key={s.key} style={{ display: 'flex', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 18, flexShrink: 0 }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        border: `1.5px solid ${stateColor(s.state)}`,
                        background: s.state === 1 ? 'var(--g-accent)' : 'transparent',
                        color: s.state === 1 ? 'var(--g-accent-ink, #06251c)' : stateColor(s.state),
                      }}>
                        {s.state === 1 ? <IconCheck size={10} /> : s.state === 2 ? <span style={{ fontSize: 10, fontWeight: 800 }}>✕</span> : s.state === 0 ? <span className="gedo-src-pulse" style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--g-accent)' }} /> : null}
                      </span>
                      {i < steps.length - 1 && <span style={{ width: 1.5, flex: 1, minHeight: 18, background: s.state === 1 ? 'var(--g-accent-line)' : 'var(--g-border)' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: fontVars.sm, fontWeight: 600, color: s.state === -1 ? 'var(--g-text-faint)' : 'var(--g-text)' }}>
                          {td(`memory.sources.detail.steps.${s.key}`)}
                        </span>
                        {s.action}
                      </div>
                      {s.line && (
                        <div style={{ marginTop: 2, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', wordBreak: 'break-all', lineHeight: 1.5 }}>
                          {s.line}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <style>{'@keyframes gedoSrcBlink { from { opacity: 0.35 } to { opacity: 1 } } .gedo-src-pulse { animation: gedoSrcBlink 0.9s ease-in-out infinite alternate; }'}</style>
              </div>

              {source.status === 'failed' && source.error && (
                <div style={{
                  padding: '10px 12px', borderRadius: 10, fontSize: fontVars.xs, lineHeight: 1.5,
                  border: '1px solid oklch(0.65 0.18 25 / 0.4)', background: 'oklch(0.65 0.18 25 / 0.08)', color: 'var(--g-text)',
                }}>
                  {source.error.code} · {source.error.message}
                </div>
              )}

              {/* 元信息 */}
              <div style={{ borderTop: '1px solid var(--g-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {infoRows.map(([k, v]) => (
                  <div key={String(k)} style={{ display: 'flex', gap: 12, fontSize: fontVars.xs }}>
                    <span style={{ width: 72, flexShrink: 0, color: 'var(--g-text-faint)' }}>{k}</span>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--g-text-mid)', wordBreak: 'break-all' }}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'text' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {text == null ? (
                <p style={{ margin: 0, color: 'var(--g-text-faint)' }}>{t('common.loading')}</p>
              ) : text.total === 0 ? (
                <p style={{ margin: 0, color: 'var(--g-text-faint)' }}>{t('memory.sources.detail.textEmpty')}</p>
              ) : (
                <>
                  <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                    {td('memory.sources.detail.textMeta', { shown: text.content.length, total: text.total })}
                  </div>
                  <pre style={{
                    margin: 0, padding: '12px 14px', borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    border: '1px solid var(--g-border)', background: 'var(--g-surface-1)', color: 'var(--g-text)',
                    fontSize: fontVars.sm, lineHeight: 1.7, fontFamily: 'var(--g-font-sans)', maxHeight: 'none',
                  }}>{text.content}</pre>
                  {text.content.length < text.total && (
                    <button type="button" disabled={loading} style={{ ...ghostBtnStyle(), alignSelf: 'center', opacity: loading ? 0.5 : 1 }} onClick={loadMoreText}>
                      {t('memory.sources.detail.loadMore')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'chunks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chunks == null ? (
                <p style={{ margin: 0, color: 'var(--g-text-faint)' }}>{t('common.loading')}</p>
              ) : chunks.items.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--g-text-faint)' }}>{t('memory.sources.detail.chunksEmpty')}</p>
              ) : (
                <>
                  {chunks.items.map((c) => {
                    const label = c.meta.conv_title || c.meta.heading || null;
                    const isOpen = !!expanded[c.i];
                    return (
                      <div key={c.i} style={{ borderRadius: 10, border: '1px solid var(--g-border)', background: 'var(--g-surface-1)', overflow: 'hidden' }}>
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [c.i]: !prev[c.i] }))}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                            border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          <span style={{ fontSize: fontVars.xs, fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)', flexShrink: 0 }}>#{c.i + 1}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: fontVars.xs, color: 'var(--g-text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {label || `${c.text.slice(0, 40)}…`}
                            {c.meta.part ? ` · ${c.meta.part}` : ''}
                          </span>
                          <span
                            title={c.has_embedding ? t('memory.sources.detail.embedded') : t('memory.sources.detail.notEmbedded')}
                            style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: c.has_embedding ? 'var(--g-accent)' : 'var(--g-border)' }}
                          />
                          <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', flexShrink: 0 }}>{isOpen ? '−' : '+'}</span>
                        </button>
                        {isOpen && (
                          <pre style={{
                            margin: 0, padding: '0 12px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            color: 'var(--g-text)', fontSize: fontVars.xs, lineHeight: 1.65, fontFamily: 'var(--g-font-sans)',
                          }}>{c.text}</pre>
                        )}
                      </div>
                    );
                  })}
                  {chunks.items.length < chunks.total && (
                    <button type="button" disabled={loading} style={{ ...ghostBtnStyle(), alignSelf: 'center', opacity: loading ? 0.5 : 1 }} onClick={loadMoreChunks}>
                      {t('memory.sources.detail.loadMore')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
