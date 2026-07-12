'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Clock, Star, ChevronRight, ArrowRightFromLine, XCircle } from 'lucide-react';
import type { Task } from './types';
import { ENERGY_LABELS, FEELING_LABELS } from './types';
import CheckInModal from './CheckInModal';

interface Props {
  tasks: Task[];
  onCheckIn: (taskId: string, status: string, data?: Record<string, unknown>) => void;
  onPostpone?: (taskId: string) => void;
  onAbandon?: (taskId: string) => void;
}

export default function TodayTaskList({ tasks, onCheckIn, onPostpone, onAbandon }: Props) {
  const [checkInTask, setCheckInTask] = useState<Task | null>(null);

  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const skippedTasks = tasks.filter(t => t.status === 'skipped' || t.status === 'postponed');

  const handleQuickComplete = useCallback((task: Task) => {
    setCheckInTask(task);
  }, []);

  const handleCheckInSubmit = useCallback((status: string, data?: Record<string, unknown>) => {
    if (checkInTask) {
      onCheckIn(checkInTask.id, status, data);
      setCheckInTask(null);
    }
  }, [checkInTask, onCheckIn]);

  return (
    <div className="space-y-6">
      {/* Pending Tasks */}
      {pendingTasks.length > 0 && (
        <div>
          <h3 className="text-[length:var(--g-text-sm)] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            待完成 ({pendingTasks.length})
          </h3>
          <div className="space-y-2">
            {pendingTasks.map((task, i) => (
              <TaskRow
                key={task.id}
                task={task}
                index={i}
                onComplete={() => handleQuickComplete(task)}
                onPostpone={onPostpone ? () => onPostpone(task.id) : undefined}
                onAbandon={onAbandon ? () => onAbandon(task.id) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div>
          <h3 className="text-[length:var(--g-text-sm)] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            已完成 ({completedTasks.length})
          </h3>
          <div className="space-y-2">
            {completedTasks.map((task, i) => (
              <TaskRow key={task.id} task={task} index={i} completed />
            ))}
          </div>
        </div>
      )}

      {/* Skipped / Postponed */}
      {skippedTasks.length > 0 && (
        <div>
          <h3 className="text-[length:var(--g-text-sm)] font-semibold text-slate-500 uppercase tracking-wider mb-3">
            已顺延/跳过 ({skippedTasks.length})
          </h3>
          <div className="space-y-2">
            {skippedTasks.map((task, i) => (
              <TaskRow key={task.id} task={task} index={i} dimmed />
            ))}
          </div>
        </div>
      )}

      {/* Check In Modal */}
      <AnimatePresence>
        {checkInTask && (
          <CheckInModal
            task={checkInTask}
            onSubmit={handleCheckInSubmit}
            onClose={() => setCheckInTask(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TaskRow({ task, index, completed, dimmed, onComplete, onPostpone, onAbandon }: {
  task: Task;
  index: number;
  completed?: boolean;
  dimmed?: boolean;
  onComplete?: () => void;
  onPostpone?: () => void;
  onAbandon?: () => void;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
        task.isMIT && !completed
          ? 'bg-violet-500/10 border-violet-500/30 ring-1 ring-violet-500/20'
          : completed
          ? 'bg-slate-800/20 border-slate-700/30'
          : dimmed
          ? 'bg-slate-800/10 border-slate-700/20 opacity-50'
          : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'
      }`}
    >
      {/* Complete Button */}
      {onComplete && !completed && !dimmed && (
        <button
          onClick={onComplete}
          className="w-6 h-6 rounded-full border-2 border-slate-600 hover:border-emerald-400 hover:bg-emerald-400/10 flex items-center justify-center transition-colors flex-shrink-0"
        >
          <Check className="w-3 h-3 text-transparent hover:text-emerald-400" />
        </button>
      )}
      {completed && (
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Check className="w-3 h-3 text-emerald-400" />
        </div>
      )}
      {dimmed && (
        <div className="w-6 h-6 rounded-full bg-slate-700/50 flex items-center justify-center flex-shrink-0">
          <ArrowRightFromLine className="w-3 h-3 text-slate-500" />
        </div>
      )}

      {/* MIT Star */}
      {task.isMIT && (
        <Star className="w-4 h-4 text-violet-400 fill-violet-400 flex-shrink-0" />
      )}

      {/* Task Info */}
      <div className="flex-1 min-w-0">
        <p className={`text-[length:var(--g-text-base)] truncate ${completed ? 'line-through text-slate-500' : dimmed ? 'text-slate-500' : 'text-white'}`}>
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {task.goalTitle && <span className="text-[length:var(--g-text-sm)] text-slate-500">{task.goalTitle}</span>}
          {completed && task.feelingTag && (
            <span className="text-[length:var(--g-text-sm)] text-slate-500">
              {FEELING_LABELS[task.feelingTag].icon} {FEELING_LABELS[task.feelingTag].label}
            </span>
          )}
        </div>
      </div>

      {/* Duration */}
      {task.estimatedDuration && (
        <span className="text-[length:var(--g-text-sm)] text-slate-500 flex items-center gap-0.5 flex-shrink-0">
          <Clock className="w-3 h-3" />
          {task.estimatedDuration}m
        </span>
      )}

      {/* Energy */}
      {!completed && !dimmed && (
        <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded flex-shrink-0" style={{
          backgroundColor: ENERGY_LABELS[task.energyLevel].color + '20',
          color: ENERGY_LABELS[task.energyLevel].color,
        }}>
          {ENERGY_LABELS[task.energyLevel].label}
        </span>
      )}

      {/* Actions */}
      {!completed && !dimmed && (onPostpone || onAbandon) && (
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1 hover:bg-slate-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ChevronRight className="w-4 h-4 text-slate-500" />
          </button>
          {showActions && (
            <div className="absolute right-0 top-8 w-32 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 py-1">
              {onPostpone && (
                <button onClick={() => { onPostpone(); setShowActions(false); }} className="w-full px-3 py-2 text-left text-[length:var(--g-text-sm)] text-slate-300 hover:bg-slate-700 flex items-center gap-2">
                  <ArrowRightFromLine className="w-3 h-3" /> 顺延
                </button>
              )}
              {onAbandon && (
                <button onClick={() => { onAbandon(); setShowActions(false); }} className="w-full px-3 py-2 text-left text-[length:var(--g-text-sm)] text-red-400 hover:bg-slate-700 flex items-center gap-2">
                  <XCircle className="w-3 h-3" /> 放弃
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
