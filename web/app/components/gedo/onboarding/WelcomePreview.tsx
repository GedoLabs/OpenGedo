'use client';

import { fontVars } from '../typography';

// First-login welcome preview — a 4-step taste of the product loop:
// talk → distill → insight → breakthrough. Each step shows a tiny live-feeling
// visual so a brand-new user "gets" the value before landing on the main
// (Companion) view. Copy is i18n'd via app.welcome.*; tokens only (--g-*), so it
// follows the theme. Shown once per browser.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCheck, IconArrow, IconSpark, IconLayers, IconInsight, IconTarget } from '@/app/components/gedo/icons';

type StepKey = 'talk' | 'distill' | 'insight' | 'breakthrough';

type StepDef = {
  n: string;
  key: StepKey;
  accent: string;
  Icon: React.ComponentType<{ size?: number }>;
  Visual: React.ComponentType;
};

const STEPS: StepDef[] = [
  { n: '01', key: 'talk', accent: 'var(--g-accent)', Icon: IconSpark, Visual: TalkVisual },
  { n: '02', key: 'distill', accent: 'var(--g-dim-memory)', Icon: IconLayers, Visual: MemoryVisual },
  { n: '03', key: 'insight', accent: 'var(--g-dim-insight)', Icon: IconInsight, Visual: InsightVisual },
  { n: '04', key: 'breakthrough', accent: 'var(--g-dim-goal)', Icon: IconTarget, Visual: GrowthVisual },
];

export function WelcomePreview({ onDone }: { onDone: () => void }) {
  const t = useTranslations('app');
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const isLast = i === STEPS.length - 1;
  const Visual = step.Visual;

  return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 110,
          background: 'color-mix(in oklch, var(--g-bg) 78%, transparent)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 600,
            background: 'var(--g-bg-raised)',
            border: '1px solid var(--g-border)',
            borderRadius: 20,
            boxShadow: '0 30px 80px -40px oklch(0 0 0 / 0.5)',
            overflow: 'hidden',
            margin: 'auto',
          }}
        >
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)', letterSpacing: '0.12em' }}>
                {t('welcome.brand')}
              </span>
            </div>
            <button
              type="button"
              onClick={onDone}
              title={t('welcome.skip')}
              style={{ background: 'transparent', border: 'none', color: 'var(--g-text-faint)', fontSize: fontVars.sm, cursor: 'pointer', fontFamily: 'var(--g-font-sans)' }}
            >
              {t('welcome.skip')}
            </button>
          </div>

          {/* stepper */}
          <div style={{ display: 'flex', gap: 8, padding: '0 20px 14px' }}>
            {STEPS.map((s, idx) => {
              const active = idx === i;
              const done = idx < i;
              return (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => setI(idx)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'var(--g-font-sans)',
                  }}
                >
                  <div
                    style={{
                      height: 3,
                      borderRadius: 999,
                      marginBottom: 7,
                      background: active || done ? s.accent : 'var(--g-border)',
                      opacity: active ? 1 : done ? 0.7 : 1,
                      transition: 'background 0.2s',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: active ? s.accent : 'var(--g-text-faint)' }}>STEP {s.n}</span>
                  </div>
                  <span style={{ fontSize: fontVars.sm, fontWeight: active ? 600 : 500, color: active ? 'var(--g-text)' : 'var(--g-text-muted)' }}>{t(`welcome.steps.${s.key}.title`)}</span>
                </button>
              );
            })}
          </div>

          {/* visual stage */}
          <div style={{ padding: '4px 20px 0' }}>
            <div
              style={{
                position: 'relative',
                minHeight: 232,
                borderRadius: 14,
                border: '1px solid var(--g-border)',
                background: 'var(--g-bg)',
                overflow: 'hidden',
                padding: 18,
              }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={step.n}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  style={{ height: '100%' }}
                >
                  <Visual />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* copy */}
          <div style={{ padding: '18px 20px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: step.accent,
                  background: `color-mix(in oklch, ${step.accent} 14%, transparent)`,
                  border: `1px solid color-mix(in oklch, ${step.accent} 32%, transparent)`,
                }}
              >
                <step.Icon size={14} />
              </span>
              <h2 style={{ margin: 0, fontSize: fontVars.md, fontWeight: 700, color: 'var(--g-text)' }}>{t(`welcome.steps.${step.key}.title`)}</h2>
            </div>
            <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.6 }}>{t(`welcome.steps.${step.key}.desc`)}</p>
          </div>

          {/* footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 20px' }}>
            <button
              type="button"
              onClick={() => setI(v => Math.max(0, v - 1))}
              disabled={i === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'transparent', border: 'none',
                color: 'var(--g-text-muted)', fontSize: fontVars.sm, cursor: i === 0 ? 'default' : 'pointer',
                opacity: i === 0 ? 0.3 : 1, fontFamily: 'var(--g-font-sans)', padding: '6px 4px',
              }}
            >
              {t('welcome.prev')}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {STEPS.map((_, idx) => (
                <span key={idx} style={{ width: idx === i ? 18 : 6, height: 6, borderRadius: 999, background: idx === i ? step.accent : 'var(--g-border-hi)', transition: 'all 0.2s' }} />
              ))}
            </div>

            <button
              type="button"
              onClick={() => (isLast ? onDone() : setI(v => Math.min(STEPS.length - 1, v + 1)))}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 18px', borderRadius: 999,
                background: 'var(--g-accent)', color: 'var(--g-accent-ink)',
                fontSize: fontVars.sm, fontWeight: 600, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--g-font-sans)',
              }}
            >
              {isLast ? t('welcome.start') : t('welcome.next')}
              <IconArrow size={13} />
            </button>
          </div>
        </div>
      </div>
  );
}

// ── Step visuals ──────────────────────────────────────────────────────────

function Bubble({ side, tone = 'neutral', children }: { side: 'l' | 'r'; tone?: 'neutral' | 'accent'; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: side === 'r' ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '84%',
          padding: '8px 12px',
          borderRadius: 12,
          [side === 'r' ? 'borderTopRightRadius' : 'borderTopLeftRadius']: 4,
          fontSize: fontVars.sm,
          lineHeight: 1.5,
          color: 'var(--g-text)',
          background: tone === 'accent' ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
          border: `1px solid ${tone === 'accent' ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
        } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

function Trace({ tone, name, detail }: { tone: string; name: string; detail: string }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', fontSize: fontVars.sm }}
    >
      <span style={{ width: 16, height: 16, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone, background: `color-mix(in oklch, ${tone} 16%, transparent)`, border: `1px solid color-mix(in oklch, ${tone} 32%, transparent)` }}>
        <IconCheck size={9} />
      </span>
      <span style={{ color: 'var(--g-text)', fontWeight: 500 }}>{name}</span>
      <span style={{ flex: 1, color: 'var(--g-text-muted)' }}>{detail}</span>
    </div>
  );
}

function TalkVisual() {
  const t = useTranslations('app');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <Bubble side="r">{t('welcome.talk.userMsg')}</Bubble>
      <Bubble side="l" tone="accent">{t('welcome.talk.reply')}</Bubble>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
        <Trace tone="var(--g-dim-memory)" name={t('welcome.talk.trace.record.name')} detail={t('welcome.talk.trace.record.detail')} />
        <Trace tone="var(--g-dim-exec)" name={t('welcome.talk.trace.adjust.name')} detail={t('welcome.talk.trace.adjust.detail')} />
        <Trace tone="var(--g-dim-goal)" name={t('welcome.talk.trace.retarget.name')} detail={t('welcome.talk.trace.retarget.detail')} />
      </div>
    </div>
  );
}

function MemoryVisual() {
  const t = useTranslations('app');
  const rows = [
    { key: 'health', dim: 'var(--g-dim-exec)', count: 6 },
    { key: 'career', dim: 'var(--g-dim-goal)', count: 4 },
    { key: 'growth', dim: 'var(--g-dim-insight)', count: 5 },
  ] as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'var(--g-accent-soft)', border: '1px solid var(--g-accent-line)', fontSize: fontVars.sm }}>
        <IconCheck size={13} style={{ color: 'var(--g-accent)' }} />
        <span style={{ color: 'var(--g-text)', fontWeight: 500 }}>{t('welcome.memory.recorded')}</span>
        <span style={{ color: 'var(--g-text-muted)' }}>{t('welcome.memory.recordedDetail')}</span>
      </div>
      <div style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)', letterSpacing: '0.08em', paddingLeft: 2 }}>{t('welcome.memory.sectionLabel')}</div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderLeft: `2px solid ${r.dim}` }}>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 500 }}>{t(`welcome.memory.rows.${r.key}.name`)}</span>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t(`welcome.memory.rows.${r.key}.sub`)}</span>
          <span style={{ marginLeft: 'auto', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)' }}>{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function InsightVisual() {
  const t = useTranslations('app');
  const bars = [40, 55, 38, 70, 58, 82, 76];
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const stats = [
    { key: 'completion', v: '85%', c: 'var(--g-dim-exec)' },
    { key: 'focus', v: '↑12%', c: 'var(--g-dim-insight)' },
    { key: 'streak', v: t('welcome.insight.streakValue'), c: 'var(--g-dim-goal)' },
  ] as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>{t('welcome.insight.title')}</span>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-dim-insight)' }}>ECS 76 · ↑ 8</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 84 }}>
          {bars.map((h, idx) => (
            <div key={idx} style={{ flex: 1, height: `${h}%`, borderRadius: '5px 5px 0 0', background: `linear-gradient(to top, var(--g-dim-insight), color-mix(in oklch, var(--g-dim-insight) 45%, transparent))` }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {days.map((d, idx) => (
            <span key={idx} style={{ flex: 1, textAlign: 'center', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t(`welcome.insight.days.${d}`)}</span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        {stats.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fontVars.sm }}>
            <span style={{ color: s.c, fontWeight: 600 }}>{s.v}</span>
            <span style={{ color: 'var(--g-text-faint)' }}>{t(`welcome.insight.stats.${s.key}`)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrowthVisual() {
  const t = useTranslations('app');
  // rising curve with milestones
  const pts = '8,150 70,120 132,128 196,72 280,40';
  const dots = [
    { x: 8, y: 150, label: t('welcome.growth.today') },
    { x: 132, y: 128, label: t('welcome.growth.days', { n: 30 }) },
    { x: 196, y: 72, label: t('welcome.growth.days', { n: 60 }) },
    { x: 280, y: 40, label: t('welcome.growth.days', { n: 90 }) },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>{t('welcome.growth.title')}</span>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-dim-goal)' }}>{t('welcome.growth.capability')}</span>
      </div>
      <div style={{ position: 'relative', flex: 1 }}>
        <svg viewBox="0 0 288 170" width="100%" height="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="gv-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--g-dim-goal)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--g-dim-goal)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`${pts} 280,170 8,170`} fill="url(#gv-fill)" />
          <polyline points={pts} fill="none" stroke="var(--g-dim-goal)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {dots.map((d, idx) => (
            <circle key={idx} cx={d.x === 280 ? 278 : d.x} cy={d.y} r={4} fill="var(--g-bg)" stroke="var(--g-dim-goal)" strokeWidth={2.5} />
          ))}
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)' }}>
        {dots.map(d => <span key={d.label}>{d.label}</span>)}
      </div>
    </div>
  );
}
