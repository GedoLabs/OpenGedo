/**
 * MCP 精选目录（能力开放 E3）——设置页「推荐连接」的数据源。
 *
 * 定位：官方 remote MCP server 的运营维护清单，把"极客手填 URL"变成一键连接。
 * URL 以各家官方文档为准（docs_url 均为官方页），失效时改这里即可，无需动代码。
 * auth: 'oauth' = 添加后需走授权流程；'none' = 即连即用（适合首次体验）。
 * 隐私注：连接即表示相关数据流经该第三方服务——聚合平台（Composio 类）仍然排除。
 */

export const MCP_DIRECTORY = [
  {
    slug: 'deepwiki',
    name: 'DeepWiki',
    url: 'https://mcp.deepwiki.com/mcp',
    auth: 'none',
    icon: '📚',
    docs_url: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    desc: {
      zh: '查询任意开源 GitHub 仓库的文档与问答（免鉴权，适合第一次体验）',
      en: 'Ask questions about any public GitHub repo (no auth — great first try)',
      ja: '公開 GitHub リポジトリのドキュメント Q&A（認証不要・お試しに最適）',
    },
  },
  {
    slug: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    icon: '🗂️',
    docs_url: 'https://developers.notion.com/docs/mcp',
    desc: {
      zh: '搜索/读取/创建你的 Notion 页面与数据库',
      en: 'Search, read and create pages in your Notion workspace',
      ja: 'Notion のページ・データベースを検索/作成',
    },
  },
  {
    slug: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    icon: '📐',
    docs_url: 'https://linear.app/docs/mcp',
    desc: {
      zh: '查询与创建 Linear issue、项目与迭代',
      en: 'Find and create Linear issues, projects and cycles',
      ja: 'Linear の Issue・プロジェクトを検索/作成',
    },
  },
  {
    slug: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'oauth',
    icon: '🐙',
    docs_url: 'https://docs.github.com/en/copilot/customizing-copilot/using-model-context-protocol/using-the-github-mcp-server',
    desc: {
      zh: '仓库、issue、PR 的读取与操作',
      en: 'Read and act on repos, issues and pull requests',
      ja: 'リポジトリ・Issue・PR の参照と操作',
    },
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    auth: 'oauth',
    icon: '🚨',
    docs_url: 'https://docs.sentry.io/product/sentry-mcp/',
    desc: {
      zh: '查询报错、性能问题与项目状态',
      en: 'Query errors, performance issues and project health',
      ja: 'エラー・パフォーマンス問題を照会',
    },
  },
  {
    slug: 'atlassian',
    name: 'Atlassian (Jira/Confluence)',
    url: 'https://mcp.atlassian.com/v1/sse',
    auth: 'oauth',
    icon: '🧩',
    docs_url: 'https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/',
    desc: {
      zh: 'Jira 工单与 Confluence 页面的查询与创建',
      en: 'Work with Jira issues and Confluence pages',
      ja: 'Jira 課題と Confluence ページを操作',
    },
  },
  {
    slug: 'asana',
    name: 'Asana',
    url: 'https://mcp.asana.com/sse',
    auth: 'oauth',
    icon: '✅',
    docs_url: 'https://developers.asana.com/docs/using-asanas-model-control-protocol-mcp-server',
    desc: {
      zh: '任务与项目管理（查询/创建/更新）',
      en: 'Query, create and update tasks and projects',
      ja: 'タスク・プロジェクトの照会/作成/更新',
    },
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    url: 'https://mcp.stripe.com',
    auth: 'oauth',
    icon: '💳',
    docs_url: 'https://docs.stripe.com/mcp',
    desc: {
      zh: '查询客户、订阅与账单数据',
      en: 'Look up customers, subscriptions and billing data',
      ja: '顧客・サブスク・請求データを照会',
    },
  },
];

/** 路由序列化（全量透传即可——本清单不含秘密）。 */
export function listDirectory() {
  return MCP_DIRECTORY;
}
