import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: number;
  color?: string;
  text?: string;
  fullScreen?: boolean;
}

export function LoadingSpinner({ size = 32, color = 'text-violet-400', text, fullScreen = true }: LoadingSpinnerProps) {
  const content = (
    <div className="text-center">
      <Loader2 className={`animate-spin mx-auto mb-3 ${color}`} style={{ width: size, height: size }} />
      {text && <p className="text-slate-400 text-[length:var(--g-text-base)]">{text}</p>}
    </div>
  );

  if (fullScreen) {
    return <div className="min-h-screen flex items-center justify-center">{content}</div>;
  }

  return <div className="flex items-center justify-center py-12">{content}</div>;
}
