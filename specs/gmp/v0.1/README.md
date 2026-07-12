# GEDO Memory Pack (`.gmp`) — v0.1

> 一个开放、可移植、可签名的"个人记忆"交换格式。
> Apache License 2.0 · 由 [GEDO.AI](https://github.com/) 发起,欢迎其他厂商接入。

`.gmp`(GEDO Memory Pack)是一种为"个人长期记忆"而设计的容器格式,目标是让你的身份画像、语义画像、行为规则、情景日记可以**离开任何单一厂商**(ChatGPT memory、Claude Project、Gemini Gem、Mem0、Letta、Honcho 等),在不同 AI 助理之间无损迁移。

物理形态是一个 ZIP 包,后缀 `.gmp`,解压后由若干 JSON / JSONL 文件组成,带 manifest 与可选签名。

## 为什么需要 .gmp

2026 年初,主流 AI 助理都开始内置"记忆"能力,但每家的实现互不兼容:

| 厂商 | 形态 | 可移植性 |
|---|---|---|
| ChatGPT | 自由文本 memory.txt | 仅文本,无结构 |
| Claude | Project 文件 + 系统指令 | Markdown 散文 |
| Gemini Gem | 单一 Gem 提示词 | 单条 |
| Mem0 / Letta / Honcho | 各自 SaaS schema | 厂商锁定 |

**用户的记忆不应被某一家平台绑架**。`.gmp` 旨在做这件事的"OPML"或"vCard"。

## 文件结构

```
my-memory.gmp/                 # ZIP 包,解压后为目录
├── manifest.json              # 版本、所有者、统计、签名
├── identity.json              # L1 身份层(始终在 context 中)
├── semantic.json              # L2 语义层(8 维生命之花画像)
├── procedural.json            # L5 程序层(行为规则 / 偏好)
├── episodes.jsonl             # L4 情景层(原始事件,流式)
├── embeddings.bin             # (可选)向量,float32 little-endian
└── adapters/                  # (可选)跨平台适配视图,有损渲染
    ├── claude_project.md      # Claude Project 系统指令(≤8K)
    ├── chatgpt_memory.txt     # ChatGPT custom memory(≤4K)
    ├── gemini_gem.md          # Gemini Gem instructions
    └── system_prompt.md       # 通用 system prompt
```

约定:

- 所有 JSON 文件 UTF-8 编码,无 BOM。
- 时间戳一律 RFC 3339(`2026-04-29T10:00:00Z`)。
- ID 字段统一 UUID v4 字符串。
- `episodes.jsonl` 一行一个 JSON 对象(NDJSON)。
- `embeddings.bin` 与 `episodes.jsonl` 顺序对齐;每条向量 1024 维 × 4 字节 = 4096 字节定长。
- ZIP 内部允许任意压缩级别;读取方必须容忍流式解压。

## 五层记忆模型对应关系

`.gmp` 的层级与文档 [GEDO_AI_深度分析与改进方案.md §3.2](../../../GEDO_AI_深度分析与改进方案.md) 描述的 L1-L5 一致:

| .gmp 文件 | 层级 | 用途 |
|---|---|---|
| identity.json | L1 Identity | 始终在 context 中,体量 ≤2 KB |
| semantic.json | L2 Semantic | 8 维画像 + 知识地图 |
| (运行时,不入包) | L3 Working | 短期工作记忆,7 天过期 |
| episodes.jsonl + embeddings.bin | L4 Episodic | 原始事件流 |
| procedural.json | L5 Procedural | 行为规则 / 偏好 |

L3 工作记忆有意**不进** `.gmp`:它是短期的、易过期的,导出/导入时直接丢弃即可。

## 安全模型

### 签名(强烈建议)
- 算法:Ed25519。
- `manifest.signature` 形如 `"ed25519:<base64>"`,签名内容是 manifest 中除 `signature` 字段外的规范化 JSON。
- 公钥发布在 `owner.public_key`(可选),或由身份服务托管。
- **未签名的 .gmp 在导入时,UI 必须显示警告**:"这不是 owner 本人导出的记忆,可能含恶意内容(prompt injection 风险)"。

### 加密(可选)
- `manifest.encryption` 取值 `"none" | "age-x25519" | "age-passphrase"`。
- 启用加密时,除 `manifest.json` 外的所有文件都被 [age](https://github.com/FiloSottile/age) 加密。
- 公钥放 `manifest.encryption_recipients[]`。

### 隐私
- `owner.uid_hash` 使用 SHA-256 对原始 user id + 16 字节 salt(单独存 `owner.uid_salt`)做哈希,而非明文 user id。
- `owner.display_name` 是导出方自我声明的名字,导入端可显示但不应作为身份认证依据。

## 导入语义

读到一个 `.gmp` 时,实现方应:

1. **校验**:JSON Schema 验证 manifest + 各分层文件;失败立即拒绝。
2. **签名核验**:若 `signature` 存在,验签;失败则提示用户但允许"以观察者身份"继续。
3. **去重**:对每条 episode,先按 `id` 查重;再用 cosine ≥ 0.92 + LLM 二次确认合并。
4. **冲突解决**:identity / semantic 字段如与本地冲突,生成 `superseded_by` 链,触发用户确认而非静默覆盖。
5. **L3 不导入**:导入端按需重建工作记忆,不复用旧的 L3。

## 导出语义

导出方应:

1. **裁剪**:`identity.json` ≤ 2 KB,`semantic.json` ≤ 16 KB,`episodes.jsonl` 不限大小。
2. **adapters/ 是有损渲染**:按重要度排序后裁剪到目标平台的 context 预算,而非简单截断。
3. **可选嵌入向量**:用户可勾选"是否打包向量"。不打包时 `embeddings.bin` 省略,导入端按需重新生成。
4. **签名**:用户私钥(PassKey / WebAuthn / 浏览器存储)对 manifest 签名。

## 版本演进

- 当前版本:`0.1`(草案)。
- 后续版本:`0.x` 为草案,`1.0` 起进入兼容期。
- `manifest.schema` 字段格式 `"gedo-memory-pack/v<major>.<minor>"`。
- 实现方 MUST 拒绝高于自身支持的 major 版本,SHOULD 容忍更高的 minor。

## 引用与扩展

期待以下系统接入或参考:

- [Mem0](https://github.com/mem0ai/mem0)
- [Letta (formerly MemGPT)](https://github.com/letta-ai/letta)
- [Zep / Graphiti](https://github.com/getzep/graphiti)
- [Honcho](https://github.com/plastic-labs/honcho)
- ChatGPT custom memory、Claude Project、Gemini Gem(均为 adapter 渲染对象)

## 例子

完整的小型样本见 [examples/sample.gmp/](./examples/sample.gmp/),用 `ajv-cli` 校验:

```bash
npx ajv-cli validate \
  -s specs/gmp/v0.1/manifest.schema.json \
  -d specs/gmp/v0.1/examples/sample.gmp/manifest.json
```

## 许可

[Apache License 2.0](./LICENSE) — 任何人可自由实现、扩展、商用,需保留版权声明。

## 反馈

issues/PR 欢迎对以下问题讨论:

- 是否需要 `relations.jsonl` 来承载 graph relations(L4 sub)?当前草案让实现方在 episodes 中用 `relations[]` 字段表达。
- 是否需要 `media/` 子目录承载用户附件(图像、音频)?
- 是否需要 differential `.gmp.diff` 增量包?
