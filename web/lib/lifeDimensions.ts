// 生命之花八维 — 全站唯一键源（IA v2 批次3 收口）。
// keys 必须与后端 LIFE_DIMENSIONS（services/backend-api/src/memory/types.mjs）一致；
// 消费方：智忆（app/components/gedo/memory/dimensions.ts 的颜色映射）与
// 平行人生（lib/sim/*，雷达渲染）。改这里 = 三处同时生效。

export const DIM_KEYS = [
  'health', 'career', 'family', 'finance',
  'growth', 'social', 'hobby', 'self_realization',
] as const;

export type DimKey = typeof DIM_KEYS[number];

/** 0-10 per life-flower dimension. */
export type Dims = Record<DimKey, number>;
