'use client';

// 自我认知报告弹窗 — 证据驱动的人格洞察（非临床）。
// 状态机：report（查看）/ generating（LLM 推断中）/ clarify（澄清题 stepper）/
// finalizing（定稿中）/ error。草稿由服务端持有，跨会话可续做。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  ApiError,
  type InsightBig5Key, type InsightDraft, type InsightGedoKey,
  type InsightQuestion, type InsightState, type InsightVersion,
} from '@/lib/apiClient';
import { Modal } from '@/app/components/gedo/Modal';
import { Pill, primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { fontVars } from '@/app/components/gedo/typography';
import { IconSpark } from '@/app/components/gedo/icons';

const BIG5_ORDER: InsightBig5Key[] = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
const GEDO_ORDER: InsightGedoKey[] = ['motivation', 'decision_style', 'energy_rhythm', 'stress_response', 'interpersonal'];

type Mode = 'report' | 'generating' | 'clarify' | 'finalizing' | 'error';

export function SelfInsightModal({ open, onClose, state, autoStart, onChanged }: {
  open: boolean;
  onClose: () => void;
  state: InsightState | null;
  /** true → 打开后立即发起/续做生成 */
  autoStart?: boolean;
  onChanged?: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app.memory.insight');
  const locale = useLocale();

  const [mode, setMode] = useState<Mode>('report');
  const [draft, setDraft] = useState<InsightDraft | null>(null);
  const [viewing, setViewing] = useState<InsightVersion | null>(null);
  const [versions, setVersions] = useState<InsightVersion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [qIndex, setQIndex] = useState(0);
  const startedRef = useRef(false);

  const start = useCallback(async (force: boolean) => {
    setMode('generating');
    try {
      const r = await api.startInsight(force);
      if (r.status === 'final') {
        setViewing(r.version);
        setVersions(v => [r.version, ...v.filter(x => x.id !== r.version.id)]);
        setMode('report');
        onChanged?.();
      } else {
        setDraft(r.draft);
        setAnswers({});
        setQIndex(0);
        setMode('clarify');
      }
    } catch (e) {
      // 冷却/锁定按理到不了这里（入口已挡）；到了也回落
      setMode(e instanceof ApiError && e.status === 429 ? 'report' : 'error');
    }
  }, [api, onChanged]);

  const submit = useCallback(async () => {
    if (!draft) return;
    setMode('finalizing');
    try {
      const list = (draft.questions || []).map(q => ({ id: q.id, value: answers[q.id]! }));
      const r = await api.submitInsightAnswers(draft.id, list);
      setViewing(r.version);
      setVersions(v => [r.version, ...v.filter(x => x.id !== r.version.id)]);
      setDraft(null);
      setMode('report');
      onChanged?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) { setDraft(null); void start(true); return; }
      setMode('error');
    }
  }, [draft, answers, api, onChanged, start]);

  // 打开时初始化
  useEffect(() => {
    if (!open) { startedRef.current = false; return; }
    if (startedRef.current) return;
    startedRef.current = true;
    setViewing(state?.latest ?? null);
    if (state?.latest) {
      void api.getInsightVersions().then(r => setVersions(r.versions)).catch(() => {});
    }
    if (autoStart) void start(false);
    else setMode('report');
  }, [open, autoStart, state, start, api]);

  const cooldown = state?.cooldown;
  const isCurrent = viewing && versions.length > 0 ? viewing.id === versions[0].id : true;

  return (
    <Modal open={open} onClose={onClose} size="lg" eyebrow={t('eyebrow')} title={t('title')}>
      <div style={{ padding: '18px 22px 22px' }}>
        {mode === 'generating' || mode === 'finalizing' ? (
          <Busy label={mode === 'generating' ? t('generating') : t('finalizing')} hint={t('generatingHint')} />
        ) : mode === 'error' ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: fontVars.base, fontWeight: 600 }}>{t('failedTitle')}</div>
            <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('failedBody')}</div>
            <button type="button" style={{ ...primaryBtnStyle(), marginTop: 8 }} onClick={() => (draft ? void submit() : void start(false))}>{t('retry')}</button>
          </div>
        ) : mode === 'clarify' && draft ? (
          <ClarifyStepper
            draft={draft} answers={answers} qIndex={qIndex}
            onAnswer={(id, v) => setAnswers(a => ({ ...a, [id]: v }))}
            onIndex={setQIndex} onSubmit={() => void submit()}
          />
        ) : (
          <ReportView
            version={viewing} versions={versions} isCurrent={!!isCurrent} locale={locale}
            onPick={setViewing}
            cooldownDays={cooldown?.active ? cooldown.days_left : 0}
            onRegenerate={() => void start(true)}
          />
        )}
      </div>
    </Modal>
  );
}

function Busy({ label, hint }: { label: string; hint: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '52px 20px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', border: '3px solid var(--g-surface-2)', borderTopColor: 'var(--g-accent)', animation: 'gedoSpin 0.8s linear infinite' }} />
      <style>{'@keyframes gedoSpin { to { transform: rotate(360deg) } }'}</style>
      <div style={{ fontSize: fontVars.base, fontWeight: 600, marginTop: 6 }}>{label}</div>
      <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{hint}</div>
    </div>
  );
}

// ── 澄清题 stepper：一屏一题 ─────────────────────────────────────────
function ClarifyStepper({ draft, answers, qIndex, onAnswer, onIndex, onSubmit }: {
  draft: InsightDraft;
  answers: Record<string, string | number>; qIndex: number;
  onAnswer: (id: string, v: string | number) => void;
  onIndex: (i: number) => void; onSubmit: () => void;
}) {
  const t = useTranslations('app.memory.insight');
  const questions = draft.questions || [];
  const q: InsightQuestion | undefined = questions[qIndex];
  if (!q) return null;
  const answered = answers[q.id] != null;
  const last = qIndex === questions.length - 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 320 }}>
      <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('clarifyIntro', { n: questions.length })}</div>
      <div style={{ display: 'flex', gap: 5 }}>
        {questions.map((x, i) => (
          <div key={x.id} style={{ height: 4, flex: 1, borderRadius: 2, background: i === qIndex ? 'var(--g-accent)' : answers[x.id] != null ? 'var(--g-accent-line)' : 'var(--g-surface-2)' }} />
        ))}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: fontVars.lead, fontWeight: 600, lineHeight: 1.4, marginBottom: 18 }}>{q.question}</div>
        {q.kind === 'choice' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {(q.options || []).map(opt => {
              const on = answers[q.id] === opt;
              return (
                <button key={opt} type="button" onClick={() => onAnswer(q.id, opt)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
                  background: on ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
                  color: on ? 'var(--g-text)' : 'var(--g-text-mid)', fontWeight: on ? 600 : 400, fontSize: fontVars.sm,
                }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? 'var(--g-accent)' : 'var(--g-border-hi)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--g-accent)' }} /> : null}
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
                const on = answers[q.id] === n;
                return (
                  <button key={n} type="button" onClick={() => onAnswer(q.id, n)} style={{
                    width: 40, height: 40, borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--g-font-mono)', fontSize: fontVars.sm,
                    border: `1px solid ${on ? 'var(--g-accent)' : 'var(--g-border)'}`,
                    background: on ? 'var(--g-accent)' : 'var(--g-surface-1)',
                    color: on ? 'var(--g-accent-ink)' : 'var(--g-text-mid)', fontWeight: on ? 700 : 400,
                  }}>{n}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
              <span>{q.min_label}</span><span>{q.max_label}</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: '1px solid var(--g-border)' }}>
        {qIndex > 0 ? (
          <button type="button" style={ghostBtnStyle()} onClick={() => onIndex(qIndex - 1)}>{t('back')}</button>
        ) : <span />}
        <button type="button" style={{ ...primaryBtnStyle(), opacity: answered ? 1 : 0.4, pointerEvents: answered ? 'auto' : 'none' }}
          onClick={() => (last ? onSubmit() : onIndex(qIndex + 1))}>
          {last ? t('submit') : t('next')}
        </button>
      </div>
    </div>
  );
}

// ── 报告视图 ─────────────────────────────────────────────────────────
function ReportView({ version, versions, isCurrent, locale, onPick, cooldownDays, onRegenerate }: {
  version: InsightVersion | null; versions: InsightVersion[]; isCurrent: boolean; locale: string;
  onPick: (v: InsightVersion) => void;
  cooldownDays: number; onRegenerate: () => void;
}) {
  const t = useTranslations('app.memory.insight');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showClarify, setShowClarify] = useState(false);
  if (!version) return null;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const kindLabel = (k: string) => t(`evidenceKinds.${k}` as Parameters<typeof t>[0]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: 10, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
        <IconSpark size={13} style={{ color: 'var(--g-text-faint)', flexShrink: 0, marginTop: 2 }} />
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', lineHeight: 1.55 }}>{t('disclaimer')}</span>
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: fontVars.lg, fontWeight: 600, letterSpacing: '-0.01em' }}>{version.headline}</h3>
        <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', marginTop: 4 }}>
          {t('versionMeta', { v: version.version, date: fmtDate(version.finalized_at) })}
        </div>
        <p style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.7, marginTop: 8 }}>{version.summary}</p>
      </div>

      <section>
        <div style={sectionTitle}>{t('big5Title')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 10 }}>
          {BIG5_ORDER.map(k => {
            const d = version.big5?.[k];
            if (!d) return null;
            return (
              <SpectrumBar key={k}
                name={t(`big5.${k}.name` as Parameters<typeof t>[0])}
                low={t(`big5.${k}.low` as Parameters<typeof t>[0])}
                high={t(`big5.${k}.high` as Parameters<typeof t>[0])}
                score={d.score} confidence={d.confidence}
                confidenceLabel={t('confidence', { pct: Math.round(d.confidence * 100) })}
                narrative={d.narrative}
              />
            );
          })}
        </div>
      </section>

      <section>
        <div style={sectionTitle}>{t('gedoTitle')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
          {GEDO_ORDER.map(k => {
            const d = version.gedo?.[k];
            if (!d) return null;
            const isOpen = expanded === k;
            return (
              <div key={k} onClick={() => setExpanded(isOpen ? null : k)} style={{ cursor: 'pointer', padding: 12, borderRadius: 12, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t(`gedo.${k}` as Parameters<typeof t>[0])}</span>
                  <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{t('confidence', { pct: Math.round(d.confidence * 100) })}</span>
                </div>
                <div style={{ fontSize: fontVars.base, fontWeight: 600, marginTop: 3 }}>{d.label}</div>
                {d.tags?.length ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {d.tags.map(tag => <Pill key={tag} tone="insight">{tag}</Pill>)}
                  </div>
                ) : null}
                {d.narrative ? <p style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.65, margin: '6px 0 0' }}>{d.narrative}</p> : null}
                {isOpen && d.evidence?.length ? (
                  <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--g-border)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ fontSize: fontVars.xs, fontWeight: 600, color: 'var(--g-text-faint)' }}>{t('evidenceTitle')}</div>
                    {d.evidence.map((ev, i) => (
                      <div key={i}>
                        <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{kindLabel(ev.kind)}{ev.date ? ` · ${fmtDate(ev.date)}` : ''}</div>
                        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', fontStyle: 'italic', lineHeight: 1.5 }}>“{ev.quote}”</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {version.clarifications?.length ? (
        <section>
          <button type="button" onClick={() => setShowClarify(s => !s)} style={{ ...sectionTitle, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
            {t('clarifyRecord')} <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{showClarify ? '▲' : '▼'}</span>
          </button>
          {showClarify ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {version.clarifications.map(c => (
                <div key={c.id}>
                  <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>{c.question}</div>
                  <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 600, marginTop: 1 }}>→ {String(c.answer)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {versions.length > 1 ? (
        <section>
          <div style={sectionTitle}>{t('historyTitle')}</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
            {versions.map((v, i) => {
              const on = v.id === version.id;
              return (
                <button key={v.id} type="button" onClick={() => onPick(v)} style={{
                  fontSize: fontVars.xs, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
                  background: on ? 'var(--g-accent-soft)' : 'transparent',
                  color: on ? 'var(--g-accent)' : 'var(--g-text-muted)', fontWeight: on ? 600 : 400,
                }}>
                  {t('versionMeta', { v: v.version, date: fmtDate(v.finalized_at) })}{i === 0 ? ` · ${t('currentTag')}` : ''}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {isCurrent ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <button type="button" style={{ ...primaryBtnStyle(), opacity: cooldownDays > 0 ? 0.4 : 1, pointerEvents: cooldownDays > 0 ? 'none' : 'auto' }} onClick={onRegenerate}>
            {t('regenerate')}
          </button>
          {cooldownDays > 0 ? <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('cooldownHint', { n: cooldownDays })}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Big5 双极光谱条 ──────────────────────────────────────────────────
function SpectrumBar({ name, low, high, score, confidence, confidenceLabel, narrative }: {
  name: string; low: string; high: string;
  score: number; confidence: number; confidenceLabel: string; narrative?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const opacity = 0.45 + 0.55 * Math.max(0, Math.min(1, confidence));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: fontVars.sm, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{confidenceLabel}</span>
      </div>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--g-surface-2)' }}>
        <div style={{ position: 'absolute', top: -3, left: `${pct}%`, width: 12, height: 12, borderRadius: '50%', marginLeft: -6, background: 'var(--g-dim-insight)', opacity, border: '2px solid var(--g-bg-raised)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
        <span>{low}</span><span>{high}</span>
      </div>
      {narrative ? <p style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6, margin: '5px 0 0' }}>{narrative}</p> : null}
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' };
