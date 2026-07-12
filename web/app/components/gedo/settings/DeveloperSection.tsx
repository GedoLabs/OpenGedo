'use client';

// 「开发者/接入」独立设置节（能力开放 E2）——记忆 MCP 的 PAT 管理。
// 创建 scoped 令牌（明文仅回显一次）→ 粘到 Claude Code/Desktop/Cursor 等
// 任意 MCP 客户端的 Authorization header → 外部 AI 即可带着本人 Gedo 记忆。
// 列表含最近使用/吊销；审计（每次工具调用一条）在底部，主打"可见可断"。
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check, ShieldCheck, ShieldOff } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { resolveApiBaseUrl, type PatInfo, type PatAuditEntry } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';

export function DeveloperSection() {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [items, setItems] = useState<PatInfo[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [entitled, setEntitled] = useState(true);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [redactPii, setRedactPii] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [audit, setAudit] = useState<PatAuditEntry[]>([]);
  const [copied, setCopied] = useState<'endpoint' | 'token' | null>(null);

  const endpoint = `${resolveApiBaseUrl()}/mcp`;

  const load = useCallback(async () => {
    try {
      const r = await api.listPats();
      setItems(r.items || []);
      setScopes(r.scopes || []);
      setEntitled(r.entitled !== false);
      // 默认只勾选只读 scope；写入（*.write）必须用户显式勾选
      if (r.scopes?.length) setPicked(prev => (prev.size ? prev : new Set(r.scopes.filter(s => !s.endsWith('.write')))));
    } catch { /* ignore */ }
    try {
      const a = await api.listPatAudit(20);
      setAudit(a.items || []);
    } catch { /* ignore */ }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const copy = (text: string, which: 'endpoint' | 'token') => {
    void navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  // next-intl 类型化 key 不接受动态模板，scope 标签走显式映射
  const scopeLabel = (s: string) => {
    if (s === 'memory.read') return t('settings.developer.scope.memory_read');
    if (s === 'profile.read') return t('settings.developer.scope.profile_read');
    if (s === 'goals.read') return t('settings.developer.scope.goals_read');
    if (s === 'memory.write') return t('settings.developer.scope.memory_write');
    return s;
  };

  const toggleScope = (s: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const handleCreate = async () => {
    if (busy || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createPat({ name: name.trim() || 'Token', scopes: [...picked], redact_pii: redactPii });
      setFreshToken(r.token);
      setName('');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes('quota_exceeded') ? t('settings.developer.upgradeHint') : msg);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    await api.revokePat(id).catch(() => {});
    await load();
  };

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--g-border)', background: 'var(--g-surface-1)',
    color: 'var(--g-text)', fontSize: fontVars.sm, outline: 'none',
  };

  const active = items.filter(p => !p.revoked_at);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
        {t('settings.developer.desc')}
      </p>

      {/* 端点卡：接入地址 + 客户端一行命令 */}
      <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
        <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('settings.developer.endpointLabel')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <code style={{ flex: 1, minWidth: 0, fontSize: fontVars.sm, color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{endpoint}</code>
          <button type="button" onClick={() => copy(endpoint, 'endpoint')} style={miniBtnStyle()}>
            {copied === 'endpoint' ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          claude mcp add --transport http gedo {endpoint} --header &quot;Authorization: Bearer &lt;token&gt;&quot;
        </p>
      </div>

      {!entitled && (
        <p style={{ margin: 0, padding: '9px 12px', borderRadius: 10, fontSize: fontVars.sm, color: 'var(--g-text-mid)', background: 'color-mix(in oklch, var(--g-accent) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--g-accent) 30%, transparent)' }}>
          {t('settings.developer.upgradeHint')}
        </p>
      )}

      {/* 一次性明文回显 */}
      {freshToken && (
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'color-mix(in oklch, var(--g-accent) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--g-accent) 35%, transparent)' }}>
          <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-mid)' }}>{t('settings.developer.tokenOnce')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <code style={{ flex: 1, minWidth: 0, fontSize: fontVars.xs, color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)', wordBreak: 'break-all' }}>{freshToken}</code>
            <button type="button" onClick={() => copy(freshToken, 'token')} style={miniBtnStyle()}>
              {copied === 'token' ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>
      )}

      {/* 令牌列表 */}
      {active.length === 0 ? (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('settings.developer.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {active.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {p.name}
                  {p.redact_pii
                    ? <ShieldCheck size={13} style={{ color: 'var(--g-accent)' }} aria-label={t('settings.developer.redactOn')} />
                    : <ShieldOff size={13} style={{ color: 'oklch(0.7 0.14 60)' }} aria-label={t('settings.developer.redactOff')} />}
                </p>
                <p style={{ margin: '1px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.token_prefix}… · {(p.scopes || []).map(scopeLabel).join(' / ')}
                  {p.last_used_at ? ` · ${t('settings.developer.lastUsed', { time: new Date(p.last_used_at).toLocaleString() })}` : ` · ${t('settings.developer.neverUsed')}`}
                </p>
              </div>
              <button type="button" onClick={() => handleRevoke(p.id)} style={{ ...miniBtnStyle(), color: 'oklch(0.65 0.18 25)' }}>
                {t('settings.developer.revoke')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 创建表单 */}
      {entitled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--g-border)' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.developer.namePh')} style={{ ...inputStyle, maxWidth: 180 }} />
            {scopes.map(s => (
              <label key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: fontVars.xs, color: 'var(--g-text-mid)', cursor: 'pointer', border: '1px solid var(--g-border)', borderRadius: 8, padding: '6px 9px', background: picked.has(s) ? 'color-mix(in oklch, var(--g-accent) 10%, transparent)' : 'transparent' }}>
                <input type="checkbox" checked={picked.has(s)} onChange={() => toggleScope(s)} style={{ accentColor: 'var(--g-accent)' }} />
                {scopeLabel(s)}
              </label>
            ))}
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy || picked.size === 0}
              style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--g-accent)', color: 'var(--g-accent-ink, #06251c)', fontSize: fontVars.sm, fontWeight: 600, opacity: busy || picked.size === 0 ? 0.5 : 1 }}
            >
              {t('settings.developer.create')}
            </button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: fontVars.xs, color: 'var(--g-text-faint)', cursor: 'pointer' }}>
            <input type="checkbox" checked={redactPii} onChange={e => setRedactPii(e.target.checked)} style={{ accentColor: 'var(--g-accent)' }} />
            {t('settings.developer.redactToggle')}
          </label>
        </div>
      )}

      {error && <p style={{ margin: 0, fontSize: fontVars.xs, color: 'oklch(0.65 0.18 25)' }}>{error}</p>}
      <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('settings.developer.securityHint')}</p>

      {/* 审计 */}
      {audit.length > 0 && (
        <div>
          <p style={{ margin: '4px 0 6px', fontSize: fontVars.xs, fontWeight: 600, color: 'var(--g-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('settings.developer.auditTitle')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {audit.map(a => (
              <p key={a.id} style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {new Date(a.ts).toLocaleString()} · {a.tool}{a.summary ? ` · “${a.summary}”` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function miniBtnStyle(): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 7, cursor: 'pointer', flexShrink: 0,
    border: '1px solid var(--g-border)', background: 'transparent',
    color: 'var(--g-text-muted)', fontSize: fontVars.xs,
    display: 'inline-flex', alignItems: 'center',
  };
}
