'use client';

import { fontVars, text } from '../typography';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { Field, TextArea, Select, TagInput } from '@/app/components/gedo/FormField';
import { primaryBtnStyle, ghostBtnStyle, Dot } from '@/app/components/gedo/primitives';
import { DIM_KEYS, dimColor } from '@/app/components/gedo/memory/dimensions';

type MemoryType = 'important_info' | 'observation' | 'goal_related' | 'reflection' | 'general';
// 手动记录只可能是文本/语音；'chat_extract' 是曾经的误选项（后端枚举外脏值，
// 对话提取由系统自动写入 chat/auto_extract，不该人工标注），已下线。
type MemorySource = 'text' | 'voice';

const TYPE_VALUES: MemoryType[] = ['important_info', 'observation', 'goal_related', 'reflection', 'general'];
const SOURCE_VALUES: MemorySource[] = ['text', 'voice'];

/**
 * Memory capture modal — invoked from the composer 智忆 button or
 * MemoryScreen "手动记录". Calls api.captureMemory and lets the parent
 * refresh the timeline via onSaved.
 */
export function MemoryCaptureModal({
  open, onClose, onSaved, initialText = '',
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (memory: { content_raw: string; tags: string[] }) => void;
  initialText?: string;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const typeOptions = TYPE_VALUES.map(v => ({ value: v, label: t(`companion.memoryModal.category.${v}`) }));
  const sourceOptions = SOURCE_VALUES.map(v => ({ value: v, label: t(`companion.memoryModal.source.${v}`) }));
  const [content, setContent] = useState(initialText);
  const [type, setType] = useState<MemoryType>('important_info');
  const [source, setSource] = useState<MemorySource>('text');
  const [tags, setTags] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = content.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.captureMemory({
        type,
        content_raw: content.trim(),
        tags,
        source,
        dimensions,
      });
      onSaved?.({ content_raw: content.trim(), tags });
      setContent('');
      setTags([]);
      setDimensions([]);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('companion.memoryModal.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('companion.memoryModal.eyebrow')}
      title={t('companion.memoryModal.title')}
      size="md"
      footer={
        <>
          <button type="button" style={ghostBtnStyle()} onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={{
              ...primaryBtnStyle(),
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? 'pointer' : 'default',
            }}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? t('companion.memoryModal.saving') : t('companion.memoryModal.save')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label={t('companion.memoryModal.contentLabel')} required>
          <TextArea
            value={content}
            onChange={setContent}
            placeholder={t('companion.memoryModal.contentPlaceholder')}
            rows={5}
            autoFocus
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={t('companion.memoryModal.typeLabel')}>
            <Select value={type} onChange={setType} options={typeOptions} />
          </Field>
          <Field label={t('companion.memoryModal.sourceLabel')}>
            <Select value={source} onChange={setSource} options={sourceOptions} />
          </Field>
        </div>

        <Field label={t('companion.memoryModal.dimensionsLabel')} hint={t('companion.memoryModal.dimensionsHint')}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DIM_KEYS.map((d) => {
              const active = dimensions.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDimensions(prev => (active ? prev.filter(x => x !== d) : [...prev, d]))}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                    fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)',
                    border: `1px solid ${active ? 'var(--g-accent-line, var(--g-border))' : 'var(--g-border)'}`,
                    background: active ? 'var(--g-surface-2)' : 'transparent',
                    color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
                  }}
                >
                  <Dot color={dimColor(d)} size={6} />
                  {t(`memory.profileDims.${d}` as Parameters<typeof t>[0])}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t('companion.memoryModal.tagsLabel')} hint={t('companion.memoryModal.tagsHint')}>
          <TagInput
            value={tags}
            onChange={setTags}
            placeholder={t('companion.memoryModal.tagsPlaceholder')}
          />
        </Field>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'color-mix(in oklch, var(--g-danger) 12%, transparent)',
              border: '1px solid color-mix(in oklch, var(--g-danger) 32%, transparent)',
              color: 'var(--g-danger)',
              fontSize: fontVars.sm,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
