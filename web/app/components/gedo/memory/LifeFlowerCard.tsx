'use client';

// 生命之花卡（AI 评估版）：八维雷达默认展示 Dimension Engine 的 AI 评估——
//   实线填充 = AI 评估分（0-10；insufficient=证据不足画到圆心，诚实不造假分）
//   虚线     = 用户自评（人生快照采集；作对比系列，差距本身是洞察）
// 就地评分 chips 退役（自评只在人生快照采集）；原「近30天活跃」虚线退役
// （活跃度已是 AI 评估的输入信号）。
// 雷达下是 8 枚紧凑维度 chips（分数/「–」），点 chip 或雷达扇形 hit-area
// 选中维度 → 展开详情：等级徽章 + 解读 + 依据 + 自评对比 + 看记忆 + 证据下钻。
// 本组件纯展示，不发任何写请求。
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MemoryDimensionAssessment, MemoryDimensionEntry } from '@/lib/apiClient';
import { radarSvg, type RadarSeries } from '@/lib/radarSvg';
import { DIM_KEYS, type Dims } from '@/lib/lifeDimensions';
import { dimColor } from './dimensions';
import { fontVars } from '@/app/components/gedo/typography';
import { Dot } from '@/app/components/gedo/primitives';
import { EvidenceLink } from './profile/shared';

type DimProfile = Record<string, { summary?: string; self_score?: number | null }>;

const SIZE = 300;

function wedgePath(cx: number, cy: number, r: number, i: number, n: number): string {
  const a0 = (Math.PI * 2 * (i - 0.5)) / n - Math.PI / 2;
  const a1 = (Math.PI * 2 * (i + 0.5)) / n - Math.PI / 2;
  const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
  const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
  return `M ${cx} ${cy} L ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A ${r} ${r} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Z`;
}

export function LifeFlowerCard({
  assessment,
  dims,
  onGoMemories,
  onEvidence,
}: {
  /** 八维 AI 评估（GET /v1/memory/dimensions；null=加载失败，雷达只画自评） */
  assessment: MemoryDimensionAssessment | null;
  /** profile dimensions（自评对比系列 + 详情对照用「活值」） */
  dims: DimProfile;
  /** 「看记忆」：跳记忆视图并选中该领域 */
  onGoMemories: (dim: string) => void;
  /** 「来自这 N 条记忆」证据下钻（记忆流按证据过滤） */
  onEvidence?: (ids: string[], label: string) => void;
}) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const [selected, setSelected] = useState<string | null>(null);

  const entryOf = (k: string): MemoryDimensionEntry | null => assessment?.dimensions?.[k] ?? null;
  const aiScoreOf = (k: string): number | null => {
    const e = entryOf(k);
    return e?.status === 'scored' && typeof e.score === 'number' ? e.score : null;
  };
  const selfOf = (k: string): number | null => {
    const s = dims[k]?.self_score;
    return typeof s === 'number' ? s : null;
  };

  const hasAnyAi = DIM_KEYS.some(k => aiScoreOf(k) != null);
  const hasAnySelf = DIM_KEYS.some(k => selfOf(k) != null);
  const hasAnyInsufficient = DIM_KEYS.some(k => entryOf(k)?.status === 'insufficient');

  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of DIM_KEYS) out[k] = t(`memory.profileDims.${k}` as Parameters<typeof t>[0]);
    return out;
  }, [t]);

  const svg = useMemo(() => {
    const series: RadarSeries[] = [];
    // 自评虚线在下层（对比系列）
    if (hasAnySelf) {
      series.push({
        dims: Object.fromEntries(DIM_KEYS.map(k => [k, selfOf(k) ?? 0])) as Dims,
        stroke: 'var(--g-text-faint)',
        dash: '4 4',
        width: 1.2,
      });
    }
    // AI 评估主实线在上层；insufficient/缺失 = 0 收缩圆心（floor 0 诚实原则）
    if (hasAnyAi) {
      series.push({
        dims: Object.fromEntries(DIM_KEYS.map(k => [k, aiScoreOf(k) ?? 0])) as Dims,
        stroke: 'var(--g-accent)',
        fill: 'color-mix(in oklch, var(--g-accent) 16%, transparent)',
        width: 1.8,
      });
    }
    return radarSvg(series, labels, SIZE, { grid: 'var(--g-border)', text: 'var(--g-text-muted)', floor: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment, dims, hasAnyAi, hasAnySelf, labels]);

  const selectedEntry = selected ? entryOf(selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 雷达 + 点击扇区 */}
      <div style={{ position: 'relative', maxWidth: SIZE, margin: '0 auto', width: '100%' }}>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        {/* 8 个透明扇形 hit-area：与 radarSvg 同一几何 */}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {DIM_KEYS.map((k, i) => (
            <path
              key={k}
              d={wedgePath(SIZE / 2, SIZE / 2, SIZE * 0.36 + SIZE * 0.05, i, DIM_KEYS.length)}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onClick={() => setSelected(sel => (sel === k ? null : k))}
            >
              <title>{labels[k]}</title>
            </path>
          ))}
        </svg>
        {!hasAnyAi && !hasAnySelf && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{
              padding: '4px 12px', borderRadius: 999, background: 'var(--g-bg-raised)',
              border: '1px solid var(--g-border)', fontSize: fontVars.xs, color: 'var(--g-text-muted)',
              maxWidth: SIZE * 0.72, textAlign: 'center', lineHeight: 1.5,
            }}>
              {t('memory.flowerCard.aiEmptyHint')}
            </span>
          </div>
        )}
      </div>

      {/* 图例 */}
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
        {hasAnyAi && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: '2px solid var(--g-accent)' }} />
            {t('memory.flowerCard.legendAi')}
          </span>
        )}
        {hasAnySelf && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--g-text-faint)' }} />
            {t('memory.flowerCard.legendSelf')}
          </span>
        )}
        {hasAnyInsufficient && <span>{t('memory.flowerCard.insufficientLegend')}</span>}
      </div>

      {/* 8 枚紧凑维度 chips（替代柱状列表；与扇形共用选中态） */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {DIM_KEYS.map((k) => {
          const score = aiScoreOf(k);
          const active = selected === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSelected(sel => (sel === k ? null : k))}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${active ? dimColor(k) : 'var(--g-border)'}`,
                background: active ? `color-mix(in oklch, ${dimColor(k)} 14%, transparent)` : 'transparent',
                color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
                fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)', whiteSpace: 'nowrap',
              }}
            >
              <Dot color={dimColor(k)} size={6} />
              {labels[k]}
              <span style={{ fontFamily: 'var(--g-font-mono)', color: score != null ? 'var(--g-text-mid)' : 'var(--g-text-faint)' }}>
                {score != null ? score : '–'}
              </span>
            </button>
          );
        })}
      </div>

      {/* 选中维度详情 */}
      {selected && (
        <DimDetail
          dimKey={selected}
          label={labels[selected]}
          entry={selectedEntry}
          selfScore={selfOf(selected)}
          onGoMemories={onGoMemories}
          onEvidence={onEvidence}
        />
      )}
    </div>
  );
}

function DimDetail({ dimKey, label, entry, selfScore, onGoMemories, onEvidence }: {
  dimKey: string;
  label: string;
  entry: MemoryDimensionEntry | null;
  selfScore: number | null;
  onGoMemories: (dim: string) => void;
  onEvidence?: (ids: string[], label: string) => void;
}) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const color = dimColor(dimKey);
  const scored = entry?.status === 'scored';
  const sig = entry?.signals;

  const insightText = scored
    ? (entry?.insight || t('memory.flowerCard.ruleInsightFallback'))
    : t('memory.flowerCard.insufficientHint');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: '12px 14px', borderRadius: 12,
      background: 'var(--g-surface-1)', border: '1px solid var(--g-border)',
    }}>
      {/* 头行：维名 + 等级徽章 + 分数 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Dot color={color} size={8} />
        <span style={{ fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{label}</span>
        {scored && entry?.level_key ? (
          <span
            title={t(`memory.dimLevelDesc.${entry.level_key}` as Parameters<typeof t>[0])}
            style={{
              fontSize: fontVars.xs, padding: '2px 9px', borderRadius: 999,
              background: `color-mix(in oklch, ${color} 16%, transparent)`,
              border: `1px solid color-mix(in oklch, ${color} 36%, transparent)`,
              color: 'var(--g-text)',
            }}
          >
            {t(`memory.dimLevels.${entry.level_key}` as Parameters<typeof t>[0])}
          </span>
        ) : (
          <span
            title={t('memory.dimLevelDesc.unknown')}
            style={{
              fontSize: fontVars.xs, padding: '2px 9px', borderRadius: 999,
              background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', color: 'var(--g-text-faint)',
            }}
          >
            {t('memory.dimLevels.unknown')}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {scored && (
          <span style={{ fontFamily: 'var(--g-font-mono)', fontSize: fontVars.sm, color: 'var(--g-text)' }}>
            {entry!.score}<span style={{ color: 'var(--g-text-faint)' }}>/10</span>
          </span>
        )}
      </div>

      {/* 解读 */}
      <p style={{ margin: 0, fontSize: fontVars.sm, color: scored && entry?.insight ? 'var(--g-text-mid)' : 'var(--g-text-faint)', lineHeight: 1.65, fontStyle: scored && entry?.insight ? 'normal' : 'italic' }}>
        {insightText}
      </p>

      {/* 依据行 + 自评对比 */}
      {sig && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
          <span>{td('memory.flowerCard.signalsLine', { total: sig.ep_total, recent: sig.ep_30d })}</span>
          {sig.goals_active > 0 && (
            <span>{td('memory.flowerCard.goalsLine', { n: sig.goals_active, p: sig.goals_avg_progress ?? 0 })}</span>
          )}
          {selfScore != null && <span>{td('memory.flowerCard.selfCompare', { s: selfScore })}</span>}
        </div>
      )}

      {/* 动作行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onGoMemories(dimKey)}
          style={{ border: 'none', background: 'transparent', color: 'var(--g-accent)', cursor: 'pointer', fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)', padding: 0, whiteSpace: 'nowrap' }}
        >
          {td('memory.flowerCard.viewMemories', { n: sig?.ep_total ?? 0 })} →
        </button>
        {scored && (
          <EvidenceLink ids={entry?.evidence_episode_ids} label={label} onEvidence={onEvidence} style={{ marginTop: 0, margin: 0 }} />
        )}
      </div>
    </div>
  );
}
