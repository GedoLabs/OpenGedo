'use client';

import { motion } from 'framer-motion';
import { X, Check, Tag, Sparkles } from 'lucide-react';
import { Memory, SystemTag, TYPE_LABELS, SYSTEM_TAG_LABELS } from './types';

interface MemoryConfirmModalProps {
  memory: Memory;
  suggestedTags?: SystemTag[];
  suggestedType?: Memory['type'];
  onConfirm: (updatedMemory: Partial<Memory>) => void;
  onReject: () => void;
  onClose: () => void;
}

export const MemoryConfirmModal = ({
  memory,
  suggestedTags = [],
  suggestedType,
  onConfirm,
  onReject,
  onClose,
}: MemoryConfirmModalProps) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full overflow-hidden"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-blue-400">
            <Sparkles size={18} />
            <span className="font-medium">AI 识别到新记忆</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-4">
          {/* 识别到的内容 */}
          <div className="bg-slate-800/50 rounded-xl p-4">
            <p className="text-white leading-relaxed">{memory.contentRaw}</p>
          </div>

          {/* 建议的类型 */}
          {suggestedType && (
            <div>
              <div className="text-[length:var(--g-text-base)] text-slate-400 mb-2">建议分类为</div>
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg"
                style={{ backgroundColor: TYPE_LABELS[suggestedType].color + '20' }}
              >
                <span>{TYPE_LABELS[suggestedType].icon}</span>
                <span className="text-white">{TYPE_LABELS[suggestedType].label}</span>
              </div>
            </div>
          )}

          {/* 建议的标签 */}
          {suggestedTags.length > 0 && (
            <div>
              <div className="text-[length:var(--g-text-base)] text-slate-400 mb-2">建议添加标签</div>
              <div className="flex flex-wrap gap-2">
                {suggestedTags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[length:var(--g-text-base)]"
                    style={{
                      backgroundColor: SYSTEM_TAG_LABELS[tag].color + '20',
                      color: SYSTEM_TAG_LABELS[tag].color,
                    }}
                  >
                    <Tag size={12} />
                    {SYSTEM_TAG_LABELS[tag].label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 提示 */}
          <p className="text-[length:var(--g-text-base)] text-slate-500">
            这条记忆来自系统自动识别，确认后将存入你的智忆。
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-3 p-4 border-t border-slate-800">
          <button
            onClick={onReject}
            className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium transition-colors"
          >
            忽略
          </button>
          <button
            onClick={() => onConfirm({
              type: suggestedType || memory.type,
              systemTags: suggestedTags.length > 0 ? suggestedTags : memory.systemTags,
              confirmed: true,
            })}
            className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Check size={18} />
            确认存入
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};







