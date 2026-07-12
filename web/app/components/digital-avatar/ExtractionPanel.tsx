'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, CheckCircle, X, ChevronDown, ChevronUp, Plus, Sparkles, ClipboardList, User } from 'lucide-react';
import type { ProfileEntry, ExtractedTask, ChatExtraction } from './profile-types';
import { PROFILE_CATEGORY_LABELS } from './profile-types';

interface Props {
  extractions: ChatExtraction[];
  profileEntries: ProfileEntry[];
  extractedTasks: ExtractedTask[];
  profileCompleteness: number;
  onConfirmEntry: (entry: ProfileEntry) => void;
  onDismissEntry: (entryId: string) => void;
  onConfirmTask: (task: ExtractedTask) => void;
  onDismissTask: (taskId: string) => void;
}

export default function ExtractionPanel({
  extractions,
  profileEntries,
  extractedTasks,
  profileCompleteness,
  onConfirmEntry,
  onDismissEntry,
  onConfirmTask,
  onDismissTask,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'profile' | 'tasks'>('pending');

  const pendingEntries = profileEntries.filter(e => e.confidence < 1);
  const confirmedEntries = profileEntries.filter(e => e.confidence >= 1);
  const pendingTasks = extractedTasks.filter(t => !t.confirmed);
  const pendingCount = pendingEntries.length + pendingTasks.length;

  return (
    <div className="rounded-xl bg-slate-800/40 border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          <span className="text-[length:var(--g-text-base)] font-medium text-white">AI 画像提取</span>
          {pendingCount > 0 && (
            <span className="px-1.5 py-0.5 text-[length:var(--g-text-sm)] font-bold rounded-full bg-violet-500/20 text-violet-400">
              {pendingCount} 待确认
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all"
              style={{ width: `${profileCompleteness}%` }}
            />
          </div>
          <span className="text-[length:var(--g-text-sm)] text-slate-500">{profileCompleteness}%</span>
          {expanded ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Tabs */}
            <div className="flex border-b border-slate-700/50">
              {[
                { key: 'pending' as const, label: '待确认', count: pendingCount },
                { key: 'profile' as const, label: '画像', count: confirmedEntries.length },
                { key: 'tasks' as const, label: '待办', count: extractedTasks.filter(t => t.confirmed).length },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 px-3 py-2 text-[length:var(--g-text-sm)] font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'text-violet-400 border-b-2 border-violet-400'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>

            <div className="max-h-60 overflow-y-auto p-3 space-y-2">
              {/* Pending Tab */}
              {activeTab === 'pending' && (
                <>
                  {pendingEntries.map(entry => {
                    const catInfo = PROFILE_CATEGORY_LABELS[entry.category];
                    return (
                      <div key={entry.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/50 border border-slate-700/30">
                        <span className="text-[length:var(--g-text-base)] flex-shrink-0 mt-0.5">{catInfo.icon}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded" style={{ backgroundColor: catInfo.color + '20', color: catInfo.color }}>
                            {catInfo.label}
                          </span>
                          <p className="text-[length:var(--g-text-sm)] text-slate-300 mt-1 line-clamp-2">{entry.content}</p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => onConfirmEntry(entry)} className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => onDismissEntry(entry.id)} className="p-1 text-slate-500 hover:bg-slate-700 rounded transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {pendingTasks.map(task => (
                    <div key={task.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/50 border border-cyan-500/20">
                      <ClipboardList className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">待办事项</span>
                        <p className="text-[length:var(--g-text-sm)] text-white mt-1">{task.title}</p>
                        {task.dueDate && <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-0.5">{task.dueDate}</p>}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => onConfirmTask(task)} className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors">
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => onDismissTask(task.id)} className="p-1 text-slate-500 hover:bg-slate-700 rounded transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {pendingCount === 0 && (
                    <p className="text-center text-[length:var(--g-text-sm)] text-slate-500 py-4">和智伴聊天，AI 会自动提取关键信息</p>
                  )}
                </>
              )}

              {/* Profile Tab */}
              {activeTab === 'profile' && (
                <>
                  {confirmedEntries.length === 0 ? (
                    <p className="text-center text-[length:var(--g-text-sm)] text-slate-500 py-4">
                      <User className="w-5 h-5 mx-auto mb-1 text-slate-600" />
                      还没有确认的画像信息<br />继续和智伴聊天来完善你的画像
                    </p>
                  ) : (
                    confirmedEntries.map(entry => {
                      const catInfo = PROFILE_CATEGORY_LABELS[entry.category];
                      return (
                        <div key={entry.id} className="p-2 rounded-lg bg-slate-900/30">
                          <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded" style={{ backgroundColor: catInfo.color + '20', color: catInfo.color }}>
                            {catInfo.icon} {catInfo.label}
                          </span>
                          <p className="text-[length:var(--g-text-sm)] text-slate-300 mt-1">{entry.content}</p>
                        </div>
                      );
                    })
                  )}
                </>
              )}

              {/* Tasks Tab */}
              {activeTab === 'tasks' && (
                <>
                  {extractedTasks.filter(t => t.confirmed).length === 0 ? (
                    <p className="text-center text-[length:var(--g-text-sm)] text-slate-500 py-4">
                      <ClipboardList className="w-5 h-5 mx-auto mb-1 text-slate-600" />
                      提到待办事项时，AI 会自动提取
                    </p>
                  ) : (
                    extractedTasks.filter(t => t.confirmed).map(task => (
                      <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/30">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span className="text-[length:var(--g-text-sm)] text-slate-300 flex-1">{task.title}</span>
                        {task.dueDate && <span className="text-[length:var(--g-text-sm)] text-slate-500">{task.dueDate}</span>}
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
