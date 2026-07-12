import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  // 顺序：英语、中文、日语。英语为默认语言。
  locales: ['en', 'zh', 'ja'],
  defaultLocale: 'en',
  // 'as-needed'：默认语言(en)不带前缀、直接位于根目录 /；其余语言带前缀 /zh、/ja。
  // /en 会被规范化重定向到 /。未匹配语言一律回落到默认语言(英文)。
  localePrefix: 'as-needed',
  // 关闭基于 Accept-Language 的首访自动跳转：根目录(/)始终呈现英文。
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
