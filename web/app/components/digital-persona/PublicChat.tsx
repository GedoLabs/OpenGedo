'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import {
  publicPersonaChatStream,
  verifyPersona,
  finalizePersonaSession,
  type PublicPersonaProfile,
} from '@/lib/apiClient';
import { getTheme } from './presets';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface PublicChatProps {
  profile: PublicPersonaProfile;
  /** Pre-obtained session token (from the gate flow). If omitted, the component
   *  self-bootstraps an anonymous session (works for public/hybrid personas). */
  sessionToken?: string;
}

export function PublicChat({ profile, sessionToken: providedToken }: PublicChatProps) {
  const theme = getTheme(profile.theme);
  const [messages, setMessages] = useState<Message[]>(
    profile.greeting ? [{ role: 'assistant', content: profile.greeting }] : []
  );
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(providedToken ?? null);
  const [gateError, setGateError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Self-bootstrap an anonymous session when no token was provided.
  // (When a token IS provided, sessionToken already initialised to it above.)
  useEffect(() => {
    if (providedToken) return;
    let cancelled = false;
    verifyPersona(profile.slug, {})
      .then((r) => { if (!cancelled) setSessionToken(r.session_token); })
      .catch(() => { if (!cancelled) setGateError('该数字人需要口令或邀请链接才能对话。'); });
    return () => { cancelled = true; };
  }, [profile.slug, providedToken]);

  // Finalize the session (→ owner review inbox) when the visitor leaves.
  useEffect(() => {
    if (!sessionToken) return;
    const finalize = () => finalizePersonaSession(profile.slug, sessionToken);
    window.addEventListener('beforeunload', finalize);
    return () => {
      window.removeEventListener('beforeunload', finalize);
      finalize();
    };
  }, [profile.slug, sessionToken]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming || !sessionToken) return;
    setInput('');

    setMessages((prev) => [...prev, { role: 'user', content: message }, { role: 'assistant', content: '' }]);
    setStreaming(true);

    await publicPersonaChatStream(
      profile.slug,
      { message, session_token: sessionToken },
      {
        onText: (chunk) => {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: 'assistant',
              content: next[next.length - 1].content + chunk,
            };
            return next;
          });
        },
        onError: (err) => {
          const msg =
            err === 'rate_limited' ? '请求太频繁了，请稍后再试 🙏'
            : err === 'session_required' ? '会话已失效，请刷新页面。'
            : '抱歉，回答出错了，请重试。';
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content: msg };
            return next;
          });
        },
      }
    );
    setStreaming(false);
  };

  const ready = !!sessionToken;

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const isStreamingLast = streaming && i === messages.length - 1;
          return (
            <div key={i} className={`gedo-msg-in flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-[length:var(--g-text-base)] leading-relaxed whitespace-pre-wrap break-words ${
                  isUser
                    ? `bg-gradient-to-br ${theme.from} ${theme.to} text-white`
                    : 'text-[var(--g-text)] bg-[var(--g-surface-1)] border border-[var(--g-border)]'
                }`}
              >
                {m.content || (isStreamingLast ? <TypingDots /> : '')}
              </div>
            </div>
          );
        })}
        {gateError && <p className="text-[length:var(--g-text-sm)] text-[var(--g-dim-goal)] text-center px-4">{gateError}</p>}
      </div>

      {profile.suggested_questions.length > 0 && messages.filter((m) => m.role === 'user').length === 0 && ready && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {profile.suggested_questions.map((q, i) => (
            <button
              key={i}
              onClick={() => send(q)}
              className="px-3 py-1.5 rounded-full bg-[var(--g-surface-1)] hover:bg-[var(--g-surface-2)] border border-[var(--g-border)] text-[length:var(--g-text-sm)] text-[var(--g-text-mid)] transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="p-3 border-t border-[var(--g-border)] flex items-center gap-2"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!ready}
          placeholder={ready ? `和 ${profile.display_name} 的助理聊聊…` : '正在连接…'}
          className="flex-1 bg-[var(--g-surface-1)] border border-[var(--g-border)] rounded-full px-4 py-2.5 text-[length:var(--g-text-base)] text-[var(--g-text)] placeholder-[var(--g-text-faint)] outline-none focus:border-[var(--g-border-hi)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim() || !ready}
          className={`w-10 h-10 shrink-0 rounded-full bg-gradient-to-br ${theme.from} ${theme.to} flex items-center justify-center text-white disabled:opacity-50 transition-opacity`}
        >
          {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="正在输入">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: 'var(--g-text-muted)', animation: 'gedo-dot 1.2s ease-in-out infinite', animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}
