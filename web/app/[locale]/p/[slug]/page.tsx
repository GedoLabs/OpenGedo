'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  getPublicPersona,
  verifyPersona,
  identifyVisitor,
  type PublicPersonaProfile,
} from '@/lib/apiClient';
import { PersonaAvatar } from '@/app/components/digital-persona/PersonaAvatar';
import { PublicChat } from '@/app/components/digital-persona/PublicChat';
import { getTheme } from '@/app/components/digital-persona/presets';

type Step = 'loading' | 'gate' | 'identify' | 'chat' | 'not_found' | 'error';

export default function PublicPersonaPage() {
  const params = useParams();
  const search = useSearchParams();
  const slug = Array.isArray(params?.slug) ? params.slug[0] : (params?.slug as string | undefined);
  const inviteToken = search?.get('invite') || undefined;

  const [profile, setProfile] = useState<PublicPersonaProfile | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [matchedName, setMatchedName] = useState<string | null>(null);

  // Load profile, then route by access_mode / invite token.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      let p: PublicPersonaProfile;
      try {
        p = await getPublicPersona(slug);
      } catch (e) {
        if (!cancelled) setStep((e as Error)?.message === 'not_found' ? 'not_found' : 'error');
        return;
      }
      if (cancelled) return;
      setProfile(p);

      if (inviteToken) {
        try {
          const r = await verifyPersona(slug, { invite_token: inviteToken });
          if (cancelled) return;
          setSessionToken(r.session_token);
          setMatchedName(r.visitor.name);
          setStep('chat'); // invite identifies the visitor — skip the identity step
          return;
        } catch { /* fall through to normal gating */ }
      }

      if (p.access_mode === 'public') {
        try {
          const r = await verifyPersona(slug, {});
          if (cancelled) return;
          setSessionToken(r.session_token);
          setStep('identify');
        } catch {
          if (!cancelled) setStep('error');
        }
      } else {
        setStep('gate'); // passcode / hybrid → ask for passcode (hybrid allows anonymous)
      }
    })();
    return () => { cancelled = true; };
  }, [slug, inviteToken]);

  const onVerified = useCallback((token: string, name: string | null) => {
    setSessionToken(token);
    setMatchedName(name);
    setStep(name ? 'chat' : 'identify');
  }, []);

  // ── render states ──
  if (step === 'loading') {
    return <Centered><Spinner /> 正在加载…</Centered>;
  }
  if (step === 'not_found' || step === 'error' || !profile) {
    return (
      <Centered>
        <div className="text-center">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-lg text-[var(--g-text)] mb-1">{step === 'not_found' ? '找不到这个数字人' : '加载失败'}</p>
          <p className="text-[length:var(--g-text-base)]">{step === 'not_found' ? '链接可能已失效或尚未发布。' : '请稍后重试。'}</p>
        </div>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--g-bg)] flex items-center justify-center p-0 sm:p-6">
      <div className="w-full sm:max-w-md h-screen sm:h-[640px] bg-[var(--g-bg-raised)] sm:rounded-3xl sm:border sm:border-[var(--g-border)] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex flex-col items-center text-center px-6 pt-8 pb-5 border-b border-[var(--g-border)]">
          <PersonaAvatar
            avatarKind={profile.avatar_kind}
            avatarUrl={profile.avatar_url}
            presetId={profile.preset_id}
            theme={profile.theme}
            size={84}
          />
          <h1 className="mt-3 text-lg font-bold text-[var(--g-text)]">{profile.display_name} 的智能助理</h1>
          {profile.tagline && <p className="mt-1 text-[length:var(--g-text-base)] text-[var(--g-text-muted)]">{profile.tagline}</p>}
          {matchedName && step === 'chat' && (
            <p className="mt-1 text-[length:var(--g-text-sm)] text-[var(--g-dim-persona)]">已识别：{matchedName}</p>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0">
          {step === 'gate' && (
            <GateForm slug={slug!} profile={profile} onVerified={onVerified} />
          )}
          {step === 'identify' && sessionToken && (
            <IdentifyForm
              slug={slug!}
              profile={profile}
              sessionToken={sessionToken}
              onDone={(name) => { setMatchedName(name); setStep('chat'); }}
            />
          )}
          {step === 'chat' && sessionToken && (
            <PublicChat profile={profile} sessionToken={sessionToken} />
          )}
        </div>

        <div className="px-4 py-2 text-center text-[length:var(--g-text-sm)] text-[var(--g-text-faint)] border-t border-[var(--g-border)]">
          由 GEDO.AI 数字分身驱动 · 仅基于公开档案作答
        </div>
      </div>
    </div>
  );
}

function GateForm({
  slug,
  profile,
  onVerified,
}: {
  slug: string;
  profile: PublicPersonaProfile;
  onVerified: (token: string, name: string | null) => void;
}) {
  const theme = getTheme(profile.theme);
  const [passcode, setPasscode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (anonymous = false) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await verifyPersona(slug, anonymous ? {} : { passcode });
      onVerified(r.session_token, r.visitor.name);
    } catch (e) {
      const msg = (e as Error)?.message;
      setErr(msg === 'passcode_required' || msg === 'forbidden' ? '口令不正确' : '验证失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center">
      <div className="text-3xl mb-3">🔒</div>
      <p className="text-[length:var(--g-text-base)] text-[var(--g-text-mid)] mb-1">这是一个受保护的数字人</p>
      <p className="text-[length:var(--g-text-sm)] text-[var(--g-text-faint)] mb-5">请输入分享口令{profile.access_mode === 'hybrid' ? '，或匿名进入轻量对话' : ''}。</p>
      <input
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && passcode.trim() && submit(false)}
        type="password"
        placeholder="口令"
        className="w-full max-w-xs bg-[var(--g-surface-1)] border border-[var(--g-border)] rounded-lg px-4 py-2.5 text-[length:var(--g-text-base)] text-[var(--g-text)] placeholder-[var(--g-text-faint)] outline-none focus:border-[var(--g-border-hi)]"
      />
      {err && <p className="text-[length:var(--g-text-sm)] text-[var(--g-danger)] mt-2">{err}</p>}
      <button
        onClick={() => submit(false)}
        disabled={busy || !passcode.trim()}
        className={`mt-4 w-full max-w-xs py-2.5 rounded-lg bg-gradient-to-br ${theme.from} ${theme.to} text-white text-[length:var(--g-text-base)] font-medium disabled:opacity-50`}
      >
        进入
      </button>
      {profile.access_mode === 'hybrid' && (
        <button onClick={() => submit(true)} disabled={busy} className="mt-2 text-[length:var(--g-text-sm)] text-[var(--g-text-muted)] hover:text-[var(--g-text-mid)]">
          匿名进入
        </button>
      )}
    </div>
  );
}

function IdentifyForm({
  slug,
  profile,
  sessionToken,
  onDone,
}: {
  slug: string;
  profile: PublicPersonaProfile;
  sessionToken: string;
  onDone: (name: string | null) => void;
}) {
  const theme = getTheme(profile.theme);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const declared = name.trim();
    if (!declared) { onDone(null); return; }
    setBusy(true);
    try {
      const r = await identifyVisitor(slug, { session_token: sessionToken, declared_name: declared });
      onDone(r.matched ? r.name : declared);
    } catch {
      onDone(declared);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center">
      <div className="text-3xl mb-3">👋</div>
      <p className="text-[length:var(--g-text-base)] text-[var(--g-text-mid)] mb-1">怎么称呼你？</p>
      <p className="text-[length:var(--g-text-sm)] text-[var(--g-text-faint)] mb-5">报上名字后，助理能更好地认出你（可跳过）。</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="你的名字 / 称呼"
        className="w-full max-w-xs bg-[var(--g-surface-1)] border border-[var(--g-border)] rounded-lg px-4 py-2.5 text-[length:var(--g-text-base)] text-[var(--g-text)] placeholder-[var(--g-text-faint)] outline-none focus:border-[var(--g-border-hi)]"
      />
      <button
        onClick={submit}
        disabled={busy}
        className={`mt-4 w-full max-w-xs py-2.5 rounded-lg bg-gradient-to-br ${theme.from} ${theme.to} text-white text-[length:var(--g-text-base)] font-medium disabled:opacity-50`}
      >
        开始对话
      </button>
      <button onClick={() => onDone(null)} disabled={busy} className="mt-2 text-[length:var(--g-text-sm)] text-[var(--g-text-muted)] hover:text-[var(--g-text-mid)]">
        跳过
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--g-bg)] flex items-center justify-center text-[var(--g-text-muted)] px-6">
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Spinner() {
  return <span className="w-5 h-5 rounded-full border-2 border-[var(--g-border)] border-t-[var(--g-dim-persona)] animate-spin inline-block" />;
}
