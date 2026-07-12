'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname, Link } from '@/i18n/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { AccountMenu } from '@/app/components/gedo/AccountMenu';
import OnboardingQuest, { FINAL_STEP } from '@/app/components/onboarding/OnboardingQuest';
import { WelcomePreview } from '@/app/components/gedo/onboarding/WelcomePreview';
import { SettingsModal } from '@/app/components/account/SettingsModal';
import type { SettingsSectionId } from '@/app/components/account/AccountSectionNav';
import {
  IconChat,
  IconMemory,
  IconExec,
  IconInsight,
  IconLayers,
  IconSearch,
  IconCog,
} from '@/app/components/gedo/icons';
import { iconBtnStyle } from '@/app/components/gedo/primitives';
import { fontVars, text } from '@/app/components/gedo/typography';
import { ThemePicker } from '@/app/components/gedo/ThemePicker';

// 主导航 = 五个核心模块；设置在页脚（齿轮 + 头像）。label 走 i18n（app.nav.<id>）。
const NAV_ITEMS = [
  { id: 'companion', labelKey: 'nav.companion', href: '/app/companion', Icon: IconChat },
  { id: 'memory',    labelKey: 'nav.memory',    href: '/app/memory',    Icon: IconMemory },
  { id: 'action',    labelKey: 'nav.action',    href: '/app/today',     Icon: IconExec },
  { id: 'insights',  labelKey: 'nav.insights',  href: '/app/insights',  Icon: IconInsight },
  { id: 'avatar',    labelKey: 'nav.avatar',    href: '/app/avatar',    Icon: IconLayers },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user, accountLanguage, membership, membershipLoading, entitlements, logout, api } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? '';

  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [onboardingDismissedThisSession, setOnboardingDismissedThisSession] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | undefined>(undefined);
  const openSettings = (section?: SettingsSectionId) => { setSettingsSection(section); setSettingsOpen(true); };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // In-app language follows the account setting. If the URL [locale] differs from
  // the stored preference (e.g. entered from an English landing link), snap it
  // back so the whole product area stays in the account's language. A deliberate
  // switch updates the preference first, so this never fights the user's choice.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !accountLanguage) return;
    if (accountLanguage !== locale) {
      router.replace(pathname, { locale: accountLanguage });
    }
  }, [isLoading, isAuthenticated, accountLanguage, locale, pathname, router]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    let cancelled = false;
    api
      .getOnboardingStep()
      .then(res => { if (!cancelled) setOnboardingStep(res?.step ?? 0); })
      .catch(() => { if (!cancelled) setOnboardingStep(0); });
    return () => { cancelled = true; };
  }, [isAuthenticated, user, api]);

  // First-login welcome preview — shown once per browser, before the quest.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    try {
      if (!localStorage.getItem('gedo_welcome_v1_seen')) setShowWelcome(true);
    } catch { /* ignore */ }
  }, [isAuthenticated, user]);

  // Re-open the initial info-collection quest (人生快照) on demand, e.g. from the 画像 page.
  useEffect(() => {
    const open = () => {
      setOnboardingDismissedThisSession(false);
      setOnboardingStep(s => (s == null || s >= FINAL_STEP ? 0 : s));
    };
    window.addEventListener('gedo:open-onboarding', open);
    return () => window.removeEventListener('gedo:open-onboarding', open);
  }, []);

  // Open the settings modal from anywhere:
  //   window.dispatchEvent(new CustomEvent('gedo:open-settings', { detail: { section: 'mcp' } }))
  useEffect(() => {
    const open = (e: Event) => {
      const section = (e as CustomEvent).detail?.section as SettingsSectionId | undefined;
      setSettingsSection(section);
      setSettingsOpen(true);
    };
    window.addEventListener('gedo:open-settings', open);
    return () => window.removeEventListener('gedo:open-settings', open);
  }, []);

  // 在设置弹窗里切换语言会走 [locale] 路由、重挂本布局 → 用 sessionStorage 记住意图，
  // 重挂后自动把弹窗恢复到原分节（表现为"只刷新文字、弹窗不关"）。
  useEffect(() => {
    try {
      const reopen = sessionStorage.getItem('gedo_settings_reopen');
      if (reopen) {
        sessionStorage.removeItem('gedo_settings_reopen');
        setSettingsSection(reopen as SettingsSectionId);
        setSettingsOpen(true);
      }
    } catch { /* ignore */ }
  }, []);

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--g-bg)',
          color: 'var(--g-text-muted)',
          fontFamily: 'var(--g-font-sans)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: '2px solid var(--g-border)',
              borderTopColor: 'var(--g-accent)',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <p style={{ ...text.bodySm }}>{t('common.loading')}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const activeId =
    NAV_ITEMS.find(n => pathname.startsWith(n.href))?.id ??
    (pathname === '/app' ? 'companion' : undefined);

  return (
    <div
      className="gedo-app-shell"
      style={{
        height: '100dvh',
        width: '100%',
        background: 'var(--g-bg)',
        color: 'var(--g-text)',
        fontFamily: 'var(--g-font-sans)',
        display: 'flex',
        fontSize: fontVars.base,
        lineHeight: 'var(--g-leading-base)',
        letterSpacing: '-0.005em',
      }}
    >
      {/* Left rail — visible on desktop (>900px) */}
      <aside
        className="gedo-desktop-only gedo-app-side-rail"
        style={{
          width: 84,
          flexShrink: 0,
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0 0 16px',
          borderRight: '1px solid var(--g-border)',
          background: 'var(--g-bg-raised)',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center" style={{ height: 60, flexShrink: 0 }}>
          <Link href="/app" className="flex items-center group">
            <span
              className="block w-7 h-7 rounded-lg bg-gradient-to-r from-blue-600 to-emerald-600 group-hover:from-blue-500 group-hover:to-emerald-500 transition-all duration-300 flex-shrink-0"
              style={{
                WebkitMask: "url('/logo.png') center/contain no-repeat",
                mask: "url('/logo.png') center/contain no-repeat",
              }}
              role="img"
              aria-label="GEDO.AI"
            />
          </Link>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map(item => {
            const isActive = item.id === activeId;
            const { Icon } = item;
            return (
              <Link
                key={item.id}
                href={item.href}
                title={t(item.labelKey)}
                style={{
                  width: 60,
                  height: 48,
                  borderRadius: 12,
                  background: isActive ? 'var(--g-surface-1)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--g-border)' : 'transparent'}`,
                  color: isActive ? 'var(--g-text)' : 'var(--g-text-muted)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  position: 'relative',
                  overflow: 'hidden',
                  textDecoration: 'none',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                <Icon size={18} />
                <span style={{
                  fontSize: fontVars['2xs'],
                  letterSpacing: '0.02em',
                  maxWidth: 56,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>{t(item.labelKey)}</span>
                {isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      left: -16,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 2,
                      height: 18,
                      borderRadius: 2,
                      background: 'var(--g-accent)',
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={iconBtnStyle()}
            title={t('nav.searchHint')}
            onClick={() => {
              if (!pathname.startsWith('/app/companion')) {
                router.push('/app/companion');
              }
              setTimeout(() => window.dispatchEvent(new Event('gedo:focus-conv-search')), 80);
            }}
          >
            <IconSearch size={16} />
          </button>
          <button type="button" onClick={() => openSettings()} style={iconBtnStyle()} title={t('nav.settings')}>
            <IconCog size={16} />
          </button>
          <ThemePicker compact placement="right-end" usePortal />
          {/* 用户头像 → 账户菜单（身份 / 会员 / 设置 / 主页 / 帮助 / 退出登录） */}
          <div style={{ marginTop: 12 }}>
            <AccountMenu
              user={user}
              membership={membership}
              membershipLoading={membershipLoading}
              entitlements={entitlements}
              placement="right-end"
              size={32}
              onOpenSettings={openSettings}
              onLogout={logout}
            />
          </div>
        </div>
      </aside>

      {/* ===== Center Content (GUI) ===== */}
      <div className="gedo-app-center-col flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar (mobile only, ≤900px) */}
        <header
          className="gedo-app-mobile-header"
          style={{
            flexShrink: 0,
            background: 'color-mix(in oklch, var(--g-bg-raised) 94%, transparent)',
            borderBottom: '1px solid var(--g-border)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <Link href="/app" className="flex items-center gap-2" style={{ textDecoration: 'none', minWidth: 0 }}>
            <span
              className="block w-6 h-6 rounded-md bg-gradient-to-r from-blue-600 to-emerald-600"
              style={{
                WebkitMask: "url('/logo.png') center/contain no-repeat",
                mask: "url('/logo.png') center/contain no-repeat",
              }}
              role="img"
              aria-label="GEDO.AI"
            />
            <span className="font-bold text-[length:var(--g-text-base)]" style={{ color: 'var(--g-text)' }}>GEDO.AI</span>
          </Link>
          <div className="gedo-app-mobile-header-actions">
            <ThemePicker compact placement="bottom-end" usePortal />
            <button
              type="button"
              onClick={() => openSettings()}
              title={t('nav.settings')}
              style={{ ...iconBtnStyle(), flexShrink: 0 }}
            >
              <IconCog size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto gedo-app-main flex flex-col">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="gedo-app-bottom-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: 'color-mix(in oklch, var(--g-bg-raised) 92%, transparent)',
          borderTop: '1px solid var(--g-border)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="gedo-app-bottom-nav-inner">
          {NAV_ITEMS.map(item => {
            const isActive = item.id === activeId;
            const { Icon } = item;
            return (
              <Link
                key={item.id}
                href={item.href}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 12px',
                  color: isActive ? 'var(--g-accent)' : 'var(--g-text-muted)',
                  textDecoration: 'none',
                }}
              >
                <Icon size={20} />
                <span style={{ fontSize: fontVars.sm, fontWeight: 500 }}>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* First-login welcome preview — 对话 → 沉淀 → 洞察 → 突破，看完回到主界面 */}
      {showWelcome && (
        <WelcomePreview
          onDone={() => {
            try { localStorage.setItem('gedo_welcome_v1_seen', '1'); } catch { /* ignore */ }
            setShowWelcome(false);
            router.push('/app/companion');
          }}
        />
      )}

      {/* 7-day onboarding quest — only after the welcome preview is done */}
      {!showWelcome && onboardingStep !== null && onboardingStep < FINAL_STEP && !onboardingDismissedThisSession && (
        <OnboardingQuest
          initialStep={onboardingStep}
          onStepChange={next => setOnboardingStep(next)}
          onClose={() => setOnboardingDismissedThisSession(true)}
        />
      )}

      {/* 设置弹窗：外壳全局挂载，从齿轮 / 头像 / gedo:open-settings 事件打开 */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsSection}
      />
    </div>
  );
}
