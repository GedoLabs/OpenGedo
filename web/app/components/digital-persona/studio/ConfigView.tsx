'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import type { DigitalPersona, DigitalPersonaPatch } from '@/lib/apiClient';
import { AvatarPicker } from '../AvatarPicker';
import { PersonaAvatar } from '../PersonaAvatar';
import { PublicChat } from '../PublicChat';
import { THEME_LIST } from '../presets';
import { Field, SectionTitle } from './shared';
import { TwinCard } from '@/app/components/account/TwinSection';

const ACCESS_IDS = ['public', 'hybrid', 'passcode'] as const;

export function ConfigView({
  persona, patch, onUpload,
}: {
  persona: DigitalPersona;
  patch: (changes: DigitalPersonaPatch) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const t = useTranslations('app');
  const [newQuestion, setNewQuestion] = useState('');

  const addQuestion = () => {
    const q = newQuestion.trim();
    if (!q) return;
    patch({ suggested_questions: [...(persona.suggested_questions || []), q].slice(0, 6) });
    setNewQuestion('');
  };
  const removeQuestion = (idx: number) => {
    patch({ suggested_questions: persona.suggested_questions.filter((_, i) => i !== idx) });
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* ── Editor column ── */}
      <main
        className="gedo-main-padded"
        style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 28px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}
      >
        {/* Twin 分身模型养成卡（个人 LoRA，Wave 1） */}
        <TwinCard />

        {/* Identity notice */}
        <div
          style={{
            borderRadius: 12,
            border: '1px solid color-mix(in oklch, var(--g-dim-persona) 28%, transparent)',
            background: 'color-mix(in oklch, var(--g-dim-persona) 8%, transparent)',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>{t('avatar.config.identityTitle')}</div>
          <p style={{ margin: '4px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.55 }}>
            {t('avatar.config.identityBody', { name: persona.display_name || t('avatar.defaultAssistantName') })}
          </p>
        </div>

        {/* Access gate */}
        <section>
          <SectionTitle title={t('avatar.config.accessTitle')} mono="ACCESS" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ACCESS_IDS.map(id => {
              const active = persona.access_mode === id;
              return (
                <label
                  key={id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    border: `1px solid ${active ? 'color-mix(in oklch, var(--g-dim-persona) 50%, transparent)' : 'var(--g-border)'}`,
                    background: active ? 'color-mix(in oklch, var(--g-dim-persona) 10%, transparent)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="access_mode"
                    checked={active}
                    onChange={() => patch({ access_mode: id })}
                    style={{ marginTop: 2, accentColor: 'var(--g-dim-persona)' }}
                  />
                  <div>
                    <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)' }}>{t(`avatar.config.access.${id}.label`)}</div>
                    <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', marginTop: 1 }}>{t(`avatar.config.access.${id}.desc`)}</div>
                  </div>
                </label>
              );
            })}
            {persona.access_mode !== 'public' && (
              <Field label={t('avatar.config.passcodeLabel')}>
                <input
                  className="pin"
                  defaultValue={persona.passcode}
                  onBlur={(e) => e.target.value !== persona.passcode && patch({ passcode: e.target.value })}
                  placeholder={t('avatar.config.passcodePlaceholder')}
                />
              </Field>
            )}
            <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)', lineHeight: 1.5 }}>
              {t('avatar.config.inviteHint')}
            </p>
          </div>
        </section>

        {/* Avatar */}
        <section>
          <SectionTitle title={t('avatar.config.avatarTitle')} mono="AVATAR" />
          <AvatarPicker
            avatarKind={persona.avatar_kind}
            avatarUrl={persona.avatar_url}
            presetId={persona.preset_id}
            theme={persona.theme}
            onSelectPreset={(id) => patch({ avatar_kind: 'preset', preset_id: id })}
            onUpload={onUpload}
          />
        </section>

        {/* Profile */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionTitle title={t('avatar.config.profileTitle')} mono="PROFILE" />
          <Field label={t('avatar.config.displayNameLabel')}>
            <input
              className="pin"
              defaultValue={persona.display_name}
              onBlur={(e) => e.target.value !== persona.display_name && patch({ display_name: e.target.value })}
              placeholder={t('avatar.config.displayNamePlaceholder')}
            />
          </Field>
          <Field label={t('avatar.config.taglineLabel')}>
            <input
              className="pin"
              defaultValue={persona.tagline}
              onBlur={(e) => e.target.value !== persona.tagline && patch({ tagline: e.target.value })}
              placeholder={t('avatar.config.taglinePlaceholder')}
            />
          </Field>
          <Field label={t('avatar.config.greetingLabel')}>
            <textarea
              className="pin"
              defaultValue={persona.greeting}
              onBlur={(e) => e.target.value !== persona.greeting && patch({ greeting: e.target.value })}
              rows={2}
              placeholder={t('avatar.config.greetingPlaceholder')}
            />
          </Field>
        </section>

        {/* Suggested questions */}
        <section>
          <SectionTitle title={t('avatar.config.promptsTitle')} mono="PROMPTS" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {persona.suggested_questions.map((q, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--g-surface-1)', border: '1px solid var(--g-border)',
                  borderRadius: 8, padding: '8px 12px',
                }}
              >
                <span style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>{q}</span>
                <button
                  type="button"
                  onClick={() => removeQuestion(i)}
                  aria-label={t('avatar.config.deleteAria')}
                  style={{ background: 'transparent', border: 'none', color: 'var(--g-text-faint)', cursor: 'pointer', display: 'inline-flex' }}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            {persona.suggested_questions.length < 6 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  className="pin"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addQuestion()}
                  placeholder={t('avatar.config.addPlaceholder')}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={addQuestion}
                  aria-label={t('avatar.config.addAria')}
                  style={{
                    flexShrink: 0, width: 34, height: 34, borderRadius: 8,
                    background: 'var(--g-surface-2)', border: '1px solid var(--g-border)',
                    color: 'var(--g-text)', cursor: 'pointer', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Scope */}
        <section>
          <SectionTitle title={t('avatar.config.scopeTitle')} mono="SCOPE" desc={t('avatar.config.scopeDesc')} />
          <textarea
            className="pin"
            defaultValue={(persona.share_scope?.topics || []).join('、')}
            onBlur={(e) => {
              const topics = e.target.value.split(/[、,，\n]/).map(s => s.trim()).filter(Boolean);
              patch({ share_scope: { ...(persona.share_scope || { fields: [] }), topics } });
            }}
            rows={2}
            placeholder={t('avatar.config.scopePlaceholder')}
          />
        </section>

        {/* Theme */}
        <section>
          <SectionTitle title={t('avatar.config.themeTitle')} mono="THEME" />
          <div style={{ display: 'flex', gap: 8 }}>
            {THEME_LIST.map(theme => {
              const active = persona.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  title={t(`avatar.themeColors.${theme.id}` as Parameters<typeof t>[0])}
                  onClick={() => patch({ theme: theme.id })}
                  className={`bg-gradient-to-br ${theme.from} ${theme.to}`}
                  style={{
                    width: 34, height: 34, borderRadius: 999, cursor: 'pointer',
                    border: active ? '2px solid var(--g-text)' : '2px solid transparent',
                    transform: active ? 'scale(1.08)' : 'none',
                    transition: 'transform 0.12s ease',
                  }}
                />
              );
            })}
          </div>
        </section>
      </main>

      {/* ── Live preview aside (hidden < 900px via .gedo-aux-sidebar) ── */}
      <aside
        className="gedo-aux-sidebar"
        style={{
          width: 380, flexShrink: 0, borderLeft: '1px solid var(--g-border)',
          background: 'var(--g-bg-raised)', padding: 18, display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em', marginBottom: 10 }}>
          {t('avatar.config.previewLabel')} · PREVIEW
        </div>
        <div
          style={{
            flex: 1, minHeight: 0, borderRadius: 18, border: '1px solid var(--g-border)',
            background: 'var(--g-bg)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '22px 18px 14px', borderBottom: '1px solid var(--g-border)' }}>
            <PersonaAvatar
              avatarKind={persona.avatar_kind}
              avatarUrl={persona.avatar_url}
              presetId={persona.preset_id}
              theme={persona.theme}
              size={72}
            />
            <h3 style={{ margin: '10px 0 0', fontSize: fontVars.base, fontWeight: 700, color: 'var(--g-text)' }}>
              {t('avatar.assistantOf', { name: persona.display_name || t('avatar.defaultAssistantName') })}
            </h3>
            {persona.tagline && <p style={{ margin: '3px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{persona.tagline}</p>}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {persona.published && persona.slug ? (
              <PublicChat
                profile={{
                  slug: persona.slug,
                  display_name: persona.display_name,
                  tagline: persona.tagline,
                  greeting: persona.greeting,
                  avatar_kind: persona.avatar_kind,
                  avatar_url: persona.avatar_url,
                  preset_id: persona.preset_id,
                  suggested_questions: persona.suggested_questions,
                  theme: persona.theme,
                  access_mode: persona.access_mode,
                }}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
                {t('avatar.config.previewEmpty')}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
