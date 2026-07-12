/**
 * Cloud hooks — open-core 的跨层注入点。
 *
 * 开源核心（共享代码）里凡是需要「商业模块存在时才有的能力」，一律通过
 * getCloudHook(name) 取用：闭源仓的 src/cloud/index.mjs 启动时 register，
 * 开源构建下 src/cloud/ 不存在 → hook 恒为 null，调用方自行降级。
 *
 * 约定：hook 名用 "domain.action" 形式（如 assessment.getState）；
 * 共享代码只能读（getCloudHook），注册（registerCloudHook）只允许 cloud 模块调用。
 */

const hooks = new Map();

export function registerCloudHook(name, fn) {
  hooks.set(name, fn);
}

export function getCloudHook(name) {
  return hooks.get(name) || null;
}
