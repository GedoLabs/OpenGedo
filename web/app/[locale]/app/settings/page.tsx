import { SettingsPanel } from '@/app/components/account/SettingsPanel';

// 设置以弹窗为主（应用外壳里从任意界面打开，无需跳转）；此路由保留为可直达 / 深链的整页回退。
export default function SettingsPage() {
  return <SettingsPanel variant="page" />;
}
