'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, MessageSquare, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { Memory } from './types';
import { TYPE_LABELS, EXTRACTION_CATEGORY_LABELS } from './types';

interface Props {
  memories: Memory[];
  onConfirm: (memoryId: string) => void;
  onDeny: (memoryId: string) => void;
}

export const ClarificationPrompts = ({ memories, onConfirm, onDeny }: Props) => {
  const [collapsed, setCollapsed] = useState(false);

  const needsClarification = memories.filter(
    m => m.aiExtraction?.needsClarification && m.verificationStatus === 'unverified'
  );
  const unverifiedCount = memories.filter(
    m => m.aiExtraction && m.verificationStatus === 'unverified'
  ).length;

  if (needsClarification.length === 0 && unverifiedCount === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-amber-500/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400" />
          <span className="text-[length:var(--g-text-base)] font-medium text-amber-300">
            {needsClarification.length > 0
              ? `${needsClarification.length} 条信息需要你确认`
              : `${unverifiedCount} 条 AI 分析待确认`
            }
          </span>
          <span className="text-[length:var(--g-text-sm)] text-slate-500">不确认也可以，默认采用 AI 结果</span>
        </div>
        {collapsed ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronUp className="w-3 h-3 text-slate-500" />}
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="px-4 pb-4 space-y-2">
              {needsClarification.slice(0, 5).map(memory => {
                const catInfo = memory.aiExtraction
                  ? EXTRACTION_CATEGORY_LABELS[memory.aiExtraction.category]
                  : null;

                return (
                  <div
                    key={memory.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800/50"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[length:var(--g-text-base)] flex-shrink-0"
                      style={{ backgroundColor: TYPE_LABELS[memory.type].color + '20' }}
                    >
                      {TYPE_LABELS[memory.type].icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[length:var(--g-text-sm)] text-slate-300 line-clamp-1 mb-1">{memory.contentRaw}</p>
                      {memory.aiExtraction?.clarificationQuestion && (
                        <p className="text-[length:var(--g-text-sm)] text-amber-300">
                          {memory.aiExtraction.clarificationQuestion}
                        </p>
                      )}
                      {catInfo && (
                        <span
                          className="inline-block mt-1 text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: catInfo.color + '15', color: catInfo.color }}
                        >
                          {catInfo.icon} {catInfo.label}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => onConfirm(memory.id)}
                        className="p-1.5 text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors"
                        title="确认正确"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeny(memory.id)}
                        className="p-1.5 text-slate-500 hover:bg-slate-700 rounded transition-colors"
                        title="不准确"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {needsClarification.length > 0 && (
                <Link
                  href="/app/avatar"
                  className="flex items-center justify-center gap-2 py-2 text-[length:var(--g-text-sm)] text-violet-400 hover:text-violet-300 transition-colors"
                >
                  <MessageSquare className="w-3 h-3" />
                  去智伴聊聊，帮助 AI 更了解你
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
