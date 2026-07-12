'use client';

// 添加来源模态（NotebookLM 式单入口）：顶部大拖放区 + 四种方式（上传/链接/粘贴/AI平台）
// + 底部配额条。提交即入队（可连续添加多个），逐条显示"已加入队列/失败"，进度在来源列表看。
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { ApiError, type SourceQuota } from '@/lib/apiClient';
import { Modal } from '@/app/components/gedo/Modal';
import { fontVars } from '@/app/components/gedo/typography';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { Dropzone } from './Dropzone';
import { PlatformImportPanel, type PlatformId } from './PlatformImportPanel';
import { IconFileDoc, IconLink, IconClipboard, IconBot } from './icons';

export type AddSourceMode = 'upload' | 'url' | 'paste' | 'ai';
type Mode = AddSourceMode;
type SubmitItem = { key: string; label: string; status: 'uploading' | 'queued' | 'failed'; error?: string };

export function AddSourcesModal({
  open,
  onClose,
  quota,
  onCreated,
  initialMode,
}: {
  open: boolean;
  onClose: () => void;
  quota: SourceQuota | null;
  onCreated: () => void;
  /** 「+ 添加」菜单直达某种导入方式（上传/链接/粘贴/AI 平台）。 */
  initialMode?: AddSourceMode;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const [mode, setMode] = useState<Mode>('upload');
  useEffect(() => { if (open && initialMode) setMode(initialMode); }, [open, initialMode]);
  const [items, setItems] = useState<SubmitItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');

  const quotaLeft = quota?.limit != null ? Math.max(0, quota.limit - quota.used) : null;
  const quotaFull = quotaLeft === 0;

  const track = useCallback(async (label: string, run: () => Promise<unknown>) => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems((prev) => [{ key, label, status: 'uploading' as const }, ...prev].slice(0, 8));
    setBusy(true);
    try {
      await run();
      setItems((prev) => prev.map((x) => (x.key === key ? { ...x, status: 'queued' } : x)));
      onCreated();
    } catch (e) {
      const quotaHit = e instanceof ApiError && e.status === 402;
      setItems((prev) => prev.map((x) => (x.key === key
        ? { ...x, status: 'failed', error: quotaHit ? t('memory.sources.add.quotaFull') : (e instanceof Error ? e.message : String(e)) }
        : x)));
    } finally {
      setBusy(false);
    }
  }, [onCreated, t]);

  const submitFiles = useCallback((files: File[], platform?: PlatformId) => {
    for (const f of files) {
      void track(f.name, () => api.createSourceFile(f, platform ? { type: 'chat_export', platform } : { type: 'file' }));
    }
  }, [api, track]);

  const modeBtn = (m: Mode, icon: React.ReactNode, label: string) => {
    const active = mode === m;
    return (
      <button
        key={m}
        type="button"
        onClick={() => setMode(m)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
          border: `1px solid ${active ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
          background: active ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
          color: active ? 'var(--g-accent)' : 'var(--g-text-mid)',
          fontSize: fontVars.sm, fontWeight: 600, fontFamily: 'var(--g-font-sans)',
        }}
      >
        {icon} {label}
      </button>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={t('memory.sources.title')}
      title={t('memory.sources.add.title')}
      footer={(
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
          <span style={{ fontSize: fontVars.xs, color: quotaFull ? 'oklch(0.65 0.18 25)' : 'var(--g-text-faint)' }}>
            {quota?.limit == null
              ? t('memory.sources.add.queueNote')
              : quotaFull
                ? t('memory.sources.add.quotaFull')
                : td('memory.sources.add.quotaLeft', { n: quotaLeft })}
          </span>
          <button type="button" style={ghostBtnStyle()} onClick={onClose}>{t('common.close')}</button>
        </div>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {mode === 'upload' && <Dropzone onFiles={(fs) => submitFiles(fs)} disabled={quotaFull || busy} />}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {modeBtn('upload', <IconFileDoc size={14} />, t('memory.sources.add.modeUpload'))}
          {modeBtn('url', <IconLink size={14} />, t('memory.sources.add.modeUrl'))}
          {modeBtn('paste', <IconClipboard size={14} />, t('memory.sources.add.modePaste'))}
          {modeBtn('ai', <IconBot size={14} />, t('memory.sources.add.modeAi'))}
        </div>

        {mode === 'url' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('memory.sources.add.urlPlaceholder')}
                inputMode="url"
                style={{
                  flex: 1, borderRadius: 10, padding: '10px 12px',
                  border: '1px solid var(--g-border)', background: 'var(--g-surface-1)', color: 'var(--g-text)',
                  fontSize: fontVars.sm, outline: 'none', fontFamily: 'var(--g-font-mono)',
                }}
              />
              <button
                type="button"
                disabled={busy || quotaFull || !/^https?:\/\/\S+/i.test(url.trim())}
                style={{ ...primaryBtnStyle(), opacity: busy || quotaFull || !/^https?:\/\/\S+/i.test(url.trim()) ? 0.5 : 1 }}
                onClick={() => { const u = url.trim(); setUrl(''); void track(u.replace(/^https?:\/\//i, '').slice(0, 60), () => api.createSourceUrl(u)); }}
              >
                {t('memory.sources.add.urlSubmit')}
              </button>
            </div>
            <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)', lineHeight: 1.5 }}>
              {t('memory.sources.add.urlHint')}
            </p>
          </div>
        )}

        {mode === 'paste' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder={t('memory.sources.add.pasteTitlePlaceholder')}
              style={{
                borderRadius: 10, padding: '9px 12px',
                border: '1px solid var(--g-border)', background: 'var(--g-surface-1)', color: 'var(--g-text)',
                fontSize: fontVars.sm, outline: 'none', fontFamily: 'var(--g-font-sans)',
              }}
            />
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={t('memory.sources.add.pastePlaceholder')}
              rows={8}
              style={{
                width: '100%', resize: 'vertical', borderRadius: 10, padding: '10px 12px',
                border: '1px solid var(--g-border)', background: 'var(--g-surface-1)', color: 'var(--g-text)',
                fontSize: fontVars.sm, lineHeight: 1.6, outline: 'none', fontFamily: 'var(--g-font-sans)',
              }}
            />
            <div>
              <button
                type="button"
                disabled={busy || quotaFull || !pasted.trim()}
                style={{ ...primaryBtnStyle(), opacity: busy || quotaFull || !pasted.trim() ? 0.5 : 1 }}
                onClick={() => {
                  const text = pasted.trim();
                  const title = pasteTitle.trim();
                  setPasted(''); setPasteTitle('');
                  void track(title || text.slice(0, 24), () => api.createSourceText(text, title ? { title } : {}));
                }}
              >
                {t('memory.sources.add.pasteSubmit')}
              </button>
            </div>
          </div>
        )}

        {mode === 'ai' && (
          <PlatformImportPanel
            busy={busy || quotaFull}
            onUploadFile={(f, platform) => submitFiles([f], platform)}
            onPasteText={(text, platform) => { void track(td(`memory.sources.platforms.${platform}`), () => api.createSourceText(text, { platform })); }}
          />
        )}

        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((it) => (
              <div key={it.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '8px 12px', borderRadius: 10, border: '1px solid var(--g-border)', background: 'var(--g-surface-1)',
              }}>
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.label}
                </span>
                <span style={{ flexShrink: 0, fontSize: fontVars.xs, fontFamily: 'var(--g-font-mono)', color: it.status === 'failed' ? 'oklch(0.65 0.18 25)' : it.status === 'queued' ? 'var(--g-accent)' : 'var(--g-text-faint)' }}>
                  {it.status === 'uploading' ? '…' : it.status === 'queued' ? t('memory.sources.add.fileQueued') : (it.error || t('memory.sources.add.fileFailed'))}
                </span>
              </div>
            ))}
            <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('memory.sources.add.queueNote')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
