'use client';

// 外壳头像下拉菜单：身份(名/邮箱) · 会员等级(+升级/管理) · 设置 / 主页 / 帮助 · 退出登录。
// 触发器为头像；菜单走 portal 挂到 body，避免被侧栏 overflow 裁切。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Home, HelpCircle, LogOut, Settings as SettingsIcon, ArrowUpRight, ChevronRight, Crown, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { UserAvatar } from '@/app/components/UserAvatar';
import type { SettingsSectionId } from '@/app/components/account/AccountSectionNav';
import { fontVars } from './typography';

type Tier = 'free' | 'pro' | 'ultra';

export function AccountMenu({
  user,
  membership,
  membershipLoading,
  entitlements,
  placement = 'right-end',
  size = 32,
  onOpenSettings,
  onLogout,
}: {
  user: { id?: string; email?: string; display_name?: string | null; avatar_url?: string | null } | null;
  membership: { tier: Tier };
  membershipLoading: boolean;
  entitlements: { tier?: Tier } | null;
  placement?: 'right-end' | 'bottom-end';
  size?: number;
  onOpenSettings: (section?: SettingsSectionId) => void;
  onLogout: () => void;
}) {
  const t = useTranslations('app');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);

  const effectiveTier: Tier = membershipLoading ? 'free' : (entitlements?.tier ?? membership.tier);
  const displayName = user?.display_name?.trim() || user?.email?.split('@')[0] || 'GEDO';
  const isFree = effectiveTier === 'free';
  const tierLabel = effectiveTier === 'ultra' ? t('membership.tierUltra') : effectiveTier === 'pro' ? t('membership.tierPro') : t('membership.tierFree');

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('touchstart', onDoc, { passive: true });
    }, 0);
    document.addEventListener('keydown', onEsc);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const close = () => setOpen(false);
  const act = (fn: () => void) => { close(); fn(); };
  const hoverOn = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'var(--g-surface-2)');
  const hoverOff = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent');

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '8px 12px', borderRadius: 8, border: 'none', background: 'transparent',
    color: 'var(--g-text-mid)', fontSize: fontVars.sm, cursor: 'pointer', textAlign: 'left',
    fontFamily: 'var(--g-font-sans)', textDecoration: 'none',
  };

  // right-end：菜单出现在头像右侧、底边对齐（桌面侧栏）；bottom-end：出现在下方、右对齐（移动顶栏）。
  const menuPos: React.CSSProperties = !pos
    ? { left: -9999, top: -9999 }
    : placement === 'bottom-end'
      ? { top: pos.bottom + 8, right: Math.max(8, window.innerWidth - pos.right) }
      : { left: pos.right + 10, bottom: Math.max(8, window.innerHeight - pos.bottom) };

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        ...menuPos,
        width: 264,
        maxWidth: 'calc(100vw - 16px)',
        background: 'var(--g-bg-raised, var(--g-bg))',
        border: '1px solid var(--g-border)',
        borderRadius: 14,
        boxShadow: '0 16px 40px -18px oklch(0 0 0 / 0.5)',
        zIndex: 200,
        padding: 6,
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 12px' }}>
        <UserAvatar seed={user?.id || user?.email || 'G'} displayName={user?.display_name} email={user?.email} avatarUrl={user?.avatar_url} tier={effectiveTier} size={38} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</p>
          <p style={{ margin: '2px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</p>
        </div>
      </div>

      {/* Membership — 免费版：整卡为柔和渐变的升级 CTA；付费版：极简等级行 + 管理 */}
      {isFree ? (
        <Link
          href="/pricing"
          onClick={close}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            padding: '11px 14px', margin: '2px 4px 6px', borderRadius: 12, textDecoration: 'none',
            background: 'linear-gradient(135deg, color-mix(in oklch, var(--g-dim-memory) 13%, transparent), color-mix(in oklch, var(--g-dim-insight) 13%, transparent))',
            border: '1px solid color-mix(in oklch, var(--g-accent) 18%, transparent)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Sparkles size={17} style={{ color: 'var(--g-accent)', flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)', lineHeight: 1.25 }}>{t('settings.membership.upgrade')}</span>
              <span style={{ display: 'block', fontSize: fontVars.xs, color: 'var(--g-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tierLabel} · {t('shell.upgradeHint')}</span>
            </span>
          </span>
          <ArrowUpRight size={16} style={{ color: 'var(--g-accent)', flexShrink: 0 }} />
        </Link>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', margin: '2px 4px 6px', borderRadius: 12, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <Crown size={16} style={{ color: 'var(--g-accent)', flexShrink: 0 }} />
            <span style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>{tierLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => act(() => onOpenSettings('subscription'))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--g-text-muted)', fontSize: fontVars.sm, fontWeight: 500, fontFamily: 'var(--g-font-sans)', flexShrink: 0 }}
          >
            {t('shell.manage')}<ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Actions */}
      <button type="button" role="menuitem" style={itemStyle} onClick={() => act(() => onOpenSettings())} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
        <SettingsIcon size={16} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} /> {t('nav.settings')}
      </button>
      <Link href="/" role="menuitem" style={itemStyle} onClick={close} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
        <Home size={16} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} /> {t('shell.home')}
      </Link>
      <Link href="/help" role="menuitem" style={itemStyle} onClick={close} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
        <HelpCircle size={16} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} /> {t('shell.help')}
      </Link>

      <div style={{ height: 1, background: 'var(--g-border)', margin: '6px 2px' }} />

      <button
        type="button"
        role="menuitem"
        style={{ ...itemStyle, color: 'var(--g-danger)' }}
        onClick={() => act(onLogout)}
        onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in oklch, var(--g-danger) 15%, transparent)')}
        onMouseLeave={hoverOff}
      >
        <LogOut size={16} style={{ flexShrink: 0 }} /> {t('shell.logout')}
      </button>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user?.email ? t('shell.accountAndSettingsFor', { email: user.email }) : t('shell.accountAndSettings')}
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', borderRadius: '50%', display: 'inline-flex', lineHeight: 0 }}
      >
        <UserAvatar seed={user?.id || user?.email || 'G'} displayName={user?.display_name} email={user?.email} avatarUrl={user?.avatar_url} tier={effectiveTier} size={size} />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
