// GitHub Pages版の承認導線。
//
// Pages自身は静的で書き込めないため、GitHubのログイン済み本人確認を使って
// 構造化されたIssueを作る。Issueを受けたActionsが現在のRevision/Hashを再検査し、
// 一致した場合だけboard.jsonへ承認証跡を書き込む。

import { approvalBasisHash, buildApprovalBasis } from '../domain/approval.js';
import { DEFAULT_RETRY_DELAY_MINUTES } from '../services/approvals.js';

export const PUBLIC_APPROVAL_REPOSITORY = 'reiki-ai-apps/AI-';
export const PUBLIC_APPROVAL_CONTRACT = 'REIKI_POST_BOARD_APPROVAL_V1';

function safeLabel(value, fallback = '（名称なし）') {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return text || fallback;
}

export async function buildPublicApprovalRequest({ group, posts, revisions }) {
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('承認対象がありません。');
  const targets = [];
  const summary = [];

  for (const post of posts) {
    const revision = revisions.get(post.current_revision_id);
    if (!revision) throw new Error(`対象版が見つかりません: ${post.current_revision_id}`);
    const basis = buildApprovalBasis({
      channelPost: post,
      revision,
      schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
      allowedRetryDelayMinutes: DEFAULT_RETRY_DELAY_MINUTES,
    });
    const basisHash = await approvalBasisHash(basis);
    targets.push({
      channel_post_id: post.channel_post_id,
      revision_id: revision.revision_id,
      approval_basis_hash: basisHash,
      allowed_retry_delay_minutes: DEFAULT_RETRY_DELAY_MINUTES,
    });
    summary.push(`- ${post.platform} / 第${revision.revision_no}版 / ${post.scheduled_at}`);
  }

  const payload = {
    contract: PUBLIC_APPROVAL_CONTRACT,
    action: 'APPROVE',
    project_title: safeLabel(group?.project_title),
    targets,
  };
  const title = `[POST BOARD承認] ${safeLabel(group?.project_title)}`.slice(0, 220);
  const body = [
    'POST BOARDで内容を確認し、次のRevisionとHashを承認します。',
    '',
    ...summary,
    '',
    'このIssueを作成すると承認が確定します。本文の識別子は変更しないでください。',
    '',
    `<!-- ${PUBLIC_APPROVAL_CONTRACT}`,
    JSON.stringify(payload),
    '-->',
  ].join('\n');
  const query = new URLSearchParams({ title, body });
  return `https://github.com/${PUBLIC_APPROVAL_REPOSITORY}/issues/new?${query}`;
}
