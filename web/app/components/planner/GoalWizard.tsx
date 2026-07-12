'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Sparkles, Shield, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { Goal, OKRStructure } from './types';
import { LEVEL_COLORS } from './types';
import type { IfThenCard } from '../obstacles/types';
import { type ObstacleType } from '../obstacles/types';
import { useAuth } from '@/app/contexts/AuthContext';
import { useObstacleTypeInfo } from './planner-i18n';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';

type WizardStep = 'input' | 'diagnosis' | 'structure' | 'obstacle_plan';

const STEP_KEYS: { key: WizardStep; num: number }[] = [
  { key: 'input', num: 1 },
  { key: 'diagnosis', num: 2 },
  { key: 'structure', num: 3 },
  { key: 'obstacle_plan', num: 4 },
];

// 诊断问题不再写死 —— 进入诊断步时由 LLM(/v1/planner/clarify)按目标动态生成,
// 每题带推荐选项 + 「其他」自填。下面是 LLM 返回的题型。
type ClarifyQ = { id: string; field?: string; prompt: string; hint?: string; options?: { value: string; label: string }[] };

interface Props {
  onComplete: (goals: Goal[], ifThenCards: IfThenCard[], okrStructure?: OKRStructure | null) => void;
  onCancel: () => void;
}

function generateMockOKR(prompt: string, answers: Record<string, string>): OKRStructure {
  const isCareer = /工作|offer|面试|转行|升职|涨薪|PM|产品/.test(prompt);
  const isFitness = /健身|体脂|减肥|运动|跑步|健康/.test(prompt);

  if (isCareer) {
    return {
      objective: { title: prompt, description: '通过系统准备实现职业目标', timeframe: '3-6个月' },
      keyResults: [
        { id: 'kr-1', title: '完成技能体系搭建', description: answers.q3 ? `弥补缺口：${answers.q3}` : '系统学习核心技能', timeframe: '第1-2个月' },
        { id: 'kr-2', title: answers.q1 || '达成可量化的求职成果', description: '面试/Offer 数量达标', timeframe: '第2-4个月' },
      ],
      monthlyGoals: [
        { id: 'mg-1', keyResultId: 'kr-1', title: '本月：系统学习核心方法论', description: '完成书籍/课程学习' },
        { id: 'mg-2', keyResultId: 'kr-2', title: '本月：准备简历和面试材料', description: '优化简历 + STAR 叙述' },
      ],
      tasks: [
        { id: 't-1', monthlyGoalId: 'mg-1', title: '阅读核心书籍第1-3章', estimatedDuration: 60 },
        { id: 't-2', monthlyGoalId: 'mg-1', title: '完成在线课程第一模块', estimatedDuration: 90 },
        { id: 't-3', monthlyGoalId: 'mg-2', title: '整理 3 个项目经历的 STAR 叙述', estimatedDuration: 45 },
        { id: 't-4', monthlyGoalId: 'mg-2', title: '优化目标岗位版简历', estimatedDuration: 60 },
      ],
    };
  }

  if (isFitness) {
    return {
      objective: { title: prompt, description: '通过规律运动和饮食管理达成健康目标', timeframe: '3个月' },
      keyResults: [
        { id: 'kr-1', title: '每周完成 4 次有氧运动', description: '每次 30 分钟以上', timeframe: '持续' },
        { id: 'kr-2', title: '控制饮食热量在合理范围', description: '记录饮食，控制摄入', timeframe: '持续' },
      ],
      monthlyGoals: [
        { id: 'mg-1', keyResultId: 'kr-1', title: '本月：建立运动习惯', description: '每周至少 3 次' },
        { id: 'mg-2', keyResultId: 'kr-2', title: '本月：学习基础营养知识', description: '掌握热量计算' },
      ],
      tasks: [
        { id: 't-1', monthlyGoalId: 'mg-1', title: '30 分钟慢跑 + 10 分钟拉伸', estimatedDuration: 40 },
        { id: 't-2', monthlyGoalId: 'mg-1', title: '全身力量训练 40 分钟', estimatedDuration: 40 },
        { id: 't-3', monthlyGoalId: 'mg-2', title: '记录今日饮食并计算热量', estimatedDuration: 10 },
      ],
    };
  }

  return {
    objective: { title: prompt, description: answers.q1 || '系统推进目标达成', timeframe: answers.q2 || '3-6个月' },
    keyResults: [
      { id: 'kr-1', title: '完成核心里程碑 1', description: '关键成果指标', timeframe: '第1个月' },
      { id: 'kr-2', title: '完成核心里程碑 2', description: '关键成果指标', timeframe: '第2个月' },
    ],
    monthlyGoals: [
      { id: 'mg-1', keyResultId: 'kr-1', title: '本月核心目标', description: '聚焦最重要的事' },
    ],
    tasks: [
      { id: 't-1', monthlyGoalId: 'mg-1', title: '今日第一步行动', estimatedDuration: 30 },
      { id: 't-2', monthlyGoalId: 'mg-1', title: '准备相关资料', estimatedDuration: 20 },
    ],
  };
}

function classifyObstacle(text: string): ObstacleType {
  if (/时间|太忙|没空|加班/.test(text)) return 'time_limited';
  if (/手机|打断|分心|注意力/.test(text)) return 'attention_scattered';
  if (/拖延|害怕|不敢|恐惧|不知道从哪/.test(text)) return 'procrastination_fear';
  if (/不懂|不会|信息|不确定/.test(text)) return 'info_insufficient';
  if (/累|疲|精力|睡眠/.test(text)) return 'energy_low';
  if (/等待|别人|依赖|外部/.test(text)) return 'external_dependency';
  return 'procrastination_fear';
}

function getDefaultThenAction(type: ObstacleType, tw: (key: string) => string): string {
  return tw(`thenActions.${type}`);
}

function generateIfThenCards(
  obstacle: string,
  goalTitle: string,
  tw: (key: string, values?: Record<string, string>) => string,
): Array<{ obstacleDescription: string; ifCondition: string; thenAction: string; obstacleType: ObstacleType }> {
  const obstacleType = classifyObstacle(obstacle);
  return [{
    obstacleDescription: obstacle,
    ifCondition: tw('ifThenWhen', { goal: goalTitle }),
    thenAction: getDefaultThenAction(obstacleType, (k) => tw(k)),
    obstacleType,
  }];
}

// ── Gedo 设计系统样式 —— token 化的面板 / 输入框 / 按钮 / 层级徽标 ──
// OKR 四层徽标走 LEVEL_LABELS 分类色（与 GoalList 一致，保留 hex）。
const fieldStyle: CSSProperties = {
  width: '100%', borderRadius: 8, background: 'var(--g-bg-raised)',
  border: '1px solid var(--g-border)', padding: '10px 12px', fontSize: fontVars.sm,
  color: 'var(--g-text)', outline: 'none', resize: 'none', lineHeight: 1.5,
  fontFamily: 'var(--g-font-sans)', transition: 'border-color 0.15s',
};

const panelStyle: CSSProperties = {
  borderRadius: 12, background: 'var(--g-surface-1)',
  border: '1px solid var(--g-border)', padding: 18,
};

function primaryCta(disabled = false): CSSProperties {
  return { ...primaryBtnStyle(), padding: '9px 18px', opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' };
}

function layerBadge(text: string, color: string, small = false) {
  return (
    <span style={{ flexShrink: 0, padding: small ? '1px 5px' : '2px 6px', fontSize: small ? 10 : 11, fontWeight: 700, borderRadius: 5, background: color + '20', color }}>
      {text}
    </span>
  );
}

export default function GoalWizard({ onComplete, onCancel }: Props) {
  const { api } = useAuth();
  const t = useTranslations('app.planner.wizard');
  const tCommon = useTranslations('app.common');
  const obstacleInfo = useObstacleTypeInfo();
  const [step, setStep] = useState<WizardStep>('input');
  const [goalPrompt, setGoalPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [diagnosisAnswers, setDiagnosisAnswers] = useState<Record<string, string>>({});
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [clarifyQuestions, setClarifyQuestions] = useState<ClarifyQ[]>([]);
  const [otherMode, setOtherMode] = useState<Record<string, boolean>>({});
  const [woopOutcome, setWoopOutcome] = useState('');
  const [woopObstacle, setWoopObstacle] = useState('');
  const [generatedOKR, setGeneratedOKR] = useState<OKRStructure | null>(null);
  const [generatedCards, setGeneratedCards] = useState<Array<{ obstacleDescription: string; ifCondition: string; thenAction: string; obstacleType: ObstacleType }>>([]);
  const [expandedKR, setExpandedKR] = useState<string | null>(null);

  const stepIndex = STEP_KEYS.findIndex(s => s.key === step);

  const handleStartDiagnosis = useCallback(async () => {
    if (!goalPrompt.trim()) return;
    setIsAnalyzing(true);
    try {
      const res = await api.clarify(goalPrompt.trim());
      setClarifyQuestions(Array.isArray(res?.questions) ? (res.questions as ClarifyQ[]) : []);
    } catch { setClarifyQuestions([]); }
    setIsAnalyzing(false);
    setCurrentQIndex(0);
    setOtherMode({});
    setStep('diagnosis');
  }, [goalPrompt, api]);

  const handleDiagnosisNext = useCallback(() => {
    setCurrentQIndex(prev => Math.min(prev + 1, Math.max(0, clarifyQuestions.length - 1)));
  }, [clarifyQuestions.length]);

  // WOOP 已并入 LLM 澄清(field=outcome/obstacle)。诊断完成 / 跳过即从答案抽出 WOOP → 生成 OKR。
  const handleWoopComplete = useCallback(async () => {
    let outcome = '', obstacle = '';
    for (const q of clarifyQuestions) {
      if (q.field === 'outcome') outcome = diagnosisAnswers[q.id] || '';
      else if (q.field === 'obstacle') obstacle = diagnosisAnswers[q.id] || '';
    }
    setWoopOutcome(outcome); setWoopObstacle(obstacle);
    setIsAnalyzing(true);
    try {
      const result = await api.woopGenerate({ prompt: goalPrompt, diagnosis_answers: diagnosisAnswers, woop: { wish: goalPrompt, outcome, obstacle } });
      setGeneratedOKR(result.okrStructure ? result.okrStructure : generateMockOKR(goalPrompt, diagnosisAnswers));
      if (result.ifThenCards?.length > 0) {
        setGeneratedCards(result.ifThenCards.map((c: { obstacleType?: string; obstacle_type?: string; obstacleDescription?: string; obstacle_description?: string; ifCondition?: string; if_condition?: string; thenAction?: string; then_action?: string }) => ({
          obstacleDescription: c.obstacleDescription || c.obstacle_description || obstacle,
          ifCondition: c.ifCondition || c.if_condition || t('ifThenFallback', { obstacle: obstacle || t('ifLabel') }),
          thenAction: c.thenAction || c.then_action || t('thenFallback'),
          obstacleType: (c.obstacleType || c.obstacle_type || classifyObstacle(obstacle)) as ObstacleType,
        })));
      } else {
        setGeneratedCards(obstacle ? generateIfThenCards(obstacle, goalPrompt, (key, values) => t(key as Parameters<typeof t>[0], values)) : []);
      }
    } catch {
      setGeneratedOKR(generateMockOKR(goalPrompt, diagnosisAnswers));
      setGeneratedCards(obstacle ? generateIfThenCards(obstacle, goalPrompt, (key, values) => t(key as Parameters<typeof t>[0], values)) : []);
    }
    setIsAnalyzing(false);
    setStep('structure');
  }, [clarifyQuestions, diagnosisAnswers, goalPrompt, api, t]);

  const handleConfirmStructure = useCallback(() => {
    setStep('obstacle_plan');
  }, []);

  const handleFinalComplete = useCallback(() => {
    if (!generatedOKR) return;

    const now = new Date().toISOString();
    const goals: Goal[] = [{
      id: `goal-${Date.now()}`,
      title: generatedOKR.objective.title,
      description: generatedOKR.objective.description,
      wish: goalPrompt,
      outcome: woopOutcome,
      obstacle: woopObstacle,
      plan: generatedCards[0]?.thenAction || '',
      level: 'objective',
      lifeWheelDimension: 'career',
      status: 'active',
      progress: 0,
      startDate: now,
      endDate: '',
      createdAt: now,
      updatedAt: now,
    }];

    const ifThenCards: IfThenCard[] = generatedCards.map((card, i) => ({
      id: `itc-${Date.now()}-${i}`,
      goalId: goals[0].id,
      goalTitle: goals[0].title,
      obstacleDescription: card.obstacleDescription,
      ifCondition: card.ifCondition,
      thenAction: card.thenAction,
      obstacleType: card.obstacleType,
      triggeredCount: 0,
      executedCount: 0,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    }));

    onComplete(goals, ifThenCards, generatedOKR);
  }, [generatedOKR, goalPrompt, woopOutcome, woopObstacle, generatedCards, onComplete]);

  return (
    <div style={{ borderRadius: 10, background: 'var(--g-bg-raised)', overflow: 'hidden' }}>
      <style>{`
        .gw-input::placeholder { color: var(--g-text-faint); }
        .gw-input:focus { border-color: var(--g-accent); }
        .gw-input--warn:focus { border-color: var(--g-warning, #f59e0b); }
        .gw-input--danger:focus { border-color: var(--g-danger); }
        .gw-kr:hover { background: var(--g-surface-2); }
        .gw-cancel:hover { color: var(--g-text); }
        .gw-skip:hover { color: var(--g-text-mid); }
      `}</style>

      {/* Progress Bar */}
      <div style={{ padding: '20px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{t('title')}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="gw-cancel"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--g-text-muted)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', transition: 'color 0.15s' }}
          >
            {tCommon('cancel')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          {STEP_KEYS.map((s, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 999, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: fontVars.sm, fontWeight: 700,
                  background: done || active ? 'var(--g-accent)' : 'var(--g-surface-2)',
                  color: done || active ? 'var(--g-accent-ink)' : 'var(--g-text-faint)',
                  boxShadow: active ? '0 0 0 3px var(--g-accent-soft)' : 'none',
                }}>
                  {done ? <Check className="w-4 h-4" /> : s.num}
                </div>
                {i < STEP_KEYS.length - 1 && (
                  <div style={{ flex: 1, height: 2, margin: '0 6px', borderRadius: 2, background: done ? 'var(--g-accent)' : 'var(--g-border)' }} />
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontVars.sm, color: 'var(--g-text-faint)', marginBottom: 4 }}>
          {STEP_KEYS.map(s => <span key={s.key} style={{ flex: 1, textAlign: 'center' }}>{t(`steps.${s.key}`)}</span>)}
        </div>
      </div>

      <div style={{ padding: '8px 22px 22px' }}>
        <AnimatePresence mode="wait">
          {/* Step 1: Input */}
          {step === 'input' && (
            <motion.div key="input" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: fontVars.sm, fontWeight: 500, color: 'var(--g-text-mid)', marginBottom: 8 }}>{t('inputLabel')}</label>
                  <textarea
                    value={goalPrompt}
                    onChange={e => setGoalPrompt(e.target.value)}
                    placeholder={t('inputPlaceholder')}
                    className="gw-input"
                    style={{ ...fieldStyle, height: 112 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleStartDiagnosis}
                    disabled={!goalPrompt.trim() || isAnalyzing}
                    style={primaryCta(!goalPrompt.trim() || isAnalyzing)}
                  >
                    {isAnalyzing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> {t('analyzing')}</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> {t('startDiagnosis')}</>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: AI 澄清提问（LLM 动态生成,选项 + 其他自填） */}
          {step === 'diagnosis' && (
            <motion.div key="diagnosis" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {clarifyQuestions.length === 0 ? (
                  <>
                    <div style={panelStyle}>
                      <p style={{ margin: 0, color: 'var(--g-text-muted)', fontSize: fontVars.sm }}>{t('noClarify')}</p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" onClick={handleWoopComplete} disabled={isAnalyzing} style={primaryCta(isAnalyzing)}>{isAnalyzing ? t('generating') : t('generateOkr')} <ArrowRight className="w-3 h-3" /></button>
                    </div>
                  </>
                ) : (() => {
                  const q = clarifyQuestions[currentQIndex];
                  const ans = diagnosisAnswers[q.id] || '';
                  const isOther = !!otherMode[q.id];
                  const chip = (active: boolean): CSSProperties => ({
                    padding: '7px 12px', borderRadius: 8, fontSize: fontVars.sm, cursor: 'pointer', fontFamily: 'var(--g-font-sans)',
                    border: `1px solid ${active ? 'var(--g-accent)' : 'var(--g-border)'}`,
                    background: active ? 'var(--g-accent-soft)' : 'var(--g-bg-raised)',
                    color: active ? 'var(--g-accent)' : 'var(--g-text-mid)',
                  });
                  return (
                    <>
                      <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>{t('questionProgress', { current: currentQIndex + 1, total: clarifyQuestions.length })}</div>
                      <div style={panelStyle}>
                        <p style={{ margin: 0, marginBottom: q.hint ? 4 : 12, color: 'var(--g-text)', fontWeight: 500 }}>{q.prompt}</p>
                        {q.hint && <p style={{ margin: '0 0 12px', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{q.hint}</p>}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {(q.options || []).map(opt => (
                            <button key={opt.value} type="button" style={chip(!isOther && ans === opt.label)}
                              onClick={() => { setOtherMode(m => ({ ...m, [q.id]: false })); setDiagnosisAnswers(prev => ({ ...prev, [q.id]: opt.label })); }}>
                              {opt.label}
                            </button>
                          ))}
                          <button type="button" style={chip(isOther)}
                            onClick={() => { setOtherMode(m => ({ ...m, [q.id]: true })); setDiagnosisAnswers(prev => ({ ...prev, [q.id]: '' })); }}>
                            {t('other')}
                          </button>
                        </div>
                        {isOther && (
                          <textarea value={ans} onChange={e => setDiagnosisAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                            placeholder={t('answerPlaceholder')} className="gw-input" style={{ ...fieldStyle, height: 64, marginTop: 10 }} autoFocus />
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <button type="button" onClick={handleWoopComplete} className="gw-skip"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', transition: 'color 0.15s' }}>
                          {t('skip')}
                        </button>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {currentQIndex > 0 && (
                            <button type="button" onClick={() => setCurrentQIndex(prev => prev - 1)} style={ghostBtnStyle()}>
                              <ArrowLeft className="w-3 h-3" /> {t('prevQuestion')}
                            </button>
                          )}
                          <button type="button" onClick={currentQIndex < clarifyQuestions.length - 1 ? handleDiagnosisNext : handleWoopComplete} disabled={isAnalyzing} style={primaryCta(isAnalyzing)}>
                            {currentQIndex < clarifyQuestions.length - 1 ? t('nextQuestion') : (isAnalyzing ? t('generating') : t('generateOkr'))} <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          )}

          {/* Step 3: OKR Structure */}
          {step === 'structure' && generatedOKR && (
            <motion.div key="structure" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ borderRadius: 12, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', overflow: 'hidden' }}>
                  {/* O Layer */}
                  <div style={{ padding: 16, borderBottom: '1px solid var(--g-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      {layerBadge('O', LEVEL_COLORS.objective)}
                      <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{generatedOKR.objective.timeframe}</span>
                    </div>
                    <p style={{ margin: 0, color: 'var(--g-text)', fontWeight: 500 }}>{generatedOKR.objective.title}</p>
                    <p style={{ margin: '4px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{generatedOKR.objective.description}</p>
                  </div>

                  {/* KR Layer */}
                  {generatedOKR.keyResults.map(kr => (
                    <div key={kr.id} style={{ borderBottom: '1px solid var(--g-border)' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedKR(expandedKR === kr.id ? null : kr.id)}
                        className="gw-kr"
                        style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--g-font-sans)', transition: 'background 0.15s' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {layerBadge('KR', LEVEL_COLORS.key_result)}
                          <span style={{ color: 'var(--g-text)', fontSize: fontVars.sm }}>{kr.title}</span>
                        </div>
                        {expandedKR === kr.id ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--g-text-muted)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--g-text-muted)' }} />}
                      </button>

                      {expandedKR === kr.id && (
                        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <p style={{ margin: 0, paddingLeft: 40, fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{kr.description} · {kr.timeframe}</p>
                          {/* M Layer */}
                          {generatedOKR.monthlyGoals.filter(mg => mg.keyResultId === kr.id).map(mg => (
                            <div key={mg.id} style={{ paddingLeft: 40 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                {layerBadge('M', LEVEL_COLORS.monthly, true)}
                                <span style={{ color: 'var(--g-text)', fontSize: fontVars.sm }}>{mg.title}</span>
                              </div>
                              {/* T Layer */}
                              {generatedOKR.tasks.filter(t => t.monthlyGoalId === mg.id).map(t => (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', paddingLeft: 32 }}>
                                  {layerBadge('T', LEVEL_COLORS.task, true)}
                                  <span style={{ color: 'var(--g-text-mid)', fontSize: fontVars.sm }}>{t.title}</span>
                                  {t.estimatedDuration && (
                                    <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t.estimatedDuration}min</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" onClick={() => setStep('diagnosis')} style={ghostBtnStyle()}>
                    <ArrowLeft className="w-3 h-3" /> {t('editAnswers')}
                  </button>
                  <button type="button" onClick={handleConfirmStructure} style={primaryCta()}>
                    <Shield className="w-4 h-4" /> {t('confirmObstaclePlan')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 5: Obstacle Plan */}
          {step === 'obstacle_plan' && (
            <motion.div key="obstacle_plan" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ borderRadius: 12, background: 'color-mix(in oklch, var(--g-danger) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--g-danger) 25%, transparent)', padding: 14 }}>
                  <p style={{ margin: 0, color: 'var(--g-danger)', fontSize: fontVars.sm, fontWeight: 600 }}>{t('yourObstacle', { obstacle: woopObstacle })}</p>
                  <p style={{ margin: '4px 0 0', color: 'var(--g-text-muted)', fontSize: fontVars.sm }}>
                    {t('obstaclePlanIntro')}
                  </p>
                </div>

                {generatedCards.map((card, i) => {
                  // LLM may return an obstacleType outside the 6 known keys — fall back so it never crashes.
                  const meta = obstacleInfo(card.obstacleType);
                  return (
                  <div key={i} style={panelStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: fontVars.sm, padding: '2px 8px', borderRadius: 999, background: meta.color + '22', color: meta.color }}>
                        {meta.icon} {meta.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <span style={{ color: 'var(--g-warning, #f59e0b)', fontSize: fontVars.sm, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('ifLabel')}</span>
                        <p style={{ margin: 0, color: 'var(--g-text-mid)', fontSize: fontVars.sm }}>{card.ifCondition}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <span style={{ color: 'var(--g-accent)', fontSize: fontVars.sm, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('thenLabel')}</span>
                        <p style={{ margin: 0, color: 'var(--g-text)', fontSize: fontVars.sm, fontWeight: 500 }}>{card.thenAction}</p>
                      </div>
                    </div>
                  </div>
                  );
                })}

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" onClick={() => setStep('structure')} style={ghostBtnStyle()}>
                    <ArrowLeft className="w-3 h-3" /> {t('back')}
                  </button>
                  <button type="button" onClick={handleFinalComplete} style={primaryCta()}>
                    <Check className="w-4 h-4" /> {t('confirmStart')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
