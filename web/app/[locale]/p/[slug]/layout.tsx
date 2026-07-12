import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { resolveApiBaseUrl } from '@/lib/apiClient';

// Server layout wrapping the (client) public persona page so we can emit
// per-persona metadata + OG/Twitter cards. The sibling opengraph-image.tsx is
// auto-wired into openGraph.images by Next.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;

  let profile: { display_name?: string; tagline?: string } | null = null;
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/public/v1/persona/${slug}`, { cache: 'no-store' });
    if (res.ok) profile = await res.json();
  } catch {
    /* fall back to generic copy */
  }

  const name = profile?.display_name || '数字分身';
  const title = `${name} 的智能助理 · GEDO`;
  const description = profile?.tagline || `与 ${name} 的数字分身对话 —— 基于公开档案作答，由 GEDO 驱动。`;

  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function PublicPersonaLayout({ children }: { children: ReactNode }) {
  return children;
}
