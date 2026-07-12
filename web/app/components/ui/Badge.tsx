import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'custom';
  color?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const variantStyles = {
  default: 'bg-slate-700/50 text-slate-300',
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-400',
  error: 'bg-red-500/15 text-red-400',
  info: 'bg-blue-500/15 text-blue-400',
  custom: '',
};

export function Badge({ children, variant = 'default', color, size = 'sm', className }: BadgeProps) {
  const sizeStyles = size === 'sm' ? 'text-[length:var(--g-text-sm)] px-1.5 py-0.5' : 'text-[length:var(--g-text-base)] px-2 py-0.5';
  const style = color ? { backgroundColor: color + '15', color } : {};

  return (
    <span
      className={cn('inline-flex items-center rounded-full font-medium', sizeStyles, variantStyles[variant], className)}
      style={variant === 'custom' ? style : undefined}
    >
      {children}
    </span>
  );
}
