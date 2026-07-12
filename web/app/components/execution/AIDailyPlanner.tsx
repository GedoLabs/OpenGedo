'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Brain, ClipboardList, RefreshCw, Check, ChevronRight, AlertTriangle, Zap, Clock, Target, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';

// AI 规划来源
export interface PlanSource {
  type: 'profile' | 'memory' | 'review' | 'goal' | 'extracted_task';
  label: string;
  content: string;
  icon: string;
}

// AI 规划的单个任务
export interface PlannedTask {
  id: string;
  title: string;
  description?: string;
  timeSlot: string; // "09:00-10:00"
  priority: 'high' | 'medium' | 'low';
  energyRequired: 'high' | 'medium' | 'low';
  source: PlanSource;
  isMIT: boolean;
  estimatedMinutes: number;
  reasoning: string; // AI 排此任务的原因
}

// 每日 AI 规划
export interface DailyPlan {
  date: string;
  generatedAt: string;
  plannerVersion: string;
  tasks: PlannedTask[];
  sources: PlanSource[];
  totalMinutes: number;
  adjustmentNote?: string; // 基于复盘的调整说明
  energyForecast: 'high' | 'medium' | 'low';
}

// Mock: 生成每日 AI 规划
function generateMockDailyPlan(): DailyPlan {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const sources: PlanSource[] = [
    { type: 'profile', label: '个人画像', content: '擅长上午处理复杂任务，下午适合创意工作', icon: '🧠' },
    { type: 'review', label: '昨日复盘', content: '昨日深度工作时间不足，需增加专注时段', icon: '📊' },
    { type: 'memory', label: '记忆提取', content: '最近在学习 AI 产品设计，需要持续练习', icon: '💡' },
    { type: 'extracted_task', label: '对话提取', content: '和智伴对话中提到需要完成项目报告', icon: '💬' },
    { type: 'goal', label: '目标关联', content: 'OKR：本季度完成个人作品集（进度 45%）', icon: '🎯' },
  ];

  const tasks: PlannedTask[] = [
    {
      id: 'pt-1',
      title: '深度工作：完成项目报告初稿',
      description: '根据昨日复盘，优先安排深度工作时间',
      timeSlot: '09:00-11:00',
      priority: 'high',
      energyRequired: 'high',
      source: sources[3],
      isMIT: true,
      estimatedMinutes: 120,
      reasoning: '从对话中提取的待办 + 昨日复盘建议增加深度工作时段 → 安排在精力最充沛的上午',
    },
    {
      id: 'pt-2',
      title: 'AI 产品设计学习 - 案例分析',
      description: '学习 3 个优秀的 AI 产品案例',
      timeSlot: '11:00-12:00',
      priority: 'medium',
      energyRequired: 'medium',
      source: sources[2],
      isMIT: false,
      estimatedMinutes: 60,
      reasoning: '记忆系统中显示你最近在学习 AI 产品设计 → 保持每日学习节奏',
    },
    {
      id: 'pt-3',
      title: '午间运动：散步 20 分钟',
      description: '恢复精力，为下午准备',
      timeSlot: '12:30-13:00',
      priority: 'medium',
      energyRequired: 'low',
      source: sources[0],
      isMIT: false,
      estimatedMinutes: 30,
      reasoning: '个人画像：需要运动恢复 → 午间低强度活动',
    },
    {
      id: 'pt-4',
      title: '作品集设计：完成首页布局',
      description: '推进 OKR 季度目标',
      timeSlot: '14:00-15:30',
      priority: 'high',
      energyRequired: 'medium',
      source: sources[4],
      isMIT: false,
      estimatedMinutes: 90,
      reasoning: 'OKR 进度 45%，需加速推进 → 安排在下午创意时段',
    },
    {
      id: 'pt-5',
      title: '回顾今日学习笔记 + 整理',
      description: '巩固知识，记录到智忆系统',
      timeSlot: '16:00-16:30',
      priority: 'low',
      energyRequired: 'low',
      source: sources[2],
      isMIT: false,
      estimatedMinutes: 30,
      reasoning: '每日知识巩固 → 安排在精力下降时段',
    },
  ];

  return {
    date: today,
    generatedAt: now.toISOString(),
    plannerVersion: 'v0.1-mock',
    tasks,
    sources,
    totalMinutes: tasks.reduce((acc, t) => acc + t.estimatedMinutes, 0),
    adjustmentNote: '基于昨日复盘：深度工作时间提升了30分钟，减少了碎片任务安排。',
    energyForecast: 'medium',
  };
}

interface Props {
  onAcceptPlan: (tasks: PlannedTask[]) => void;
  onRegenerate: () => void;
  lastReviewNote?: string;
}

export default function AIDailyPlanner({ onAcceptPlan, onRegenerate, lastReviewNote }: Props) {
  const { api } = useAuth();
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const generatePlan = useCallback(async () => {
    setIsGenerating(true);
    try {
      const result = await api.generateDailyPlan();
      const now = new Date();
      const tasks: PlannedTask[] = (result.tasks || []).map((t: any, i: number) => ({
        id: t.id || `pt-${i}`,
        title: t.title,
        description: t.description || '',
        timeSlot: t.timeSlot || t.time_slot || '09:00-10:00',
        priority: t.priority || 'medium',
        energyRequired: t.energyRequired || t.energy_required || 'medium',
        source: {
          type: t.sourceType || t.source_type || 'goal',
          label: t.sourceLabel || t.source_label || '目标',
          content: t.reasoning || '',
          icon: t.sourceType === 'memory' ? '💡' : t.sourceType === 'review' ? '📊' : t.sourceType === 'habit' ? '🔄' : '🎯',
        },
        isMIT: t.isMIT ?? t.is_mit ?? (i === 0),
        estimatedMinutes: t.estimatedMinutes || t.estimated_minutes || 60,
        reasoning: t.reasoning || '基于目标和画像推荐',
      }));
      const newPlan: DailyPlan = {
        date: now.toISOString().split('T')[0],
        generatedAt: now.toISOString(),
        plannerVersion: 'v1-api',
        tasks,
        sources: [],
        totalMinutes: tasks.reduce((acc, t) => acc + t.estimatedMinutes, 0),
        adjustmentNote: result.adjustmentNote || result.adjustment_note,
        energyForecast: (result.energyForecast || result.energy_forecast || 'medium') as 'high' | 'medium' | 'low',
      };
      setPlan(newPlan);
      setSelectedTasks(new Set(newPlan.tasks.map(t => t.id)));
    } catch {
      const fallback = generateMockDailyPlan();
      setPlan(fallback);
      setSelectedTasks(new Set(fallback.tasks.map(t => t.id)));
    }
    setIsGenerating(false);
  }, [api]);

  useEffect(() => {
    generatePlan();
  }, [generatePlan]);

  const toggleTask = (taskId: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleAccept = () => {
    if (!plan) return;
    const accepted = plan.tasks.filter(t => selectedTasks.has(t.id));
    onAcceptPlan(accepted);
  };

  const priorityColors = {
    high: 'text-red-400 bg-red-500/10 border-red-500/20',
    medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    low: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  };

  const energyIcons = { high: '🔥', medium: '⚡', low: '🌿' };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-400" />
          <h3 className="text-lg font-bold text-white">AI 智能规划</h3>
        </div>
        <button
          onClick={() => { generatePlan(); onRegenerate(); }}
          disabled={isGenerating}
          className="flex items-center gap-1 px-3 py-1.5 text-[length:var(--g-text-sm)] rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
          重新规划
        </button>
      </div>

      {/* Generating State */}
      {isGenerating && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-8 rounded-xl bg-gradient-to-br from-violet-500/10 to-cyan-500/10 border border-violet-500/20 text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="w-12 h-12 mx-auto mb-3 rounded-full border-2 border-violet-400/30 border-t-violet-400"
          />
          <p className="text-[length:var(--g-text-base)] text-violet-300 mb-1">AI 正在分析你的画像和记忆...</p>
          <p className="text-[length:var(--g-text-sm)] text-slate-500">综合个人画像 + 记忆系统 + 昨日复盘</p>
        </motion.div>
      )}

      {/* Plan Content */}
      {plan && !isGenerating && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Adjustment Note */}
            {plan.adjustmentNote && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[length:var(--g-text-sm)] font-medium text-amber-400">复盘驱动调整</p>
                  <p className="text-[length:var(--g-text-sm)] text-amber-300/80 mt-0.5">{plan.adjustmentNote}</p>
                </div>
              </div>
            )}

            {/* Sources Toggle */}
            <button
              onClick={() => setShowSources(!showSources)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-800/60 transition-colors"
            >
              <span className="text-[length:var(--g-text-sm)] text-slate-400 flex items-center gap-1">
                <Brain className="w-3.5 h-3.5" />
                规划依据 ({plan.sources.length} 个来源)
              </span>
              {showSources ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
            </button>

            <AnimatePresence>
              {showSources && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid gap-2 p-3 rounded-lg bg-slate-900/50">
                    {plan.sources.map((src, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-[length:var(--g-text-base)]">{src.icon}</span>
                        <div>
                          <span className="text-[length:var(--g-text-sm)] font-medium text-slate-400">{src.label}</span>
                          <p className="text-[length:var(--g-text-sm)] text-slate-300">{src.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Plan Summary */}
            <div className="flex gap-3">
              <div className="flex-1 p-2 rounded-lg bg-slate-800/40 text-center">
                <p className="text-lg font-bold text-white">{plan.tasks.length}</p>
                <p className="text-[length:var(--g-text-sm)] text-slate-500">任务数</p>
              </div>
              <div className="flex-1 p-2 rounded-lg bg-slate-800/40 text-center">
                <p className="text-lg font-bold text-white">{Math.round(plan.totalMinutes / 60)}h{plan.totalMinutes % 60 > 0 ? `${plan.totalMinutes % 60}m` : ''}</p>
                <p className="text-[length:var(--g-text-sm)] text-slate-500">预估时长</p>
              </div>
              <div className="flex-1 p-2 rounded-lg bg-slate-800/40 text-center">
                <p className="text-lg font-bold text-white">{energyIcons[plan.energyForecast]}</p>
                <p className="text-[length:var(--g-text-sm)] text-slate-500">能量预估</p>
              </div>
            </div>

            {/* Task List */}
            <div className="space-y-2">
              {plan.tasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`rounded-xl border transition-colors cursor-pointer ${
                    selectedTasks.has(task.id)
                      ? task.isMIT
                        ? 'bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border-violet-500/30'
                        : 'bg-slate-800/50 border-slate-700/50'
                      : 'bg-slate-900/30 border-slate-800/30 opacity-50'
                  }`}
                >
                  <div
                    className="flex items-start gap-3 p-3"
                    onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                  >
                    {/* Selection checkbox */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleTask(task.id); }}
                      className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                        selectedTasks.has(task.id) ? 'bg-violet-500 text-white' : 'border border-slate-600'
                      }`}
                    >
                      {selectedTasks.has(task.id) && <Check className="w-3 h-3" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {task.isMIT && (
                          <span className="px-1.5 py-0.5 text-[length:var(--g-text-sm)] font-bold rounded bg-violet-500/20 text-violet-400">MIT</span>
                        )}
                        <span className={`px-1.5 py-0.5 text-[length:var(--g-text-sm)] rounded border ${priorityColors[task.priority]}`}>
                          {task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}
                        </span>
                        <span className="text-[length:var(--g-text-sm)] text-slate-500">{energyIcons[task.energyRequired]}</span>
                      </div>
                      <p className="text-[length:var(--g-text-base)] font-medium text-white">{task.title}</p>
                      {task.description && <p className="text-[length:var(--g-text-sm)] text-slate-400 mt-0.5">{task.description}</p>}
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="flex items-center gap-1 text-[length:var(--g-text-sm)] text-slate-400">
                        <Clock className="w-3 h-3" />
                        {task.timeSlot}
                      </div>
                      <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-0.5">{task.estimatedMinutes}min</p>
                    </div>
                  </div>

                  {/* Expanded: AI Reasoning */}
                  <AnimatePresence>
                    {expandedTask === task.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-3 pt-0 border-t border-slate-700/30 mt-1">
                          <div className="flex items-start gap-2 mt-2">
                            <Sparkles className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[length:var(--g-text-sm)] font-medium text-violet-400 mb-0.5">AI 排期理由</p>
                              <p className="text-[length:var(--g-text-sm)] text-slate-300">{task.reasoning}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 mt-2">
                            <span className="text-[length:var(--g-text-base)]">{task.source.icon}</span>
                            <span className="text-[length:var(--g-text-sm)] text-slate-500">来源：{task.source.label}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>

            {/* Accept Button */}
            <div className="flex gap-2">
              <button
                onClick={handleAccept}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium hover:from-violet-500 hover:to-cyan-500 transition-all"
              >
                <Zap className="w-4 h-4" />
                确认规划 ({selectedTasks.size}/{plan.tasks.length})
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
