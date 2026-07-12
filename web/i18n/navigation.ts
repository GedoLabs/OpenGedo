import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// 语言感知的导航封装：内部链接/跳转必须使用这里导出的 API，
// 否则会丢失 URL 语言前缀（/zh、/en）。
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
