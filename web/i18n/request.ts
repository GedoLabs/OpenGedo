import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  // 营销/落地页文案在 messages/<locale>.json；产品区(app)文案隔离在
  // messages/app/<locale>.json，避免改动 50KB 的营销文件。两者顶层 key 不重叠，
  // 浅合并即可。
  const [base, appMessages, plannerOnboarding] = await Promise.all([
    import(`../messages/${locale}.json`),
    import(`../messages/app/${locale}.json`),
    import(`../messages/app/planner-onboarding.${locale}.json`),
  ]);

  return {
    locale,
    messages: {
      ...base.default,
      app: {
        ...appMessages.default.app,
        ...plannerOnboarding.default,
      },
    },
  };
});
