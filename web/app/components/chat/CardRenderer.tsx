'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { validateGedoCard, type GedoCard } from '@/lib/genui/schemas';
import SnapshotCard     from './cards/SnapshotCard';
import TaskAdjustCard   from './cards/TaskAdjustCard';
import GoalProgressCard from './cards/GoalProgressCard';
import MemoryListCard   from './cards/MemoryListCard';
import CardErrorBoundary from './CardErrorBoundary';

interface CardRendererProps {
  card: GedoCard;
  /** Original fence body, shown verbatim when the card can't be rendered. */
  rawJson?: string;
}

export default function CardRenderer({ card, rawJson }: CardRendererProps) {
  // Raw-JSON fallback — used for unknown card_type, shape-invalid cards, and
  // any render-time throw caught by the boundary below. Content is never lost.
  const fallback = (
    <pre
      style={{
        fontSize: fontVars.sm,
        color: 'var(--g-text-muted)',
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 8,
        padding: 12,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        fontFamily: 'var(--g-font-mono)',
      }}
    >
      {rawJson ?? JSON.stringify(card, null, 2)}
    </pre>
  );

  const valid = validateGedoCard(card);
  if (!valid) return fallback;

  let body: React.ReactNode;
  switch (valid.card_type) {
    case 'snapshot':      body = <SnapshotCard card={valid} />; break;
    case 'task_adjust':   body = <TaskAdjustCard card={valid} />; break;
    case 'goal_progress': body = <GoalProgressCard card={valid} />; break;
    case 'memory_list':   body = <MemoryListCard card={valid} />; break;
    default:              return fallback;
  }

  return <CardErrorBoundary fallback={fallback}>{body}</CardErrorBoundary>;
}
