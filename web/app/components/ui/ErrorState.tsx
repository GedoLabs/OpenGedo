import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title = '加载失败', message, onRetry, className }: ErrorStateProps) {
  return (
    <div className={`text-center py-16 ${className || ''}`}>
      <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
      <h3 className="text-white font-medium mb-2">{title}</h3>
      {message && <p className="text-slate-500 text-[length:var(--g-text-base)] mb-4">{message}</p>}
      {onRetry && (
        <button onClick={onRetry}
          className="flex items-center gap-2 mx-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[length:var(--g-text-base)] transition-colors">
          <RefreshCw className="w-4 h-4" /> 重试
        </button>
      )}
    </div>
  );
}
