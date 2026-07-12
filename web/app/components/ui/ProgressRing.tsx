interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  showLabel?: boolean;
  className?: string;
}

export function ProgressRing({
  progress, size = 36, strokeWidth = 3, color = '#10b981',
  bgColor = 'currentColor', showLabel = true, className,
}: ProgressRingProps) {
  const r = (size - strokeWidth * 2) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, progress)) / 100) * c;

  return (
    <svg width={size} height={size} className={`transform -rotate-90 ${className || ''}`}>
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={bgColor} strokeWidth={strokeWidth}
        className="text-slate-700"
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={c} strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-500"
      />
      {showLabel && (
        <text
          x="50%" y="50%"
          textAnchor="middle" dy="0.35em"
          className="transform rotate-90 origin-center"
          fill="white" fontSize={size * 0.28} fontWeight="bold"
        >
          {Math.round(progress)}%
        </text>
      )}
    </svg>
  );
}
