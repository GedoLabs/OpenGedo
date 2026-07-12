/**
 * Shared HTTP-proxy support for LLM providers (Anthropic / OpenAI).
 *
 * Why this exists: in region-restricted networks the providers' official
 * endpoints must be reached through a local proxy (e.g. Clash 127.0.0.1:7897).
 * Node's built-in fetch does NOT read HTTPS_PROXY, so the SDKs connect directly
 * and get 403 "Request not allowed". We inject a proxy only when one is
 * configured, so production (no proxy env) connects directly — unchanged.
 *
 * Critical gotcha: you must pass undici's OWN `fetch` together with its
 * `ProxyAgent`. Handing the npm-undici ProxyAgent to Node's built-in fetch
 * throws `UND_ERR_INVALID_ARG (invalid onRequestStart)` on newer Node, because
 * the bundled-undici and npm-undici dispatcher handler interfaces differ.
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** True when the URL points at the local machine (e.g. an Ollama endpoint). */
function isLocalhost(url) {
  if (!url) return false;
  try { return LOCAL_HOSTS.has(new URL(url).hostname); }
  catch { return false; }
}

/**
 * Resolve a proxy URL.
 * Priority: per-provider override env (e.g. ANTHROPIC_PROXY / OPENAI_PROXY,
 * where "off"/"none"/"false" force-disables) → generic HTTPS_PROXY / ALL_PROXY.
 * `configProxyUrl` (when defined) wins over everything — used by tests.
 * Returns null when nothing is configured → caller connects directly.
 */
export function resolveProxyUrl({ explicitEnvVar, configProxyUrl } = {}) {
  if (configProxyUrl !== undefined) return configProxyUrl || null;
  const explicit = explicitEnvVar ? process.env[explicitEnvVar]?.trim() : '';
  if (explicit) {
    const v = explicit.toLowerCase();
    return (v === 'off' || v === 'none' || v === 'false') ? null : explicit;
  }
  return (
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy ||
    null
  );
}

/** Mask any credentials in a proxy URL for safe logging (protocol//host only). */
export function maskProxy(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; }
  catch { return 'configured'; }
}

/**
 * Mutate `clientOpts` to route the SDK through `proxyUrl`, when appropriate.
 * Skips silently when no proxy is configured, or when `baseURL` is localhost
 * (a local Ollama-compatible endpoint must stay direct). Returns true if a
 * proxy was applied.
 */
export function applyProxy(clientOpts, { proxyUrl, baseURL, label }) {
  if (!proxyUrl || isLocalhost(baseURL)) return false;
  try {
    clientOpts.fetch = undiciFetch;
    clientOpts.fetchOptions = { ...(clientOpts.fetchOptions || {}), dispatcher: new ProxyAgent(proxyUrl) };
    console.log(`[${label}] Routing via proxy ${maskProxy(proxyUrl)}`);
    return true;
  } catch (err) {
    console.warn(`[${label}] Proxy init failed (${err.message}); using direct connection`);
    return false;
  }
}
