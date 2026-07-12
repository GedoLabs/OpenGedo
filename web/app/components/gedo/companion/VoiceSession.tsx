'use client';

import { fontVars, text } from '../typography';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/app/components/gedo/Modal';
import { primaryBtnStyle, ghostBtnStyle, Pill } from '@/app/components/gedo/primitives';
import { IconMic, IconWave, IconCheck } from '@/app/components/gedo/icons';

type VoiceState = 'idle' | 'listening' | 'transcribing' | 'responding' | 'speaking' | 'error';

// Web Speech API isn't standard TypeScript yet — declare minimal type.
interface SpeechRecognitionEventLike { results: { 0: { 0: { transcript: string }; isFinal: boolean } }[]; }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type WindowWithSR = typeof window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/**
 * Voice mode for the companion. Uses Web Speech API for STT,
 * SpeechSynthesisUtterance for TTS, and the parent's existing
 * chatStream() pipe for the LLM round-trip.
 *
 * State machine:
 *   idle → listening → transcribing → responding → speaking → idle
 */
export function VoiceSession({
  open, onClose, onSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (text: string, hooks: {
    onText: (chunk: string) => void;
    onDone: () => void;
    onError: (err: string) => void;
  }) => Promise<void>;
}) {
  const t = useTranslations('app');
  const locale = useLocale();
  const ttsLang = locale === 'ja' ? 'ja-JP' : locale === 'en' ? 'en-US' : 'zh-CN';
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      const w = window as WindowWithSR;
      const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (!SR) {
        setSupported(false);
        setError(t('companion.voice.noSpeechApi'));
        return;
      }
      if (!('speechSynthesis' in window)) {
        setSupported(false);
        setError(t('companion.voice.noSynthesis'));
        return;
      }
      setSupported(true);
    }, 0);
    return () => { cancelled = true; clearTimeout(id); };
  }, [open]);

  const cleanup = useCallback(() => {
    try { recRef.current?.abort(); } catch {}
    try { window.speechSynthesis.cancel(); } catch {}
    recRef.current = null;
    utterRef.current = null;
  }, []);

  useEffect(() => {
    if (open) return cleanup;
    // Defer reset to a microtask to satisfy react-hooks/set-state-in-effect.
    const id = setTimeout(() => {
      cleanup();
      setState('idle');
      setTranscript('');
      setReply('');
      setError(null);
    }, 0);
    return () => { clearTimeout(id); cleanup(); };
  }, [open, cleanup]);

  const startListening = useCallback(() => {
    if (!supported) return;
    setError(null);
    setTranscript('');
    setReply('');
    const w = window as WindowWithSR;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = 0; i < (e.results as unknown as ArrayLike<unknown>).length; i++) {
        const res = (e.results as unknown as { [k: number]: { 0: { transcript: string }; isFinal: boolean } })[i];
        if (!res) continue;
        const piece = res[0].transcript;
        if (res.isFinal) finalText += piece;
        else interim += piece;
      }
      setTranscript(finalText + interim);
    };
    rec.onerror = (e) => {
      setError(e?.error || 'recognition_failed');
      setState('error');
    };
    rec.onend = async () => {
      const text = finalText.trim();
      if (!text) {
        setState('idle');
        return;
      }
      setState('transcribing');
      // Brief pause to show transcribing state, then dispatch.
      setState('responding');
      let accum = '';
      try {
        await onSend(text, {
          onText: (chunk) => { accum += chunk; setReply(accum); },
          onDone: () => {
            const utt = new SpeechSynthesisUtterance(accum || t('companion.voice.noReply'));
            utt.lang = ttsLang;
            utt.rate = 1.05;
            utt.onend = () => setState('idle');
            utt.onerror = () => setState('idle');
            utterRef.current = utt;
            setState('speaking');
            try { window.speechSynthesis.speak(utt); } catch {}
          },
          onError: (err) => { setError(err); setState('error'); },
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t('companion.voice.requestFailed'));
        setState('error');
      }
    };
    recRef.current = rec;
    setState('listening');
    try { rec.start(); } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'start_failed');
      setState('error');
    }
  }, [onSend, supported]);

  const stopListening = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
  }, []);

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis.cancel(); } catch {}
    setState('idle');
  }, []);

  return (
    <Modal
      open={open}
      onClose={() => { cleanup(); onClose(); }}
      eyebrow={t('companion.voice.eyebrow')}
      title={t(`companion.voice.state.${state}`)}
      size="md"
      footer={
        <>
          <button
            type="button"
            style={ghostBtnStyle()}
            onClick={() => { cleanup(); onClose(); }}
          >
            {t('companion.voice.exit')}
          </button>
          {state === 'idle' && (
            <button type="button" style={primaryBtnStyle()} onClick={startListening} disabled={!supported}>
              <IconMic size={14} /> {t('companion.voice.holdToTalk')}
            </button>
          )}
          {state === 'listening' && (
            <button type="button" style={primaryBtnStyle()} onClick={stopListening}>
              <IconCheck size={14} /> {t('companion.voice.stopListening')}
            </button>
          )}
          {(state === 'transcribing' || state === 'responding') && (
            <button type="button" style={ghostBtnStyle()} disabled>
              {t('companion.voice.processing')}
            </button>
          )}
          {state === 'speaking' && (
            <button type="button" style={primaryBtnStyle()} onClick={stopSpeaking}>
              {t('companion.voice.stopReading')}
            </button>
          )}
          {state === 'error' && (
            <button type="button" style={primaryBtnStyle()} onClick={() => { setError(null); setState('idle'); }}>
              {t('companion.voice.retry')}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 220 }}>
        <VoiceStateOrb state={state} />

        {transcript && (
          <div>
            <Pill mono>{t('companion.voice.youSaid')}</Pill>
            <p style={{ margin: '8px 0 0', fontSize: fontVars.sm, color: 'var(--g-text)', lineHeight: 1.55 }}>
              {transcript}
            </p>
          </div>
        )}

        {reply && (
          <div>
            <Pill tone="accent">{t('companion.voice.assistant')}</Pill>
            <p style={{ margin: '8px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {reply}
            </p>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'color-mix(in oklch, var(--g-danger) 12%, transparent)',
              border: '1px solid color-mix(in oklch, var(--g-danger) 32%, transparent)',
              color: 'var(--g-danger)',
              fontSize: fontVars.sm,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function VoiceStateOrb({ state }: { state: VoiceState }) {
  const color =
    state === 'listening' ? 'var(--g-dim-insight)' :
    state === 'responding' ? 'var(--g-dim-memory)' :
    state === 'speaking' ? 'var(--g-accent)' :
    state === 'error' ? 'var(--g-danger)' :
    'var(--g-text-muted)';
  const pulsing = state === 'listening' || state === 'speaking';
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
      <div
        style={{
          position: 'relative',
          width: 96,
          height: 96,
          borderRadius: 999,
          background: `radial-gradient(circle, color-mix(in oklch, ${color} 30%, transparent), transparent 60%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            border: `2px solid ${color}`,
            background: 'var(--g-surface-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
            animation: pulsing ? 'gedoVoicePulse 1.4s ease-in-out infinite' : 'none',
          }}
        >
          <IconWave size={24} />
        </div>
      </div>
      <style>{`
        @keyframes gedoVoicePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 ${color}55; }
          50% { transform: scale(1.06); box-shadow: 0 0 0 12px transparent; }
        }
      `}</style>
    </div>
  );
}
