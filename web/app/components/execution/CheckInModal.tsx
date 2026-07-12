'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Check, ArrowRight, Clock } from 'lucide-react';
import type { Task, ReasonCode } from './types';
import { REASON_LABELS, FEELING_LABELS } from './types';

interface Props {
  task: Task;
  onSubmit: (status: string, data?: Record<string, unknown>) => void;
  onClose: () => void;
}

type Step = 'status' | 'feeling' | 'reason' | 'duration';

export default function CheckInModal({ task, onSubmit, onClose }: Props) {
  const [step, setStep] = useState<Step>('status');
  const [status, setStatus] = useState<'completed' | 'not_completed' | 'partial' | null>(null);
  const [feelingTag, setFeelingTag] = useState<'smooth' | 'challenging' | 'struggling' | null>(null);
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  const [actualDuration, setActualDuration] = useState(task.estimatedDuration || 30);

  const handleSelectStatus = useCallback((s: 'completed' | 'not_completed' | 'partial') => {
    setStatus(s);
    if (s === 'completed') {
      setStep('feeling');
    } else {
      setStep('reason');
    }
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(status === 'completed' ? 'completed' : status === 'partial' ? 'partial' : 'not_completed', {
      feelingTag,
      reasonCode,
      reasonNote,
      actualDuration,
      triggerObstacleMatch: status !== 'completed',
    });
  }, [status, feelingTag, reasonCode, reasonNote, actualDuration, onSubmit]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold text-[length:var(--g-text-base)]">任务打卡</h3>
            <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-0.5 truncate max-w-[250px]">{task.title}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="px-5 py-5">
          {/* Step: Status Selection */}
          {step === 'status' && (
            <div className="space-y-3">
              <p className="text-[length:var(--g-text-base)] text-slate-300 text-center mb-4">完成情况</p>
              <button
                onClick={() => handleSelectStatus('completed')}
                className="w-full p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 hover:bg-emerald-500/10 transition-colors text-left"
              >
                <p className="text-emerald-400 font-medium">完成</p>
                <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-0.5">已完成此任务</p>
              </button>
              <button
                onClick={() => handleSelectStatus('partial')}
                className="w-full p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 hover:bg-amber-500/10 transition-colors text-left"
              >
                <p className="text-amber-400 font-medium">部分完成</p>
                <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-0.5">做了一部分，但未全部完成</p>
              </button>
              <button
                onClick={() => handleSelectStatus('not_completed')}
                className="w-full p-4 rounded-xl bg-red-500/5 border border-red-500/20 hover:bg-red-500/10 transition-colors text-left"
              >
                <p className="text-red-400 font-medium">未完成</p>
                <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-0.5">今天没有做这件事</p>
              </button>
            </div>
          )}

          {/* Step: Feeling Tag (completed) */}
          {step === 'feeling' && (
            <div className="space-y-4">
              <p className="text-[length:var(--g-text-base)] text-slate-300 text-center">完成时的感受</p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(FEELING_LABELS) as Array<'smooth' | 'challenging' | 'struggling'>).map(tag => {
                  const info = FEELING_LABELS[tag];
                  const selected = feelingTag === tag;
                  return (
                    <button
                      key={tag}
                      onClick={() => setFeelingTag(tag)}
                      className={`py-4 rounded-xl text-center transition-colors ${
                        selected
                          ? 'bg-emerald-500/20 border border-emerald-500/40'
                          : 'bg-slate-800/30 border border-slate-700/50 hover:border-slate-600'
                      }`}
                    >
                      <span className="text-2xl block mb-1">{info.icon}</span>
                      <span className={`text-[length:var(--g-text-sm)] ${selected ? 'text-emerald-300' : 'text-slate-400'}`}>{info.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[length:var(--g-text-sm)] text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> 实际用时</span>
                <input
                  type="range"
                  min={5}
                  max={180}
                  step={5}
                  value={actualDuration}
                  onChange={e => setActualDuration(Number(e.target.value))}
                  className="flex-1 accent-emerald-400"
                />
                <span className="text-[length:var(--g-text-sm)] text-white w-12 text-right">{actualDuration}m</span>
              </div>
              <button
                onClick={handleSubmit}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> 确认打卡
              </button>
            </div>
          )}

          {/* Step: Reason (not completed / partial) */}
          {step === 'reason' && (
            <div className="space-y-4">
              <p className="text-[length:var(--g-text-base)] text-slate-300 text-center">
                {status === 'partial' ? '什么阻碍了你完成剩余部分？' : '什么阻碍了你？'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(REASON_LABELS) as ReasonCode[]).map(code => {
                  const info = REASON_LABELS[code];
                  const selected = reasonCode === code;
                  return (
                    <button
                      key={code}
                      onClick={() => setReasonCode(code)}
                      className={`px-3 py-3 rounded-xl text-[length:var(--g-text-base)] transition-colors flex items-center gap-2 ${
                        selected
                          ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                          : 'bg-slate-800/30 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600'
                      }`}
                    >
                      <span>{info.icon}</span>
                      <span>{info.label}</span>
                    </button>
                  );
                })}
              </div>
              <textarea
                value={reasonNote}
                onChange={e => setReasonNote(e.target.value)}
                placeholder="补充说明（可选）"
                className="w-full h-16 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white text-[length:var(--g-text-base)] placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
              />
              <button
                onClick={() => setStep('duration')}
                disabled={!reasonCode}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                下一步 <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step: Duration (for non-complete) */}
          {step === 'duration' && (
            <div className="space-y-4">
              <p className="text-[length:var(--g-text-base)] text-slate-300 text-center">实际花了多少时间？</p>
              <div className="flex items-center gap-3">
                <span className="text-[length:var(--g-text-sm)] text-slate-500">0m</span>
                <input
                  type="range"
                  min={0}
                  max={180}
                  step={5}
                  value={actualDuration}
                  onChange={e => setActualDuration(Number(e.target.value))}
                  className="flex-1 accent-amber-400"
                />
                <span className="text-[length:var(--g-text-base)] text-white font-medium w-12 text-right">{actualDuration}m</span>
              </div>
              <div className="rounded-lg bg-slate-800/30 border border-slate-700/50 p-3">
                <p className="text-[length:var(--g-text-sm)] text-slate-500">
                  系统将根据原因自动触发障碍比对，帮你匹配已有的 If-Then 应对方案
                </p>
              </div>
              <button
                onClick={handleSubmit}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> 确认并触发障碍比对
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
