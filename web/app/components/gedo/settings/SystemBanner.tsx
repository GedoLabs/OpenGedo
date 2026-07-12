'use client';

import { fontVars, text } from '../typography';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import { Pill, primaryBtnStyle, ghostBtnStyle, chipBtnStyle } from '@/app/components/gedo/primitives';
import { IconBolt, IconCheck, IconArrow, IconWand } from '@/app/components/gedo/icons';

type Persona = 'FOR' | 'AS' | 'ABOUT';

const PERSONA_OPTIONS: { value: Persona; label: string; description: string }[] = [
  { value: 'FOR',   label: '你说',   description: '智伴帮你说话 / 表达' },
  { value: 'AS',    label: '代说',   description: '智伴模拟你的口吻' },
  { value: 'ABOUT', label: '谈论',   description: '智伴和你谈论你自己' },
];

const PERSONA_STORAGE = 'gedo_default_persona';

/**
 * System-level controls injected at the top of /app/settings:
 * - LLM connection status (api.llmStatus)
 * - Default persona mode (used by chatStream)
 * - .gmp Memory Pack import / export
 */
export function SystemBanner() {
  const { api } = useAuth();
  const [llm, setLlm] = useState<{ available: boolean; primaryChat?: string; providers?: string[] } | null>(null);
  const [persona, setPersona] = useState<Persona>('FOR');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.llmStatus()
      .then(s => { if (!cancelled) setLlm(s); })
      .catch(() => { if (!cancelled) setLlm({ available: false }); });
    try {
      const saved = localStorage.getItem(PERSONA_STORAGE);
      if (saved === 'FOR' || saved === 'AS' || saved === 'ABOUT') setPersona(saved);
    } catch {}
    return () => { cancelled = true; };
  }, [api]);

  const updatePersona = (p: Persona) => {
    setPersona(p);
    try { localStorage.setItem(PERSONA_STORAGE, p); } catch {}
  };

  const handleExport = async () => {
    setExporting(true);
    setStatus(null);
    try {
      const { blob, filename } = await api.exportMemoryGmp();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus(`已导出 ${filename}`);
    } catch (e: unknown) {
      setStatus(e instanceof Error ? `导出失败：${e.message}` : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => fileRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setStatus(null);
    try {
      const result = await api.importMemoryGmp(file, { dryRun: false });
      setStatus(`已导入：${result.episodes_added} 条新增 · ${result.episodes_skipped_duplicate} 条去重`);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? `导入失败：${err.message}` : '导入失败');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      style={{
        margin: '0 0 24px',
        padding: 18,
        background: 'var(--g-bg-raised)',
        border: '1px solid var(--g-border)',
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontFamily: 'var(--g-font-sans)',
        color: 'var(--g-text)',
      }}
    >
      {/* LLM status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Pill tone={llm?.available ? 'accent' : 'neutral'}>
          <span
            style={{
              width: 6, height: 6, borderRadius: 999,
              background: llm?.available ? 'var(--g-accent)' : 'var(--g-danger)',
              display: 'inline-block',
            }}
          />
          LLM {llm?.available ? '已连接' : '未连接'}
        </Pill>
        {llm?.primaryChat && (
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', fontFamily: 'var(--g-font-mono)' }}>
            模型：{llm.primaryChat}
          </span>
        )}
        {llm?.providers && llm.providers.length > 0 && (
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            可用：{llm.providers.join(' · ')}
          </span>
        )}
      </div>

      {/* Persona */}
      <div>
        <div
          style={{
            fontSize: fontVars.sm,
            fontFamily: 'var(--g-font-mono)',
            color: 'var(--g-text-faint)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Persona · 默认对话视角
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PERSONA_OPTIONS.map(o => {
            const active = o.value === persona;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => updatePersona(o.value)}
                style={{
                  flex: '1 1 180px',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${active ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
                  background: active ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
                  cursor: 'pointer',
                  fontFamily: 'var(--g-font-sans)',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: fontVars.sm, fontWeight: 500, color: 'var(--g-text)' }}>{o.label}</span>
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{o.value}</span>
                  {active && <IconCheck size={12} style={{ color: 'var(--g-accent)', marginLeft: 'auto' }} />}
                </div>
                <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{o.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Memory Pack */}
      <div>
        <div
          style={{
            fontSize: fontVars.sm,
            fontFamily: 'var(--g-font-mono)',
            color: 'var(--g-text-faint)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          GEDO Memory Pack (.gmp)
        </div>
        <p style={{ margin: '0 0 10px', fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.55 }}>
          可签名、可移植的记忆容器。换设备、换服务、做离线备份 — 都靠它。
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={{ ...primaryBtnStyle(), opacity: exporting ? 0.6 : 1 }}
            onClick={handleExport}
            disabled={exporting}
          >
            <IconArrow size={14} /> {exporting ? '打包中…' : '导出 .gmp'}
          </button>
          <button
            type="button"
            style={{ ...ghostBtnStyle(), opacity: importing ? 0.6 : 1 }}
            onClick={handleImport}
            disabled={importing}
          >
            <IconBolt size={14} /> {importing ? '导入中…' : '导入 .gmp'}
          </button>
          <button type="button" style={chipBtnStyle()} onClick={() => window.location.reload()}>
            <IconWand size={11} /> 刷新状态
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".gmp,application/octet-stream,application/zip"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        {status && (
          <p style={{ margin: '10px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
