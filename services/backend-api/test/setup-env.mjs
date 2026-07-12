import path from 'node:path';

// Hard guard, runs in every worker before any test module (and before any
// src module resolves DATA_DIR): tests must never run against the real dev
// data/. vitest.config.mjs points GEDO_DATA_DIR at a per-run temp dir; if
// that ever stops happening (config refactor, stray custom --config), fail
// loudly instead of silently writing test users into store.json.
const dir = process.env.GEDO_DATA_DIR ? path.resolve(process.env.GEDO_DATA_DIR) : '';
if (!dir || dir === path.join(process.cwd(), 'data')) {
  throw new Error(
    '[test/setup-env] GEDO_DATA_DIR 未指向临时目录——拒绝运行，防止测试写入真实 data/store.json。' +
    ' 请通过 vitest.config.mjs 运行（npm test），不要绕过配置直跑。',
  );
}
