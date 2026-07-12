'use client';

/**
 * 法务文档通用渲染器(security / terms / privacy 共用)。
 * 从 security 页抽取:编号章节 + 桌面侧栏/移动内联双 TOC + scroll-spy + 公司落款。
 * 文档内容以 LegalDocData 传入 —— security 来自 messages,terms/privacy 内联在页面文件。
 */

import { useEffect, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { fontVars, land, text } from '@/app/components/gedo/typography';

const SIDE = 'clamp(20px, 5vw, 56px)';

// 与 landing/subpage.tsx 的 gradTextStyle 同款（法务页共享侧不 import landing/：
// open-core 拆分后 landing/ 只存在于闭源仓，terms/privacy 在开源仓也要能构建）。
const gradTextStyle: CSSProperties = {
  background:
    'linear-gradient(135deg, var(--g-dim-memory), var(--g-dim-insight) 50%, var(--g-accent))',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  color: 'transparent',
};

/** 极简法务页壳：主题背景 + main。terms/privacy（开源仓保留页）用它；
 * security（营销 site-only 页）自带 SubpageShell 并传 chrome={false}。 */
function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="gedo-land-page"
      style={{
        background: 'var(--g-bg)',
        color: 'var(--g-text)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}

export type LegalSection = { h: string; p?: string[]; list?: string[]; note?: string };
export type LegalSignature = {
  closing: string;
  by: string;
  company: string;
  entity: string;
  address: string;
  contactLabel: string;
  email: string;
  place: string;
  dateLabel: string;
  date: string;
};
export type LegalDocData = {
  eyebrow: string;
  title: string;
  subtitle: string;
  version: string;
  updatedLabel: string;
  updated: string;
  effectiveLabel: string;
  effective: string;
  tocLabel: string;
  intro?: string[];
  sections: LegalSection[];
  /** 末节高亮框(security 的免责声明);可省略 */
  disclaimer?: LegalSection;
  signature: LegalSignature;
};

type Item = LegalSection & { n: number; id: string; warn?: boolean };

const two = (n: number) => String(n).padStart(2, '0');

const paraStyle: CSSProperties = {
  ...text.body,
  color: 'var(--g-text-mid)',
  lineHeight: 1.85,
  margin: '0 0 14px',
};

function TocList({
  items,
  active,
  tocLabel,
  onClick,
  variant,
}: {
  items: Item[];
  active: string;
  tocLabel: string;
  onClick: (e: ReactMouseEvent, id: string) => void;
  variant: 'rail' | 'inline';
}) {
  const rail = variant === 'rail';
  return (
    <>
      <div style={{ ...land.eyebrow, marginBottom: 14 }}>{tocLabel}</div>
      <ol
        style={
          rail
            ? { margin: 0, padding: 0, listStyle: 'none', borderLeft: '1px solid var(--g-border)' }
            : {
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                gap: '9px 24px',
              }
        }
      >
        {items.map(sec => {
          const on = active === sec.id;
          return (
            <li key={sec.id}>
              <a
                href={`#${sec.id}`}
                onClick={e => onClick(e, sec.id)}
                style={
                  rail
                    ? {
                        display: 'flex',
                        gap: 10,
                        alignItems: 'baseline',
                        padding: '6px 0 6px 14px',
                        marginLeft: -1,
                        borderLeft: `2px solid ${on ? 'var(--g-accent)' : 'transparent'}`,
                        color: on ? 'var(--g-text)' : 'var(--g-text-mid)',
                        fontWeight: on ? 600 : 400,
                        fontSize: fontVars.sm,
                        lineHeight: 1.4,
                        textDecoration: 'none',
                        transition: 'color .15s ease, border-color .15s ease',
                      }
                    : {
                        display: 'flex',
                        gap: 10,
                        alignItems: 'baseline',
                        color: on ? 'var(--g-text)' : 'var(--g-text-mid)',
                        fontWeight: on ? 600 : 400,
                        fontSize: fontVars.sm,
                        lineHeight: 1.5,
                        textDecoration: 'none',
                      }
                }
              >
                <span
                  style={{
                    fontFamily: 'var(--g-font-mono)',
                    fontSize: fontVars.xs,
                    color: on ? 'var(--g-accent)' : 'var(--g-text-faint)',
                    minWidth: 18,
                  }}
                >
                  {two(sec.n)}
                </span>
                <span>{sec.h}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function LegalDoc({ doc, chrome = true }: { doc: LegalDocData; chrome?: boolean }) {
  const intro = doc.intro ?? [];
  const items: Item[] = [
    ...doc.sections.map((sec, i) => ({ ...sec, n: i + 1, id: `sec-${i + 1}` })),
    ...(doc.disclaimer
      ? [{ ...doc.disclaimer, n: doc.sections.length + 1, id: `sec-${doc.sections.length + 1}`, warn: true }]
      : []),
  ];
  const sig = doc.signature;

  const ids = items.map(i => i.id);
  const [active, setActive] = useState(ids[0] ?? '');

  useEffect(() => {
    const els = ids
      .map(id => document.getElementById(id))
      .filter((x): x is HTMLElement => x !== null);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      entries => {
        const vis = entries.filter(e => e.isIntersecting);
        if (!vis.length) return;
        vis.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActive(vis[0].target.id);
      },
      { rootMargin: '-88px 0px -68% 0px', threshold: 0 },
    );
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|')]);

  const onTocClick = (e: ReactMouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof history !== 'undefined') history.replaceState(null, '', `#${id}`);
    setActive(id);
  };

  const body = (
      <section style={{ padding: `clamp(88px, 11vh, 128px) ${SIDE} 56px` }}>
        <div className="gedo-sec-grid">
          <aside className="gedo-sec-toc-rail" aria-label={doc.tocLabel}>
            <TocList items={items} active={active} tocLabel={doc.tocLabel} onClick={onTocClick} variant="rail" />
          </aside>

          <div className="gedo-sec-main">
            <header style={{ position: 'relative', marginBottom: 4 }}>
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  background:
                    'radial-gradient(720px 280px at 8% -30%, color-mix(in oklch, var(--g-accent) 8%, transparent), transparent 70%)',
                }}
              />
              <div style={{ position: 'relative' }}>
                <div style={{ ...land.eyebrow, marginBottom: 16 }}>{doc.eyebrow}</div>
                <h1 style={{ ...land.hero, fontSize: 'clamp(30px, 4.6vw, 46px)' }}>{doc.title}</h1>
                <p style={{ margin: '18px 0 0', maxWidth: 680, ...land.heroSub }}>{doc.subtitle}</p>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px 22px',
                    marginTop: 24,
                    ...text.mono,
                    color: 'var(--g-text-faint)',
                  }}
                >
                  <span>{doc.version}</span>
                  <span>{doc.updatedLabel}: {doc.updated}</span>
                  <span>{doc.effectiveLabel}: {doc.effective}</span>
                </div>
              </div>
            </header>

            <div style={{ marginTop: 28 }}>
              {intro.map((para, i) => (
                <p key={i} style={paraStyle}>
                  {para}
                </p>
              ))}
            </div>

            <nav
              className="gedo-sec-toc-inline"
              aria-label={doc.tocLabel}
              style={{
                margin: '22px 0 8px',
                border: '1px solid var(--g-border)',
                borderRadius: 14,
                background: 'var(--g-bg-raised)',
                padding: '20px 24px',
              }}
            >
              <TocList items={items} active={active} tocLabel={doc.tocLabel} onClick={onTocClick} variant="inline" />
            </nav>

            {items.map(sec => (
              <article key={sec.id} id={sec.id} style={{ scrollMarginTop: 88, marginTop: 44 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: fontVars.sm,
                      fontWeight: 600,
                      fontFamily: 'var(--g-font-mono)',
                      color: 'var(--g-accent)',
                      background: 'color-mix(in oklch, var(--g-accent) 12%, transparent)',
                      border: '1px solid var(--g-accent-line)',
                    }}
                  >
                    {two(sec.n)}
                  </span>
                  <h2 style={{ margin: 0, ...text.heading, color: 'var(--g-text)' }}>{sec.h}</h2>
                </div>

                <div
                  style={
                    sec.warn
                      ? {
                          marginLeft: 48,
                          padding: '18px 22px',
                          border: '1px solid var(--g-border)',
                          borderLeft: '3px solid var(--g-accent)',
                          borderRadius: 12,
                          background: 'color-mix(in oklch, var(--g-accent) 5%, var(--g-bg-raised))',
                        }
                      : { paddingLeft: 48 }
                  }
                >
                  {(sec.p ?? []).map((para, i) => (
                    <p key={i} style={{ ...paraStyle, margin: i === (sec.p!.length - 1) && !sec.list ? 0 : '0 0 12px' }}>
                      {para}
                    </p>
                  ))}

                  {sec.list && sec.list.length > 0 && (
                    <ul
                      style={{
                        margin: '6px 0 0',
                        padding: 0,
                        listStyle: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 11,
                      }}
                    >
                      {sec.list.map((item, i) => (
                        <li
                          key={i}
                          style={{ display: 'flex', gap: 12, ...text.body, color: 'var(--g-text-mid)', lineHeight: 1.7 }}
                        >
                          <span
                            aria-hidden
                            style={{
                              flexShrink: 0,
                              marginTop: '0.62em',
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: 'var(--g-accent)',
                            }}
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {sec.note && (
                    <p
                      style={{
                        ...text.bodySm,
                        color: 'var(--g-text-muted)',
                        lineHeight: 1.7,
                        margin: '16px 0 0',
                        paddingTop: 14,
                        borderTop: '1px dashed var(--g-border)',
                      }}
                    >
                      {sec.note}
                    </p>
                  )}
                </div>
              </article>
            ))}

            <div style={{ marginTop: 60, borderTop: '1px solid var(--g-border)', paddingTop: 34 }}>
              <p
                style={{
                  ...text.body,
                  color: 'var(--g-text-muted)',
                  lineHeight: 1.85,
                  fontStyle: 'italic',
                  margin: '0 0 28px',
                }}
              >
                {sig.closing}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ textAlign: 'right', maxWidth: 460 }}>
                  <div style={{ ...text.mono, color: 'var(--g-text-faint)', marginBottom: 8 }}>{sig.by}</div>
                  <div style={{ ...gradTextStyle, fontSize: fontVars.xl, fontWeight: 700, letterSpacing: '-0.01em' }}>
                    {sig.company}
                  </div>
                  <div style={{ ...text.mono, color: 'var(--g-text-faint)', marginTop: 6 }}>{sig.entity}</div>
                  <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.6, marginTop: 12 }}>
                    {sig.address}
                  </div>
                  <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', marginTop: 10 }}>
                    {sig.contactLabel}:{' '}
                    <a href={`mailto:${sig.email}`} style={{ color: 'var(--g-accent)', textDecoration: 'none' }}>
                      {sig.email}
                    </a>
                  </div>
                  <div style={{ ...text.mono, color: 'var(--g-text-mid)', marginTop: 16 }}>
                    {sig.place} · {sig.dateLabel}: {sig.date}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
  );

  return chrome ? <LegalShell>{body}</LegalShell> : body;
}
