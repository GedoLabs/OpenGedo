'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, Loader2, X } from 'lucide-react';
import { PRESET_AVATARS } from './presets';
import { PersonaAvatar } from './PersonaAvatar';

interface AvatarPickerProps {
  avatarKind: 'preset' | 'uploaded';
  avatarUrl?: string | null;
  presetId?: string | null;
  theme?: string | null;
  /** Select a preset cartoon avatar. */
  onSelectPreset: (presetId: string) => void;
  /** Upload a photo; resolves when the avatar has been persisted. */
  onUpload: (file: File) => Promise<void>;
}

export function AvatarPicker({
  avatarKind,
  avatarUrl,
  presetId,
  theme,
  onSelectPreset,
  onUpload,
}: AvatarPickerProps) {
  const t = useTranslations('app');
  const presetLabel = (id: string) => t(`avatar.presetAvatars.${id}` as Parameters<typeof t>[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Close the cartoon picker on Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  const activePreset = avatarKind === 'preset'
    ? PRESET_AVATARS.find((p) => p.id === (presetId || 'default'))
    : undefined;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError(t('avatar.picker.fileTooLarge'));
      return;
    }
    setError(null);
    setUploading(true);
    try {
      await onUpload(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('avatar.picker.uploadError'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <PersonaAvatar
          avatarKind={avatarKind}
          avatarUrl={avatarUrl}
          presetId={presetId}
          theme={theme}
          size={72}
        />
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[length:var(--g-text-base)] text-white transition-colors disabled:opacity-60"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t('avatar.picker.uploadPhoto')}
          </button>
          <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-1.5">{t('avatar.picker.fileHint')}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {error && <p className="text-[length:var(--g-text-sm)] text-rose-400">{error}</p>}

      <div>
        <p className="text-[length:var(--g-text-sm)] text-slate-400 mb-2">{t('avatar.picker.chooseCartoonHint')}</p>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[length:var(--g-text-base)] text-white transition-colors"
        >
          <span className="text-lg leading-none">{activePreset?.emoji ?? '🙂'}</span>
          {activePreset ? t('avatar.picker.cartoonAvatarOf', { label: presetLabel(activePreset.id) }) : t('avatar.picker.chooseCartoonAvatar')}
        </button>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('avatar.picker.chooseCartoonAvatar')}
          onClick={() => setPickerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[length:var(--g-text-base)] font-semibold text-white">{t('avatar.picker.chooseCartoonAvatar')}</h3>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label={t('avatar.picker.close')}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {PRESET_AVATARS.map((p) => {
                const active = avatarKind === 'preset' && (presetId || 'default') === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={presetLabel(p.id)}
                    onClick={() => { onSelectPreset(p.id); setPickerOpen(false); }}
                    className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 text-2xl transition-all ${
                      active
                        ? 'bg-slate-700 ring-2 ring-emerald-500'
                        : 'bg-slate-800/60 hover:bg-slate-700/80'
                    }`}
                  >
                    {p.emoji}
                    <span className="text-[length:var(--g-text-sm)] text-slate-400 leading-none">{presetLabel(p.id)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
