'use client';

// 图鉴详情内容（IA v3：右侧滑出面板取代旧详情 Modal）。同一份内容两处复用：
// ≥1100px 内嵌 motion.aside 右栏（EntityCodexView 控制滑入滑出），
// <1100px 塞进 gedo/Drawer。旧 Modal 的全部功能寄生于此：AI 总结区（新）+
// 快捷动作（聊聊TA/编辑/合并）+ 智伴新发现入口 + 事实网格（含完整度环）+
// 相关碎片时间线。
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { useRouter } from '@/i18n/navigation';
import type { Entity, MemoryCandidate } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';
import { ghostBtnStyle, primaryBtnStyle, iconBtnStyle } from '@/app/components/gedo/primitives';
import { completenessOf, factKeyLabel, type Tr } from './shared';
import { TypeIconTile, typeColor } from './typeMeta';

function CompletenessRing({ value, title }: { value: number; title: string }) {
  const R = 8;
  const C = 2 * Math.PI * R;
  return (
    <svg width={22} height={22} viewBox="0 0 22 22" role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx={11} cy={11} r={R} fill="none" stroke="var(--g-surface-2)" strokeWidth={2.5} />
      <circle
        cx={11} cy={11} r={R} fill="none"
        stroke={value >= 1 ? 'var(--g-accent)' : 'var(--g-text-faint)'}
        strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${(C * value).toFixed(1)} ${C.toFixed(1)}`}
        transform="rotate(-90 11 11)"
      />
    </svg>
  );
}

export function EntityDetailContent({ entity, allEntities, inline, onClose, onEdit, onChanged, onOpenInbox }: {
  entity: Entity;
  allEntities: Entity[];
  /** true = 内嵌右栏形态（自带关闭钮）；false = Drawer 形态（Drawer 自带关闭） */
  inline?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  /** 「关于 TA 的发现」→ 打开统一收件箱（按该实体过滤）；确认动作不内嵌。 */
  onOpenInbox?: (entityId: string, entityName: string) => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const locale = useLocale();
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Array<{ id: string; content_raw?: string; created_at?: string }>>([]);
  const [epLimit, setEpLimit] = useState(10);
  const [discoveries, setDiscoveries] = useState<MemoryCandidate[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [merging, setMerging] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const band = typeColor(entity.entity_type);

  useEffect(() => {
    let cancelled = false;
    api.listEntityEpisodes(entity.id, epLimit)
      .then(r => { if (!cancelled) setEpisodes((r?.items ?? []) as typeof episodes); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id, epLimit]);

  useEffect(() => {
    let cancelled = false;
    api.listCaptures({ status: 'pending', limit: 50 })
      .then(r => {
        if (cancelled) return;
        setDiscoveries((r?.items ?? []).filter(c =>
          (c.entity_id && c.entity_id === entity.id) ||
          (!c.entity_id && c.entity_name && c.entity_name === entity.name)
        ));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id, entity.name]);

  const chatAbout = () => {
    onClose();
    router.push(`/app/companion?refType=entity&refId=${encodeURIComponent(entity.id)}&refLabel=${encodeURIComponent(entity.name || '')}`);
  };

  const regenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await api.regenerateEntitySummary(entity.id);
      onChanged();
    } catch { /* meta.status=failed 由下方 failed 文案兜底 */ } finally {
      setRegenerating(false);
    }
  };

  const lastSeen = entity.last_interaction ? new Date(entity.last_interaction).toLocaleDateString(locale) : null;
  const completeness = completenessOf(entity);
  const summary = (entity.ai_summary || '').trim();
  const meta = entity.ai_summary_meta;
  const sectionTitle: React.CSSProperties = { margin: 0, fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' };

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding: inline ? '16px 16px 24px' : '16px 20px 24px' }}>
      {/* hero */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, flexShrink: 0,
        border: `1px solid color-mix(in oklch, ${band} 34%, transparent)`,
        background: `color-mix(in oklch, ${band} 7%, transparent)`,
      }}>
        <TypeIconTile type={entity.entity_type} emoji={entity.emoji || undefined} size={52} className="" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: fontVars.md, fontWeight: 700, color: 'var(--g-text)' }}>{entity.name || '—'}</p>
          <p style={{ margin: '1px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
            {entity.relation || t(`memory.codex.types.${entity.entity_type}` as Parameters<Tr>[0])}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {td('memory.codex.detail.mentions', { n: entity.interaction_count || 0 })}{lastSeen ? ` · ${td('memory.codex.detail.lastSeen', { d: lastSeen })}` : ''}
          </p>
        </div>
        {inline && (
          <button type="button" aria-label={t('common.close')} onClick={onClose} style={{ ...iconBtnStyle(), color: 'var(--g-text-muted)', alignSelf: 'flex-start', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        )}
      </div>

      {/* AI 总结 */}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <p style={sectionTitle}>{t('memory.codex.summary.title')}</p>
          <span style={{ flex: 1 }} />
          {!entity.ai_excluded && (
            <button type="button" onClick={regenerate} disabled={regenerating}
              style={{ border: 'none', background: 'transparent', color: 'var(--g-accent)', cursor: 'pointer', fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)', padding: 0, opacity: regenerating ? 0.6 : 1 }}>
              {regenerating ? t('memory.codex.summary.regenerating') : t('memory.codex.summary.regenerate')}
            </button>
          )}
        </div>
        {summary ? (
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.7 }}>{summary}</p>
        ) : (
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontStyle: 'italic', lineHeight: 1.6 }}>
            {entity.ai_excluded ? t('memory.codex.summary.excludedHint') : t('memory.codex.summary.empty')}
          </p>
        )}
        {(meta?.generated_at || meta?.status === 'failed') && (
          <p style={{ margin: '6px 0 0', fontSize: fontVars.xs, color: meta.status === 'failed' ? 'var(--g-warn, #d9a441)' : 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {meta.status === 'failed'
              ? t('memory.codex.summary.failed')
              : td('memory.codex.summary.generatedAt', { date: new Date(meta.generated_at).toLocaleDateString(locale) })}
          </p>
        )}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" onClick={chatAbout} style={{ ...primaryBtnStyle(), flex: 1, justifyContent: 'center' }}>
          {t('memory.codex.detail.chatAbout')}
        </button>
        <button type="button" onClick={onEdit} style={{ ...ghostBtnStyle(), flex: 1, justifyContent: 'center' }}>
          {t('memory.codex.detail.edit')}
        </button>
        <button type="button" onClick={() => setMergeOpen(o => !o)} style={{ ...ghostBtnStyle(), justifyContent: 'center' }}>
          {t('memory.codex.merge.button')}
        </button>
      </div>

      {/* 实体合并（两张「妈妈」卡问题）：本卡并入所选目标卡后删除本卡 */}
      {mergeOpen && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px',
          borderRadius: 10, border: '1px solid var(--g-border)', background: 'var(--g-surface-1)',
        }}>
          <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)', lineHeight: 1.5 }}>
            {td('memory.codex.merge.hint', { name: entity.name || '—' })}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              style={{
                flex: 1, minWidth: 160, padding: '5px 8px', borderRadius: 8,
                border: '1px solid var(--g-border)', background: 'var(--g-surface-2)',
                color: 'var(--g-text)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', outline: 'none',
              }}
            >
              <option value="">{t('memory.codex.merge.pickTarget')}</option>
              {allEntities
                .filter(e => e.id !== entity.id)
                .sort((a, b) => (a.entity_type === entity.entity_type ? -1 : 0) - (b.entity_type === entity.entity_type ? -1 : 0))
                .map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name || '—'}{e.entity_type !== entity.entity_type ? `（${t(`memory.codex.types.${e.entity_type}` as Parameters<Tr>[0])}）` : ''}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!mergeTarget || merging}
              onClick={async () => {
                if (!mergeTarget || merging) return;
                setMerging(true);
                try {
                  await api.mergeEntity(entity.id, mergeTarget);
                  onChanged();
                  onClose();
                } catch { /* 保持现场可重试 */ } finally {
                  setMerging(false);
                }
              }}
              style={{ ...primaryBtnStyle(), opacity: !mergeTarget || merging ? 0.5 : 1 }}
            >
              {merging ? t('common.saving') : t('memory.codex.merge.confirm')}
            </button>
          </div>
        </div>
      )}

      {/* 智伴新发现 → 统一收件箱（确认唯一入口） */}
      {discoveries.length > 0 && (
        <button
          type="button"
          onClick={() => { onClose(); onOpenInbox?.(entity.id, entity.name || ''); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', flexShrink: 0,
            border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)',
            color: 'var(--g-text)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)',
          }}
        >
          <span>{td('memory.codex.detail.inboxEntry', { n: discoveries.length })}</span>
          <span style={{ color: 'var(--g-accent)', flexShrink: 0 }}>→</span>
        </button>
      )}

      {/* 事实网格（k·v 从卡面搬到这里，含完整度环） */}
      {(entity.facts || []).length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <p style={sectionTitle}>{t('memory.codex.detail.facts')}</p>
            <span style={{ flex: 1 }} />
            {completeness != null && (
              <CompletenessRing value={completeness} title={td('memory.codex.completeness', { pct: Math.round(completeness * 100) })} />
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {(entity.facts || []).map(f => (
              <div key={f.k} style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
                <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{factKeyLabel(t, f.k)}</p>
                <p style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text)' }}>{f.v}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 相关碎片时间线 */}
      <div>
        <p style={{ ...sectionTitle, marginBottom: 8 }}>{t('memory.codex.editor.linkedEpisodes')}</p>
        {episodes.length === 0 ? (
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('memory.codex.editor.noLinkedEpisodes')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {episodes.map(ep => (
              <div key={ep.id} style={{ display: 'flex', gap: 10, padding: '7px 0', alignItems: 'flex-start', borderBottom: '1px solid var(--g-border)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: `color-mix(in oklch, ${band} 70%, transparent)`, marginTop: 6, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.5 }}>{(ep.content_raw || '').slice(0, 160)}</p>
                  <p style={{ margin: '2px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{ep.created_at ? new Date(ep.created_at).toLocaleDateString(locale) : ''}</p>
                </div>
              </div>
            ))}
            {episodes.length >= epLimit && (
              <button type="button" onClick={() => setEpLimit(l => l + 20)} style={{ border: 'none', background: 'transparent', color: 'var(--g-accent)', cursor: 'pointer', fontSize: fontVars.sm, padding: '8px 0', textAlign: 'left' }}>
                {t('memory.codex.detail.loadMore')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 隐私徽章 */}
      {(entity.ai_excluded || entity.avatar_visible) && (
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          {entity.ai_excluded && (
            <span style={{ fontSize: fontVars.xs, color: 'var(--g-warn, #d9a441)', fontFamily: 'var(--g-font-mono)' }}>{t('memory.codex.aiHiddenBadge')}</span>
          )}
          {entity.avatar_visible && (
            <span style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', fontFamily: 'var(--g-font-mono)' }}>{t('memory.codex.avatarVisibleBadge')}</span>
          )}
        </div>
      )}
    </div>
  );
}
