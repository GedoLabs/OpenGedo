'use client';

/**
 * 隐私政策(Privacy Policy)v1.0 (Beta) —— App Store / Google Play 提审必填 URL。
 * 与 /security 声明 v1.1 的承诺保持一致(传输加密、绝不未经同意训练、导出/硬删),
 * 第三方处理者按 docs/legal/LEGAL_PACKAGE_2026-07.md C2 要求如实列出。
 * 修订时同步更新 version/effective 三语;建议上线前由律师复核。
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
  eyebrow: 'LEGAL · PRIVACY',
  title: 'Privacy Policy',
  subtitle: 'What we collect, why, who processes it, and the controls you keep. Your data stays yours.',
  version: 'v1.0 (Beta)',
  updatedLabel: 'Updated',
  updated: '2026-07-09',
  effectiveLabel: 'Effective',
  effective: '2026-07-09',
  tocLabel: 'Contents',
  intro: [
    'This Privacy Policy explains how GEDO PTE. LTD., a company registered in Singapore ("GEDO", "we"), collects, uses and protects personal data when you use GEDO — the gedo.ai website, web app, mobile apps, digital persona pages and related services (the "Service"). We process personal data in accordance with Singapore’s Personal Data Protection Act (PDPA) and, where applicable, other local data protection laws. This Policy should be read together with our Security & Privacy Statement at gedo.ai/security.',
  ],
  sections: [
    {
      h: 'Scope & Who We Are',
      p: [
        'GEDO PTE. LTD. is the data controller for the Service. This Policy applies to account holders and to visitors who interact with published digital persona pages. It does not cover third-party services you choose to connect.',
      ],
    },
    {
      h: 'Information We Collect',
      list: [
        'Account data — email address, password hash or third-party sign-in identity (Apple / Google), language preference, invite code used.',
        'Your content — conversations with your AI, memories, goals and tasks, imported sources (files, links, chat exports), persona configuration, and reflections you write.',
        'Visitor interactions — messages visitors send to a published digital persona, and the persona’s replies.',
        'Subscription data — plan, billing period, subscription status and channel (Stripe / App Store / Google Play). Card details are handled by Stripe and never touch our servers; app-store billing is handled by Apple or Google.',
        'Usage & device data — feature usage counters (e.g. smart-credit consumption), approximate request metadata (timestamps, app version, browser type), and logs needed for security and abuse prevention.',
      ],
      note: 'We do not collect advertising identifiers, and we do not sell personal data.',
    },
    {
      h: 'How We Use Information',
      list: [
        'To provide the Service: generating AI replies, building your long-term memory, planning and insight features, syncing across devices.',
        'To operate subscriptions: entitlement checks, billing status, receipts and subscription lifecycle emails.',
        'To keep the Service safe: authentication, rate-limiting, abuse and fraud prevention.',
        'To communicate: transactional emails (verification, password reset, receipts) and, only with your consent, product updates.',
        'To improve the Service using aggregated, de-identified usage statistics — never the content of your memories without consent.',
      ],
    },
    {
      h: 'AI Processing & Service Providers',
      p: [
        'To generate replies and reports, relevant excerpts of your content are sent to AI model providers as processors. Under our agreements with them, this data is not used to train their models. We use the following categories of subprocessors:',
      ],
      list: [
        'Anthropic and OpenAI — large-language-model inference (chat, planning, insight generation).',
        'Stripe — web payment processing.',
        'Apple App Store / Google Play — in-app subscription billing on mobile.',
        'RevenueCat — cross-platform subscription state management (receives subscription events and your account ID, never your content).',
        'Resend — transactional email delivery.',
        'Cloud infrastructure providers — hosting, storage and encrypted backups.',
      ],
    },
    {
      h: 'Model Training & Your Consent',
      p: [
        'We never use your content to train models without your separate, explicit consent. Optional programs (such as training your personal Twin model) each require an independent opt-in, are limited to the stated purpose, and can be withdrawn at any time — withdrawal stops further use and deletes the training copies.',
      ],
    },
    {
      h: 'Retention & Deletion',
      p: [
        'We keep your data while your account is active. You can hard-delete individual memories at any time, pause long-term memory, or delete your entire account in-app (Settings → Privacy → Delete account) or on the web — deletion is permanent and cascades to memories, goals, persona data and subscription records. Residual copies in encrypted backups are rotated out within approximately 60 days. Records we must keep for legal reasons (e.g. tax and billing records) are retained as required by law.',
      ],
    },
    {
      h: 'Your Rights & Controls',
      list: [
        'Access & export — download your memory archive (GMP format) anytime.',
        'Correction — edit or update your account data and content.',
        'Deletion — hard-delete items or your whole account, in-app.',
        'Consent withdrawal — revoke optional consents (e.g. Twin training) at any time.',
        'Complaint — contact us first at support@gedo.ai; you may also lodge a complaint with your data protection authority (in Singapore, the PDPC).',
      ],
    },
    {
      h: 'Security',
      p: [
        'All traffic is encrypted in transit (TLS). Access to production data is restricted and audited, backups are encrypted, and secrets are isolated. During beta we deliberately describe our safeguards precisely — see the Security & Privacy Statement at gedo.ai/security for the current, versioned description of our measures. No internet service can guarantee absolute security; notify us at support@gedo.ai of any suspected incident.',
      ],
    },
    {
      h: 'Children',
      p: [
        'The Service is not directed to children under 13, and we do not knowingly collect their data. If you believe a child has provided us personal data, contact us and we will delete it.',
      ],
    },
    {
      h: 'International Transfers',
      p: [
        'Our infrastructure and subprocessors may process data outside your country (including Singapore and the United States). Where required, we use appropriate safeguards such as contractual protections that meet PDPA transfer requirements.',
      ],
    },
    {
      h: 'Cookies & Analytics',
      p: [
        'We use essential cookies for sign-in sessions and preferences. Usage analytics are first-party and privacy-respecting; we do not use third-party advertising trackers.',
      ],
    },
    {
      h: 'Changes & Contact',
      p: [
        'We will notify you of material changes to this Policy (in-app or by email) before they take effect. Privacy questions and data requests: support@gedo.ai. General enquiries: info@gedo.ai.',
      ],
    },
  ],
  signature: {
    closing: 'Privacy-first is a design constraint at GEDO, not a slogan: export anytime, hard-delete anytime, and never trained on without consent.',
    by: 'Issued by',
    contactLabel: 'Contact',
    dateLabel: 'Effective',
    ...SIGNATURE_BASE,
  },
};

const zh: LegalDocData = {
  eyebrow: '法律条款 · 隐私政策',
  title: '隐私政策',
  subtitle: '我们收集什么、为什么收集、谁在处理,以及始终在你手里的控制权。数据归你所有。',
  version: 'v1.0（Beta）',
  updatedLabel: '更新',
  updated: '2026-07-09',
  effectiveLabel: '生效',
  effective: '2026-07-09',
  tocLabel: '目录',
  intro: [
    '本《隐私政策》说明注册于新加坡的 GEDO PTE. LTD.（下称"GEDO"或"我们"）在你使用 GEDO——gedo.ai 网站、网页应用、移动应用、数字分身页面及相关服务（"本服务"）时,如何收集、使用与保护个人数据。我们依据新加坡《个人数据保护法》（PDPA）及适用的当地数据保护法律处理个人数据。请结合 gedo.ai/security 的《安全与隐私声明》一并阅读。',
  ],
  sections: [
    {
      h: '适用范围与主体',
      p: [
        'GEDO PTE. LTD. 是本服务的数据控制者。本政策适用于账户持有人,以及与已发布数字分身页面互动的访客;不适用于你自行连接的第三方服务。',
      ],
    },
    {
      h: '我们收集的信息',
      list: [
        '账户数据——邮箱、密码哈希或第三方登录身份（Apple / Google）、语言偏好、使用的邀请码。',
        '你的内容——与 AI 的对话、记忆、目标与任务、导入来源（文件、链接、聊天记录导出）、分身配置与你撰写的复盘。',
        '访客互动——访客发给已发布数字分身的消息及分身的回复。',
        '订阅数据——方案、计费周期、订阅状态与渠道（Stripe / App Store / Google Play）。银行卡信息由 Stripe 处理,不经过我们的服务器;应用商店扣费由 Apple 或 Google 处理。',
        '使用与设备数据——功能用量计数（如智能额度消耗）、必要的请求元数据（时间戳、应用版本、浏览器类型）及安全防滥用所需日志。',
      ],
      note: '我们不收集广告标识符,也绝不出售个人数据。',
    },
    {
      h: '我们如何使用信息',
      list: [
        '提供服务:生成 AI 回复、构建长期记忆、规划与洞察、跨设备同步。',
        '运营订阅:权益校验、账单状态、收据与订阅生命周期邮件。',
        '保障安全:身份认证、限流、防滥用与反欺诈。',
        '与你沟通:交易类邮件（验证、找回密码、收据）;仅在你同意时发送产品动态。',
        '改进服务:仅使用聚合、去标识化的用量统计——未经同意绝不使用你的记忆内容。',
      ],
    },
    {
      h: 'AI 处理与服务商',
      p: [
        '为生成回复与报告,你的内容中相关片段会发送给作为受托处理方的 AI 模型服务商。依据我们与其签订的协议,这些数据不会被用于训练它们的模型。我们使用以下类别的子处理方:',
      ],
      list: [
        'Anthropic 与 OpenAI——大语言模型推理（对话、规划、洞察生成）。',
        'Stripe——网页端支付处理。',
        'Apple App Store / Google Play——移动端应用内订阅扣费。',
        'RevenueCat——跨平台订阅状态管理（仅接收订阅事件与你的账户 ID,绝不接触你的内容）。',
        'Resend——交易类邮件投递。',
        '云基础设施服务商——托管、存储与加密备份。',
      ],
    },
    {
      h: '模型训练与你的同意',
      p: [
        '未经你单独、明确的同意,我们绝不使用你的内容训练模型。可选项目（如训练你的个人 Twin 模型）均需独立开启,仅限所述用途,并可随时撤回——撤回即停止后续使用并删除训练副本。',
      ],
    },
    {
      h: '保留与删除',
      p: [
        '账户存续期间我们保留你的数据。你可以随时硬删除单条记忆、暂停长期记忆,或在应用内（设置 → 数据与隐私 → 删除账号）或网页端删除整个账户——删除不可恢复,将级联清除记忆、目标、分身数据与订阅记录。加密备份中的残留副本约在 60 天内轮换清除。法律要求保留的记录（如税务与账单记录）按法定期限保存。',
      ],
    },
    {
      h: '你的权利与控制',
      list: [
        '访问与导出——随时下载你的记忆档案（GMP 格式）。',
        '更正——编辑或更新你的账户数据与内容。',
        '删除——应用内硬删除单条内容或整个账户。',
        '撤回同意——随时撤回可选同意（如 Twin 训练）。',
        '投诉——请先联系 support@gedo.ai;你也可以向你所在地的数据保护机构（新加坡为 PDPC）投诉。',
      ],
    },
    {
      h: '安全',
      p: [
        '全部流量传输加密（TLS）;生产数据访问受限并被审计,备份加密,密钥隔离。内测期间我们刻意精确描述防护现状——最新的、带版本号的安全措施说明见 gedo.ai/security。任何互联网服务都无法保证绝对安全;如怀疑发生安全事件,请立即联系 support@gedo.ai。',
      ],
    },
    {
      h: '未成年人',
      p: [
        '本服务不面向 13 岁以下儿童,我们不会明知而收集其数据。若你认为有儿童向我们提供了个人数据,请联系我们删除。',
      ],
    },
    {
      h: '跨境传输',
      p: [
        '我们的基础设施与子处理方可能在你所在国家/地区以外（包括新加坡与美国）处理数据。在需要时,我们采用符合 PDPA 跨境传输要求的合同保障等适当措施。',
      ],
    },
    {
      h: 'Cookie 与统计',
      p: [
        '我们使用必要的 Cookie 维持登录会话与偏好设置。用量统计为第一方且尊重隐私;我们不使用第三方广告追踪器。',
      ],
    },
    {
      h: '政策变更与联系方式',
      p: [
        '本政策发生重大变更时,我们会在生效前通过应用内或邮件通知你。隐私问题与数据请求:support@gedo.ai;一般咨询:info@gedo.ai。',
      ],
    },
  ],
  signature: {
    closing: '隐私优先是 GEDO 的设计约束,不是口号:随时导出、一键硬删、未经同意绝不用于训练。',
    by: '发布方',
    contactLabel: '联系',
    dateLabel: '生效日期',
    ...SIGNATURE_BASE,
  },
};

const ja: LegalDocData = {
  eyebrow: '法的情報 · プライバシー',
  title: 'プライバシーポリシー',
  subtitle: '何を・なぜ収集し、誰が処理するのか。そしてあなたの手にあるコントロール。データはあなたのものです。',
  version: 'v1.0（Beta）',
  updatedLabel: '更新',
  updated: '2026-07-09',
  effectiveLabel: '発効',
  effective: '2026-07-09',
  tocLabel: '目次',
  intro: [
    '本プライバシーポリシーは、シンガポール法人 GEDO PTE. LTD.（以下「GEDO」「当社」）が、GEDO —— gedo.ai ウェブサイト、ウェブアプリ、モバイルアプリ、デジタルペルソナページおよび関連サービス（「本サービス」）において個人データをどのように収集・利用・保護するかを説明します。当社はシンガポール個人データ保護法（PDPA)および適用ある各地のデータ保護法に従って個人データを取り扱います。gedo.ai/security のセキュリティとプライバシーに関する声明と併せてお読みください。',
  ],
  sections: [
    {
      h: '適用範囲と事業者',
      p: [
        '本サービスのデータ管理者は GEDO PTE. LTD. です。本ポリシーはアカウント保有者、および公開されたデジタルペルソナページと対話する訪問者に適用されます。あなたが接続する第三者サービスには適用されません。',
      ],
    },
    {
      h: '収集する情報',
      list: [
        'アカウントデータ —— メールアドレス、パスワードのハッシュまたは第三者ログイン ID（Apple / Google）、言語設定、使用した招待コード。',
        'あなたのコンテンツ —— AI との会話、記憶、目標とタスク、取り込みソース（ファイル・リンク・チャット履歴）、ペルソナ設定、振り返り。',
        '訪問者とのやり取り —— 公開ペルソナへ訪問者が送るメッセージとペルソナの返信。',
        'サブスクリプションデータ —— プラン、請求期間、購読状態とチャネル（Stripe / App Store / Google Play）。カード情報は Stripe が処理し、当社サーバーには一切保存されません。アプリ内課金は Apple / Google が処理します。',
        '利用・デバイスデータ —— 機能利用カウンタ（スマートクレジット消費など）、必要最小限のリクエストメタデータ（タイムスタンプ、アプリバージョン、ブラウザ種別)、セキュリティと濫用防止のためのログ。',
      ],
      note: '広告識別子は収集しません。個人データを販売することもありません。',
    },
    {
      h: '情報の利用目的',
      list: [
        'サービスの提供:AI 返信の生成、長期記憶の構築、計画・インサイト機能、デバイス間同期。',
        'サブスクリプションの運用:利用資格の確認、請求状態、領収書と購読ライフサイクルのメール。',
        '安全の確保:認証、レート制限、濫用・不正の防止。',
        'コミュニケーション:トランザクションメール(確認・パスワード再設定・領収書)。製品情報は同意がある場合のみ。',
        'サービス改善:集計・匿名化された利用統計のみを使用 —— 同意なく記憶の内容を使うことはありません。',
      ],
    },
    {
      h: 'AI 処理と委託先',
      p: [
        '返信やレポートの生成のため、あなたのコンテンツの関連する抜粋が処理者である AI モデル提供者へ送信されます。当社との契約に基づき、これらのデータが提供者のモデル学習に使われることはありません。当社は以下のカテゴリの委託先を利用します:',
      ],
      list: [
        'Anthropic・OpenAI —— 大規模言語モデルによる推論（会話・計画・インサイト生成）。',
        'Stripe —— ウェブ決済処理。',
        'Apple App Store / Google Play —— モバイルのアプリ内課金。',
        'RevenueCat —— クロスプラットフォームの購読状態管理（購読イベントとアカウント ID のみを受領し、コンテンツには触れません）。',
        'Resend —— トランザクションメール配信。',
        'クラウドインフラ事業者 —— ホスティング、ストレージ、暗号化バックアップ。',
      ],
    },
    {
      h: 'モデル学習と同意',
      p: [
        'あなたの個別かつ明示的な同意なく、あなたのコンテンツをモデルの学習に使うことは決してありません。任意プログラム（あなた専用の Twin モデルの学習など）はそれぞれ独立したオプトインが必要で、記載された目的に限定され、いつでも撤回できます —— 撤回すると以後の利用は停止され、学習用コピーは削除されます。',
      ],
    },
    {
      h: '保持と削除',
      p: [
        'アカウントが有効な間、データを保持します。個々の記憶はいつでも完全削除でき、長期記憶の一時停止も可能です。アカウント全体の削除はアプリ内（設定 → プライバシー → アカウント削除）またはウェブから行えます —— 削除は取り消せず、記憶・目標・ペルソナ・購読記録に連鎖します。暗号化バックアップ内の残存コピーは約 60 日以内にローテーションで消去されます。法令上保持が必要な記録（税務・請求記録など）は法定期間保存します。',
      ],
    },
    {
      h: 'あなたの権利とコントロール',
      list: [
        'アクセスとエクスポート —— 記憶アーカイブ(GMP 形式)をいつでもダウンロード。',
        '訂正 —— アカウントデータとコンテンツの編集・更新。',
        '削除 —— アプリ内で個別またはアカウント全体を完全削除。',
        '同意の撤回 —— 任意の同意(Twin 学習など)はいつでも撤回可能。',
        '苦情 —— まず support@gedo.ai へ。居住地のデータ保護当局(シンガポールでは PDPC)への申立ても可能です。',
      ],
    },
    {
      h: 'セキュリティ',
      p: [
        'すべての通信は転送時に暗号化されます（TLS）。本番データへのアクセスは制限・監査され、バックアップは暗号化、シークレットは隔離されています。ベータ期間中、当社は保護策を正確に記述する方針です —— 最新のバージョン付き説明は gedo.ai/security をご覧ください。いかなるインターネットサービスも絶対的な安全は保証できません。インシデントの疑いがあれば support@gedo.ai までご連絡ください。',
      ],
    },
    {
      h: 'お子様について',
      p: [
        '本サービスは 13 歳未満の子どもを対象としておらず、その情報を故意に収集しません。子どもが個人データを提供したと思われる場合はご連絡ください。削除します。',
      ],
    },
    {
      h: '国外移転',
      p: [
        '当社のインフラと委託先は、あなたの国以外（シンガポール・米国を含む）でデータを処理する場合があります。必要な場合、PDPA の移転要件を満たす契約上の保護措置等を講じます。',
      ],
    },
    {
      h: 'Cookie と分析',
      p: [
        'ログインセッションと設定の保持に必須の Cookie を使用します。利用分析はファーストパーティかつプライバシーに配慮したものであり、第三者の広告トラッカーは使用しません。',
      ],
    },
    {
      h: 'ポリシーの変更と連絡先',
      p: [
        '本ポリシーの重要な変更は、発効前にアプリ内またはメールで通知します。プライバシーに関する質問・データリクエスト:support@gedo.ai。一般のお問い合わせ:info@gedo.ai。',
      ],
    },
  ],
  signature: {
    closing: 'プライバシーファーストは GEDO の設計上の制約であり、スローガンではありません:いつでもエクスポート、いつでも完全削除、同意なき学習は決してしない。',
    by: '発行者',
    contactLabel: '連絡先',
    dateLabel: '発効日',
    ...SIGNATURE_BASE,
  },
};

const CONTENT: Record<string, LegalDocData> = { en, zh, ja };

export default function PrivacyPage() {
  const locale = useLocale();
  return <LegalDoc doc={CONTENT[locale] ?? en} />;
}
