'use client';

import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

interface CardProps extends HTMLMotionProps<'div'> {
  variant?: 'default' | 'gradient' | 'outlined';
  gradientFrom?: string;
  gradientTo?: string;
}

export function Card({ className, variant = 'default', gradientFrom, gradientTo, children, ...props }: CardProps) {
  const base = 'rounded-xl border overflow-hidden';
  const variants = {
    default: 'bg-slate-800/30 border-slate-700/50',
    gradient: `bg-gradient-to-br ${gradientFrom || 'from-violet-500/10'} ${gradientTo || 'to-purple-500/10'} border-violet-500/20`,
    outlined: 'bg-transparent border-slate-700/50 hover:border-slate-600 transition-colors',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(base, variants[variant], className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props}>{children}</div>;
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props}>{children}</div>;
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-3 border-t border-slate-700/30', className)} {...props}>{children}</div>;
}
