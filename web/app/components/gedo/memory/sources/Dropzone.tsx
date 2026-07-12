'use client';

// 通用文件拖放区（全站首个 dropzone，先内聚在来源中心；他处需要时再上提）。
// 拖放 + 点击选择双通道，多文件；accept 只做前端提示性过滤，真正校验在后端解析器。
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fontVars } from '@/app/components/gedo/typography';
import { IconUploadTray } from './icons';

const ACCEPT = '.txt,.md,.markdown,.pdf,.docx,.json,.zip,.html,.htm';

export function Dropzone({
  onFiles,
  disabled = false,
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('app');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback((list: FileList | null) => {
    if (disabled || !list?.length) return;
    onFiles(Array.from(list));
  }, [disabled, onFiles]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer?.files ?? null); }}
      style={{
        border: `1.5px dashed ${dragOver ? 'var(--g-accent)' : 'var(--g-border)'}`,
        borderRadius: 14,
        background: dragOver ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
        padding: compact ? '18px 16px' : '34px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.15s ease, background 0.15s ease',
        textAlign: 'center',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />
      <span style={{ color: dragOver ? 'var(--g-accent)' : 'var(--g-text-muted)' }}>
        <IconUploadTray size={compact ? 18 : 24} />
      </span>
      <span style={{ fontSize: compact ? fontVars.sm : fontVars.base, color: 'var(--g-text)', fontWeight: 600 }}>
        {t('memory.sources.add.dropTitle')}
      </span>
      <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
        {t('memory.sources.add.dropHint')}
      </span>
    </div>
  );
}
