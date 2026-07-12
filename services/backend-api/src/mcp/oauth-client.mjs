/**
 * MCP OAuth 客户端流程（能力开放 E3 = P13 修订版）。
 *
 * 让用户在设置里连接需要 OAuth 的官方 remote MCP server（Notion/Linear/GitHub…）：
 *   ① POST /v1/mcp/servers/:id/oauth/start → 后端走 SDK auth()（含 RFC 9728 资源
 *      元数据发现 + RFC 8414 AS 元数据 + RFC 7591 动态客户端注册 + PKCE），拿到
 *      authorization_url 交给前端 window.open；
 *   ② 用户在浏览器完成授权 → AS 302 回 /v1/mcp/oauth/callback?code&state；
 *   ③ 回调按 state 反查 (user,server)，auth() 换 token 存库（含 refresh_token）。
 * 之后 client-manager 的 transport 挂同一 provider：请求自动带 Bearer、过期自动
 * refresh；需要重新交互授权时抛 UnauthorizedError → 设置页显示「重新授权」。
 *
 * 秘密纪律：client_information / tokens / code_verifier 全存 mcp_servers.oauth，
 * 路由序列化时剥掉（同 headers）。state 高熵一次性，10 分钟过期。
 */

import crypto from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

const STATE_TTL_MS = 10 * 60_000;

/** 授权回调地址：必须与 DCR 注册的 redirect_uris 一致，部署侧用 env 指到公网域名。 */
export function oauthRedirectUrl() {
  return process.env.MCP_OAUTH_REDIRECT_URL
    || `http://localhost:${process.env.PORT || 8787}/v1/mcp/oauth/callback`;
}

/**
 * OAuthClientProvider（SDK 接口）实现：状态全部持久化在 store 的 server.oauth。
 * 每个 getter 都现读库，token refresh 后 transport 下一请求即拿到新值。
 */
export function makeProvider({ store, userId, serverId }) {
  const row = () => store.getMcpServer(userId, serverId);
  const patch = (p) => store.updateMcpServerOauth(userId, serverId, p);

  let capturedAuthUrl = null;

  return {
    get redirectUrl() { return oauthRedirectUrl(); },
    get clientMetadata() {
      return {
        client_name: 'GEDO',
        client_uri: 'https://gedo.ai',
        redirect_uris: [oauthRedirectUrl()],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // 公共客户端 + PKCE
      };
    },
    state() {
      const st = row()?.oauth?.state;
      if (!st) throw new Error('oauth_state_missing');
      return st;
    },
    clientInformation() { return row()?.oauth?.client_information; },
    saveClientInformation(info) { patch({ client_information: info }); },
    tokens() { return row()?.oauth?.tokens; },
    saveTokens(tokens) { patch({ tokens, connected_at: new Date().toISOString(), last_error: null }); },
    redirectToAuthorization(url) { capturedAuthUrl = String(url); },
    saveCodeVerifier(v) { patch({ code_verifier: v }); },
    codeVerifier() {
      const v = row()?.oauth?.code_verifier;
      if (!v) throw new Error('oauth_code_verifier_missing');
      return v;
    },
    invalidateCredentials(scope) {
      if (scope === 'all') patch({ tokens: null, client_information: null, code_verifier: null });
      else if (scope === 'client') patch({ client_information: null });
      else if (scope === 'tokens') patch({ tokens: null });
      else if (scope === 'verifier') patch({ code_verifier: null });
    },
    /** startOAuth 用：auth() 返回 'REDIRECT' 后取回捕获的授权页地址。 */
    _takeAuthUrl() { const u = capturedAuthUrl; capturedAuthUrl = null; return u; },
  };
}

/**
 * 发起授权：返回 { connected: true }（refresh 直接成功，无需交互）或
 * { authorization_url }（前端打开让用户授权）。
 */
export async function startOAuth({ store, userId, server, fetchFn }) {
  // 新的一轮授权：换新 state，清掉上一轮残留的 verifier
  const state = crypto.randomBytes(24).toString('base64url');
  store.updateMcpServerOauth(userId, server.id, {
    state,
    state_created_at: new Date().toISOString(),
    code_verifier: null,
    last_error: null,
  });
  const provider = makeProvider({ store, userId, serverId: server.id });
  const result = await auth(provider, { serverUrl: server.url, fetchFn });
  if (result === 'AUTHORIZED') {
    store.updateMcpServerOauth(userId, server.id, { state: null, state_created_at: null });
    return { connected: true };
  }
  const authorization_url = provider._takeAuthUrl();
  if (!authorization_url) throw new Error('authorization_url_not_captured');
  return { authorization_url };
}

/**
 * 授权回调：按 state 反查行，换 token。返回 { server } 或抛错（调用方渲染失败页）。
 */
export async function finishOAuth({ store, code, state, fetchFn }) {
  const server = store.getMcpServerByOauthState(state);
  if (!server) throw new Error('unknown_or_expired_state');
  const createdAt = Date.parse(server.oauth?.state_created_at || 0);
  if (!createdAt || Date.now() - createdAt > STATE_TTL_MS) {
    store.updateMcpServerOauth(server.user_id, server.id, { state: null, state_created_at: null });
    throw new Error('state_expired');
  }
  const provider = makeProvider({ store, userId: server.user_id, serverId: server.id });
  const result = await auth(provider, { serverUrl: server.url, authorizationCode: code, fetchFn });
  if (result !== 'AUTHORIZED') throw new Error(`unexpected_auth_result_${result}`);
  store.updateMcpServerOauth(server.user_id, server.id, {
    state: null,
    state_created_at: null,
    code_verifier: null,
  });
  return { server: store.getMcpServer(server.user_id, server.id) };
}
