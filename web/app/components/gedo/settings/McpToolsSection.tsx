'use client';

// 外部工具（MCP 客户端）设置节 — 精选目录一键连接（E3）+ 登记/测试/启停/删除。
// 登记后其工具自动并入智伴聊天的工具表（命名空间 mcp__{slug}__{tool}），
// composer「+」菜单也会列出。OAuth server：连接 → 弹授权窗 → 回调落 token →
// 授权窗 postMessage 触发本节自动刷新+测试。安全：生产仅 https、私网默认拒绝。
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { McpDirectoryEntry, McpServerInfo } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';

export function McpToolsSection() {
  const { api } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [directory, setDirectory] = useState<McpDirectoryEntry[]>([]);
  const [stdioAllowed, setStdioAllowed] = useState(false);
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await api.listMcpServers();
      setServers(r.items || []);
      setStdioAllowed(r.stdio_allowed === true);
    } catch { /* ignore */ }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api.getMcpDirectory().then(r => setDirectory(r.items || [])).catch(() => {});
  }, [api]);

  // 授权弹窗完成后（回调页 postMessage）自动刷新列表并测试最近待授权的 server。
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === 'gedo-mcp-oauth') void load();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [load]);

  const startOauth = async (serverId: string) => {
    try {
      const r = await api.startMcpOauth(serverId);
      if (r.connected) { await load(); return; }
      if (r.authorization_url) window.open(r.authorization_url, 'gedo-mcp-oauth', 'width=560,height=720');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addFromDirectory = async (entry: McpDirectoryEntry) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { server } = await api.createMcpServer({ name: entry.name, url: entry.url });
      if (entry.auth === 'oauth') await startOauth(server.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canAdd = name.trim() && (transport === 'stdio' ? command.trim() : url.trim());

  const handleAdd = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createMcpServer(transport === 'stdio'
        ? { name: name.trim(), transport, command: command.trim(), args: argsText.trim() ? argsText.trim().split(/\s+/) : [] }
        : { name: name.trim(), url: url.trim() });
      setName('');
      setUrl('');
      setCommand('');
      setArgsText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestResult(prev => ({ ...prev, [id]: '…' }));
    try {
      const r = await api.testMcpServer(id);
      setTestResult(prev => ({
        ...prev,
        [id]: r.ok
          ? t('settings.mcp.testOk', { n: r.tools?.length ?? 0 })
          : r.auth_required
            ? t('settings.mcp.authRequired')
            : `${t('settings.mcp.testFailed')}: ${r.error || ''}`,
      }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [id]: `${t('settings.mcp.testFailed')}: ${e instanceof Error ? e.message : ''}` }));
    }
  };

  const handleToggle = async (server: McpServerInfo) => {
    await api.updateMcpServer(server.id, { enabled: !server.enabled }).catch(() => {});
    await load();
  };

  const handleDelete = async (id: string) => {
    await api.deleteMcpServer(id).catch(() => {});
    await load();
  };

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--g-border)', background: 'var(--g-surface-1)',
    color: 'var(--g-text)', fontSize: fontVars.sm, outline: 'none',
  };

  const descFor = (entry: McpDirectoryEntry) => entry.desc[locale] || entry.desc.en || '';
  const addedUrls = new Set(servers.map(s => s.url));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
        {t('settings.mcp.desc')}
      </p>

      {/* E3 精选目录：一键连接官方 remote server */}
      {directory.length > 0 && (
        <div>
          <p style={{ margin: '2px 0 6px', fontSize: fontVars.xs, fontWeight: 600, color: 'var(--g-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('settings.mcp.directoryTitle')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6 }}>
            {directory.map(entry => {
              const added = addedUrls.has(entry.url);
              return (
                <div key={entry.slug} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 10px', borderRadius: 10, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
                  <span aria-hidden style={{ fontSize: 16, lineHeight: '20px' }}>{entry.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.name}
                      {entry.auth === 'oauth' && (
                        <span style={{ marginLeft: 5, fontSize: fontVars.xs, fontWeight: 400, color: 'var(--g-text-faint)', border: '1px solid var(--g-border)', borderRadius: 5, padding: '0 4px' }}>OAuth</span>
                      )}
                    </p>
                    <p style={{ margin: '1px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {descFor(entry)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || added}
                    onClick={() => void addFromDirectory(entry)}
                    style={{ ...miniBtnStyle(), ...(added ? { opacity: 0.55, cursor: 'default' } : { color: 'var(--g-accent)', border: '1px solid color-mix(in oklch, var(--g-accent) 45%, transparent)' }) }}
                  >
                    {added ? t('settings.mcp.dirAdded') : t('settings.mcp.dirConnect')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('settings.mcp.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {servers.map(s => (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                borderRadius: 10, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                  {s.oauth_status === 'connected' && (
                    <span style={{ marginLeft: 6, fontSize: fontVars.xs, color: 'var(--g-accent)', border: '1px solid color-mix(in oklch, var(--g-accent) 45%, transparent)', borderRadius: 6, padding: '0 5px' }}>
                      {t('settings.mcp.oauthConnected')}
                    </span>
                  )}
                  {!s.enabled && (
                    <span style={{ marginLeft: 6, fontSize: fontVars.xs, color: 'var(--g-text-faint)', border: '1px solid var(--g-border)', borderRadius: 6, padding: '0 5px' }}>
                      {t('settings.mcp.disabled')}
                    </span>
                  )}
                </p>
                <p style={{ margin: '1px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.transport === 'stdio' ? `stdio · ${s.command || ''}` : s.url}{testResult[s.id] ? ` · ${testResult[s.id]}` : ''}
                </p>
              </div>
              {(testResult[s.id] === t('settings.mcp.authRequired') || s.oauth_status === 'pending') && (
                <button type="button" onClick={() => void startOauth(s.id)} style={{ ...miniBtnStyle(), color: 'var(--g-accent)', border: '1px solid color-mix(in oklch, var(--g-accent) 45%, transparent)' }}>
                  {t('settings.mcp.authorize')}
                </button>
              )}
              <button type="button" onClick={() => handleTest(s.id)} style={miniBtnStyle()}>{t('settings.mcp.test')}</button>
              <button type="button" onClick={() => handleToggle(s)} style={miniBtnStyle()}>
                {s.enabled ? t('settings.mcp.disable') : t('settings.mcp.enable')}
              </button>
              <button type="button" onClick={() => handleDelete(s.id)} style={{ ...miniBtnStyle(), color: 'oklch(0.65 0.18 25)' }}>
                {t('settings.mcp.delete')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {stdioAllowed && (
          // stdio 仅自托管（MCP_ALLOW_STDIO=1）可见：本机拉起子进程跑 MCP server
          <select
            value={transport}
            onChange={e => setTransport(e.target.value === 'stdio' ? 'stdio' : 'http')}
            style={{ ...inputStyle, flex: 'none', width: 92 }}
          >
            <option value="http">HTTP</option>
            <option value="stdio">stdio</option>
          </select>
        )}
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.mcp.namePh')} style={{ ...inputStyle, maxWidth: 150 }} />
        {transport === 'stdio' ? (
          <>
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder={t('settings.mcp.commandPh')} style={inputStyle} />
            <input value={argsText} onChange={e => setArgsText(e.target.value)} placeholder={t('settings.mcp.argsPh')} style={inputStyle} />
          </>
        ) : (
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder={t('settings.mcp.urlPh')} style={inputStyle} />
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !canAdd}
          style={{
            padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--g-accent)', color: 'var(--g-accent-ink, #06251c)',
            fontSize: fontVars.sm, fontWeight: 600, opacity: busy || !canAdd ? 0.5 : 1,
          }}
        >
          {t('settings.mcp.add')}
        </button>
      </div>
      {error && <p style={{ margin: 0, fontSize: fontVars.xs, color: 'oklch(0.65 0.18 25)' }}>{error}</p>}
      <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('settings.mcp.securityHint')}</p>
    </div>
  );
}

function miniBtnStyle(): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 7, cursor: 'pointer', flexShrink: 0,
    border: '1px solid var(--g-border)', background: 'transparent',
    color: 'var(--g-text-muted)', fontSize: fontVars.xs,
  };
}
