'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Shield, AlertTriangle, Plus, Check } from 'lucide-react';
import type { IfThenCard as IfThenCardType, ObstacleType } from './types';
import { OBSTACLE_TYPE_LABELS } from './types';
import IfThenCard from './IfThenCard';

interface Props {
  taskTitle: string;
  reasonCode: string;
  matchedCards: IfThenCardType[];
  onExecuteCard: (cardId: string) => void;
  onAddNewObstacle: (description: string, obstacleType: ObstacleType) => void;
  onClose: () => void;
}

export default function ObstacleMatchModal({ taskTitle, reasonCode, matchedCards, onExecuteCard, onAddNewObstacle, onClose }: Props) {
  const [showAddNew, setShowAddNew] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState<ObstacleType>('procrastination_fear');
  const hasMatch = matchedCards.length > 0;

  const handleAddNew = () => {
    if (newDescription.trim()) {
      onAddNewObstacle(newDescription, newType);
      onClose();
    }
  };

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
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700/50 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-violet-400" />
              <h3 className="text-white font-semibold">障碍比对</h3>
            </div>
            <p className="text-[length:var(--g-text-sm)] text-slate-500">任务：{taskTitle}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {hasMatch ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                <p className="text-emerald-400 text-[length:var(--g-text-base)] font-medium flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  与预测障碍吻合
                </p>
                <p className="text-slate-400 text-[length:var(--g-text-sm)] mt-1">
                  你之前就预见到了这个情况。你当时制定的应对方案是：
                </p>
              </div>

              {matchedCards.map(card => (
                <div key={card.id}>
                  <IfThenCard card={card} compact />
                  <button
                    onClick={() => { onExecuteCard(card.id); onClose(); }}
                    className="mt-2 w-full py-2 text-[length:var(--g-text-base)] bg-violet-600/20 text-violet-400 rounded-lg hover:bg-violet-600/30 transition-colors"
                  >
                    立刻执行这个应对方案
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                <p className="text-amber-400 text-[length:var(--g-text-base)] font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  这是一个新障碍
                </p>
                <p className="text-slate-400 text-[length:var(--g-text-sm)] mt-1">
                  这个障碍不在你的预测库中。要把它加入障碍库吗？
                </p>
              </div>

              {!showAddNew ? (
                <button
                  onClick={() => setShowAddNew(true)}
                  className="w-full py-3 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 transition-colors flex items-center justify-center gap-2 text-[length:var(--g-text-base)]"
                >
                  <Plus className="w-4 h-4" /> 加入障碍库并生成 If-Then 卡片
                </button>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={newDescription}
                    onChange={e => setNewDescription(e.target.value)}
                    placeholder="描述这个障碍..."
                    className="w-full h-20 px-3 py-2 bg-slate-800/50 border border-slate-600 rounded-lg text-white text-[length:var(--g-text-base)] placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(OBSTACLE_TYPE_LABELS) as ObstacleType[]).map(type => {
                      const info = OBSTACLE_TYPE_LABELS[type];
                      return (
                        <button
                          key={type}
                          onClick={() => setNewType(type)}
                          className={`px-2.5 py-1 text-[length:var(--g-text-sm)] rounded-full transition-colors ${
                            newType === type ? 'text-white' : 'text-slate-500'
                          }`}
                          style={newType === type ? { backgroundColor: info.color + '30', color: info.color } : { backgroundColor: 'rgb(30 41 59 / 0.5)' }}
                        >
                          {info.icon} {info.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={handleAddNew}
                    disabled={!newDescription.trim()}
                    className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-[length:var(--g-text-base)] font-medium transition-colors"
                  >
                    生成 If-Then 卡片
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700/50">
          <button onClick={onClose} className="w-full py-2 text-[length:var(--g-text-base)] text-slate-400 hover:text-white transition-colors">
            暂不处理
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
