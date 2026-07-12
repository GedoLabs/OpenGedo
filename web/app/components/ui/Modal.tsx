'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, subtitle, children, className, maxWidth = 'max-w-md' }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className={cn('w-full bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden', maxWidth, className)}
            onClick={e => e.stopPropagation()}
          >
            {(title || subtitle) && (
              <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
                <div>
                  {title && <h3 className="text-white font-semibold text-[length:var(--g-text-base)]">{title}</h3>}
                  {subtitle && <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-0.5">{subtitle}</p>}
                </div>
                <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            )}
            <div className="px-5 py-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
