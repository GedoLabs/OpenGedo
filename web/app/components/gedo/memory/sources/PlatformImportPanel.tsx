'use client';

// AI 平台导入面板：平台网格 → 导出指引（数字步，沿用 MemoryImportWizard 的样式基因）
// → 上传导出文件 / 粘贴文本。豆包/DeepSeek 无官方导出，主路径即粘贴。
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fontVars } from '@/app/components/gedo/typography';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';

export type PlatformId = 'chatgpt' | 'claude' | 'gemini' | 'kimi' | 'doubao' | 'deepseek';

// steps=指引步数；primary=主行动（upload=有官方导出文件，paste=无官方导出走粘贴）
const PLATFORMS: Array<{ id: PlatformId; steps: number; primary: 'upload' | 'paste'; warn?: boolean }> = [
  { id: 'chatgpt', steps: 3, primary: 'upload' },
  { id: 'claude', steps: 3, primary: 'upload' },
  { id: 'gemini', steps: 3, primary: 'upload', warn: true },
  { id: 'kimi', steps: 3, primary: 'upload' },
  { id: 'doubao', steps: 2, primary: 'paste' },
  { id: 'deepseek', steps: 2, primary: 'paste' },
];

export function PlatformImportPanel({
  busy,
  onUploadFile,
  onPasteText,
}: {
  busy: boolean;
  onUploadFile: (file: File, platform: PlatformId) => void;
  onPasteText: (text: string, platform: PlatformId) => void;
}) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const [platform, setPlatform] = useState<PlatformId | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const spec = PLATFORMS.find((p) => p.id === platform) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {PLATFORMS.map((p) => {
          const active = platform === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { setPlatform(active ? null : p.id); setPasteMode(false); setPasted(''); }}
              style={{
                padding: '10px 8px',
                borderRadius: 10,
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
                background: active ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
                color: active ? 'var(--g-accent)' : 'var(--g-text)',
                fontSize: fontVars.sm,
                fontWeight: 600,
                fontFamily: 'var(--g-font-sans)',
              }}
            >
              {td(`memory.sources.platforms.${p.id}`)}
            </button>
          );
        })}
      </div>

      {spec && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--g-border)', background: 'var(--g-surface-1)' }}>
          {Array.from({ length: spec.steps }, (_, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{
                width: 20, height: 20, borderRadius: 999, flexShrink: 0, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', fontSize: fontVars.xs, fontWeight: 700,
                background: 'var(--g-accent-soft)', color: 'var(--g-accent)',
              }}>{i + 1}</span>
              <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.55 }}>
                {td(`memory.sources.guide.${spec.id}${i + 1}`)}
              </span>
            </div>
          ))}
          {spec.warn && (
            <div style={{ fontSize: fontVars.xs, color: 'oklch(0.75 0.14 75)', lineHeight: 1.5 }}>
              ⚠ {td(`memory.sources.guide.${spec.id}Warn`)}
            </div>
          )}

          {!pasteMode ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,.json,.txt,.md,.markdown,.html"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && platform) onUploadFile(f, platform);
                  e.target.value = '';
                }}
              />
              {spec.primary === 'upload' ? (
                <>
                  <button type="button" disabled={busy} style={{ ...primaryBtnStyle(true), opacity: busy ? 0.5 : 1 }} onClick={() => fileRef.current?.click()}>
                    {t('memory.sources.guide.uploadExport')}
                  </button>
                  <button type="button" disabled={busy} style={ghostBtnStyle()} onClick={() => setPasteMode(true)}>
                    {t('memory.sources.guide.pasteInstead')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled={busy} style={{ ...primaryBtnStyle(true), opacity: busy ? 0.5 : 1 }} onClick={() => setPasteMode(true)}>
                    {t('memory.sources.guide.pasteInstead')}
                  </button>
                  <button type="button" disabled={busy} style={ghostBtnStyle()} onClick={() => fileRef.current?.click()}>
                    {t('memory.sources.guide.uploadExport')}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={t('memory.sources.add.pastePlaceholder')}
                rows={6}
                style={{
                  width: '100%', resize: 'vertical', borderRadius: 10, padding: '10px 12px',
                  border: '1px solid var(--g-border)', background: 'var(--g-bg-raised)', color: 'var(--g-text)',
                  fontSize: fontVars.sm, lineHeight: 1.6, outline: 'none', fontFamily: 'var(--g-font-sans)',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={busy || !pasted.trim()}
                  style={{ ...primaryBtnStyle(true), opacity: busy || !pasted.trim() ? 0.5 : 1 }}
                  onClick={() => { if (platform && pasted.trim()) { onPasteText(pasted.trim(), platform); setPasted(''); } }}
                >
                  {t('memory.sources.add.pasteSubmit')}
                </button>
                <button type="button" style={ghostBtnStyle()} onClick={() => setPasteMode(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {!spec && (
        <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
          {t('memory.sources.add.aiHint')}
        </p>
      )}
    </div>
  );
}
