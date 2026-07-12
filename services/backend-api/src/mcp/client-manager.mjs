/**
 * MCP 客户端管理器 — 聊天调「外部工具」的反向通道（P5 MVP）。
 *
 * 用户在设置里登记远程 MCP server（HTTP/SSE transport，MVP 不做 stdio），
 * 聊天组装工具表时把已启用 server 的工具并入（命名空间 mcp__{slug}__{tool}），
 * executeTool 按前缀路由到这里执行。连接按 (userId, serverId) 懒建 + 闲置回收。
 *
 * 安全护栏：生产环境仅 https 且默认拒绝 localhost/私网（MCP_ALLOW_PRIVATE=1 放开，
 * 自托管用）；开发环境放开本机地址便于调试。响应文本截断，防撑爆上下文。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { makeProvider } from './oauth-client.mjs';

const store = Store();

// 外网 MCP server 走代理（E3）：Node fetch 不读系统代理（同 Anthropic 坑）。
// 仅认显式 MCP_PROXY_URL——不兜底 HTTPS_PROXY：shell 里常驻的系统代理会被
// dev 进程静默继承，把直连可达的 MCP 站点也塞进代理（实测 Clash 对部分域名
// 超时而直连正常）；与 ANTHROPIC_PROXY 的"逐目标显式配置"哲学保持一致。
const MCP_PROXY = process.env.MCP_PROXY_URL || '';
const proxyDispatcher = MCP_PROXY ? new ProxyAgent(MCP_PROXY) : null;
export function mcpFetch(input, init) {
  return proxyDispatcher ? undiciFetch(input, { ...init, dispatcher: proxyDispatcher }) : fetch(input, init);
}

/** OAuth 授权态判断 + 错误归一（设置页据此显示「授权/重新授权」）。 */
export function isUnauthorizedError(e) {
  return e instanceof UnauthorizedError || /unauthorized|invalid_token/i.test(String(e?.message || ''));
}

const IDLE_TTL_MS = 5 * 60_000;
const CALL_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 8_000;
const MAX_RESULT_CHARS = 8_000;

/** key `${userId}:${serverId}` → { client, confHash, lastUsed, timer } */
const conns = new Map();

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label || 'mcp'}_timeout_${ms}ms`)), ms)),
  ]);
}

export function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return s || 'srv';
}

/** stdio 门禁（P11）：仅自托管可信环境显式开启；命令必须绝对路径、不走 shell。 */
export function stdioAllowed() {
  return process.env.MCP_ALLOW_STDIO === '1';
}

export function validateStdioCommand(command) {
  if (!stdioAllowed()) return { ok: false, reason: 'stdio_disabled' };
  const cmd = String(command || '').trim();
  if (!cmd) return { ok: false, reason: 'command_required' };
  if (!path.isAbsolute(cmd)) return { ok: false, reason: 'absolute_path_required' };
  return { ok: true };
}

/** URL 白名单校验：返回 { ok, reason? }。 */
export function validateMcpUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, reason: 'invalid_url' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'unsupported_protocol' };
  const host = u.hostname;
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host);
  const prod = process.env.NODE_ENV === 'production';
  const allowPrivate = process.env.MCP_ALLOW_PRIVATE === '1' || !prod;
  if (prod && u.protocol !== 'https:' && !(allowPrivate && (isLoopback || isPrivate))) {
    return { ok: false, reason: 'https_required' };
  }
  if ((isLoopback || isPrivate) && !allowPrivate) return { ok: false, reason: 'private_address_blocked' };
  return { ok: true };
}

function confHash(server) {
  // oauth 连接态入 hash：授权/重授权后强制重建连接（token 刷新不需要——
  // transport 每请求经 provider 现读库取 token）。
  return JSON.stringify([server.transport || 'http', server.url, server.command, server.args, server.env, server.headers || {}, !!server.oauth?.tokens]);
}

/** 有 OAuth 凭据的 server 挂 authProvider；请求自动带 Bearer、过期自动 refresh。 */
function authProviderFor(server) {
  if (!server.oauth?.tokens || !server.user_id) return undefined;
  return makeProvider({ store, userId: server.user_id, serverId: server.id });
}

async function openClient(server) {
  // stdio（P11，自托管）：懒拉起子进程；连接随闲置回收/崩溃 dropConn 一并关闭，
  // 下次调用自动重启（天然的退避 = IDLE_TTL/调用间隔）。
  if (server.transport === 'stdio') {
    if (!stdioAllowed()) { throw new Error('stdio_disabled'); }
    const valid = validateStdioCommand(server.command);
    if (!valid.ok) throw new Error(valid.reason);
    const client = new Client({ name: 'gedo-backend', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: server.command,
      args: Array.isArray(server.args) ? server.args.map(String) : [],
      env: server.env && typeof server.env === 'object'
        ? { ...process.env, ...server.env }
        : { ...process.env },
      stderr: 'ignore',
    });
    await client.connect(transport);
    return client;
  }

  const url = new URL(server.url);
  const headers = server.headers && typeof server.headers === 'object' ? server.headers : {};
  const fetchWithHeaders = (input, init) =>
    mcpFetch(input, { ...init, headers: { ...(init?.headers || {}), ...headers } });
  const authProvider = authProviderFor(server);

  // 先试 Streamable HTTP（规范推荐），失败回退 SSE（兼容旧 server）。
  // 需要交互授权时 SDK 抛 UnauthorizedError——原样上抛（不吞进 SSE 回退）。
  try {
    const client = new Client({ name: 'gedo-backend', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers }, fetch: mcpFetch, authProvider });
    await client.connect(transport);
    return client;
  } catch (streamableErr) {
    if (isUnauthorizedError(streamableErr)) throw streamableErr;
    try {
      const client = new Client({ name: 'gedo-backend', version: '1.0.0' });
      const transport = new SSEClientTransport(url, {
        requestInit: { headers },
        eventSourceInit: { fetch: fetchWithHeaders },
        fetch: mcpFetch,
        authProvider,
      });
      await client.connect(transport);
      return client;
    } catch (sseErr) {
      throw isUnauthorizedError(sseErr) ? sseErr : streamableErr;
    }
  }
}

function dropConn(key) {
  const entry = conns.get(key);
  if (!entry) return;
  conns.delete(key);
  clearTimeout(entry.timer);
  try { void entry.client.close(); } catch { /* ignore */ }
}

async function getClient(userId, server) {
  const key = `${userId}:${server.id}`;
  const hash = confHash(server);
  const cached = conns.get(key);
  if (cached && cached.confHash === hash) {
    cached.lastUsed = Date.now();
    clearTimeout(cached.timer);
    cached.timer = setTimeout(() => dropConn(key), IDLE_TTL_MS);
    return cached.client;
  }
  if (cached) dropConn(key);
  const client = await withTimeout(openClient(server), LIST_TIMEOUT_MS, 'connect');
  const entry = { client, confHash: hash, lastUsed: Date.now(), timer: setTimeout(() => dropConn(key), IDLE_TTL_MS) };
  conns.set(key, entry);
  return client;
}

function normalizeToolResult(result) {
  const parts = [];
  for (const c of result?.content || []) {
    if (c?.type === 'text') parts.push(c.text);
    else if (c) parts.push(JSON.stringify(c));
  }
  let output = parts.join('\n').trim();
  if (output.length > MAX_RESULT_CHARS) output = `${output.slice(0, MAX_RESULT_CHARS)}\n…(truncated)`;
  return { success: result?.isError !== true, output: output || '(empty result)' };
}

/** 测试连接：返回 { ok, tools?, error? }（settings「测试」按钮 + 创建时校验用）。 */
export async function testServer(server) {
  const valid = server.transport === 'stdio' ? validateStdioCommand(server.command) : validateMcpUrl(server.url);
  if (!valid.ok) return { ok: false, error: valid.reason };
  try {
    const client = await withTimeout(openClient(server), LIST_TIMEOUT_MS, 'connect');
    try {
      const res = await withTimeout(client.listTools(), LIST_TIMEOUT_MS, 'list_tools');
      return {
        ok: true,
        tools: (res?.tools || []).map(t => ({ name: t.name, description: t.description || '' })),
      };
    } finally {
      try { void client.close(); } catch { /* ignore */ }
    }
  } catch (e) {
    // OAuth server 未授权/凭据失效：设置页据此把「测试」失败渲染成「去授权」。
    if (isUnauthorizedError(e)) return { ok: false, error: 'auth_required', auth_required: true };
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * 聊天工具表合并：所有已启用 server 的工具，命名空间化为 Anthropic tool 形状。
 * 单 server 失败只跳过（不拖垮聊天）；无 server 时零开销。
 */
export async function listChatTools(userId) {
  const servers = (store.listMcpServers ? store.listMcpServers(userId) : []).filter(s => s.enabled !== false);
  if (!servers.length) return [];
  const out = [];
  await Promise.all(servers.map(async server => {
    try {
      const client = await getClient(userId, server);
      const res = await withTimeout(client.listTools(), LIST_TIMEOUT_MS, 'list_tools');
      for (const t of res?.tools || []) {
        out.push({
          name: `mcp__${server.slug}__${t.name}`,
          description: `[外部工具 · ${server.name}] ${t.description || t.name}`.slice(0, 1000),
          input_schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
        });
      }
    } catch (e) {
      console.warn(`[mcp] listTools failed for ${server.name}:`, e?.message || e);
      dropConn(`${userId}:${server.id}`);
    }
  }));
  return out;
}

/** 执行命名空间工具 mcp__{slug}__{tool}；异常转成 { success:false } 让模型可恢复。 */
export async function callNamespacedTool(userId, namespacedName, args) {
  const m = /^mcp__([a-z0-9_]+)__(.+)$/.exec(String(namespacedName));
  if (!m) return { success: false, message: `invalid mcp tool name: ${namespacedName}` };
  const [, slug, toolName] = m;
  const server = (store.listMcpServers ? store.listMcpServers(userId) : [])
    .find(s => s.slug === slug && s.enabled !== false);
  if (!server) return { success: false, message: `mcp server not found or disabled: ${slug}` };
  try {
    const client = await getClient(userId, server);
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args || {} }),
      CALL_TIMEOUT_MS,
      `call_${toolName}`
    );
    return normalizeToolResult(result);
  } catch (e) {
    dropConn(`${userId}:${server.id}`);
    return { success: false, message: e?.message || String(e) };
  }
}

export default { slugify, validateMcpUrl, testServer, listChatTools, callNamespacedTool };
