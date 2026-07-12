'use client';

import { fontVars } from './typography';
import { useTranslations } from 'next-intl';
import { HUE_OPTIONS, useTheme, type AccentHue, type Theme } from '@/app/contexts/ThemeContext';
import { useFontScale } from '@/app/contexts/FontScaleContext';
import type { FontScalePref } from './typography';
import { IconSun, IconMoon, IconMonitor, IconCheck } from './icons';

const HUE_I18N: Record<AccentHue, string> = {
  145: 'emerald',
  75: 'amber',
  235: 'blue',
  305: 'purple',
  25: 'coral',
  195: 'teal',
};

const FONT_PREFS: FontScalePref[] = ['small', 'standard', 'large'];

const FONT_LABEL_KEYS: Record<FontScalePref, 'fontSizeSmall' | 'fontSizeStandard' | 'fontSizeLarge'> = {
  small: 'fontSizeSmall',
  standard: 'fontSizeStandard',
  large: 'fontSizeLarge',
};

const THEME_OPTS: { value: Theme; labelKey: 'modeDark' | 'modeLight' | 'modeAuto'; icon: React.ReactNode }[] = [
  { value: 'dark', labelKey: 'modeDark', icon: <IconMoon size={12} /> },
  { value: 'light', labelKey: 'modeLight', icon: <IconSun size={12} /> },
  { value: 'auto', labelKey: 'modeAuto', icon: <IconMonitor size={12} /> },
];

function segmentBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '8px 6px',
    background: active ? 'var(--g-surface-2)' : 'transparent',
    color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
    border: `1px solid ${active ? 'var(--g-accent-line)' : 'transparent'}`,
    borderRadius: 8,
    fontSize: fontVars.sm,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontFamily: 'var(--g-font-sans)',
  };
}

/** 设置页内联外观：主题 + 主色 + 字号，无说明段落。 */
export function AppearancePanel() {
  const t = useTranslations('app.settings.theme');
  const { theme, accentHue, setTheme, setAccent } = useTheme();
  const { fontScale, setFontScale } = useFontScale();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginBottom: 6 }}>{t('mode')}</div>
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 3,
            borderRadius: 10,
            background: 'var(--g-surface-1)',
            border: '1px solid var(--g-border)',
          }}
        >
          {THEME_OPTS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              style={segmentBtn(theme === opt.value)}
            >
              {opt.icon}
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginBottom: 6 }}>{t('accent')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {HUE_OPTIONS.map(o => {
            const active = o.hue === accentHue;
            const label = t(`accentColors.${HUE_I18N[o.hue as AccentHue]}` as never);
            return (
              <button
                key={o.hue}
                type="button"
                onClick={() => setAccent(o.hue as AccentHue)}
                title={label}
                aria-label={label}
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  padding: 0,
                  borderRadius: 999,
                  border: `2px solid ${active ? o.hex : 'transparent'}`,
                  background: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: o.hex,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {active && <IconCheck size={13} color="var(--g-accent-ink)" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginBottom: 6 }}>{t('fontSize')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {FONT_PREFS.map(pref => {
            const active = fontScale === pref;
            return (
              <button
                key={pref}
                type="button"
                onClick={() => setFontScale(pref)}
                style={{
                  ...segmentBtn(active),
                  flex: undefined,
                }}
              >
                {t(FONT_LABEL_KEYS[pref])}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
