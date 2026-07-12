'use client';

// 画像视图共享小件：头像/了解度环/胶囊/事实行/迷你统计/证据下钻。
// 拆自 MemoryProfileView（IA v2 画像侧栏化改版）。
import { useTranslations } from 'next-intl';
import { IconSpark } from '@/app/components/gedo/icons';
import { fontVars } from '@/app/components/gedo/typography';

export function trendArrow(trend: string): string {
  return trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
}

export function Avatar({ name }: { name?: string | null }) {
  const ch = (name || '').trim().charAt(0);
  return (
    <div style={{
      width: 56, height: 56, borderRadius: 16, flexShrink: 0,
      background: 'linear-gradient(135deg, var(--g-dim-memory), var(--g-accent))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g-bg)', fontSize: fontVars.lg, fontWeight: 600,
    }}>
      {ch || <IconSpark size={23} />}
    </div>
  );
}

export function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: fontVars.sm, padding: '3px 9px', borderRadius: 999, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', color: 'var(--g-text-mid)', height: 'fit-content' }}>
      <span style={{ color: 'var(--g-text-faint)' }}>{label}</span>{value}
    </span>
  );
}

export function Ring({ percent }: { percent: number }) {
  const t = useTranslations('app');
  const r = 30, c = 2 * Math.PI * r, off = c * (1 - percent / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <svg width={78} height={78}>
        <circle cx="39" cy="39" r={r} fill="none" stroke="var(--g-surface-2)" strokeWidth="6" />
        <circle cx="39" cy="39" r={r} fill="none" stroke="var(--g-accent)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 39 39)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        <text x="39" y="43" textAnchor="middle" fill="var(--g-text)" style={{ fontSize: fontVars.base, fontWeight: 600, fontFamily: 'var(--g-font-mono)' }}>{percent}%</text>
      </svg>
      <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('memory.profile.completion')}</span>
    </div>
  );
}

export function Fact({ label, value, benefit }: { label: string; value: string | null; benefit?: string }) {
  const t = useTranslations('app');
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span style={{ width: 48, flexShrink: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{label}</span>
      {value ? (
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text)', lineHeight: 1.5 }}>{value}</span>
      ) : (
        // 空字段展示"填了它智伴能做什么"的回报文案，比"还没提到"更有动机。
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontStyle: 'italic' }}>{benefit ?? t('memory.profile.notMentioned')}</span>
      )}
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{label}</div>
      <div style={{ fontSize: fontVars.lead, fontWeight: 500, marginTop: 2 }}>{value}</div>
    </div>
  );
}

/** 「来自这 N 条记忆 →」：卡片级证据回溯；存量派生数据无 ids 时给降级文案。 */
export function EvidenceLink({ ids, label, onEvidence, style }: {
  ids?: string[]; label: string; onEvidence?: (ids: string[], label: string) => void;
  /** 布局覆盖（默认为卡片底部独立一行；行内使用传 { marginTop: 0 } 等） */
  style?: React.CSSProperties;
}) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  if (ids?.length && onEvidence) {
    return (
      <button
        type="button"
        onClick={() => onEvidence(ids, label)}
        style={{
          marginTop: 10, alignSelf: 'flex-start', border: 'none', background: 'transparent',
          color: 'var(--g-accent)', cursor: 'pointer', fontSize: fontVars.xs,
          fontFamily: 'var(--g-font-sans)', padding: 0, display: 'block',
          ...style,
        }}
      >
        {td('memory.profile.evidenceLink', { n: ids.length })} →
      </button>
    );
  }
  return (
    <p style={{ margin: '10px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', ...style }}>
      {t('memory.profile.evidenceMissing')}
    </p>
  );
}
