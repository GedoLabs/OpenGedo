'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useMemo } from 'react';
import { 
  AvatarState, 
  AvatarMood, 
  MOOD_COLORS, 
  LEVEL_COLORS,
  DIMENSION_ICONS,
} from './types';
import { LifeWheelDimension, DIMENSION_COLORS } from '../life-tree/types';

interface DigitalAvatarProps {
  state: AvatarState;
  size?: 'sm' | 'md' | 'lg';
  showDimensions?: boolean;
  showAchievements?: boolean;
  isAnimated?: boolean;
  onClick?: () => void;
}

export const DigitalAvatar = ({
  state,
  size = 'md',
  showDimensions = true,
  showAchievements = true,
  isAnimated = true,
  onClick,
}: DigitalAvatarProps) => {
  const sizeConfig = {
    sm: { width: 200, height: 280, scale: 0.6 },
    md: { width: 300, height: 400, scale: 1 },
    lg: { width: 400, height: 520, scale: 1.3 },
  };

  const { width, height, scale } = sizeConfig[size];
  const centerX = width / 2;
  const centerY = height / 2 - 20;

  const levelColor = LEVEL_COLORS[state.level];
  const moodColor = MOOD_COLORS[state.mood];

  // 8维度位置计算
  const dimensionNodes = useMemo(() => {
    const dimensions: LifeWheelDimension[] = [
      'health', 'career', 'growth', 'self_realization',
      'hobby', 'social', 'family', 'finance'
    ];
    
    return dimensions.map((dim, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / 8;
      const radius = 120 * scale;
      return {
        dimension: dim,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius * 0.8,
        value: state.lifeWheel[dim],
        icon: DIMENSION_ICONS[dim],
        color: DIMENSION_COLORS[dim],
      };
    });
  }, [state.lifeWheel, centerX, centerY, scale]);

  // 表情参数
  const moodExpression = getMoodExpression(state.mood);

  return (
    <div 
      className={`relative ${onClick ? 'cursor-pointer' : ''}`}
      style={{ width, height }}
      onClick={onClick}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
      >
        <defs>
          {/* 光环渐变 */}
          <radialGradient id="auraGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={levelColor.primary} stopOpacity="0.4" />
            <stop offset="70%" stopColor={levelColor.primary} stopOpacity="0.1" />
            <stop offset="100%" stopColor={levelColor.primary} stopOpacity="0" />
          </radialGradient>

          {/* 身体渐变 */}
          <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>

          {/* 面部渐变 */}
          <radialGradient id="faceGradient" cx="50%" cy="30%" r="60%">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="100%" stopColor="#fcd34d" />
          </radialGradient>

          {/* 发光滤镜 */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* 柔和阴影 */}
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.3" />
          </filter>
        </defs>

        {/* 背景光环 */}
        <motion.circle
          cx={centerX}
          cy={centerY}
          r={100 * scale}
          fill="url(#auraGradient)"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ 
            scale: isAnimated ? [1, 1.1, 1] : 1, 
            opacity: 1 
          }}
          transition={{ 
            duration: 3, 
            repeat: isAnimated ? Infinity : 0,
            ease: "easeInOut" 
          }}
        />

        {/* 能量光环 */}
        <motion.circle
          cx={centerX}
          cy={centerY}
          r={85 * scale}
          fill="none"
          stroke={levelColor.primary}
          strokeWidth={3}
          strokeDasharray={`${(state.energy / 100) * 2 * Math.PI * 85 * scale} ${2 * Math.PI * 85 * scale}`}
          transform={`rotate(-90 ${centerX} ${centerY})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 0.5 }}
        />

        {/* 8维度光点 */}
        {showDimensions && dimensionNodes.map(({ dimension, x, y, value, color }, i) => (
          <motion.g
            key={dimension}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 + i * 0.05 }}
          >
            {/* 光点背景 */}
            <circle
              cx={x}
              cy={y}
              r={8 + value * 1.5}
              fill={color}
              opacity={0.3}
            />
            {/* 光点核心 */}
            <motion.circle
              cx={x}
              cy={y}
              r={5 + value * 0.8}
              fill={color}
              animate={isAnimated ? { 
                scale: [1, 1.2, 1],
                opacity: [0.8, 1, 0.8] 
              } : {}}
              transition={{ 
                duration: 2 + i * 0.3, 
                repeat: Infinity,
                ease: "easeInOut" 
              }}
            />
          </motion.g>
        ))}

        {/* 身体 */}
        <motion.ellipse
          cx={centerX}
          cy={centerY + 80 * scale}
          rx={45 * scale}
          ry={60 * scale}
          fill="url(#bodyGradient)"
          filter="url(#shadow)"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
        />

        {/* 领口装饰 */}
        <motion.path
          d={`M ${centerX - 20 * scale} ${centerY + 25 * scale} 
              Q ${centerX} ${centerY + 40 * scale} ${centerX + 20 * scale} ${centerY + 25 * scale}`}
          stroke={levelColor.primary}
          strokeWidth={3}
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
        />

        {/* 头部 */}
        <motion.circle
          cx={centerX}
          cy={centerY - 20 * scale}
          r={40 * scale}
          fill="url(#faceGradient)"
          filter="url(#shadow)"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        />

        {/* 头发 */}
        <motion.path
          d={`M ${centerX - 38 * scale} ${centerY - 25 * scale}
              Q ${centerX - 45 * scale} ${centerY - 60 * scale} ${centerX - 20 * scale} ${centerY - 58 * scale}
              Q ${centerX} ${centerY - 70 * scale} ${centerX + 20 * scale} ${centerY - 58 * scale}
              Q ${centerX + 45 * scale} ${centerY - 60 * scale} ${centerX + 38 * scale} ${centerY - 25 * scale}`}
          fill="#1e293b"
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.4 }}
        />

        {/* 眼睛 */}
        <g className="eyes">
          {/* 左眼 */}
          <motion.ellipse
            cx={centerX - 12 * scale}
            cy={centerY - 22 * scale}
            rx={5 * scale}
            ry={moodExpression.eyeHeight * scale}
            fill="#1e293b"
            animate={isAnimated ? { 
              scaleY: [1, 0.1, 1],
            } : {}}
            transition={{ 
              duration: 0.15,
              repeat: Infinity,
              repeatDelay: 4,
            }}
          />
          {/* 右眼 */}
          <motion.ellipse
            cx={centerX + 12 * scale}
            cy={centerY - 22 * scale}
            rx={5 * scale}
            ry={moodExpression.eyeHeight * scale}
            fill="#1e293b"
            animate={isAnimated ? { 
              scaleY: [1, 0.1, 1],
            } : {}}
            transition={{ 
              duration: 0.15,
              repeat: Infinity,
              repeatDelay: 4,
            }}
          />
          {/* 眼睛高光 */}
          <circle
            cx={centerX - 10 * scale}
            cy={centerY - 24 * scale}
            r={2 * scale}
            fill="#fff"
          />
          <circle
            cx={centerX + 14 * scale}
            cy={centerY - 24 * scale}
            r={2 * scale}
            fill="#fff"
          />
        </g>

        {/* 眉毛 */}
        <g className="eyebrows">
          <motion.path
            d={`M ${centerX - 18 * scale} ${centerY - 32 * scale} 
                Q ${centerX - 12 * scale} ${centerY - (34 + moodExpression.browRaise) * scale} ${centerX - 6 * scale} ${centerY - 32 * scale}`}
            stroke="#1e293b"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
          <motion.path
            d={`M ${centerX + 6 * scale} ${centerY - 32 * scale} 
                Q ${centerX + 12 * scale} ${centerY - (34 + moodExpression.browRaise) * scale} ${centerX + 18 * scale} ${centerY - 32 * scale}`}
            stroke="#1e293b"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
        </g>

        {/* 嘴巴 */}
        <motion.path
          d={moodExpression.mouthPath(centerX, centerY - 8 * scale, scale)}
          stroke="#b45309"
          strokeWidth={2.5}
          fill={moodExpression.mouthFill}
          strokeLinecap="round"
          animate={isAnimated && state.mood === 'happy' ? {
            d: [
              moodExpression.mouthPath(centerX, centerY - 8 * scale, scale),
              moodExpression.mouthPath(centerX, centerY - 7 * scale, scale),
              moodExpression.mouthPath(centerX, centerY - 8 * scale, scale),
            ]
          } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        />

        {/* 腮红 */}
        {(state.mood === 'happy' || state.mood === 'excited') && (
          <>
            <circle
              cx={centerX - 25 * scale}
              cy={centerY - 12 * scale}
              r={6 * scale}
              fill="#fca5a5"
              opacity={0.5}
            />
            <circle
              cx={centerX + 25 * scale}
              cy={centerY - 12 * scale}
              r={6 * scale}
              fill="#fca5a5"
              opacity={0.5}
            />
          </>
        )}

        {/* 等级徽章 */}
        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1, type: 'spring' }}
        >
          <circle
            cx={centerX}
            cy={centerY - 75 * scale}
            r={15 * scale}
            fill={levelColor.primary}
            filter="url(#glow)"
          />
          <text
            x={centerX}
            y={centerY - 70 * scale}
            textAnchor="middle"
            fill="#fff"
            fontSize={14 * scale}
            fontWeight="bold"
          >
            {state.level}
          </text>
        </motion.g>

        {/* 人生主题标签 */}
        {state.lifeTheme && (
          <motion.g
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2 }}
          >
            <rect
              x={centerX - 60 * scale}
              y={centerY + 145 * scale}
              width={120 * scale}
              height={24 * scale}
              rx={12 * scale}
              fill="#1e293b"
              stroke={levelColor.primary}
              strokeWidth={1}
            />
            <text
              x={centerX}
              y={centerY + 161 * scale}
              textAnchor="middle"
              fill="#e2e8f0"
              fontSize={10 * scale}
            >
              {state.lifeTheme.length > 12 
                ? state.lifeTheme.slice(0, 12) + '…' 
                : state.lifeTheme}
            </text>
          </motion.g>
        )}

        {/* 智行进度 */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
        >
          <text
            x={centerX}
            y={height - 30 * scale}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize={11 * scale}
          >
            智行 {state.todayCompleted}/{state.todayTotal} 
            {state.streakDays > 0 && ` · 🔥${state.streakDays}天`}
          </text>
        </motion.g>

        {/* 成就徽章 */}
        {showAchievements && state.achievements.length > 0 && (
          <g className="achievements">
            {state.achievements.slice(0, 3).map((achievement, i) => (
              <motion.g
                key={achievement.id}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 1.5 + i * 0.1, type: 'spring' }}
              >
                <circle
                  cx={centerX - 40 * scale + i * 40 * scale}
                  cy={centerY + 180 * scale}
                  r={14 * scale}
                  fill="#1e293b"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                />
                <text
                  x={centerX - 40 * scale + i * 40 * scale}
                  y={centerY + 185 * scale}
                  textAnchor="middle"
                  fontSize={12 * scale}
                >
                  {achievement.icon}
                </text>
              </motion.g>
            ))}
          </g>
        )}
      </svg>

      {/* 情绪状态指示器 */}
      <motion.div
        className="absolute top-2 right-2 px-2 py-1 rounded-full text-[length:var(--g-text-sm)] font-medium"
        style={{ 
          backgroundColor: `${moodColor}20`,
          color: moodColor,
          border: `1px solid ${moodColor}40`
        }}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.5 }}
      >
        {getMoodLabel(state.mood)}
      </motion.div>
    </div>
  );
};

// 表情参数生成
function getMoodExpression(mood: AvatarMood) {
  const expressions: Record<AvatarMood, {
    eyeHeight: number;
    browRaise: number;
    mouthPath: (cx: number, cy: number, scale: number) => string;
    mouthFill: string;
  }> = {
    happy: {
      eyeHeight: 6,
      browRaise: 2,
      mouthPath: (cx, cy, s) => `M ${cx - 12 * s} ${cy} Q ${cx} ${cy + 10 * s} ${cx + 12 * s} ${cy}`,
      mouthFill: 'none',
    },
    excited: {
      eyeHeight: 7,
      browRaise: 4,
      mouthPath: (cx, cy, s) => `M ${cx - 10 * s} ${cy} Q ${cx} ${cy + 12 * s} ${cx + 10 * s} ${cy} Z`,
      mouthFill: '#fef3c7',
    },
    neutral: {
      eyeHeight: 5,
      browRaise: 0,
      mouthPath: (cx, cy, s) => `M ${cx - 8 * s} ${cy} L ${cx + 8 * s} ${cy}`,
      mouthFill: 'none',
    },
    thinking: {
      eyeHeight: 4,
      browRaise: 1,
      mouthPath: (cx, cy, s) => `M ${cx - 6 * s} ${cy} Q ${cx} ${cy - 3 * s} ${cx + 8 * s} ${cy + 2 * s}`,
      mouthFill: 'none',
    },
    tired: {
      eyeHeight: 3,
      browRaise: -1,
      mouthPath: (cx, cy, s) => `M ${cx - 8 * s} ${cy + 2 * s} Q ${cx} ${cy - 2 * s} ${cx + 8 * s} ${cy + 2 * s}`,
      mouthFill: 'none',
    },
    encouraging: {
      eyeHeight: 5,
      browRaise: 2,
      mouthPath: (cx, cy, s) => `M ${cx - 10 * s} ${cy} Q ${cx} ${cy + 8 * s} ${cx + 10 * s} ${cy}`,
      mouthFill: 'none',
    },
  };

  return expressions[mood];
}

// 情绪标签
function getMoodLabel(mood: AvatarMood): string {
  const labels: Record<AvatarMood, string> = {
    happy: '😊 开心',
    excited: '🎉 兴奋',
    neutral: '😐 平静',
    thinking: '🤔 思考',
    tired: '😴 疲惫',
    encouraging: '💪 加油',
  };
  return labels[mood];
}



