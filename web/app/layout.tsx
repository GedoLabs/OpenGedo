import type { ReactNode } from "react";

// 根布局仅作透传：<html>/<body> 与所有 Provider 都在 app/[locale]/layout.tsx，
// 这样可以按语言输出 <html lang>（next-intl 的 [locale]-rooted 模式）。
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
