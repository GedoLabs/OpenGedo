'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, 
  Image, 
  Mic, 
  Calendar, 
  Tag, 
  X, 
  ChevronDown,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { MemoryType, MemoryInput as MemoryInputType, TYPE_LABELS } from './types';

interface MemoryInputProps {
  onSubmit: (input: MemoryInputType) => Promise<void>;
  onAnalyze?: (text: string) => Promise<{ 
    suggestedType: MemoryType; 
    suggestedTags: string[];
    extractedInfo: Record<string, string[]>;
  }>;
}

export const MemoryInput = ({ onSubmit, onAnalyze }: MemoryInputProps) => {
  const [content, setContent] = useState('');
  const [type, setType] = useState<MemoryType>('important_info');
  const [userTags, setUserTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<{
    type?: MemoryType;
    tags?: string[];
  } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAnalyze = async () => {
    if (!content.trim() || !onAnalyze) return;
    
    setIsAnalyzing(true);
    try {
      const result = await onAnalyze(content);
      setAiSuggestions({
        type: result.suggestedType,
        tags: result.suggestedTags,
      });
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async () => {
    if (!content.trim()) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit({
        type,
        contentRaw: content,
        source: 'text',
        userTags,
        reminderDate: reminderDate || undefined,
      });
      // 重置表单
      setContent('');
      setUserTags([]);
      setReminderDate('');
      setAiSuggestions(null);
    } catch (error) {
      console.error('Submit failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !userTags.includes(trimmed)) {
      setUserTags([...userTags, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setUserTags(userTags.filter(t => t !== tag));
  };

  const applySuggestion = (suggestion: 'type' | 'tags') => {
    if (!aiSuggestions) return;
    if (suggestion === 'type' && aiSuggestions.type) {
      setType(aiSuggestions.type);
    }
    if (suggestion === 'tags' && aiSuggestions.tags) {
      setUserTags([...new Set([...userTags, ...aiSuggestions.tags])]);
    }
  };

  return (
    <div className="bg-slate-900/50 rounded-2xl border border-slate-800 p-6">
      {/* 类型选择器 */}
      <div className="relative mb-4">
        <button
          onClick={() => setShowTypeDropdown(!showTypeDropdown)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <span>{TYPE_LABELS[type].icon}</span>
          <span className="text-white">{TYPE_LABELS[type].label}</span>
          <ChevronDown size={16} className="text-slate-400" />
        </button>
        
        <AnimatePresence>
          {showTypeDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-full left-0 mt-2 bg-slate-800 rounded-lg border border-slate-700 overflow-hidden z-10"
            >
              {(Object.entries(TYPE_LABELS) as [MemoryType, typeof TYPE_LABELS[MemoryType]][]).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => {
                    setType(key);
                    setShowTypeDropdown(false);
                  }}
                  className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-700 transition-colors ${
                    type === key ? 'bg-slate-700' : ''
                  }`}
                >
                  <span>{value.icon}</span>
                  <span className="text-white">{value.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 主输入区 */}
      <div className="relative">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="记录你的想法、经验、重要信息..."
          className="w-full h-32 bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
        />
        
        {/* AI 分析按钮 */}
        {content.length > 10 && onAnalyze && (
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="absolute right-3 top-3 flex items-center gap-1 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-full text-[length:var(--g-text-base)] transition-colors"
          >
            {isAnalyzing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            <span>AI 分析</span>
          </button>
        )}
      </div>

      {/* AI 建议 */}
      <AnimatePresence>
        {aiSuggestions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl"
          >
            <div className="flex items-center gap-2 text-blue-400 text-[length:var(--g-text-base)] mb-3">
              <Sparkles size={16} />
              <span>AI 建议</span>
            </div>
            
            <div className="space-y-3">
              {aiSuggestions.type && aiSuggestions.type !== type && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 text-[length:var(--g-text-base)]">
                    建议类型：{TYPE_LABELS[aiSuggestions.type].icon} {TYPE_LABELS[aiSuggestions.type].label}
                  </span>
                  <button
                    onClick={() => applySuggestion('type')}
                    className="text-blue-400 text-[length:var(--g-text-base)] hover:underline"
                  >
                    应用
                  </button>
                </div>
              )}
              
              {aiSuggestions.tags && aiSuggestions.tags.length > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-300 text-[length:var(--g-text-base)]">建议标签：</span>
                    {aiSuggestions.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-slate-700 rounded text-[length:var(--g-text-sm)] text-slate-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => applySuggestion('tags')}
                    className="text-blue-400 text-[length:var(--g-text-base)] hover:underline"
                  >
                    应用
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 标签输入 */}
      <div className="mt-4">
        <div className="flex items-center gap-2 flex-wrap">
          {userTags.map(tag => (
            <span
              key={tag}
              className="flex items-center gap-1 px-3 py-1 bg-slate-800 rounded-full text-[length:var(--g-text-base)] text-slate-300"
            >
              <Tag size={12} />
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-white">
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            placeholder="添加标签..."
            className="flex-1 min-w-[100px] bg-transparent text-white placeholder-slate-500 text-[length:var(--g-text-base)] focus:outline-none"
          />
        </div>
      </div>

      {/* 高级选项 */}
      <div className="mt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-slate-400 text-[length:var(--g-text-base)] hover:text-white transition-colors"
        >
          {showAdvanced ? '收起' : '更多选项'}
        </button>
        
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 space-y-3"
            >
              {/* 日期提醒 */}
              <div className="flex items-center gap-3">
                <Calendar size={16} className="text-slate-400" />
                <input
                  type="date"
                  value={reminderDate}
                  onChange={(e) => setReminderDate(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-[length:var(--g-text-base)] focus:outline-none focus:border-blue-500"
                />
                <span className="text-slate-400 text-[length:var(--g-text-base)]">设置提醒日期</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 操作栏 */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                console.log('Image selected:', file.name);
                // TODO: 上传图片
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="添加图片"
          >
            <Image size={20} />
          </button>
          <button
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="语音输入"
          >
            <Mic size={20} />
          </button>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!content.trim() || isSubmitting}
          className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-full font-medium transition-colors"
        >
          {isSubmitting ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={18} />
          )}
          <span>保存记忆</span>
        </button>
      </div>
    </div>
  );
};









