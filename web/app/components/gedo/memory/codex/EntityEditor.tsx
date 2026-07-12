'use client';

// 图鉴卡编辑器（新建/编辑，Modal 形态保留：表单密集 + 删除/邀请等破坏性
// 操作需要强焦点）。原样拆自 EntityCodexView。
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { Entity, EntityType } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';
import { Dot, ghostBtnStyle, primaryBtnStyle } from '@/app/components/gedo/primitives';
import { Modal } from '@/app/components/gedo/Modal';
import { DIM_KEYS, dimColor } from '../dimensions';
import { ENTITY_TYPE_KEYS, FACT_TEMPLATES, TYPE_FALLBACK_EMOJI, factKeyLabel, type Tr } from './shared';

export function EntityEditor({
  entity, personaSlug, onClose, onSaved,
}: {
  entity: Entity | null;
  personaSlug: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const [entityType, setEntityType] = useState<EntityType>(entity?.entity_type || 'person');
  const [name, setName] = useState(entity?.name || '');
  const [aliases, setAliases] = useState((entity?.aliases || []).join('、'));
  const [emoji, setEmoji] = useState(entity?.emoji || '');
  const [relation, setRelation] = useState(entity?.relation || '');
  const [note, setNote] = useState(entity?.note || '');
  const [facts, setFacts] = useState<{ k: string; v: string }[]>(entity?.facts || []);
  const [dimensions, setDimensions] = useState<string[]>(entity?.dimensions || []);
  const [aiExcluded, setAiExcluded] = useState(entity?.ai_excluded === true);
  const [avatarVisible, setAvatarVisible] = useState(entity?.avatar_visible === true);
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [inviteToken, setInviteToken] = useState(entity?.invite_token || null);
  const [linked, setLinked] = useState<{ id?: string; content_raw?: string; created_at?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entity?.id) return;
    let cancelled = false;
    api.listEntityEpisodes(entity.id, 20)
      .then((r) => { if (!cancelled) setLinked(r?.items || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, entity?.id]);

  const suggestedKeys = (FACT_TEMPLATES[entityType] || []).filter((k) => !facts.some((f) => f.k === k));

  const setFactValue = (k: string, v: string) => {
    setFacts((prev) => prev.map((f) => (f.k === k ? { ...f, v } : f)));
  };
  const removeFact = (k: string) => setFacts((prev) => prev.filter((f) => f.k !== k));
  const addFact = (k: string, v = '') => {
    const key = k.trim();
    if (!key || facts.some((f) => f.k === key)) return;
    setFacts((prev) => [...prev, { k: key, v }]);
  };

  const save = async () => {
    setBusy(true);
    try {
      const patch: Partial<Entity> = {
        entity_type: entityType,
        name: name.trim(),
        aliases: aliases.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean),
        emoji: emoji.trim(),
        relation: relation.trim(),
        note: note.trim(),
        facts: facts.map((f) => ({ k: f.k.trim(), v: f.v.trim() })).filter((f) => f.k && f.v),
        dimensions,
        ai_excluded: aiExcluded,
        avatar_visible: avatarVisible,
      };
      if (entity) await api.updateEntity(entity.id, patch);
      else await api.createEntity(patch);
      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entity) return;
    setBusy(true);
    try { await api.deleteEntity(entity.id); onSaved(); }
    finally { setBusy(false); }
  };

  const makeInvite = async () => {
    if (!entity) return;
    try {
      const r = await api.generateEntityInvite(entity.id);
      setInviteToken(r.invite_token);
    } catch (e) {
      console.error(e);
    }
  };

  const inviteUrl = inviteToken && personaSlug && typeof window !== 'undefined'
    ? `${window.location.origin}/p/${personaSlug}?invite=${inviteToken}` : '';

  const field: React.CSSProperties = {
    width: '100%', background: 'var(--g-bg)', border: '1px solid var(--g-border)',
    borderRadius: 8, padding: '7px 10px', fontSize: fontVars.sm, color: 'var(--g-text)', marginTop: 4,
    fontFamily: 'var(--g-font-sans)',
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: fontVars.sm, color: 'var(--g-text-mid)', fontWeight: 500, margin: '14px 0 6px',
  };
  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px', borderRadius: 999, cursor: 'pointer', fontSize: fontVars.sm,
    border: `1px solid ${active ? 'var(--g-accent-line, var(--g-border))' : 'var(--g-border)'}`,
    background: active ? 'var(--g-surface-2)' : 'transparent',
    color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
    fontFamily: 'var(--g-font-sans)',
  });

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="CODEX"
      title={entity ? t('memory.codex.editor.editTitle') : t('memory.codex.editor.newTitle')}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {entity && (
            <button type="button" onClick={remove} disabled={busy} style={{ ...ghostBtnStyle(), color: 'var(--g-danger, #c2554d)', marginRight: 'auto' }}>
              {t('memory.codex.editor.delete')}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} style={ghostBtnStyle()}>
            {t('memory.codex.editor.cancel')}
          </button>
          <button type="button" onClick={save} disabled={busy || !name.trim()} style={primaryBtnStyle()}>
            {t('memory.codex.editor.save')}
          </button>
        </div>
      }
    >
      <div style={{ padding: '16px 20px 24px' }}>
        {/* Basic info */}
        <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: 10 }}>
          <label style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
            {t('memory.codex.editor.emoji')}
            <input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 4))} style={{ ...field, textAlign: 'center' }} placeholder={TYPE_FALLBACK_EMOJI[entityType]} />
          </label>
          <label style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
            {t('memory.codex.editor.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} style={field} placeholder={t('memory.codex.editor.namePlaceholder')} />
          </label>
        </div>

        <div style={sectionLabel}>{t('memory.codex.editor.type')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ENTITY_TYPE_KEYS.map((key) => (
            <button key={key} type="button" onClick={() => setEntityType(key)} style={chipStyle(entityType === key)}>
              {TYPE_FALLBACK_EMOJI[key]} {t(`memory.codex.types.${key}` as Parameters<Tr>[0])}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <label style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
            {t('memory.codex.editor.relation')}
            <input value={relation} onChange={(e) => setRelation(e.target.value)} style={field} placeholder={t('memory.codex.editor.relationPlaceholder')} />
          </label>
          <label style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
            {t('memory.codex.editor.aliases')}
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} style={field} placeholder={t('memory.codex.editor.aliasesPlaceholder')} />
          </label>
        </div>

        {/* Facts */}
        <div style={sectionLabel}>{t('memory.codex.editor.facts')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {facts.map((f) => (
            <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                flexShrink: 0, fontSize: fontVars.xs, color: 'var(--g-text-muted)',
                padding: '3px 8px', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 999,
                maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {factKeyLabel(t, f.k)}
              </span>
              <input value={f.v} onChange={(e) => setFactValue(f.k, e.target.value)} style={{ ...field, marginTop: 0, flex: 1 }} placeholder={t('memory.codex.editor.valuePlaceholder')} />
              <button type="button" onClick={() => removeFact(f.k)} aria-label={t('memory.codex.editor.removeFact')} style={{ background: 'transparent', border: 'none', color: 'var(--g-text-faint)', cursor: 'pointer', padding: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6" /></svg>
              </button>
            </div>
          ))}
          {facts.length === 0 && (
            <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('memory.codex.editor.noFacts')}</div>
          )}
        </div>
        {suggestedKeys.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('memory.codex.editor.suggested')}</span>
            {suggestedKeys.map((k) => (
              <button key={k} type="button" onClick={() => addFact(k)} style={chipStyle(false)}>
                + {factKeyLabel(t, k)}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input value={customKey} onChange={(e) => setCustomKey(e.target.value)} style={{ ...field, marginTop: 0, width: 110, flexShrink: 0 }} placeholder={t('memory.codex.editor.customKeyPlaceholder')} />
          <input value={customValue} onChange={(e) => setCustomValue(e.target.value)} style={{ ...field, marginTop: 0, flex: 1 }} placeholder={t('memory.codex.editor.valuePlaceholder')} />
          <button
            type="button"
            style={ghostBtnStyle()}
            onClick={() => { addFact(customKey, customValue); setCustomKey(''); setCustomValue(''); }}
            disabled={!customKey.trim() || !customValue.trim()}
          >
            {t('memory.codex.editor.addFact')}
          </button>
        </div>

        {/* Note */}
        <div style={sectionLabel}>{t('memory.codex.editor.note')}</div>
        <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...field, marginTop: 0 }} placeholder={t('memory.codex.editor.notePlaceholder')} />

        {/* Dimensions */}
        <div style={sectionLabel}>{t('memory.codex.editor.dimensions')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DIM_KEYS.map((d) => {
            const active = dimensions.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDimensions((prev) => (active ? prev.filter((x) => x !== d) : [...prev, d]))}
                style={{ ...chipStyle(active), display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Dot color={dimColor(d)} size={6} />
                {t(`memory.profileDims.${d}` as Parameters<Tr>[0])}
              </button>
            );
          })}
        </div>

        {/* Privacy */}
        <div style={sectionLabel}>{t('memory.codex.editor.privacy')}</div>
        <PrivacyToggle
          checked={aiExcluded}
          onChange={setAiExcluded}
          label={t('memory.codex.editor.aiExcluded')}
          hint={t('memory.codex.editor.aiExcludedHint')}
          warnTone
        />
        <PrivacyToggle
          checked={avatarVisible}
          onChange={setAvatarVisible}
          label={t('memory.codex.editor.avatarVisible')}
          hint={t('memory.codex.editor.avatarVisibleHint')}
        />

        {/* Invite link (persons only) */}
        {entity && entityType === 'person' && (
          <>
            <div style={sectionLabel}>{t('memory.codex.editor.invite')}</div>
            {inviteUrl ? (
              <div style={{ fontSize: fontVars.sm }}>
                <code style={{ color: 'var(--g-text)', wordBreak: 'break-all' }}>{inviteUrl}</code>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(inviteUrl).catch(() => {}); }}
                  style={{ marginLeft: 8, fontSize: fontVars.sm, color: 'var(--g-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {t('memory.codex.editor.copy')}
                </button>
                <div style={{ marginTop: 4, color: 'var(--g-text-faint)', fontSize: fontVars.xs }}>{t('memory.codex.editor.inviteHint')}</div>
              </div>
            ) : inviteToken && !personaSlug ? (
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('memory.codex.editor.inviteNeedPublish')}</div>
            ) : (
              <button type="button" onClick={makeInvite} style={ghostBtnStyle()}>
                {t('memory.codex.editor.inviteGenerate')}
              </button>
            )}
          </>
        )}

        {/* Linked fragments */}
        {entity && (
          <>
            <div style={sectionLabel}>{t('memory.codex.editor.linkedEpisodes')}</div>
            {linked.length === 0 ? (
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('memory.codex.editor.noLinkedEpisodes')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {linked.map((ep, i) => (
                  <div key={ep.id ?? i} style={{ padding: 10, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10 }}>
                    <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.5 }}>
                      {(ep.content_raw || '').slice(0, 120)}
                    </div>
                    {ep.created_at && (
                      <div style={{ marginTop: 4, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                        {new Date(ep.created_at).toLocaleDateString(locale)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function PrivacyToggle({
  checked, onChange, label, hint, warnTone,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  warnTone?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
        padding: 10, marginBottom: 6, borderRadius: 10, cursor: 'pointer',
        background: 'var(--g-surface-1)', border: '1px solid var(--g-border)',
        color: 'inherit', fontFamily: 'var(--g-font-sans)',
      }}
    >
      <span style={{
        width: 30, height: 18, borderRadius: 999, flexShrink: 0, marginTop: 1,
        background: checked ? (warnTone ? 'var(--g-warn, #d9a441)' : 'var(--g-accent)') : 'var(--g-surface-2)',
        border: '1px solid var(--g-border)', position: 'relative', transition: 'background 0.15s',
      }}>
        <span style={{
          position: 'absolute', top: 1, left: checked ? 13 : 1, width: 14, height: 14,
          borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: fontVars.sm, color: 'var(--g-text)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginTop: 2, lineHeight: 1.5 }}>{hint}</span>
      </span>
    </button>
  );
}
