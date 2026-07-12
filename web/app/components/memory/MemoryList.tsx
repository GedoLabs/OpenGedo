'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Filter,
  Tag,
  Calendar,
  ChevronRight,
  Star,
  Clock,
  MoreVertical,
  Trash2,
  Edit2,
  Link2,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import {
  Memory,
  MemoryType,
  SystemTag,
  VerificationStatus,
  TYPE_LABELS,
  SYSTEM_TAG_LABELS,
  EXTRACTION_CATEGORY_LABELS,
  VERIFICATION_LABELS,
} from './types';

interface MemoryListProps {
  memories: Memory[];
  onSearch?: (query: string) => void;
  onFilter?: (filters: { types?: MemoryType[]; tags?: string[] }) => void;
  onMemoryClick?: (memory: Memory) => void;
  onMemoryDelete?: (id: string) => void;
  onMemoryEdit?: (memory: Memory) => void;
  onVerify?: (memoryId: string, status: VerificationStatus) => void;
  onAskClarification?: (memoryId: string) => void;
}

export const MemoryList = ({
  memories,
  onSearch,
  onFilter,
  onMemoryClick,
  onMemoryDelete,
  onMemoryEdit,
  onVerify,
  onAskClarification,
}: MemoryListProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<MemoryType[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    onSearch?.(query);
  };

  const toggleType = (type: MemoryType) => {
    const newTypes = selectedTypes.includes(type)
      ? selectedTypes.filter(t => t !== type)
      : [...selectedTypes, type];
    setSelectedTypes(newTypes);
    onFilter?.({ types: newTypes, tags: selectedTags });
  };

  const toggleTag = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(newTags);
    onFilter?.({ types: selectedTypes, tags: newTags });
  };

  const allUserTags = [...new Set(memories.flatMap(m => m.userTags))];

  const getSourceLabel = (source: Memory['source']) => {
    switch (source) {
      case 'chat_extract': return { label: '智伴提取', icon: '💬', color: '#8b5cf6' };
      case 'text': return { label: '手动输入', icon: '✏️', color: '#3b82f6' };
      case 'voice': return { label: '语音输入', icon: '🎤', color: '#06b6d4' };
      default: return { label: '系统', icon: '⚙️', color: '#64748b' };
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索栏 */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索记忆..."
            className="w-full pl-12 pr-4 py-3 bg-slate-900/50 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-3 rounded-xl border transition-colors ${
            showFilters || selectedTypes.length > 0 || selectedTags.length > 0
              ? 'bg-blue-600/20 border-blue-500/30 text-blue-400'
              : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Filter size={18} />
        </button>
      </div>

      {/* 筛选器 */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-4"
          >
            <div>
              <div className="text-[length:var(--g-text-base)] text-slate-400 mb-2">记忆类型</div>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(TYPE_LABELS) as [MemoryType, typeof TYPE_LABELS[MemoryType]][]).map(([key, value]) => (
                  <button
                    key={key}
                    onClick={() => toggleType(key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[length:var(--g-text-base)] transition-colors ${
                      selectedTypes.includes(key)
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span>{value.icon}</span>
                    <span>{value.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[length:var(--g-text-base)] text-slate-400 mb-2">系统标签</div>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(SYSTEM_TAG_LABELS) as [SystemTag, typeof SYSTEM_TAG_LABELS[SystemTag]][]).map(([key, value]) => (
                  <button
                    key={key}
                    onClick={() => toggleTag(key)}
                    className="px-3 py-1.5 rounded-full text-[length:var(--g-text-base)] transition-colors"
                    style={{
                      backgroundColor: selectedTags.includes(key) ? value.color : '#1e293b',
                      color: selectedTags.includes(key) ? '#fff' : '#cbd5e1',
                    }}
                  >
                    {value.label}
                  </button>
                ))}
              </div>
            </div>

            {allUserTags.length > 0 && (
              <div>
                <div className="text-[length:var(--g-text-base)] text-slate-400 mb-2">自定义标签</div>
                <div className="flex flex-wrap gap-2">
                  {allUserTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[length:var(--g-text-base)] transition-colors ${
                        selectedTags.includes(tag)
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <Tag size={12} />
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 记忆列表 */}
      <div className="space-y-3">
        {memories.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <p>还没有记忆，开始记录吧！</p>
          </div>
        ) : (
          memories.map((memory) => {
            const sourceInfo = getSourceLabel(memory.source);
            const veriInfo = VERIFICATION_LABELS[memory.verificationStatus];
            const isExpanded = expandedId === memory.id;

            return (
              <motion.div
                key={memory.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-slate-900/50 border rounded-xl overflow-hidden transition-colors ${
                  memory.aiExtraction?.needsClarification && memory.verificationStatus === 'unverified'
                    ? 'border-amber-500/30'
                    : memory.verificationStatus === 'denied'
                      ? 'border-slate-800/50 opacity-60'
                      : 'border-slate-800'
                }`}
              >
                {/* 卡片头部 */}
                <div
                  className="p-4 cursor-pointer hover:bg-slate-800/30 transition-colors"
                  onClick={() => {
                    setExpandedId(isExpanded ? null : memory.id);
                    onMemoryClick?.(memory);
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      {/* 类型图标 */}
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                        style={{ backgroundColor: TYPE_LABELS[memory.type].color + '20' }}
                      >
                        {TYPE_LABELS[memory.type].icon}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* 来源 + 确认状态 */}
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded" style={{ backgroundColor: sourceInfo.color + '15', color: sourceInfo.color }}>
                            {sourceInfo.icon} {sourceInfo.label}
                          </span>
                          {memory.verificationStatus !== 'unverified' && (
                            <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ backgroundColor: veriInfo.color + '15', color: veriInfo.color }}>
                              {memory.verificationStatus === 'confirmed' ? <CheckCircle size={9} /> : <XCircle size={9} />}
                              {veriInfo.label}
                            </span>
                          )}
                          {memory.aiExtraction?.needsClarification && memory.verificationStatus === 'unverified' && (
                            <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                              待澄清
                            </span>
                          )}
                        </div>

                        <p className={`text-white text-[length:var(--g-text-base)] ${isExpanded ? '' : 'line-clamp-2'}`}>
                          {memory.contentRaw}
                        </p>

                        {/* 标签 */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {memory.systemTags.map(tag => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded text-[length:var(--g-text-sm)]"
                              style={{ backgroundColor: SYSTEM_TAG_LABELS[tag].color + '20', color: SYSTEM_TAG_LABELS[tag].color }}
                            >
                              {SYSTEM_TAG_LABELS[tag].label}
                            </span>
                          ))}
                          {memory.userTags.map(tag => (
                            <span key={tag} className="px-2 py-0.5 bg-slate-700 rounded text-[length:var(--g-text-sm)] text-slate-300">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 操作菜单 */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(menuOpenId === memory.id ? null : memory.id);
                        }}
                        className="p-1 text-slate-400 hover:text-white rounded"
                      >
                        <MoreVertical size={18} />
                      </button>
                      <AnimatePresence>
                        {menuOpenId === memory.id && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden z-10 min-w-[120px]"
                          >
                            <button
                              onClick={(e) => { e.stopPropagation(); onMemoryEdit?.(memory); setMenuOpenId(null); }}
                              className="w-full px-4 py-2 flex items-center gap-2 text-slate-300 hover:bg-slate-700 text-[length:var(--g-text-base)]"
                            >
                              <Edit2 size={14} /> 编辑
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); }}
                              className="w-full px-4 py-2 flex items-center gap-2 text-slate-300 hover:bg-slate-700 text-[length:var(--g-text-base)]"
                            >
                              <Link2 size={14} /> 关联目标
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onMemoryDelete?.(memory.id); setMenuOpenId(null); }}
                              className="w-full px-4 py-2 flex items-center gap-2 text-red-400 hover:bg-slate-700 text-[length:var(--g-text-base)]"
                            >
                              <Trash2 size={14} /> 删除
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <ChevronRight
                      size={18}
                      className={`text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </div>
                </div>

                {/* 展开详情：AI 提取结果 + 确认/否定 */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-0 border-t border-slate-800">
                        <div className="pt-4 space-y-3">
                          {/* 元信息 */}
                          <div className="flex items-center gap-4 text-[length:var(--g-text-base)] text-slate-400">
                            <div className="flex items-center gap-1">
                              <Clock size={14} />
                              <span>{new Date(memory.createdAt).toLocaleString('zh-CN')}</span>
                            </div>
                            {memory.reminderDate && (
                              <div className="flex items-center gap-1">
                                <Calendar size={14} />
                                <span>提醒：{memory.reminderDate}</span>
                              </div>
                            )}
                            {memory.impactScore > 0 && (
                              <div className="flex items-center gap-1">
                                <Star size={14} />
                                <span>影响度：{memory.impactScore.toFixed(1)}</span>
                              </div>
                            )}
                          </div>

                          {/* AI 提取结果 */}
                          {memory.aiExtraction && (
                            <div className="rounded-xl bg-gradient-to-br from-violet-500/5 to-cyan-500/5 border border-violet-500/20 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-[length:var(--g-text-base)]">
                                  <Sparkles size={14} className="text-violet-400" />
                                  <span className="text-violet-400 font-medium">AI 分析结果</span>
                                  <span className="text-[length:var(--g-text-sm)] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                                    置信度 {Math.round(memory.aiExtraction.confidence * 100)}%
                                  </span>
                                </div>
                                {memory.verificationStatus === 'unverified' && (
                                  <span className="text-[length:var(--g-text-sm)] text-slate-500">可选择确认或忽略</span>
                                )}
                              </div>

                              {/* 分类 */}
                              {(() => {
                                const catInfo = EXTRACTION_CATEGORY_LABELS[memory.aiExtraction.category];
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[length:var(--g-text-sm)] text-slate-400">识别为：</span>
                                    <span
                                      className="text-[length:var(--g-text-sm)] px-2 py-0.5 rounded"
                                      style={{ backgroundColor: catInfo.color + '20', color: catInfo.color }}
                                    >
                                      {catInfo.icon} {catInfo.label}
                                    </span>
                                  </div>
                                );
                              })()}

                              {/* 摘要 */}
                              <div>
                                <span className="text-[length:var(--g-text-sm)] text-slate-400">AI 摘要：</span>
                                <p className="text-[length:var(--g-text-base)] text-slate-200 mt-0.5">{memory.aiExtraction.summary}</p>
                              </div>

                              {/* 关键实体 */}
                              {memory.aiExtraction.keyEntities.length > 0 && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[length:var(--g-text-sm)] text-slate-400">关键词：</span>
                                  {memory.aiExtraction.keyEntities.map((entity, i) => (
                                    <span key={i} className="text-[length:var(--g-text-sm)] px-2 py-0.5 bg-slate-700/50 rounded text-slate-300">{entity}</span>
                                  ))}
                                </div>
                              )}

                              {/* 提取的任务 */}
                              {memory.aiExtraction.taskExtracted && (
                                <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                                  <span className="text-[length:var(--g-text-base)]">📌</span>
                                  <div className="flex-1">
                                    <span className="text-[length:var(--g-text-sm)] text-orange-400">提取的待办：</span>
                                    <span className="text-[length:var(--g-text-base)] text-white ml-1">{memory.aiExtraction.taskExtracted.title}</span>
                                  </div>
                                  {memory.aiExtraction.taskExtracted.dueDate && (
                                    <span className="text-[length:var(--g-text-sm)] text-slate-500">{memory.aiExtraction.taskExtracted.dueDate}</span>
                                  )}
                                </div>
                              )}

                              {/* 待澄清问题 */}
                              {memory.aiExtraction.needsClarification && memory.aiExtraction.clarificationQuestion && memory.verificationStatus === 'unverified' && (
                                <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                  <span className="text-[length:var(--g-text-base)] mt-0.5">❓</span>
                                  <div className="flex-1">
                                    <p className="text-[length:var(--g-text-sm)] text-amber-400 mb-1">AI 不太确定：</p>
                                    <p className="text-[length:var(--g-text-base)] text-amber-200">{memory.aiExtraction.clarificationQuestion}</p>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onAskClarification?.(memory.id); }}
                                    className="flex items-center gap-1 text-[length:var(--g-text-sm)] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors flex-shrink-0"
                                  >
                                    <MessageSquare size={10} />
                                    去智伴聊聊
                                  </button>
                                </div>
                              )}

                              {/* 确认/否定按钮 */}
                              {memory.verificationStatus === 'unverified' && (
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onVerify?.(memory.id, 'confirmed'); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-[length:var(--g-text-sm)] transition-colors"
                                  >
                                    <ThumbsUp size={12} />
                                    分析正确
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onVerify?.(memory.id, 'denied'); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[length:var(--g-text-sm)] transition-colors"
                                  >
                                    <ThumbsDown size={12} />
                                    不准确
                                  </button>
                                  <span className="text-[length:var(--g-text-sm)] text-slate-600 ml-2">不操作则默认采用 AI 分析结果</span>
                                </div>
                              )}
                              {memory.verificationStatus === 'confirmed' && (
                                <div className="flex items-center gap-1 text-[length:var(--g-text-sm)] text-emerald-400">
                                  <CheckCircle size={12} /> 你已确认此分析结果
                                </div>
                              )}
                              {memory.verificationStatus === 'denied' && (
                                <div className="flex items-center gap-1 text-[length:var(--g-text-sm)] text-red-400">
                                  <XCircle size={12} /> 你已否定此分析结果
                                </div>
                              )}
                            </div>
                          )}

                          {/* 旧版结构化信息（兼容） */}
                          {!memory.aiExtraction && memory.contentStruct && Object.keys(memory.contentStruct).length > 0 && (
                            <div className="bg-slate-800/50 rounded-lg p-3">
                              <div className="text-[length:var(--g-text-sm)] text-slate-400 mb-2">AI 提取的信息</div>
                              <div className="space-y-1">
                                {memory.contentStruct.people && memory.contentStruct.people.length > 0 && (
                                  <div className="text-[length:var(--g-text-base)]">
                                    <span className="text-slate-400">相关人员：</span>
                                    <span className="text-white">{memory.contentStruct.people.join('、')}</span>
                                  </div>
                                )}
                                {memory.contentStruct.skills && memory.contentStruct.skills.length > 0 && (
                                  <div className="text-[length:var(--g-text-base)]">
                                    <span className="text-slate-400">相关技能：</span>
                                    <span className="text-white">{memory.contentStruct.skills.join('、')}</span>
                                  </div>
                                )}
                                {memory.contentStruct.conclusions && memory.contentStruct.conclusions.length > 0 && (
                                  <div className="text-[length:var(--g-text-base)]">
                                    <span className="text-slate-400">关键结论：</span>
                                    <span className="text-white">{memory.contentStruct.conclusions.join('；')}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
};
