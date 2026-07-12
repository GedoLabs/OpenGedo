'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  color?: string;
  variant?: 'default' | 'gradient';
  gradientFrom?: string;
  gradientTo?: string;
  subtitle?: string;
  delay?: number;
  className?: string;
}

export function StatCard({
  label, value, icon: Icon, color = 'text-white', variant = 'default',
  gradientFrom, gradientTo, subtitle, delay = 0, className,
}: StatCardProps) {
  const variants = {
    default: 'bg-slate-800/30 border-slate-700/50',
    gradient: `bg-gradient-to-br ${gradientFrom || 'from-violet-500/10'} ${gradientTo || 'to-purple-500/10'} border-violet-500/20`,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={cn('rounded-xl border p-4', variants[variant], className)}
    >
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className={`w-4 h-4 ${color}`} />}
        <span className="text-[length:var(--g-text-sm)] text-slate-500">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {subtitle && <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-1">{subtitle}</p>}
    </motion.div>
  );
}
