'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, Loader2, Brain, Target, CheckCircle, BarChart3 } from 'lucide-react';
import { ChatMessage, QuickAction, MessageRole } from './types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => Promise<void>;
  onQuickAction?: (action: QuickAction) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export const ChatInterface = ({
  messages,
  onSendMessage,
  onQuickAction,
  isLoading = false,
  placeholder = '和我聊聊吧...',
}: ChatInterfaceProps) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    
    const content = input.trim();
    setInput('');
    setIsSending(true);
    
    try {
      await onSendMessage(content);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // 快捷操作
  const quickActions = [
    { id: 'memory', label: '智忆', icon: Brain, type: 'memory' as const },
    { id: 'goal', label: '智引', icon: Target, type: 'goal' as const },
    { id: 'checkin', label: '打卡', icon: CheckCircle, type: 'checkin' as const },
    { id: 'insight', label: '智察', icon: BarChart3, type: 'confirm' as const },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900/50 rounded-2xl border border-slate-800 overflow-hidden">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onQuickAction={onQuickAction}
            />
          ))}
        </AnimatePresence>
        
        {/* 加载指示器 */}
        {(isLoading || isSending) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-[length:var(--g-text-base)]">
              🤖
            </div>
            <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[length:var(--g-text-base)]">思考中...</span>
              </div>
            </div>
          </motion.div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* 快捷操作栏 */}
      <div className="px-4 py-2 border-t border-slate-800/50">
        <div className="flex items-center gap-2">
          {quickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => onQuickAction?.({ 
                id: action.id, 
                label: action.label, 
                type: action.type 
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-white text-[length:var(--g-text-sm)] transition-colors"
            >
              <action.icon className="w-3.5 h-3.5" />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 输入区 */}
      <div className="p-4 pt-2 border-t border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={placeholder}
              disabled={isSending}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all disabled:opacity-50"
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-white transition-colors disabled:opacity-50"
              disabled
              title="语音输入（开发中）"
            >
              <Mic className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            className="p-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/30"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// 消息气泡组件
interface MessageBubbleProps {
  message: ChatMessage;
  onQuickAction?: (action: QuickAction) => void;
}

const MessageBubble = ({ message, onQuickAction }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* 头像 */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[length:var(--g-text-base)] flex-shrink-0 ${
        isUser 
          ? 'bg-gradient-to-br from-blue-500 to-indigo-600' 
          : 'bg-gradient-to-br from-emerald-500 to-teal-600'
      }`}>
        {isUser ? '👤' : '🤖'}
      </div>

      {/* 消息内容 */}
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-sm'
              : 'bg-slate-800 text-slate-100 rounded-tl-sm'
          }`}
        >
          <div className="text-[length:var(--g-text-base)] whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
        </div>

        {/* 快捷操作按钮 */}
        {message.quickActions && message.quickActions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex flex-wrap gap-2 mt-2"
          >
            {message.quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => onQuickAction?.(action)}
                className={`px-3 py-1.5 rounded-lg text-[length:var(--g-text-sm)] font-medium transition-colors ${
                  action.type === 'confirm'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : action.type === 'cancel'
                    ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                {action.label}
              </button>
            ))}
          </motion.div>
        )}

        {/* 时间戳 */}
        <div className={`text-[length:var(--g-text-sm)] text-slate-500 mt-1 ${isUser ? 'text-right' : 'text-left'}`}>
          {formatTime(message.timestamp)}
        </div>
      </div>
    </motion.div>
  );
};

// 格式化时间
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  
  if (date.toDateString() === now.toDateString()) {
    return `${hours}:${mins}`;
  }
  
  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${mins}`;
}



