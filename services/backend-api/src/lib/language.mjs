/**
 * Shared language-directive helpers for LLM system prompts.
 *
 * The product supports zh/en/ja UI locales (see web/i18n/routing.ts) and
 * persists the user's choice in settings.language (store.mjs). Historically
 * every system prompt across conversation/planner/persona/memory-engine
 * services hardcoded a Chinese-language instruction, so the model always
 * replied in Chinese regardless of the user's chosen language. These two
 * helpers are the single place that turns a language code into a model
 * directive — call sites just interpolate the result into their prompt.
 *
 * Two flavors:
 *   - replyLanguageDirective: for back-and-forth chat. Soft default + follows
 *     the user if they switch languages mid-conversation (mirrors how a
 *     bilingual person would behave).
 *   - outputLanguageDirective: for one-shot structured generation (plans,
 *     narratives, JSON fields) where there's no conversational turn to
 *     follow — it's a hard "write everything in X" instruction.
 */

const SUPPORTED = ['zh', 'en', 'ja'];

export function normalizeLang(lang) {
  return SUPPORTED.includes(lang) ? lang : 'zh';
}

export function replyLanguageDirective(lang) {
  switch (normalizeLang(lang)) {
    case 'en':
      return 'Default to replying in English, but if the user writes in a different language, switch to follow them.';
    case 'ja':
      return '基本的に日本語で返信してください。ただし、ユーザーが別の言語で書いてきたら、その言語に合わせてください。';
    default:
      return '默认用简体中文回复，但如果用户改用其他语言书写，请跟随用户使用的语言。';
  }
}

export function outputLanguageDirective(lang) {
  switch (normalizeLang(lang)) {
    case 'en':
      return 'Write all output text (every title, description and JSON string field) in English.';
    case 'ja':
      return '出力するすべてのテキスト（タイトル、説明、JSON内のすべての文字列フィールド）を日本語で書いてください。';
    default:
      return '请用简体中文撰写所有输出文本（标题、描述、JSON 里的每一个字符串字段）。';
  }
}
