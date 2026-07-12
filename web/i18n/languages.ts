import type { Locale } from './routing';

/**
 * 语言注册表 —— 供语言切换 UI（Header / LandNav 下拉）使用。
 * 新增语言时：在此追加一项，并在 i18n/routing.ts 的 locales 中注册，
 * 同时补齐 messages/<code>.json 翻译。
 * 顺序即下拉选择器的展示顺序。
 */
export type LanguageOption = {
  code: Locale;
  /** 在选择器中显示的紧凑标签（单字 / 双字符） */
  short: string;
  /** 该语言下的母语名称，展示在下拉项中 */
  native: string;
};

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', short: 'EN', native: 'English' },
  { code: 'zh', short: '中', native: '简体中文' },
  { code: 'ja', short: '日', native: '日本語' },
  // 后期扩展示例（需在 routing.locales 注册并补齐 messages）：
  // { code: 'ko', short: '한', native: '한국어' },
];
