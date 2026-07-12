'use client';

import { resolveApiBaseUrl } from '@/lib/apiClient';
import { getPreset, getTheme } from './presets';

interface PersonaAvatarProps {
  avatarKind: 'preset' | 'uploaded';
  avatarUrl?: string | null;
  presetId?: string | null;
  theme?: string | null;
  /** pixel diameter */
  size?: number;
  className?: string;
}

/** Resolve a possibly-relative uploads path against the backend base URL. */
export function resolveAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http')) return avatarUrl;
  return `${resolveApiBaseUrl()}${avatarUrl}`;
}

/**
 * Renders the digital human's static face — an uploaded photo or a preset
 * cartoon emoji on a themed gradient ring. Shared by the studio preview and
 * the public page so they stay visually identical.
 */
export function PersonaAvatar({
  avatarKind,
  avatarUrl,
  presetId,
  theme,
  size = 96,
  className = '',
}: PersonaAvatarProps) {
  const t = getTheme(theme);
  const resolved = avatarKind === 'uploaded' ? resolveAvatarUrl(avatarUrl) : null;

  return (
    <div
      className={`rounded-full bg-gradient-to-br ${t.from} ${t.to} p-1 flex items-center justify-center shadow-lg ${className}`}
      style={{ width: size, height: size }}
    >
      {resolved ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolved}
          alt="avatar"
          className="w-full h-full rounded-full object-cover"
        />
      ) : (
        <div
          className="w-full h-full rounded-full bg-slate-900/80 flex items-center justify-center"
          style={{ fontSize: size * 0.5 }}
        >
          <span>{getPreset(presetId).emoji}</span>
        </div>
      )}
    </div>
  );
}
