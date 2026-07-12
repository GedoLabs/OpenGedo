/**
 * 公网网页抓取（来源导入用），带 SSRF 防护：
 *   - 仅 http/https，禁 URL 内嵌凭据
 *   - 主机名 DNS 解析后逐个校验：私网/环回/链路本地/CGNAT/元数据段一律拒绝
 *   - 重定向手动跟进（≤3 跳），每一跳重新校验
 *   - 15s 超时；响应流式读取，超 5MB 截断（正文足够，防拖库）
 *   - content-type 白名单：html / 纯文本 / markdown / json / xhtml
 *
 * 已知残余风险（内测可接受，注释留档）：校验与实际连接之间存在 DNS 重绑定窗口，
 * 彻底防御需自定义 Agent 固定已校验 IP——二期若开放高频抓取再上。
 */

import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPE_ALLOW = /^(text\/(html|plain|markdown|x-markdown)|application\/(json|xhtml\+xml))\b/i;
const UA = 'Mozilla/5.0 (compatible; GedoImport/1.0; +memory-source-import)';

function err(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function isBenchmarkV4(ip) {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p[0] === 198 && (p[1] === 18 || p[1] === 19); // 198.18.0.0/15
}

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127                      // 0/8, 10/8, loopback
    || (a === 100 && b >= 64 && b <= 127)                 // CGNAT 100.64/10
    || (a === 169 && b === 254)                           // link-local / 云元数据
    || (a === 172 && b >= 16 && b <= 31)                  // 172.16/12
    || (a === 192 && b === 168)                           // 192.168/16
    || (a === 192 && b === 0)                             // 192.0.0/24 特殊用途
    || isBenchmarkV4(ip)                                  // benchmark（fake-ip 模式下按解析来源放行，见 assertPublicHost）
    || a >= 224                                           // 组播/保留
  );
}

// Clash/Surge 等本机代理的 fake-ip 模式：解析器把一切域名映射到 198.18.0.0/15
// 占位段，真实连接由代理按域名转发。此时按 IP 判 SSRF 会误伤所有域名导入。
// 启动后首次抓取时用公网金丝雀域名探测一次：金丝雀也落在 198.18/15 ⇒ 解析器是
// fake-ip 模式 ⇒ 「域名解析出的」198.18/15 视为公网（环回/RFC1918/链路本地依旧硬拦，
// fake-ip 池不会用这些段）；字面 IP 直填 198.18.x 仍然拒绝。
// 正常部署（无 fake-ip）金丝雀返回真实公网 IP ⇒ 198.18/15 保持拦截。
let fakeIpDnsMode = null; // null=未探测
async function resolverUsesFakeIp() {
  if (fakeIpDnsMode !== null) return fakeIpDnsMode;
  try {
    const addrs = await dns.lookup('example.com', { all: true, verbatim: true });
    fakeIpDnsMode = addrs.some((a) => isBenchmarkV4(a.address));
  } catch {
    fakeIpDnsMode = false;
  }
  return fakeIpDnsMode;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  const low = ip.toLowerCase();
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
  if (v4Mapped) return isPrivateV4(v4Mapped[1]);
  return (
    low === '::' || low === '::1'
    || low.startsWith('fc') || low.startsWith('fd')       // ULA fc00::/7
    || low.startsWith('fe8') || low.startsWith('fe9')
    || low.startsWith('fea') || low.startsWith('feb')     // link-local fe80::/10
  );
}

async function assertPublicHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    // 字面 IP：一律按严格名单拦（fake-ip 豁免只给"域名解析出的"地址）
    if (isPrivateIp(bare)) throw err('目标地址不允许（内网/保留段）', 'SSRF_BLOCKED');
    return;
  }
  let addrs;
  try {
    addrs = await dns.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw err('域名解析失败', 'DNS_FAILED');
  }
  if (!addrs.length) throw err('域名无解析结果', 'DNS_FAILED');
  for (const { address } of addrs) {
    if (!isPrivateIp(address)) continue;
    // benchmark 段且解析器处于 fake-ip 模式 → 放行（真实连接由本机代理按域名转发）
    if (isBenchmarkV4(address) && await resolverUsesFakeIp()) continue;
    throw err('目标地址不允许（内网/保留段）', 'SSRF_BLOCKED');
  }
}

/**
 * @param {string} rawUrl
 * @returns {Promise<{ content: string, contentType: string, finalUrl: string, truncated: boolean }>}
 */
export async function fetchPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    throw err('URL 无效', 'BAD_URL');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw err('仅支持 http/https', 'BAD_URL');
    if (url.username || url.password) throw err('URL 不允许内嵌凭据', 'BAD_URL');
    await assertPublicHost(url.hostname);

    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.8,*/*;q=0.1',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
        },
      });
    } catch (e) {
      throw err(`抓取失败: ${e?.message || e}`, e?.name === 'TimeoutError' ? 'FETCH_TIMEOUT' : 'FETCH_FAILED');
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* noop */ }
      if (!loc || hop === MAX_REDIRECTS) throw err('重定向过多或缺少目标', 'FETCH_FAILED');
      url = new URL(loc, url); // 相对跳转解析后，下一轮重新过 SSRF 校验
      continue;
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      throw err(`目标返回 ${res.status}`, 'FETCH_FAILED');
    }
    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !CONTENT_TYPE_ALLOW.test(contentType)) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      throw err(`不支持的内容类型 ${contentType}`, 'UNSUPPORTED_CONTENT_TYPE');
    }

    // 流式读，超限截断（保留已读部分——博客正文一般在前面）
    const reader = res.body?.getReader();
    if (!reader) throw err('响应无内容', 'FETCH_FAILED');
    const parts = [];
    let total = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        parts.push(value.subarray(0, value.byteLength - (total - MAX_BYTES)));
        truncated = true;
        try { await reader.cancel(); } catch { /* noop */ }
        break;
      }
      parts.push(value);
    }
    const content = Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8');
    return { content, contentType: contentType || 'text/html', finalUrl: url.toString(), truncated };
  }
  throw err('重定向过多', 'FETCH_FAILED');
}
