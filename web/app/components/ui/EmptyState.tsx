import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`text-center py-16 ${className || ''}`}>
      <Icon className="w-12 h-12 text-slate-600 mx-auto mb-4" />
      <h3 className="text-white font-medium mb-2">{title}</h3>
      {description && <p className="text-slate-500 text-[length:var(--g-text-base)] max-w-md mx-auto mb-4">{description}</p>}
      {action}
    </div>
  );
}
