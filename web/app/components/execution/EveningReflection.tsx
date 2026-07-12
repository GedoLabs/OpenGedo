'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon, ArrowRight, Check, MessageSquare } from 'lucide-react';
import type { Reflection, ReasonCode, ECSScore } from './types';
import { REASON_LABELS, ADJUSTMENT_TAG_LABELS, getECSLevel } from './types';

interface Props {
  todayECS: ECSScore;
  onComplete: (reflection: Omit<Reflection, 'id' | 'createdAt'>) => void;
}

type Step = 'q1' | 'q2' | 'q3' | 'done';

export default function EveningReflection({ todayECS, onComplete }: Props) {
  const [step, setStep] = useState<Step>('q1');
  const [q1Tag, setQ1Tag] = useState<ReasonCode | null>(null);
  const [q2Text, setQ2Text] = useState('');
  const [q3Tag, setQ3Tag] = useState<Reflection['q3AdjustmentTag'] | null>(null);

  const ecsLevel = getECSLevel(todayECS.total);

  const handleSubmit = useCallback(() => {
    onComplete({
      date: new Date().toISOString().split('T')[0],
      q1ObstacleTag: q1Tag,
      q2MostValuable: q2Text,
      q3AdjustmentTag: q3Tag || 'no_change',
      ecsScore: todayECS,
    });
    setStep('done');
  }, [q1Tag, q2Text, q3Tag, todayECS, onComplete]);

  const reasonOptions = (Object.keys(REASON_LABELS) as ReasonCode[]).filter(k => k !== 'forgot');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Moon className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-bold text-white">晚间反思</h2>
          <span className="text-[length:var(--g-text-sm)] text-slate-500">30 秒三问</span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-slate-400 text-[length:var(--g-text-base)]">今日 ECS</p>
          <span className="text-2xl font-bold" style={{ color: ecsLevel.color }}>{todayECS.total}</span>
          <span className="text-[length:var(--g-text-sm)] px-2 py-0.5 rounded-full" style={{ backgroundColor: ecsLevel.color + '20', color: ecsLevel.color }}>
            {ecsLevel.label}
          </span>
        </div>
      </div>

      {/* Progress Dots */}
      <div className="flex justify-center gap-2">
        {(['q1', 'q2', 'q3'] as Step[]).map((s, i) => (
          <div
            key={s}
            className={`w-2 h-2 rounded-full transition-colors ${
              step === 'done' || (['q1', 'q2', 'q3'].indexOf(step) > i)
                ? 'bg-indigo-400'
                : step === s
                ? 'bg-indigo-400 ring-2 ring-indigo-400/30'
                : 'bg-slate-700'
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Q1: 最大阻碍 */}
        {step === 'q1' && (
          <motion.div key="q1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="text-center">
              <p className="text-white font-medium mb-1">今天遇到的最大阻碍是什么？</p>
              <p className="text-[length:var(--g-text-sm)] text-slate-500">选择最符合的标签</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {reasonOptions.map(code => {
                const info = REASON_LABELS[code];
                const selected = q1Tag === code;
                return (
                  <button
                    key={code}
                    onClick={() => setQ1Tag(code)}
                    className={`px-3 py-3 rounded-xl text-[length:var(--g-text-base)] transition-colors flex items-center gap-2 ${
                      selected
                        ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300'
                        : 'bg-slate-800/30 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600'
                    }`}
                  >
                    <span>{info.icon}</span>
                    <span>{info.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setStep('q2')}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              下一题 <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Q2: 最有价值 */}
        {step === 'q2' && (
          <motion.div key="q2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="text-center">
              <p className="text-white font-medium mb-1">今天最有价值的一件事是？</p>
              <p className="text-[length:var(--g-text-sm)] text-slate-500">限 50 字，存入成长故事线</p>
            </div>
            <div className="relative">
              <textarea
                value={q2Text}
                onChange={e => e.target.value.length <= 50 && setQ2Text(e.target.value)}
                placeholder="今天我..."
                className="w-full h-24 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
              <span className="absolute bottom-3 right-3 text-[length:var(--g-text-sm)] text-slate-500">{q2Text.length}/50</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('q1')} className="px-4 py-2.5 text-[length:var(--g-text-base)] text-slate-400 border border-slate-700 rounded-xl hover:text-white transition-colors">
                上一题
              </button>
              <button
                onClick={() => setStep('q3')}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                下一题 <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Q3: 明天调整 */}
        {step === 'q3' && (
          <motion.div key="q3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="text-center">
              <p className="text-white font-medium mb-1">明天需要调整什么？</p>
              <p className="text-[length:var(--g-text-sm)] text-slate-500">影响明日 AI 任务推荐权重</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(ADJUSTMENT_TAG_LABELS) as [Reflection['q3AdjustmentTag'], string][]).map(([tag, label]) => {
                const selected = q3Tag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => setQ3Tag(tag)}
                    className={`px-3 py-3 rounded-xl text-[length:var(--g-text-base)] transition-colors ${
                      selected
                        ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300'
                        : 'bg-slate-800/30 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('q2')} className="px-4 py-2.5 text-[length:var(--g-text-base)] text-slate-400 border border-slate-700 rounded-xl hover:text-white transition-colors">
                上一题
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> 完成今日反思
              </button>
            </div>
          </motion.div>
        )}

        {/* Done */}
        {step === 'done' && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8 space-y-3">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-white font-semibold">今日反思已完成</h3>
            <p className="text-slate-400 text-[length:var(--g-text-base)]">
              今日 ECS: <span className="font-bold" style={{ color: ecsLevel.color }}>{todayECS.total}</span> · {ecsLevel.label}
            </p>
            {q2Text && (
              <div className="rounded-lg bg-slate-800/30 border border-slate-700/50 p-3 mx-auto max-w-sm">
                <p className="text-[length:var(--g-text-sm)] text-slate-500 mb-1 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> 今日最有价值</p>
                <p className="text-white text-[length:var(--g-text-base)]">{q2Text}</p>
              </div>
            )}
            <p className="text-[length:var(--g-text-sm)] text-slate-500">障碍命中率已更新 · 晚安</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
