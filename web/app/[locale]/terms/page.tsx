'use client';

/**
 * 用户协议(Terms of Service)v1.0 (Beta) —— 商店提审必备链接之一。
 * 内容内联(法务文档按版本整体评审,不进 UI 字符串文件);渲染复用 LegalDoc。
 * 上线前建议由新加坡执业律师复核;修订时同步更新 version/effective 三语。
 */

import { useLocale } from 'next-intl';
import { LegalDoc, type LegalDocData } from '@/app/components/gedo/LegalDoc';

const SIGNATURE_BASE = {
  company: 'GEDO',
  entity: 'GEDO PTE. LTD. · UEN 202608183K',
  address: '160 Robinson Road, #14-04, Singapore Business Federation Center, Singapore 068914',
  email: 'support@gedo.ai',
  place: 'Singapore',
  date: '2026-07-09',
};

const en: LegalDocData = {
  eyebrow: 'LEGAL · TERMS',
  title: 'Terms of Service',
  subtitle: 'The agreement between you and GEDO PTE. LTD. for using GEDO — the personal growth system.',
  version: 'v1.0 (Beta)',
  updatedLabel: 'Updated',
  updated: '2026-07-09',
  effectiveLabel: 'Effective',
  effective: '2026-07-09',
  tocLabel: 'Contents',
  intro: [
    'These Terms of Service ("Terms") govern your access to and use of GEDO — including the gedo.ai website, web app, mobile apps, digital persona pages and related services (together, the "Service"), operated by GEDO PTE. LTD., a company registered in Singapore ("GEDO", "we", "us"). By creating an account or using the Service you agree to these Terms and to our Privacy Policy.',
  ],
  sections: [
    {
      h: 'Acceptance of these Terms',
      p: [
        'You must be able to form a binding contract to use the Service. If you use the Service on behalf of an organization, you confirm you are authorized to bind it. If you do not agree to these Terms, do not use the Service.',
      ],
    },
    {
      h: 'The Service & Beta Status',
      p: [
        'GEDO is an AI-driven personal growth system: it helps you converse, remember, plan, reflect and publish an optional digital persona. The Service is currently in invite-only beta: features may change, be interrupted or be discontinued, and service levels are not guaranteed during beta.',
      ],
    },
    {
      h: 'Accounts & Eligibility',
      p: [
        'You must be at least 13 years old (or older where your local law requires) to use the Service; minors need a parent or guardian’s consent. You are responsible for your account credentials and all activity under your account. Provide accurate information and keep it updated. One person, one account, unless we agree otherwise.',
      ],
    },
    {
      h: 'Subscriptions, Billing & Auto-Renewal',
      list: [
        'Plans. The Service offers a Free plan and paid subscriptions (currently Pro and Ultra), billed monthly or yearly. What each plan includes is described on the pricing page at the time of purchase.',
        'Auto-renewal. Paid subscriptions renew automatically at the end of each billing period until canceled. Cancel anytime; cancellation takes effect at the end of the current period, and paid features then downgrade to Free.',
        'Billing channels. On the web you pay by card via Stripe. In the iOS app, billing is handled by your Apple Account (App Store); on Android, by Google Play. Manage or cancel a subscription on the platform where you purchased it.',
        'One paid tier at a time. Only one paid tier can be active per account. To switch tiers, cancel first and re-subscribe after the current period ends.',
        'Price changes. We may change prices prospectively. For an active subscription we will give at least 30 days’ notice before a new price applies to your next renewal; if you disagree, cancel before renewal.',
        'Taxes. Prices may exclude applicable taxes (e.g. GST/VAT), which are added where required.',
      ],
    },
    {
      h: 'Refunds',
      p: [
        'Web (Stripe) purchases: within 14 days of first purchase you may request a full refund; after 14 days, yearly plans are refunded pro-rata by remaining full months. Contact support@gedo.ai.',
        'App Store / Google Play purchases: refunds are governed by the platform’s own policy and processed by Apple or Google — request them directly from the platform.',
      ],
    },
    {
      h: 'Fair Use & Quotas',
      p: [
        'Plans include usage quotas (for example smart credits and persona visitor replies) that reset each billing month. "Unlimited" features are subject to fair use: usage patterns that indicate automation, resale, quota sharing or abuse may be rate-limited or suspended. Current usage is always visible in your account center.',
      ],
    },
    {
      h: 'Your Content & Our License',
      p: [
        'You own the content you bring to GEDO — conversations, memories, goals, imported sources and persona materials ("Your Content"). You grant us a limited, worldwide, non-exclusive license to host, process, transmit and display Your Content solely to operate and provide the Service (including sending relevant excerpts to AI model providers to generate your replies). We do not use Your Content to train models without your separate, explicit consent. You can export Your Content at any time and hard-delete it at any time.',
      ],
    },
    {
      h: 'AI-Generated Content',
      p: [
        'The Service generates content with artificial intelligence. AI output can be inaccurate, incomplete or inappropriate despite our safeguards. It is provided for personal reference only and is not medical, psychological, legal, financial or other professional advice. You are responsible for evaluating output before relying on or acting upon it, and decisions you make remain your own.',
      ],
    },
    {
      h: 'Digital Persona & Public Sharing',
      p: [
        'If you publish a digital persona, you choose what it may talk about and who may access it, and you are responsible for the persona content you configure and share. Visitors must not abuse persona pages; we provide reporting and blocking mechanisms and may remove content or restrict access that violates these Terms. Visitor replies consume your persona quota; when exhausted, the persona pauses until the quota resets.',
      ],
    },
    {
      h: 'Acceptable Use',
      list: [
        'No illegal use, and no infringing, harassing, hateful or exploitative content.',
        'No attempts to jailbreak, extract prompts or models, or use the Service to build competing datasets.',
        'No unauthorized access, probing, scraping, rate-limit evasion or interference with the Service.',
        'No impersonation of another person via a digital persona without their consent.',
        'No uploading content you have no right to use.',
      ],
      note: 'We may suspend or terminate accounts that violate this section, with notice where practicable.',
    },
    {
      h: 'Third-Party Services & Connectors',
      p: [
        'You may connect third-party tools (e.g. via MCP connectors or OAuth). Your use of a third-party service is governed by its own terms and privacy policy; you authorize us to exchange data with it on your instruction. We are not responsible for third-party services, and you may disconnect them at any time.',
      ],
    },
    {
      h: 'Intellectual Property & Feedback',
      p: [
        'The Service, including software, design and branding, is owned by GEDO PTE. LTD. or its licensors; these Terms grant you a personal, non-transferable right to use it. If you send us feedback, you grant us a perpetual, royalty-free license to use it without obligation.',
      ],
    },
    {
      h: 'Termination',
      p: [
        'You may stop using the Service and delete your account at any time in the app (Settings → Privacy → Delete account); deletion is permanent and cascades to your memories, goals, persona and subscription records. We may suspend or terminate access for material breach of these Terms; where reasonable we will notify you first. Sections that by nature survive (licenses already granted, disclaimers, liability limits, governing law) survive termination.',
      ],
    },
    {
      h: 'Governing Law & Disputes',
      p: [
        'These Terms are governed by the laws of Singapore. Disputes shall be submitted to the exclusive jurisdiction of the courts of Singapore, without prejudice to mandatory consumer protections of your place of residence.',
      ],
    },
    {
      h: 'Changes & Contact',
      p: [
        'We may update these Terms as the Service evolves. For material changes we will notify you (in-app or by email) at least 14 days before they take effect; continued use after the effective date constitutes acceptance. Questions: support@gedo.ai.',
      ],
    },
  ],
  disclaimer: {
    h: 'Disclaimers & Limitation of Liability',
    p: [
      'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. TO THE MAXIMUM EXTENT PERMITTED BY LAW, GEDO PTE. LTD. SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR LOSS OF DATA, PROFITS OR GOODWILL. OUR AGGREGATE LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE IS LIMITED TO THE AMOUNTS YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM (OR SGD 100 IF YOU PAID NOTHING). NOTHING IN THESE TERMS EXCLUDES LIABILITY THAT CANNOT BE EXCLUDED BY LAW.',
    ],
  },
  signature: {
    closing: 'Thank you for growing with GEDO. We keep these Terms as plain as we can — if anything is unclear, ask us before you rely on it.',
    by: 'Issued by',
    contactLabel: 'Contact',
    dateLabel: 'Effective',
    ...SIGNATURE_BASE,
  },
};

const zh: LegalDocData = {
  eyebrow: '法律条款 · 用户协议',
  title: '用户协议',
  subtitle: '你与 GEDO PTE. LTD. 之间关于使用 GEDO 个人成长系统的约定。',
  version: 'v1.0（Beta）',
  updatedLabel: '更新',
  updated: '2026-07-09',
  effectiveLabel: '生效',
  effective: '2026-07-09',
  tocLabel: '目录',
  intro: [
    '本《用户协议》（下称"本协议"）约定你访问与使用 GEDO 的条件——包括 gedo.ai 网站、网页应用、移动应用、数字分身页面及相关服务（合称"本服务"），运营方为注册于新加坡的 GEDO PTE. LTD.（下称"GEDO"或"我们"）。注册账户或使用本服务即表示你同意本协议与我们的《隐私政策》。',
  ],
  sections: [
    {
      h: '协议的接受',
      p: [
        '你须具备缔结有效合同的能力方可使用本服务。如你代表组织使用，你确认已获授权使其受本协议约束。若不同意本协议，请勿使用本服务。',
      ],
    },
    {
      h: '服务内容与 Beta 状态',
      p: [
        'GEDO 是 AI 驱动的个人成长系统：帮助你对话、记忆、规划、复盘，并可选发布对外的数字分身。本服务目前处于邀请制内测（Beta）阶段：功能可能调整、中断或下线，内测期间不作服务水平承诺。',
      ],
    },
    {
      h: '账户与使用资格',
      p: [
        '使用本服务须年满 13 周岁（或你所在地法律要求的更高年龄）；未成年人需监护人同意。你须妥善保管账户凭证，并对账户下的全部活动负责。请提供并维持准确的账户信息。除非另行约定，一人一账户。',
      ],
    },
    {
      h: '订阅、计费与自动续订',
      list: [
        '方案：本服务提供免费方案与付费订阅（现为 Pro 与 Ultra），按月或按年计费。各方案包含的内容以购买时价格页说明为准。',
        '自动续订：付费订阅在每个计费周期结束时自动续订，直至取消。可随时取消；取消于当前周期结束时生效，之后自动降为免费方案。',
        '计费渠道：网页端通过 Stripe 以银行卡支付；iOS 应用内由你的 Apple 账户（App Store）扣费；Android 由 Google Play 扣费。请在购买渠道对应的平台管理或取消订阅。',
        '同时仅一档：每个账户同一时间只能有一档付费订阅生效。换档请先取消，待当前周期结束后再订阅目标档位。',
        '价格调整：我们可能面向未来调整价格。对生效中的订阅，新价格适用于下一次续订前至少提前 30 天通知你；如不同意，请在续订前取消。',
        '税费：价格可能不含适用税费（如 GST/增值税），依法应收时将另行加收。',
      ],
    },
    {
      h: '退款',
      p: [
        '网页端（Stripe）购买：首次购买 14 天内可申请全额退款；超过 14 天，年付方案按剩余完整月份比例退款。请联系 support@gedo.ai。',
        '通过 Apple App Store / Google Play 购买：退款按平台自身政策由 Apple 或 Google 处理，请直接向平台申请。',
      ],
    },
    {
      h: '合理使用与额度',
      p: [
        '各方案包含按账单月重置的用量额度（如智能额度、分身访客额度）。标注"无限"的能力适用合理使用原则：出现自动化滥用、转售、共享额度等模式时，我们可能限流或暂停。实际用量随时可在账户中心查看。',
      ],
    },
    {
      h: '你的内容与授权',
      p: [
        '你带入 GEDO 的内容归你所有——对话、记忆、目标、导入来源与分身素材（"你的内容"）。你授予我们一项有限的、全球性的、非独占许可，仅用于托管、处理、传输与展示你的内容以运营本服务（包括将相关片段发送给 AI 模型服务商以生成回复）。未经你单独明确同意，我们不会将你的内容用于模型训练。你可以随时导出你的内容，也可以随时硬删除。',
      ],
    },
    {
      h: 'AI 生成内容',
      p: [
        '本服务使用人工智能生成内容。即便有防护措施，AI 输出仍可能不准确、不完整或不恰当。输出仅供个人参考，不构成医疗、心理、法律、财务或其他专业建议。在依赖或据此行动前，请自行判断；你的决定始终由你负责。',
      ],
    },
    {
      h: '数字分身与公开分享',
      p: [
        '若你发布数字分身，由你决定其可谈论的范围与可访问的人群，并对你配置与分享的分身内容负责。访客不得滥用分身页面；我们提供举报与屏蔽机制，并可能移除违规内容或限制访问。访客回复消耗你的分身额度；额度用尽后分身将暂停,直至额度重置。',
      ],
    },
    {
      h: '可接受使用',
      list: [
        '不得用于违法用途，不得发布侵权、骚扰、仇恨或剥削性内容。',
        '不得越狱、套取提示词或模型，或利用本服务构建竞争性数据集。',
        '不得未经授权访问、探测、抓取、规避限流或干扰本服务。',
        '不得未经本人同意通过数字分身假冒他人。',
        '不得上传你无权使用的内容。',
      ],
      note: '违反本条的账户可能被暂停或终止;在可行时我们会先行通知。',
    },
    {
      h: '第三方服务与连接器',
      p: [
        '你可以连接第三方工具（如 MCP 连接器、OAuth 授权）。第三方服务受其自身条款与隐私政策约束；你授权我们按你的指令与其交换数据。我们不对第三方服务负责，你可随时断开连接。',
      ],
    },
    {
      h: '知识产权与反馈',
      p: [
        '本服务（含软件、设计与品牌）归 GEDO PTE. LTD. 或其许可方所有；本协议仅授予你个人的、不可转让的使用权。如你向我们提交反馈，即授予我们永久、免费的使用许可，我们无使用义务。',
      ],
    },
    {
      h: '终止',
      p: [
        '你可随时停止使用并在应用内删除账户（设置 → 数据与隐私 → 删除账号）；删除不可恢复，将级联清除你的记忆、目标、分身与订阅记录。若你实质性违反本协议，我们可暂停或终止你的访问；在合理情况下会先行通知。按性质应存续的条款（已授予的许可、免责声明、责任限制、适用法律）在终止后继续有效。',
      ],
    },
    {
      h: '适用法律与争议解决',
      p: [
        '本协议适用新加坡法律。相关争议由新加坡法院专属管辖，但不影响你居住地强制性消费者保护规定的适用。',
      ],
    },
    {
      h: '协议变更与联系方式',
      p: [
        '随着服务演进，我们可能更新本协议。重大变更将至少提前 14 天通过应用内或邮件通知；生效日后继续使用即视为接受。疑问请联系 support@gedo.ai。',
      ],
    },
  ],
  disclaimer: {
    h: '免责声明与责任限制',
    p: [
      '本服务按"现状"与"可用"状态提供，不作任何明示或默示保证（包括适销性、特定用途适用性与不侵权）。在法律允许的最大范围内，GEDO PTE. LTD. 不对间接、附带、特殊、后果性或惩罚性损失，或数据、利润、商誉损失承担责任。就与本服务相关的全部索赔，我们的累计责任以你在索赔前 12 个月内向我们支付的金额为限（若未付费，则以 100 新元为限）。依法不可排除的责任不受本条限制。',
    ],
  },
  signature: {
    closing: '感谢与 GEDO 一起成长。我们尽力把条款写得直白——如有任何不清楚之处，请先来问我们。',
    by: '发布方',
    contactLabel: '联系',
    dateLabel: '生效日期',
    ...SIGNATURE_BASE,
  },
};

const ja: LegalDocData = {
  eyebrow: '法的情報 · 利用規約',
  title: '利用規約',
  subtitle: 'GEDO（パーソナル成長システム）の利用に関する、あなたと GEDO PTE. LTD. の合意です。',
  version: 'v1.0（Beta）',
  updatedLabel: '更新',
  updated: '2026-07-09',
  effectiveLabel: '発効',
  effective: '2026-07-09',
  tocLabel: '目次',
  intro: [
    '本利用規約（以下「本規約」）は、シンガポール法人 GEDO PTE. LTD.（以下「GEDO」「当社」）が運営する GEDO —— gedo.ai ウェブサイト、ウェブアプリ、モバイルアプリ、デジタルペルソナページおよび関連サービス（総称して「本サービス」）の利用条件を定めます。アカウント作成または本サービスの利用により、本規約およびプライバシーポリシーに同意したものとみなされます。',
  ],
  sections: [
    {
      h: '規約への同意',
      p: [
        '本サービスの利用には、法的拘束力のある契約を締結できる能力が必要です。組織を代表して利用する場合、当該組織を拘束する権限を有することを表明するものとします。本規約に同意いただけない場合は、本サービスを利用しないでください。',
      ],
    },
    {
      h: 'サービス内容とベータ版について',
      p: [
        'GEDO は AI によるパーソナル成長システムです。対話・記憶・計画・振り返りを支援し、任意で公開できるデジタルペルソナを提供します。本サービスは現在、招待制ベータです。機能は変更・中断・終了される場合があり、ベータ期間中のサービス水準は保証されません。',
      ],
    },
    {
      h: 'アカウントと利用資格',
      p: [
        '本サービスの利用には 13 歳以上（居住地の法令がより高い年齢を定める場合はその年齢以上）である必要があり、未成年者は保護者の同意が必要です。アカウント認証情報とアカウント上のすべての活動について、あなたが責任を負います。正確な情報を登録・維持してください。特段の合意がない限り、1 人 1 アカウントです。',
      ],
    },
    {
      h: 'サブスクリプション・請求・自動更新',
      list: [
        'プラン：無料プランと有料サブスクリプション（現在は Pro と Ultra）を月払い・年払いで提供します。各プランの内容は購入時の料金ページの記載に従います。',
        '自動更新：有料サブスクリプションは解約されるまで各請求期間の終了時に自動更新されます。いつでも解約でき、解約は現在の期間終了時に有効となり、その後は無料プランに戻ります。',
        '決済チャネル：ウェブでは Stripe によるカード決済、iOS アプリでは Apple アカウント（App Store）、Android では Google Play により請求されます。購入したプラットフォームで管理・解約してください。',
        '同時に 1 プランのみ：1 アカウントで同時に有効な有料プランは 1 つです。変更する場合は先に解約し、期間終了後に希望プランへ加入してください。',
        '価格変更：価格は将来に向かって変更されることがあります。有効中のサブスクリプションには、次回更新に適用される少なくとも 30 日前に通知します。同意できない場合は更新前に解約してください。',
        '税金：価格には適用される税（GST/VAT 等）が含まれない場合があり、法令上必要なときに加算されます。',
      ],
    },
    {
      h: '返金',
      p: [
        'ウェブ（Stripe）購入：初回購入から 14 日以内は全額返金を申請できます。14 日経過後、年払いプランは残存する完全な月数に応じて日割り返金します。support@gedo.ai までご連絡ください。',
        'App Store / Google Play 経由の購入：返金は各プラットフォームのポリシーに基づき Apple / Google が処理します。プラットフォームに直接申請してください。',
      ],
    },
    {
      h: 'フェアユースと利用枠',
      p: [
        '各プランには請求月ごとにリセットされる利用枠（スマートクレジット、ペルソナ訪問枠など）が含まれます。「無制限」の機能にはフェアユースが適用されます。自動化・転売・枠の共有などの濫用が認められる場合、制限や停止を行うことがあります。利用状況はアカウントセンターでいつでも確認できます。',
      ],
    },
    {
      h: 'あなたのコンテンツとライセンス',
      p: [
        'あなたが GEDO に持ち込むコンテンツ —— 会話・記憶・目標・取り込みソース・ペルソナ素材（「ユーザーコンテンツ」）の所有権はあなたにあります。あなたは当社に対し、本サービスの運営・提供のためにのみ（返信生成のため関連する抜粋を AI モデル提供者へ送信することを含む）、ユーザーコンテンツをホスティング・処理・送信・表示する限定的・全世界・非独占のライセンスを付与します。あなたの個別かつ明示的な同意なく、ユーザーコンテンツをモデルの学習に使用することはありません。ユーザーコンテンツはいつでもエクスポートでき、いつでも完全削除できます。',
      ],
    },
    {
      h: 'AI 生成コンテンツ',
      p: [
        '本サービスは人工知能によりコンテンツを生成します。安全対策を講じても、AI の出力は不正確・不完全・不適切な場合があります。出力は個人的な参考情報であり、医療・心理・法律・財務その他の専門的助言ではありません。出力に依拠し行動する前にご自身で評価してください。意思決定の責任はあなたにあります。',
      ],
    },
    {
      h: 'デジタルペルソナと公開',
      p: [
        'デジタルペルソナを公開する場合、話してよい範囲とアクセスできる相手はあなたが設定し、設定・共有したペルソナコンテンツについてはあなたが責任を負います。訪問者はペルソナページを濫用してはなりません。通報・ブロックの仕組みを提供しており、本規約に違反するコンテンツの削除やアクセス制限を行うことがあります。訪問者への返信はペルソナ枠を消費し、枠を使い切るとリセットまでペルソナは一時停止します。',
      ],
    },
    {
      h: '禁止事項',
      list: [
        '違法な利用、権利侵害・ハラスメント・憎悪・搾取的なコンテンツの投稿。',
        'ジェイルブレイク、プロンプトやモデルの抽出、競合データセット構築のための利用。',
        '不正アクセス、探査、スクレイピング、レート制限の回避、サービスへの妨害。',
        '本人の同意なくデジタルペルソナで他者になりすますこと。',
        '利用権限のないコンテンツのアップロード。',
      ],
      note: '本条に違反するアカウントは停止・終了されることがあります。可能な場合は事前に通知します。',
    },
    {
      h: '第三者サービスとコネクタ',
      p: [
        'MCP コネクタや OAuth などで第三者ツールを接続できます。第三者サービスには当該サービスの規約とプライバシーポリシーが適用され、あなたの指示に基づき当社がデータを連携することを許可するものとします。第三者サービスについて当社は責任を負いません。接続はいつでも解除できます。',
      ],
    },
    {
      h: '知的財産とフィードバック',
      p: [
        '本サービス（ソフトウェア・デザイン・ブランドを含む）は GEDO PTE. LTD. またはそのライセンサーに帰属します。本規約は個人的で譲渡不能な利用権のみを付与します。フィードバックをお寄せいただいた場合、当社に永続的かつ無償の利用ライセンスを付与いただいたものとします（利用義務は負いません）。',
      ],
    },
    {
      h: '解約・終了',
      p: [
        'いつでも利用を停止し、アプリ内（設定 → プライバシー → アカウント削除）でアカウントを削除できます。削除は取り消せず、記憶・目標・ペルソナ・サブスクリプション記録に連鎖します。本規約への重大な違反があった場合、当社はアクセスを停止・終了することがあります（合理的な範囲で事前に通知します）。性質上存続すべき条項（付与済みライセンス、免責、責任制限、準拠法）は終了後も有効です。',
      ],
    },
    {
      h: '準拠法と紛争解決',
      p: [
        '本規約はシンガポール法に準拠します。関連する紛争はシンガポールの裁判所の専属管轄とします。ただし、あなたの居住地の強行的な消費者保護規定の適用は妨げられません。',
      ],
    },
    {
      h: '規約の変更と連絡先',
      p: [
        'サービスの進化に伴い本規約を更新することがあります。重要な変更は発効の少なくとも 14 日前にアプリ内またはメールで通知します。発効日以降の継続利用は変更への同意とみなされます。お問い合わせ：support@gedo.ai。',
      ],
    },
  ],
  disclaimer: {
    h: '免責事項と責任の制限',
    p: [
      '本サービスは「現状有姿」かつ「提供可能な範囲」で提供され、商品性・特定目的適合性・非侵害を含む明示または黙示の保証はありません。法律の許す最大限の範囲で、GEDO PTE. LTD. は間接損害・付随的損害・特別損害・結果損害・懲罰的損害、ならびにデータ・利益・信用の喪失について責任を負いません。本サービスに関する全請求に対する当社の累積責任は、請求前 12 か月間にお支払いいただいた金額（お支払いがない場合は 100 シンガポールドル）を上限とします。法律上排除できない責任はこの限りではありません。',
    ],
  },
  signature: {
    closing: 'GEDO とともに成長してくださりありがとうございます。条項はできる限り平易に保ちます —— 不明点があれば、まずお問い合わせください。',
    by: '発行者',
    contactLabel: '連絡先',
    dateLabel: '発効日',
    ...SIGNATURE_BASE,
  },
};

const CONTENT: Record<string, LegalDocData> = { en, zh, ja };

export default function TermsPage() {
  const locale = useLocale();
  return <LegalDoc doc={CONTENT[locale] ?? en} />;
}
