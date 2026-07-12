'use client';

import { useState, useEffect, useCallback } from 'react';
import { fontVars, text } from '@/app/components/gedo/typography';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Link, getPathname, useRouter, usePathname } from '@/i18n/navigation';
import {
  Settings,
  User,
  Bot,
  Bell,
  Shield,
  Languages,
  Clock,
  Loader2,
  Check,
  Crown,
  ExternalLink,
  Download,
  Trash2,
  AlertTriangle,
  Brain,
  LayoutDashboard,
  SlidersHorizontal,
  Palette,
  Camera,
  Pencil,
  X,
  Plug,
  KeyRound,
} from 'lucide-react';
import { isOSS } from '@/lib/edition';
import { McpToolsSection } from '@/app/components/gedo/settings/McpToolsSection';
import { DeveloperSection } from '@/app/components/gedo/settings/DeveloperSection';
import { TwinConsentBlock } from '@/app/components/account/TwinSection';
import { useAuth } from '@/app/contexts/AuthContext';
import { AppearancePanel } from '@/app/components/gedo/AppearancePanel';
import type { Locale } from '@/i18n/routing';
import { MembershipBadge } from '@/app/components/MembershipBadge';
import { UserAvatar } from '@/app/components/UserAvatar';
import { LanguageSelect } from '@/app/components/gedo/LanguageSelect';
import { AccountSectionNav, SETTINGS_SECTIONS, type SettingsSectionId } from '@/app/components/account/AccountSectionNav';
import { UsageStatusBadge } from '@/app/components/account/UsageStatusBadge';
import { formatPeriodEndTs } from '@/lib/membershipDisplay';
import { TimezoneSelect } from '@/app/components/gedo/TimezoneSelect';
import { LinkAccountButtons } from '@/app/components/account/LinkAccountButtons';
import type { ApiClient, AuthIdentity } from '@/lib/apiClient';

type TFn = ReturnType<typeof useTranslations>;

interface UserSettings {
  avatar_name: string;
  avatar_personality: 'friendly' | 'professional' | 'motivational' | 'gentle';
  language: string;
  timezone: string;
  llm_preference: string;
  notification_prefs: { morning: boolean; checkin: boolean; evening: boolean };
  privacy_settings: Record<string, unknown>;
  memory_settings?: { auto_accept_imports?: boolean };
}

// label/desc 走 i18n（app.settings.avatar.personality.<value> / <value>Desc）。
const PERSONALITY_VALUES = ['friendly', 'professional', 'motivational', 'gentle'] as const;

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--g-surface-2)',
  border: '1px solid var(--g-border)',
  borderRadius: 8,
  color: 'var(--g-text)',
  fontSize: fontVars.base,
  fontFamily: 'var(--g-font-sans)',
  outline: 'none',
};

const iconBtnLike: React.CSSProperties = {
  width: 22, height: 22, flexShrink: 0, borderRadius: 6,
  border: 'none', background: 'transparent', color: 'var(--g-text-faint)',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

// 两栏 ↔ 单栏断点：窄屏时侧边栏折叠为顶部横向 chip。
function useIsNarrow(breakpoint = 860) {
  const [narrow, setNarrow] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${breakpoint}px)`).matches : false),
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return narrow;
}

export interface SettingsPanelProps {
  variant?: 'page' | 'modal';
  onClose?: () => void;
  initialSection?: SettingsSectionId;
}

export function SettingsPanel({ variant = 'page', onClose, initialSection }: SettingsPanelProps) {
  const { api, user, token, logout, membership, entitlements, membershipLoading, refreshUser, setPreferredLocale } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const tierLabel = (tier: 'pro' | 'ultra') =>
    t(tier === 'ultra' ? 'membership.tierUltra' : 'membership.tierPro');
  const intervalLabel = (iv: string | null) =>
    t(iv === 'yearly' ? 'membership.intervalYearly' : iv === 'monthly' ? 'membership.intervalMonthly' : 'membership.intervalNone');
  // 登录方式标签：password → 邮箱密码；google/apple 各自标签；未知 provider 原样透出。
  const providerLabel = (p: string) =>
    p === 'google' ? t('settings.account.google')
      : p === 'apple' ? t('settings.account.apple')
      : p === 'password' ? t('settings.account.emailPassword')
      : p;
  const [portalLoading, setPortalLoading] = useState(false);
  const [authIdentities, setAuthIdentities] = useState<AuthIdentity[]>([]);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    avatar_name: '智伴',
    avatar_personality: 'friendly',
    language: 'zh',
    timezone: 'Asia/Shanghai',
    llm_preference: 'auto',
    notification_prefs: { morning: true, checkin: true, evening: true },
    privacy_settings: {},
    memory_settings: {},
  });
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [active, setActive] = useState<SettingsSectionId>(initialSection ?? 'overview');
  const narrow = useIsNarrow();

  // Deep-link: /app/settings#mcp opens that section directly (page variant only).
  useEffect(() => {
    if (variant !== 'page') return;
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    if (SETTINGS_SECTIONS.some(s => s.id === hash)) setActive(hash as SettingsSectionId);
  }, [variant]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.getSettings();
      const { theme: _theme, ...rest } = res ?? {};
      setSettings(prev => ({ ...prev, ...rest }));
    } catch { /* use defaults */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // 拉取真实登录身份（GET /v1/me/auth-identities）——只展示已连接的方式；失败则回落邮箱密码。
  const loadAuthIdentities = useCallback(async () => {
    try {
      const res = await api.getAuthIdentities();
      setAuthIdentities(res?.identities || []);
    } catch { /* keep email/password fallback */ }
  }, [api]);

  useEffect(() => { loadAuthIdentities(); }, [loadAuthIdentities]);

  // 解绑第三方登录方式：后端护栏保证不会解绑到"无可用登录方式"；这里只做交互态与错误回显。
  const handleUnlink = async (id: string) => {
    setAuthErr(null);
    setUnlinkingId(id);
    try {
      const res = await api.unlinkIdentity(id);
      setAuthIdentities(res?.identities || []);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setAuthErr(
        code.includes('last_login_method') ? t('settings.account.errLastMethod')
          : t('settings.account.errUnlinkFailed'),
      );
    } finally {
      setUnlinkingId(null);
    }
  };

  useEffect(() => {
    setSettings(prev => (prev.language === locale ? prev : { ...prev, language: locale }));
  }, [locale]);

  const openBillingPortal = async () => {
    if (!user?.email || !token) return;
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: user.email,
          returnPath: getPathname({ locale, href: '/app/settings' }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || t('settings.membership.portalError'));
      window.location.href = data.url;
    } catch { /* ignore */ }
    finally { setPortalLoading(false); }
  };

  // 自动保存：后端 PUT /v1/settings 为合并语义，只发改动字段即可（与语言切换一致）。
  const persist = useCallback(async (patch: Partial<UserSettings>) => {
    setSaveState('saving');
    try {
      await api.updateSettings(patch);
      setSaveState('saved');
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600);
    } catch {
      setSaveState('idle');
    }
  }, [api]);

  // 切换界面语言：持久化到账号 + 切换 [locale] 路由（即时重载文案）。弹窗内先记下"回到本分节"，
  // 路由重挂后由外壳自动恢复弹窗 —— 表现为只刷新文字、弹窗不关。
  const changeLanguage = (next: Locale) => {
    if (next === locale) return;
    setSettings(prev => ({ ...prev, language: next }));
    setPreferredLocale(next);
    void persist({ language: next });
    if (variant === 'modal') {
      try { sessionStorage.setItem('gedo_settings_reopen', active); } catch { /* ignore */ }
    }
    router.replace(pathname, { locale: next });
  };

  const updateNotif = (key: string, val: boolean) => {
    const next = { ...settings.notification_prefs, [key]: val };
    setSettings(prev => ({ ...prev, notification_prefs: next }));
    void persist({ notification_prefs: next });
  };

  const pauseMemory = settings.privacy_settings?.pause_memory === true;
  const togglePauseMemory = () => {
    const next = { ...settings.privacy_settings, pause_memory: !pauseMemory };
    setSettings(prev => ({ ...prev, privacy_settings: next }));
    void persist({ privacy_settings: next });
  };

  // 导入高置信自动收下（IA v2，默认开）：关闭后全部候选走收件箱人工确认
  const autoAccept = settings.memory_settings?.auto_accept_imports !== false;
  const toggleAutoAccept = () => {
    const next = { ...settings.memory_settings, auto_accept_imports: !autoAccept };
    setSettings(prev => ({ ...prev, memory_settings: next }));
    void persist({ memory_settings: next });
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.exportMemoryGmp();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'gedo-memory.gmp';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    finally { setExporting(false); }
  };

  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [wipePassword, setWipePassword] = useState('');
  const [wiping, setWiping] = useState(false);
  const [wipeErr, setWipeErr] = useState<string | null>(null);
  const handleWipe = async () => {
    setWiping(true);
    setWipeErr(null);
    try {
      await api.deleteAccount(wipePassword);
      logout();
    } catch (e) { setWipeErr(mapAccountErr(t, e)); setWiping(false); }
  };

  const [pwOpen, setPwOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const handleAvatarFile = async (file: File | null | undefined) => {
    if (!file) return;
    setAvatarErr(null);
    setAvatarUploading(true);
    try {
      await api.uploadAvatar(file);
      await refreshUser();
    } catch {
      setAvatarErr(t('settings.overview.avatarUploadFailed'));
    } finally {
      setAvatarUploading(false);
    }
  };
  const handleRemoveAvatar = async () => {
    setAvatarErr(null);
    setAvatarUploading(true);
    try {
      await api.removeAvatar();
      await refreshUser();
    } catch {
      setAvatarErr(t('settings.overview.avatarUploadFailed'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const startNameEdit = () => { setNameDraft(user?.display_name || ''); setNameEditing(true); };
  const saveName = async () => {
    setNameSaving(true);
    try {
      await api.updateProfile(nameDraft.trim());
      await refreshUser();
      setNameEditing(false);
    } catch { /* ignore — leave the field open so the user can retry */ }
    finally { setNameSaving(false); }
  };

  const displayName = user?.display_name?.trim() || user?.email?.split('@')[0] || 'GEDO';
  const joinedLabel = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';
  const effectiveTier = entitlements?.tier ?? membership.tier;
  const entitlementsLoading = membershipLoading;

  if (loading) {
    return (
      <div style={{ minHeight: variant === 'modal' ? 260 : '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 style={{ width: 28, height: 28, color: 'var(--g-text-faint)' }} className="animate-spin" />
      </div>
    );
  }

  // 弹窗：固定高度 + 三段式（页头 / 左菜单 固定，右内容独立滚动）；整页：正常文档流。
  const isModal = variant === 'modal';
  const rootStyle: React.CSSProperties = isModal
    ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
    : { width: '100%', maxWidth: narrow ? 640 : 980, margin: '0 auto', padding: '32px 16px' };
  const headerStyle: React.CSSProperties = isModal
    ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0, padding: narrow ? '16px 18px 14px' : '20px 28px 16px', borderBottom: '1px solid var(--g-border)' }
    : { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: narrow ? 20 : 24 };
  const bodyStyle: React.CSSProperties = isModal
    ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: narrow ? 0 : 24, padding: narrow ? '12px 18px 0' : '18px 28px 0' }
    : { display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: narrow ? 0 : 28, alignItems: 'flex-start' };
  const contentStyle: React.CSSProperties = isModal
    ? { flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }
    : { flex: 1, minWidth: 0, width: '100%', maxWidth: narrow ? undefined : 640, display: 'flex', flexDirection: 'column', gap: 16 };

  return (
    <div style={rootStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: fontVars.lg, fontWeight: 700, color: 'var(--g-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={22} style={{ color: 'var(--g-text-muted)' }} /> {t('settings.title')}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: fontVars.base, color: 'var(--g-text-muted)' }}>{t('settings.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <SaveStatus state={saveState} t={t} />
          {variant === 'modal' && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              title={t('common.close')}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, border: '1px solid var(--g-border)', background: 'var(--g-surface-1)', color: 'var(--g-text-muted)', cursor: 'pointer', flexShrink: 0 }}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div style={bodyStyle}>
        <AccountSectionNav active={active} onSelect={setActive} orientation={narrow ? 'horizontal' : 'vertical'} />

        <div style={contentStyle}>
        {active === 'overview' && (
        <Section id="overview" icon={LayoutDashboard} title={t('settings.overview.title')}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
              <label
                title={t('settings.overview.changeAvatar')}
                style={{ position: 'absolute', inset: 0, borderRadius: '50%', cursor: avatarUploading ? 'default' : 'pointer' }}
                className="gedo-avatar-upload"
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={avatarUploading}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; handleAvatarFile(f); }}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: avatarUploading ? 'default' : 'pointer' }}
                />
                <UserAvatar
                  seed={user?.id || user?.email || 'G'}
                  displayName={user?.display_name}
                  email={user?.email}
                  avatarUrl={user?.avatar_url}
                  tier={effectiveTier}
                  size={56}
                />
                <div
                  className="gedo-avatar-upload-overlay"
                  style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: avatarUploading ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: 'none',
                  }}
                >
                  {avatarUploading
                    ? <Loader2 size={18} className="animate-spin" style={{ color: 'white' }} />
                    : <Camera size={18} style={{ color: 'white' }} />}
                </div>
                <style>{`.gedo-avatar-upload:hover .gedo-avatar-upload-overlay { opacity: 1; }`}</style>
              </label>
              {user?.avatar_url && !avatarUploading && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  title={t('common.delete')}
                  style={{
                    position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: '50%',
                    background: 'var(--g-danger)', border: '2px solid var(--g-bg)', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {nameEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <input
                    type="text"
                    autoFocus
                    value={nameDraft}
                    onChange={e => setNameDraft(e.target.value)}
                    placeholder={t('settings.overview.namePlaceholder')}
                    maxLength={40}
                    onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setNameEditing(false); }}
                    style={{ ...INPUT_STYLE, padding: '5px 10px', maxWidth: 220 }}
                  />
                  <button
                    onClick={saveName}
                    disabled={nameSaving}
                    style={{ ...iconBtnLike, color: 'var(--g-accent)' }}
                    title={t('common.save')}
                  >
                    {nameSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button onClick={() => setNameEditing(false)} disabled={nameSaving} style={iconBtnLike} title={t('common.cancel')}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <p style={{ margin: 0, fontSize: fontVars.md, fontWeight: 600, color: 'var(--g-text)' }}>{displayName}</p>
                  <button onClick={startNameEdit} style={iconBtnLike} title={t('settings.overview.editName')}>
                    <Pencil size={12} />
                  </button>
                  {effectiveTier !== 'free' && <MembershipBadge tier={effectiveTier} language={locale as 'zh' | 'en' | 'ja'} />}
                </div>
              )}
              {avatarErr && <p style={{ margin: '0 0 4px', fontSize: fontVars.sm, color: 'oklch(0.65 0.18 25)' }}>{avatarErr}</p>}
              <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{user?.email}</p>
              <p style={{ margin: '4px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
                {t('settings.overview.joined')}: {joinedLabel}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {!isOSS() && (
              <GhostBtn onClick={() => setActive('subscription')}>
                {t('settings.overview.manageSubscription')}
              </GhostBtn>
            )}
            <GhostBtn onClick={handleExport}>{t('settings.overview.exportData')}</GhostBtn>
          </div>
        </Section>

        )}

        {active === 'account' && (
        <Section id="account" icon={User} title={t('settings.account.title')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 2 }}>{t('settings.account.email')}</label>
                <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)' }}>{user?.email || 'unknown'}</p>
              </div>
              <GhostBtn onClick={() => { setEmailOpen(o => !o); setPwOpen(false); }}>
                {emailOpen ? t('settings.account.collapse') : t('settings.account.changeEmail')}
              </GhostBtn>
            </div>
            {emailOpen && (
              <EmailChangeForm api={api} currentEmail={user?.email || ''} onSaved={refreshUser} onClose={() => setEmailOpen(false)} />
            )}

            <EmailVerifyRow api={api} />

            <div style={{ borderTop: '1px solid var(--g-border)', paddingTop: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 2 }}>{t('settings.account.password')}</label>
                <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)', letterSpacing: '0.1em' }}>••••••••</p>
              </div>
              <GhostBtn onClick={() => { setPwOpen(o => !o); setEmailOpen(false); }}>
                {pwOpen ? t('settings.account.collapse') : t('settings.account.changePassword')}
              </GhostBtn>
            </div>
            {pwOpen && (
              <PasswordChangeForm api={api} onClose={() => setPwOpen(false)} />
            )}

            <div style={{ borderTop: '1px solid var(--g-border)', paddingTop: 16 }}>
              <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 10 }}>
                {t('settings.account.loginMethods')}
              </label>
              {(() => {
                const list: AuthIdentity[] = authIdentities.length
                  ? authIdentities
                  : [{ id: 'password', provider: 'password', email: user?.email || null }];
                const hasPassword = list.some(i => i.provider === 'password');
                const socialCount = list.filter(i => i.provider !== 'password').length;
                const linked = new Set(list.map(i => i.provider));
                return (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {list.map((id) => {
                        // 只有非密码方式、且解绑后仍留有可用登录方式时才允许解绑（与后端护栏一致）。
                        const canUnlink = id.provider !== 'password' && !!id.id && (hasPassword || socialCount > 1);
                        return (
                          <LoginMethodRow
                            key={id.id || id.provider}
                            label={providerLabel(id.provider)}
                            email={id.email}
                            canUnlink={canUnlink}
                            unlinking={unlinkingId === id.id}
                            onUnlink={canUnlink ? () => handleUnlink(id.id) : undefined}
                            unlinkLabel={t('settings.account.disconnect')}
                          />
                        );
                      })}
                    </div>
                    {authErr && (
                      <p style={{ margin: '8px 0 0', fontSize: fontVars.sm, color: 'oklch(0.65 0.18 25)' }}>{authErr}</p>
                    )}
                    <LinkAccountButtons linked={linked} onLinked={setAuthIdentities} onError={setAuthErr} />
                  </>
                );
              })()}
            </div>
          </div>
        </Section>

        )}

        {active === 'subscription' && !isOSS() && (
        <Section id="subscription" icon={Crown} title={t('settings.membership.title')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('settings.membership.currentTier')}</span>
              {membershipLoading
                ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--g-text-faint)' }} />
                : <MembershipBadge tier={membership.tier} language={locale as 'zh' | 'en' | 'ja'} />
              }
            </div>

            {!membershipLoading && membership.tier !== 'free' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: fontVars.base }}>
                <Row label={t('settings.membership.planName')} value={tierLabel(membership.tier)} />
                <Row label={t('settings.membership.billingInterval')} value={intervalLabel(membership.interval)} />
                <Row label={t('settings.membership.periodEnd')} value={formatPeriodEndTs(membership.currentPeriodEnd, locale)} />
                {membership.cancelAtPeriodEnd && (
                  <p style={{ margin: 0, fontSize: fontVars.xs, color: 'oklch(0.8 0.12 80)', background: 'oklch(0.8 0.12 80 / 0.08)', border: '1px solid oklch(0.8 0.12 80 / 0.2)', borderRadius: 8, padding: '6px 12px' }}>
                    {t('settings.membership.cancelNotice')}
                  </p>
                )}
              </div>
            )}

            {!membershipLoading && membership.tier === 'free' && (
              <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text-muted)' }}>
                {t('settings.membership.freeNotice')}
              </p>
            )}

            <UsageStatusBadge
              tier={effectiveTier}
              smart={entitlements?.usage?.smart}
              visitor={entitlements?.usage?.visitor}
              loading={entitlementsLoading}
            />

            <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)', lineHeight: 1.5 }}>
              {t('settings.membership.benefitsSummary')}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
              <Link
                href="/pricing"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 10,
                  background: 'linear-gradient(to right, var(--g-dim-memory), var(--g-dim-insight))',
                  color: 'white', fontSize: fontVars.base, fontWeight: 500, textDecoration: 'none',
                }}
              >
                {membership.tier === 'free' ? t('settings.membership.upgrade') : t('settings.membership.viewPricing')}
                <ExternalLink size={13} style={{ opacity: 0.8 }} />
              </Link>
              {membership.tier !== 'free' && (
                <button
                  type="button"
                  onClick={openBillingPortal}
                  disabled={portalLoading || !user?.email}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 10,
                    border: '1px solid var(--g-border)', background: 'var(--g-surface-1)',
                    color: 'var(--g-text)', fontSize: fontVars.base, cursor: 'pointer',
                    fontFamily: 'var(--g-font-sans)', opacity: (portalLoading || !user?.email) ? 0.5 : 1,
                  }}
                >
                  {portalLoading
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Settings size={14} style={{ color: 'var(--g-text-muted)' }} />
                  }
                  {t('settings.membership.managePortal')}
                </button>
              )}
            </div>
          </div>
        </Section>

        )}

        {active === 'preferences' && (
        <Section id="preferences" icon={SlidersHorizontal} title={t('settings.preferences.title')}>
        <Section icon={Bot} title={t('settings.avatar.title')} nested>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 6 }}>{t('settings.avatar.nameLabel')}</label>
              <input
                type="text"
                value={settings.avatar_name}
                onChange={e => setSettings(prev => ({ ...prev, avatar_name: e.target.value }))}
                style={INPUT_STYLE}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--g-dim-persona)')}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--g-border)'; void persist({ avatar_name: settings.avatar_name.trim() }); }}
              />
            </div>
            <div>
              <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 8 }}>{t('settings.avatar.personalityLabel')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {PERSONALITY_VALUES.map(value => {
                  const active = settings.avatar_personality === value;
                  return (
                    <button
                      key={value}
                      onClick={() => { setSettings(prev => ({ ...prev, avatar_personality: value })); void persist({ avatar_personality: value }); }}
                      style={{
                        padding: '10px 12px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                        border: `1px solid ${active ? 'var(--g-dim-persona)' : 'var(--g-border)'}`,
                        background: active ? 'color-mix(in oklch, var(--g-dim-persona) 14%, transparent)' : 'var(--g-surface-1)',
                        fontFamily: 'var(--g-font-sans)',
                      }}
                    >
                      <p style={{ margin: 0, fontSize: fontVars.base, fontWeight: 500, color: active ? 'var(--g-dim-persona)' : 'var(--g-text)' }}>{t(`settings.avatar.personality.${value}`)}</p>
                      <p style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t(`settings.avatar.personality.${value}Desc`)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>

        <Section icon={Bell} title={t('settings.notifications.title')} nested>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(['morning', 'checkin', 'evening'] as const).map(key => {
              const on = settings.notification_prefs[key];
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)' }}>{t(`settings.notifications.${key}`)}</p>
                    <p style={{ margin: '1px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t(`settings.notifications.${key}Desc`)}</p>
                  </div>
                  <Toggle on={on} onClick={() => updateNotif(key, !on)} color="var(--g-accent)" />
                </div>
              );
            })}
          </div>
        </Section>

        <Section icon={Palette} title={t('settings.theme.title')} nested>
          <AppearancePanel />
        </Section>

        <Section icon={Languages} title={t('language.title')} nested>
          <LanguageSelect value={locale as Locale} onChange={changeLanguage} />
        </Section>

        <Section icon={Clock} title={t('language.timezone')} nested>
          <TimezoneSelect
            value={settings.timezone}
            onChange={tz => { setSettings(prev => ({ ...prev, timezone: tz })); void persist({ timezone: tz }); }}
          />
        </Section>
        </Section>
        )}

        {active === 'mcp' && (
        <Section id="mcp" icon={Plug} title={t('settings.mcp.title')}>
          <McpToolsSection />
        </Section>
        )}

        {active === 'developer' && (
        <Section id="developer" icon={KeyRound} title={t('settings.developer.title')}>
          <DeveloperSection />
        </Section>
        )}

        {active === 'privacy' && (
        <Section id="privacy" icon={Shield} title={t('settings.privacy.title')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingRight: 12 }}>
                <Brain size={15} style={{ color: 'var(--g-text-muted)', marginTop: 1, flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)' }}>{t('settings.privacy.pauseMemory')}</p>
                  <p style={{ margin: '1px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('settings.privacy.pauseMemoryDesc')}</p>
                </div>
              </div>
              <Toggle on={pauseMemory} onClick={togglePauseMemory} color="oklch(0.75 0.14 80)" />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingRight: 12 }}>
                <Brain size={15} style={{ color: 'var(--g-text-muted)', marginTop: 1, flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)' }}>{t('settings.privacy.autoAccept')}</p>
                  <p style={{ margin: '1px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('settings.privacy.autoAcceptDesc')}</p>
                </div>
              </div>
              <Toggle on={autoAccept} onClick={toggleAutoAccept} color="var(--g-accent)" />
            </div>

            {/* Twin 分身模型训练：独立同意（撤回=物理删除），Wave 1 */}
            <TwinConsentBlock />

            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px',
                borderRadius: 8, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)',
                cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'var(--g-font-sans)',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)' }}>{t('settings.privacy.export')}</p>
                <p style={{ margin: '1px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('settings.privacy.exportDesc')}</p>
              </div>
              {exporting
                ? <Loader2 size={15} className="animate-spin" style={{ color: 'var(--g-text-muted)' }} />
                : <Download size={15} style={{ color: 'var(--g-text-muted)' }} />
              }
            </button>

            <button
              onClick={() => { setWipeText(''); setWipeOpen(true); }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px',
                borderRadius: 8,
                background: 'color-mix(in oklch, oklch(0.55 0.22 25) 8%, transparent)',
                border: '1px solid color-mix(in oklch, oklch(0.55 0.22 25) 25%, transparent)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'var(--g-font-sans)',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: fontVars.base, color: 'oklch(0.65 0.18 25)' }}>{t('settings.privacy.wipe')}</p>
                <p style={{ margin: '1px 0 0', fontSize: fontVars.sm, color: 'oklch(0.65 0.18 25 / 0.6)' }}>{t('settings.privacy.wipeDesc')}</p>
              </div>
              <Trash2 size={15} style={{ color: 'oklch(0.65 0.18 25 / 0.7)', flexShrink: 0 }} />
            </button>

            <button
              onClick={logout}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px',
                borderRadius: 8, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)',
                cursor: 'pointer', fontFamily: 'var(--g-font-sans)',
              }}
            >
              <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text-mid)' }}>{t('settings.privacy.logout')}</p>
            </button>
          </div>
        </Section>
        )}
        </div>
      </div>

      {/* Wipe confirmation modal */}
      {wipeOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: 16 }}
          onClick={() => !wiping && setWipeOpen(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 440, borderRadius: 16, background: 'var(--g-bg)', border: '1px solid color-mix(in oklch, oklch(0.55 0.22 25) 30%, transparent)', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <AlertTriangle size={18} style={{ color: 'oklch(0.65 0.18 25)' }} />
              <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{t('settings.wipe.title')}</h3>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: fontVars.base, color: 'var(--g-text-muted)', lineHeight: 1.6 }}>
              {t('settings.wipe.warning')}
            </p>
            <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 4 }}>{t('settings.wipe.passwordLabel')}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={wipePassword}
              onChange={e => setWipePassword(e.target.value)}
              autoFocus
              placeholder={t('settings.wipe.passwordPlaceholder')}
              style={{ ...INPUT_STYLE, marginBottom: 10 }}
              onFocus={e => (e.currentTarget.style.borderColor = 'oklch(0.65 0.18 25)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--g-border)')}
            />
            <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 4 }}>
              {t.rich('settings.wipe.confirmLabel', {
                kw: (chunks) => <span style={{ color: 'oklch(0.65 0.18 25)', fontFamily: 'var(--g-font-mono)' }}>{chunks}</span>,
              })}
            </label>
            <input
              type="text"
              value={wipeText}
              onChange={e => setWipeText(e.target.value)}
              placeholder="DELETE"
              style={{ ...INPUT_STYLE, marginBottom: 8 }}
              onFocus={e => (e.currentTarget.style.borderColor = 'oklch(0.65 0.18 25)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--g-border)')}
            />
            {wipeErr && <p style={{ margin: '0 0 12px', fontSize: fontVars.sm, color: 'oklch(0.65 0.18 25)' }}>{wipeErr}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setWipeOpen(false); setWipePassword(''); setWipeText(''); setWipeErr(null); }}
                disabled={wiping}
                style={{
                  padding: '7px 16px', borderRadius: 10, border: '1px solid var(--g-border)',
                  background: 'var(--g-surface-1)', color: 'var(--g-text-mid)', fontSize: fontVars.base,
                  cursor: wiping ? 'not-allowed' : 'pointer', opacity: wiping ? 0.5 : 1,
                  fontFamily: 'var(--g-font-sans)',
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleWipe}
                disabled={wipeText !== 'DELETE' || !wipePassword || wiping}
                style={{
                  padding: '7px 16px', borderRadius: 10,
                  background: wipeText === 'DELETE' && wipePassword && !wiping ? 'oklch(0.55 0.22 25)' : 'var(--g-surface-2)',
                  color: wipeText === 'DELETE' && wipePassword && !wiping ? 'white' : 'var(--g-text-faint)',
                  border: 'none', fontSize: fontVars.base, fontWeight: 500, cursor: wipeText === 'DELETE' && wipePassword && !wiping ? 'pointer' : 'not-allowed',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--g-font-sans)',
                }}
              >
                {wiping ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                {t('settings.wipe.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ────────────────────────────────────────────────────────

// 平时不占位；仅在保存中/刚保存时短暂出现反馈，避免在页头留下常驻文案。
function SaveStatus({ state, t }: { state: 'idle' | 'saving' | 'saved'; t: TFn }) {
  if (state === 'idle') return null;
  const saving = state === 'saving';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, whiteSpace: 'nowrap', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
      {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} style={{ color: 'var(--g-accent)' }} />}
      {saving ? t('settings.saving') : t('settings.savedBtn')}
    </span>
  );
}

function Toggle({ on, onClick, color }: { on: boolean; onClick: () => void; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 36, height: 22, borderRadius: 999, border: 'none', flexShrink: 0,
        background: on ? color : 'var(--g-surface-2)',
        position: 'relative', cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 16, height: 16, background: 'white', borderRadius: 999,
        position: 'absolute', top: 3,
        left: on ? 17 : 3,
        transition: 'left 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

function GhostBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)',
        border: '1px solid var(--g-border)', background: 'transparent',
        borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
        fontFamily: 'var(--g-font-sans)',
      }}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: 'var(--g-text-faint)' }}>{label}</span>
      <span style={{ color: 'var(--g-text)' }}>{value}</span>
    </div>
  );
}

function Section({ id, icon: Icon, title, children, nested }: { id?: string; icon: any; title: string; children: React.ReactNode; nested?: boolean }) {
  if (nested) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon size={14} style={{ color: 'var(--g-text-muted)' }} />
          <h4 style={{ margin: 0, fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text-mid)' }}>{title}</h4>
        </div>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ borderRadius: 12, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', padding: 20, scrollMarginTop: 72 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Icon size={15} style={{ color: 'var(--g-text-muted)' }} />
        <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text-mid)' }}>{title}</h3>
      </div>
      {children}
    </motion.div>
  );
}

function LoginMethodRow({ label, email, canUnlink, unlinking, onUnlink, unlinkLabel }: {
  label: string;
  email?: string | null;
  canUnlink?: boolean;
  unlinking?: boolean;
  onUnlink?: () => void;
  unlinkLabel?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '8px 10px', borderRadius: 8, background: 'var(--g-surface-2)', border: '1px solid var(--g-border)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: fontVars.base, color: 'var(--g-text)' }}>{label}</span>
        {email ? (
          <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
        ) : null}
      </div>
      {canUnlink && onUnlink ? (
        <button
          type="button"
          onClick={onUnlink}
          disabled={unlinking}
          style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: fontVars.sm, color: 'var(--g-text-mid)',
            border: '1px solid var(--g-border)', background: 'transparent',
            borderRadius: 8, padding: '4px 10px', cursor: unlinking ? 'default' : 'pointer',
            opacity: unlinking ? 0.6 : 1, fontFamily: 'var(--g-font-sans)',
          }}
        >
          {unlinking ? <Loader2 size={12} className="animate-spin" /> : null}
          {unlinkLabel}
        </button>
      ) : (
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', flexShrink: 0 }}>✓</span>
      )}
    </div>
  );
}

// ── Account security forms ───────────────────────────────────────────────────

const ACCOUNT_ERR_CODES = [
  'bad_credentials', 'weak_password', 'same_password', 'invalid_email',
  'email_taken', 'same_email', 'bad_json', 'unauthorized',
];

// 把后端错误码映射为本地化文案；非已知码且像人类可读信息则原样透出，否则回落通用提示。
function mapAccountErr(t: TFn, e: unknown): string {
  const m = e instanceof Error ? e.message : '';
  if (ACCOUNT_ERR_CODES.includes(m)) return t(`settings.errors.${m}`);
  if (m && !m.startsWith('API ') && !m.startsWith('Failed')) return m;
  return t('settings.errors.generic');
}

function PasswordChangeForm({ api, onClose }: { api: ApiClient; onClose: () => void }) {
  const t = useTranslations('app');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setErr(null);
    if (next.length < 6) { setErr(t('settings.errors.weak_password')); return; }
    if (next !== confirm) { setErr(t('settings.errors.passwordMismatch')); return; }
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      setOk(true);
      setTimeout(onClose, 1100);
    } catch (e) { setErr(mapAccountErr(t, e)); }
    finally { setBusy(false); }
  };

  if (ok) return <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-accent)' }}>{t('settings.passwordForm.changed')}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', borderRadius: 10, padding: 12 }}>
      <input type="password" autoComplete="current-password" placeholder={t('settings.passwordForm.current')} value={cur} onChange={e => setCur(e.target.value)} style={INPUT_STYLE} />
      <input type="password" autoComplete="new-password" placeholder={t('settings.passwordForm.new')} value={next} onChange={e => setNext(e.target.value)} style={INPUT_STYLE} />
      <input type="password" autoComplete="new-password" placeholder={t('settings.passwordForm.confirm')} value={confirm} onChange={e => setConfirm(e.target.value)} style={INPUT_STYLE} />
      {err && <p style={{ margin: 0, fontSize: fontVars.sm, color: 'oklch(0.65 0.18 25)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 2 }}>
        <button onClick={onClose} disabled={busy} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--g-text-muted)', fontSize: fontVars.sm, cursor: 'pointer', fontFamily: 'var(--g-font-sans)' }}>{t('common.cancel')}</button>
        <button
          onClick={submit}
          disabled={busy || !cur || !next || !confirm}
          style={{
            padding: '5px 14px', borderRadius: 8, border: 'none',
            background: (busy || !cur || !next || !confirm) ? 'var(--g-surface-2)' : 'var(--g-accent)',
            color: (busy || !cur || !next || !confirm) ? 'var(--g-text-faint)' : 'white',
            fontSize: fontVars.sm, fontWeight: 500, cursor: (busy || !cur || !next || !confirm) ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--g-font-sans)',
          }}
        >
          {busy && <Loader2 size={11} className="animate-spin" />}{t('common.save')}
        </button>
      </div>
    </div>
  );
}

function EmailChangeForm({ api, currentEmail, onSaved, onClose }: { api: ApiClient; currentEmail: string; onSaved: () => Promise<void>; onClose: () => void }) {
  const t = useTranslations('app');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr(t('settings.errors.invalid_email')); return; }
    if (email.trim().toLowerCase() === currentEmail.trim().toLowerCase()) { setErr(t('settings.errors.same_email')); return; }
    setBusy(true);
    try {
      await api.changeEmail(pw, email.trim());
      await onSaved();
      setOk(true);
      setTimeout(onClose, 1100);
    } catch (e) { setErr(mapAccountErr(t, e)); }
    finally { setBusy(false); }
  };

  if (ok) return <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-accent)' }}>{t('settings.emailForm.updated')}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', borderRadius: 10, padding: 12 }}>
      <input type="email" autoComplete="email" placeholder={t('settings.emailForm.newEmail')} value={email} onChange={e => setEmail(e.target.value)} style={INPUT_STYLE} />
      <input type="password" autoComplete="current-password" placeholder={t('settings.emailForm.currentPassword')} value={pw} onChange={e => setPw(e.target.value)} style={INPUT_STYLE} />
      {err && <p style={{ margin: 0, fontSize: fontVars.sm, color: 'oklch(0.65 0.18 25)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 2 }}>
        <button onClick={onClose} disabled={busy} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--g-text-muted)', fontSize: fontVars.sm, cursor: 'pointer', fontFamily: 'var(--g-font-sans)' }}>{t('common.cancel')}</button>
        <button
          onClick={submit}
          disabled={busy || !email || !pw}
          style={{
            padding: '5px 14px', borderRadius: 8, border: 'none',
            background: (busy || !email || !pw) ? 'var(--g-surface-2)' : 'var(--g-accent)',
            color: (busy || !email || !pw) ? 'var(--g-text-faint)' : 'white',
            fontSize: fontVars.sm, fontWeight: 500, cursor: (busy || !email || !pw) ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--g-font-sans)',
          }}
        >
          {busy && <Loader2 size={11} className="animate-spin" />}{t('common.save')}
        </button>
      </div>
    </div>
  );
}

// 重发验证信：/v1/me 不回传 email_verified,故做成"随时可发"的动作,
// 后端已验证会回 already_verified:true → 文案切"已验证",不误导。
function EmailVerifyRow({ api }: { api: ApiClient }) {
  const t = useTranslations('app');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'already' | 'failed'>('idle');

  const resend = async () => {
    if (status === 'sending') return;
    setStatus('sending');
    try {
      const res = await api.resendVerification();
      setStatus(res?.already_verified ? 'already' : 'sent');
    } catch {
      setStatus('failed');
    }
  };

  const hintColor = status === 'sent' || status === 'already' ? 'var(--g-accent)'
    : status === 'failed' ? 'oklch(0.65 0.18 25)'
    : 'var(--g-text-muted)';
  const hint = status === 'sent' ? t('settings.account.verifySent')
    : status === 'already' ? t('settings.account.verifyAlready')
    : status === 'failed' ? t('settings.account.verifyFailed')
    : t('settings.account.verifyHint');

  return (
    <div style={{ borderTop: '1px solid var(--g-border)', paddingTop: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <label style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'block', marginBottom: 2 }}>
          {t('settings.account.emailVerification')}
        </label>
        <p style={{ margin: 0, fontSize: fontVars.sm, color: hintColor }}>{hint}</p>
      </div>
      <GhostBtn onClick={resend}>
        {status === 'sending' ? t('settings.account.verifySending') : t('settings.account.resendVerification')}
      </GhostBtn>
    </div>
  );
}
