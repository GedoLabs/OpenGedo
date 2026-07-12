'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Star, Plus, AlertTriangle, Check, X, Clock, Zap } from 'lucide-react';
import type { Task } from './types';
import { ENERGY_LABELS } from './types';
import type { IfThenCard } from '../obstacles/types';
import IfThenCardComponent from '../obstacles/IfThenCard';

interface Props {
  suggestedTasks: Task[];
  obstacleReminders: IfThenCard[];
  onConfirmPlan: (tasks: Task[]) => void;
}

export default function MorningPlan({ suggestedTasks, obstacleReminders, onConfirmPlan }: Props) {
  const [tasks, setTasks] = useState<Task[]>(suggestedTasks);
  const [mitId, setMitId] = useState<string | null>(suggestedTasks.find(t => t.isMIT)?.id || null);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const totalDuration = tasks.reduce((sum, t) => sum + (t.estimatedDuration || 0), 0);
  const isOverloaded = tasks.length > 5;

  const handleToggleTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  const handleSetMIT = useCallback((taskId: string) => {
    setMitId(taskId);
    setTasks(prev => prev.map(t => ({ ...t, isMIT: t.id === taskId })));
  }, []);

  const handleAddTask = useCallback(() => {
    if (!newTitle.trim()) return;
    const newTask: Task = {
      id: `new-${Date.now()}`,
      title: newTitle.trim(),
      estimatedDuration: 30,
      energyLevel: 'medium',
      priority: 3,
      status: 'pending',
      scheduledDate: new Date().toISOString().split('T')[0],
      isMIT: false,
    };
    setTasks(prev => [...prev, newTask]);
    setNewTitle('');
    setShowAdd(false);
  }, [newTitle]);

  const handleConfirm = useCallback(() => {
    if (!mitId) return;
    onConfirmPlan(tasks.map(t => ({ ...t, isMIT: t.id === mitId })));
  }, [mitId, tasks, onConfirmPlan]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sun className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold text-white">晨间计划</h2>
        </div>
        <p className="text-slate-400 text-[length:var(--g-text-base)]">AI 为你推荐了 {tasks.length} 项任务，请选出今日 MIT（最重要一件事）</p>
      </div>

      {/* Overload Warning */}
      {isOverloaded && (
        <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-red-400 text-[length:var(--g-text-base)]">计划过载：当前 {tasks.length} 项任务超出建议上限（5项），建议裁剪</p>
        </div>
      )}

      {/* MIT Selection Prompt */}
      {!mitId && (
        <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3 flex items-center gap-2">
          <Star className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <p className="text-violet-400 text-[length:var(--g-text-base)]">请点击星标选出今日 MIT — 即使其他全部失败，MIT 完成 = 今日不算失败</p>
        </div>
      )}

      {/* Task List */}
      <div className="space-y-2">
        {tasks.map((task, i) => {
          const isMIT = task.id === mitId;
          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                isMIT
                  ? 'bg-violet-500/10 border-violet-500/30'
                  : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'
              }`}
            >
              {/* MIT Star */}
              <button
                onClick={() => handleSetMIT(task.id)}
                className={`flex-shrink-0 transition-colors ${isMIT ? 'text-violet-400' : 'text-slate-600 hover:text-slate-400'}`}
              >
                <Star className={`w-5 h-5 ${isMIT ? 'fill-violet-400' : ''}`} />
              </button>

              {/* Task Info */}
              <div className="flex-1 min-w-0">
                <p className={`text-[length:var(--g-text-base)] truncate ${isMIT ? 'text-white font-semibold' : 'text-slate-300'}`}>
                  {task.title}
                </p>
                {task.goalTitle && (
                  <p className="text-[length:var(--g-text-sm)] text-slate-500">{task.goalTitle}</p>
                )}
              </div>

              {/* Duration */}
              {task.estimatedDuration && (
                <span className="text-[length:var(--g-text-sm)] text-slate-500 flex items-center gap-1 flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  {task.estimatedDuration}m
                </span>
              )}

              {/* Energy */}
              <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded" style={{ backgroundColor: ENERGY_LABELS[task.energyLevel].color + '20', color: ENERGY_LABELS[task.energyLevel].color }}>
                {ENERGY_LABELS[task.energyLevel].label}
              </span>

              {/* Remove */}
              <button onClick={() => handleToggleTask(task.id)} className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </div>

      {/* Add Task */}
      {showAdd ? (
        <div className="flex items-center gap-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddTask()}
            placeholder="输入新任务..."
            className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-lg text-white text-[length:var(--g-text-base)] placeholder-slate-500 focus:outline-none focus:border-violet-500"
            autoFocus
          />
          <button onClick={handleAddTask} className="px-3 py-2 bg-violet-600 text-white rounded-lg text-[length:var(--g-text-base)]"><Check className="w-4 h-4" /></button>
          <button onClick={() => { setShowAdd(false); setNewTitle(''); }} className="px-3 py-2 text-slate-400 rounded-lg text-[length:var(--g-text-base)]"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="w-full py-2.5 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 transition-colors flex items-center justify-center gap-2 text-[length:var(--g-text-base)]">
          <Plus className="w-4 h-4" /> 新增任务
        </button>
      )}

      {/* Summary */}
      <div className="flex items-center justify-between text-[length:var(--g-text-sm)] text-slate-500 px-1">
        <span>{tasks.length} 项任务 · 预计 {totalDuration} 分钟</span>
        {mitId && <span className="text-violet-400">MIT: {tasks.find(t => t.id === mitId)?.title}</span>}
      </div>

      {/* Obstacle Reminders */}
      {obstacleReminders.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[length:var(--g-text-sm)] text-slate-500 font-medium">历史障碍提醒</h4>
          {obstacleReminders.map(card => (
            <IfThenCardComponent key={card.id} card={card} compact />
          ))}
        </div>
      )}

      {/* Confirm Button */}
      <button
        onClick={handleConfirm}
        disabled={!mitId}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
      >
        <Zap className="w-4 h-4" />
        {mitId ? '确认今日计划，开始执行' : '请先选择 MIT'}
      </button>
    </motion.div>
  );
}
