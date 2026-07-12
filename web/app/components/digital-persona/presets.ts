/**
 * Shared presets for the public-facing digital human.
 * Cartoon avatars are emoji-based so v1 ships zero image assets while still
 * letting the owner pick a friendly face. Uploaded photos override these.
 */

// label 走 i18n（app.avatar.presetAvatars.<id>），UI 侧自行查表，这里只保留稳定的 id/emoji。
export interface PresetAvatar {
  id: string;
  emoji: string;
}

export const PRESET_AVATARS: PresetAvatar[] = [
  { id: 'default', emoji: '🤖' },
  { id: 'fox', emoji: '🦊' },
  { id: 'cat', emoji: '🐱' },
  { id: 'panda', emoji: '🐼' },
  { id: 'owl', emoji: '🦉' },
  { id: 'astronaut', emoji: '🧑‍🚀' },
  { id: 'wizard', emoji: '🧙' },
  { id: 'ghost', emoji: '👻' },
  { id: 'alien', emoji: '👽' },
  { id: 'sun', emoji: '🌞' },
  { id: 'sprout', emoji: '🌱' },
  { id: 'star', emoji: '⭐' },
];

export function getPreset(id: string | null | undefined): PresetAvatar {
  return PRESET_AVATARS.find((p) => p.id === id) || PRESET_AVATARS[0];
}

// label 走 i18n（app.avatar.themeColors.<id>）。
export interface Theme {
  id: string;
  /** Tailwind gradient stops for accents. */
  from: string;
  to: string;
  /** A solid accent used for text/buttons. */
  accent: string;
}

export const THEMES: Record<string, Theme> = {
  emerald: { id: 'emerald', from: 'from-emerald-500', to: 'to-teal-500', accent: 'text-emerald-400' },
  blue: { id: 'blue', from: 'from-blue-500', to: 'to-cyan-500', accent: 'text-blue-400' },
  violet: { id: 'violet', from: 'from-violet-500', to: 'to-fuchsia-500', accent: 'text-violet-400' },
  rose: { id: 'rose', from: 'from-rose-500', to: 'to-pink-500', accent: 'text-rose-400' },
  amber: { id: 'amber', from: 'from-amber-500', to: 'to-orange-500', accent: 'text-amber-400' },
};

export function getTheme(id: string | null | undefined): Theme {
  return THEMES[id || 'emerald'] || THEMES.emerald;
}

export const THEME_LIST = Object.values(THEMES);
