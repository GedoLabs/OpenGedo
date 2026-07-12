import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { isOSS, isSiteOnlyPath, OSS_DEFAULT_PATH } from './lib/edition';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // OSS app build: block marketing site routes and Stripe/Sim API handlers.
  if (isOSS()) {
    if (pathname.startsWith('/api/stripe') || pathname.startsWith('/api/sim')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (isSiteOnlyPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = OSS_DEFAULT_PATH;
      return NextResponse.redirect(url);
    }
  }

  return intlMiddleware(request);
}

export const config = {
  // 匹配除以下之外的所有路径：
  //  - /api（保留 next.config.ts 中到 localhost:8787 的 rewrite 及 Stripe 路由处理器）
  //  - /_next、/_vercel（框架内部）
  //  - 任何带扩展名的静态资源（favicon.ico、logo.png 等）
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
