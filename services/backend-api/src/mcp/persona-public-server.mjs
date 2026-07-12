/**
 * 分身公开 MCP server（能力开放 E1）—「对外提供能力」第一块。
 *
 * 外部 Agent 通过 `POST /public/mcp`（Streamable HTTP，无状态、JSON 响应）
 * 访问已发布数字分身：digital_persona_profile / digital_persona_ask 两个只读工具。
 * 每请求新建 Server+Transport（工具表仅两项，开销可忽略），GET/DELETE 不支持。
 *
 * 安全：完全复用 REST 公开通道（/public/v1/persona/*）的既有护栏——
 * ABOUT 红线在 service 层不经此处；(ip+slug) 限流与 REST 共享同一桶；
 * 非公开分身仍须 passcode/invite_token 过门禁；主人分身额度用尽时优雅降级不调 LLM。
 *
 * 工具名用下划线而非文档早期的点号（digital_persona.ask）：Anthropic API 的
 * 工具名不允许 `.`，带点号的工具经 Claude 系客户端命名空间化后会被 API 拒绝。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const SERVER_INFO = { name: 'gedo-digital-persona', version: '1.0.0' };

const INSTRUCTIONS =
  'GEDO digital personas are AI representatives published by GEDO users. ' +
  'Call digital_persona_profile first to learn who a persona is, then digital_persona_ask to ask it questions. ' +
  'Answers are given in third person from owner-approved public knowledge only and never reveal private information. ' +
  'Requests are rate-limited per persona; some personas require a passcode or invite_token.';

const TOOLS = [
  {
    name: 'digital_persona_profile',
    title: 'Digital persona profile',
    description:
      'Fetch the public profile (display name, bio, highlights) of a published GEDO digital persona. ' +
      'Use this first to learn who the persona is.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: "The persona's public slug, e.g. 'alice-x3k9f'" },
      },
      required: ['slug'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'digital_persona_ask',
    title: 'Ask a digital persona',
    description:
      'Ask a published GEDO digital persona a question (single turn). The persona answers in third person ' +
      'strictly from its owner-approved public knowledge and never reveals private information. ' +
      'Gated personas additionally require `passcode` or `invite_token`.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: "The persona's public slug" },
        question: { type: 'string', description: 'The question to ask, plain text' },
        passcode: { type: 'string', description: 'Passcode, only for passcode-gated personas' },
        invite_token: { type: 'string', description: 'Invite token, only for invite-gated personas' },
      },
      required: ['slug', 'question'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

function textResult(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function errorResult(text) {
  return { isError: true, content: [{ type: 'text', text: String(text) }] };
}

/**
 * 依赖注入工厂（store/billing/限流器由 server.mjs 传入，避免反向 import）。
 * 返回 `(req, res) => Promise<void>`，只处理 POST /public/mcp。
 */
export function createPersonaMcpHandler({ store, DigitalPersonaService, billing, personaRateAllow, clientIp }) {
  async function callTool(name, args, req) {
    if (name === 'digital_persona_profile') {
      const slug = String(args.slug || '').trim();
      if (!slug) return errorResult('invalid_input: slug is required');
      const persona = store.getDigitalPersonaBySlug(slug);
      if (!persona) return errorResult('not_found: no published persona under this slug');
      store.incPersonaView(slug);
      return textResult(JSON.stringify(DigitalPersonaService.buildPublicProfile(persona), null, 2));
    }

    if (name === 'digital_persona_ask') {
      const slug = String(args.slug || '').trim();
      const question = String(args.question || '').trim();
      if (!slug || !question) return errorResult('invalid_input: slug and question are required');
      const persona = store.getDigitalPersonaBySlug(slug);
      if (!persona) return errorResult('not_found: no published persona under this slug');
      if (!personaRateAllow(`${clientIp(req)}:${slug}`)) return errorResult('rate_limited: too many requests for this persona, retry later');

      // 非公开分身的访问门禁与 REST 同源（passcode / invite_token）。
      const access = DigitalPersonaService.verifyAccess(
        persona,
        { passcode: args.passcode, invite_token: args.invite_token },
        { resolveInvite: (t) => store.getRelationshipByInviteToken(t) },
      );
      if (!access.ok) return errorResult(`forbidden: ${access.reason || 'access denied'} — this persona may require a passcode or invite_token`);
      if (question.length > DigitalPersonaService.MAX_MESSAGE_CHARS) {
        return errorResult(`message_too_long: question exceeds ${DigitalPersonaService.MAX_MESSAGE_CHARS} characters`);
      }

      // 分身额度（按主人的额度计量）：用尽则优雅返回不可用、不调 LLM。
      if (billing.checkEntitlement(persona.user_id, 'visitor')) {
        const who = persona.display_name || 'TA';
        return textResult(`${who} 现在不方便回复，晚点再来聊聊吧 🙏`);
      }

      let reply = '';
      let streamError = null;
      for await (const chunk of DigitalPersonaService.streamAboutResponse({
        persona, userId: persona.user_id, message: question, history: [], relationship: access.relationship,
      })) {
        if (chunk.type === 'text') reply += chunk.text;
        else if (chunk.type === 'error') streamError = chunk.error;
      }
      if (streamError && !reply) return errorResult(`llm_error: ${streamError}`);
      if (reply) billing.recordUsage(persona.user_id, 'persona.visitor_reply'); // 扣 1 分身额度（仅成功回复）
      return textResult(reply);
    }

    return errorResult(`unknown_tool: ${name}`);
  }

  return async function handlePersonaMcp(req, res) {
    const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        return await callTool(name, args || {}, req);
      } catch (e) {
        console.error('[persona-mcp] tool call failed:', e);
        return errorResult(`internal_error: ${e?.message || 'unexpected failure'}`);
      }
    });

    // 无状态模式：不发 session id、不校验会话，天然适配公开免鉴权端点。
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
