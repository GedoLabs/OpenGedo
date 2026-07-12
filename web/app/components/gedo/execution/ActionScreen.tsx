'use client';

import { fontVars, text } from '../typography';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExecutionScreen } from './ExecutionScreen';
import { GoalsView } from './GoalsView';
import { ObstaclesView } from './ObstaclesView';

// 智行 / Action —— 把 执行 + 目标 + 应急卡 收进一个模块，顶部三标签切换。
// 标签状态从 ?tab= 读取（深链），切换时用 history.replaceState 同步 URL，不触发整页跳转。
type Tab = 'execution' | 'goals' | 'obstacles';

const TAB_IDS: Tab[] = ['execution', 'goals', 'obstacles'];

function parseTab(v: string | null): Tab {
  return v === 'goals' || v === 'obstacles' ? v : 'execution';
}

export function ActionScreen() {
  // SSR-safe：初始 execution，挂载后读 URL（避免 useSearchParams 的 Suspense 约束）。
  const [tab, setTab] = useState<Tab>('execution');

  useEffect(() => {
    const t = parseTab(new URLSearchParams(window.location.search).get('tab'));
    if (t !== 'execution') setTab(t);
  }, []);

  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'execution') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url.toString());
    } catch { /* ignore */ }
  }, []);

  const tabBar = <ActionTabs tab={tab} onChange={switchTab} />;

  if (tab === 'goals') return <GoalsView tabs={tabBar} onViewObstacles={() => switchTab('obstacles')} />;
  if (tab === 'obstacles') return <ObstaclesView tabs={tabBar} />;
  return <ExecutionScreen tabs={tabBar} />;
}

function ActionTabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const t = useTranslations('app');
  return (
    <div className="gedo-action-tabs" style={{ display: 'flex', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 8, padding: 2, flexShrink: 0 }}>
        {TAB_IDS.map(id => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              style={{
                padding: 'var(--g-btn-pad-y) calc(var(--g-btn-pad-x) * 0.85)',
                minHeight: 32,
                border: 'none',
                background: active ? 'var(--g-surface-2)' : 'transparent',
                color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
                borderRadius: 6,
                fontSize: fontVars.sm,
                cursor: 'pointer',
                fontFamily: 'var(--g-font-sans)',
                whiteSpace: 'nowrap',
              }}
            >
              {t(`execution.shell.${id}`)}
            </button>
          );
        })}
    </div>
  );
}
