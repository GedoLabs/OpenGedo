import { resolveApiBaseUrl } from './apiClient';
import { isOSS } from './edition';

const VISITOR_KEY = 'gedo_visitor_id';

function getVisitorId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/**
 * 页面浏览上报（无 PII，仅匿名 visitor_id）。渠道按路径推断：
 * 含 /sim 的路径算「平行人生」专题页，其余算「官网/产品」。
 * 尽最大努力发送，任何失败都静默吞掉，不能影响页面渲染。
 */
export function trackPageview(pathname: string, locale?: string) {
  if (typeof window === 'undefined') return;
  if (isOSS()) return; // 自托管 OSS 零遥测（backend beacon 路由亦有同款守卫）
  const visitor_id = getVisitorId();
  if (!visitor_id) return;
  const channel = pathname.includes('/sim') ? 'sim' : 'web';
  const payload = JSON.stringify({
    channel,
    page: pathname,
    visitor_id,
    locale,
    referrer: document.referrer || undefined,
  });
  const url = `${resolveApiBaseUrl()}/public/v1/analytics/beacon`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch {
    // best-effort only
  }
}
