'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Check, X, Split, Calendar, Trash2 } from 'lucide-react';
import { Adjustment, Task, ReasonCode, REASON_LABELS } from './types';

interface AdjustmentSuggestionProps {
  adjustment: Adjustment;
  originalTask: Task;
  onAccept: (adjustment: Adjustment, option?: string) => void;
  onReject: (adjustment: Adjustment) => void;
  onDismiss: () => void;
}

export const AdjustmentSuggestion = ({
  adjustment,
  originalTask,
  onAccept,
  onReject,
  onDismiss,
}: AdjustmentSuggestionProps) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const getAdjustmentIcon = () => {
    switch (adjustment.adjustmentType) {
      case 'split':
        return <Split size={20} />;
      case 'reschedule':
      case 'postpone':
        return <Calendar size={20} />;
      case 'cancel':
        return <Trash2 size={20} />;
      default:
        return <Sparkles size={20} />;
    }
  };

  const getAdjustmentTitle = () => {
    switch (adjustment.adjustmentType) {
      case 'split':
        return '建议拆分任务';
      case 'reschedule':
        return '建议重新安排';
      case 'postpone':
        return '建议顺延任务';
      case 'cancel':
        return '建议取消任务';
      default:
        return '调整建议';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4"
    >
      {/* 头部 */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center text-blue-400">
            {getAdjustmentIcon()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-blue-400" />
              <span className="text-[length:var(--g-text-base)] text-blue-400">AI 建议</span>
            </div>
            <h4 className="text-white font-medium">{getAdjustmentTitle()}</h4>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* 原因说明 */}
      <p className="text-slate-300 text-[length:var(--g-text-base)] mb-4">{adjustment.reason}</p>

      {/* AI 建议消息 */}
      {adjustment.aiSuggestion && (
        <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
          <p className="text-slate-300 text-[length:var(--g-text-base)]">{adjustment.aiSuggestion.message}</p>
        </div>
      )}

      {/* 选项 */}
      {adjustment.aiSuggestion?.options && adjustment.aiSuggestion.options.length > 0 && (
        <div className="space-y-2 mb-4">
          {adjustment.aiSuggestion.options.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelectedOption(option.id)}
              className={`w-full p-3 rounded-lg border text-left transition-colors ${
                selectedOption === option.id
                  ? 'bg-blue-500/20 border-blue-500 text-white'
                  : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:border-slate-600'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onReject(adjustment)}
          className="flex-1 py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <X size={16} />
          暂不调整
        </button>
        <button
          onClick={() => onAccept(adjustment, selectedOption || undefined)}
          className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <Check size={16} />
          接受建议
        </button>
      </div>
    </motion.div>
  );
};

// 根据打卡原因生成调整建议
export function generateAdjustmentSuggestion(
  task: Task,
  reasonCode: ReasonCode,
  reasonNote?: string
): Adjustment | null {
  const now = new Date().toISOString();
  
  switch (reasonCode) {
    case 'time_insufficient':
      return {
        id: `adj-${Date.now()}`,
        adjustmentType: 'split',
        originalTaskId: task.id,
        reason: `你提到时间不够完成"${task.title}"。AI 建议将任务拆分成更小的部分。`,
        aiSuggestion: {
          message: '根据任务预计时长，建议拆分为以下方式：',
          options: [
            { id: 'split-2', label: '拆分为 2 个子任务，每个约 15-20 分钟', action: 'split_2' },
            { id: 'split-3', label: '拆分为 3 个子任务，每个约 10-15 分钟', action: 'split_3' },
            { id: 'reduce', label: '缩小任务范围，只完成核心部分', action: 'reduce' },
          ],
        },
        createdAt: now,
      };

    case 'energy_low':
      return {
        id: `adj-${Date.now()}`,
        adjustmentType: 'reschedule',
        originalTaskId: task.id,
        reason: `你提到精力不足。AI 建议将"${task.title}"调整到更合适的时间。`,
        aiSuggestion: {
          message: '根据你之前记录的作息习惯，建议：',
          options: [
            { id: 'morning', label: '改到明早 6-8 点（你的高效时段）', action: 'reschedule_morning' },
            { id: 'tomorrow', label: '顺延到明天同一时间', action: 'postpone_1day' },
            { id: 'weekend', label: '移到周末集中处理', action: 'reschedule_weekend' },
          ],
        },
        createdAt: now,
      };

    case 'external_interrupt':
      return {
        id: `adj-${Date.now()}`,
        adjustmentType: 'postpone',
        originalTaskId: task.id,
        reason: `外部打断影响了任务完成。AI 建议顺延"${task.title}"。`,
        aiSuggestion: {
          message: '建议将任务顺延并预留缓冲时间：',
          options: [
            { id: 'tomorrow', label: '顺延到明天', action: 'postpone_1day' },
            { id: 'next_slot', label: '今天稍后再试', action: 'reschedule_later' },
          ],
        },
        createdAt: now,
      };

    case 'priority_changed':
      return {
        id: `adj-${Date.now()}`,
        adjustmentType: 'reschedule',
        originalTaskId: task.id,
        reason: `优先级发生变化。AI 建议重新评估"${task.title}"的安排。`,
        aiSuggestion: {
          message: '根据优先级变化，你可以：',
          options: [
            { id: 'deprioritize', label: '降低优先级，本周再安排', action: 'deprioritize' },
            { id: 'cancel', label: '暂时取消这个任务', action: 'cancel' },
            { id: 'keep', label: '保持原计划，明天继续', action: 'keep' },
          ],
        },
        createdAt: now,
      };

    default:
      return null;
  }
}









