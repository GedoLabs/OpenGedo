import { routing } from './i18n/routing';
import type baseMessages from './messages/zh.json';
import type appMessages from './messages/app/zh.json';
import type plannerOnboarding from './messages/app/planner-onboarding.zh.json';

// request.ts 把 base / app / planner-onboarding 三份消息浅合并后交给 next-intl：
// planner-onboarding 的顶层 key 会并入 app 命名空间。类型必须同样合并，否则
// useTranslations('app' | 'app.planner' | 'app.onboarding') 及其插值参数在编译期都会被判为不存在。
type Messages = typeof baseMessages & {
  app: (typeof appMessages)['app'] & typeof plannerOnboarding;
};

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: Messages;
  }
}
