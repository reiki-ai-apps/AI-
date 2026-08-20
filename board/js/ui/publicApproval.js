// 公開Boardの承認データを、現在のRevision/Hashから構造化する。
// 送信と端末認証は publicApprovalGateway.js が担当する。

import { approvalBasisHash, buildApprovalBasis, computeApprovalComponentHash } from '../domain/approval.js';
import { DEFAULT_RETRY_DELAY_MINUTES } from '../services/approvals.js';

export const PUBLIC_APPROVAL_REPOSITORY = 'reiki-ai-apps/AI-';
export const PUBLIC_APPROVAL_CONTRACT = 'REIKI_POST_BOARD_APPROVAL_V1';

function safeLabel(value, fallback = '（名称なし）') {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return text || fallback;
}

export async function buildPublicApprovalPayload({ group, posts, revisions, componentScope = null }) {
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('承認対象がありません。');
  const targets = [];

  for (const post of posts) {
    const revision = revisions.get(post.current_revision_id);
    if (!revision) throw new Error(`対象版が見つかりません: ${post.current_revision_id}`);
    const basisHash = componentScope
      ? await computeApprovalComponentHash({
          channelPost: post,
          revision,
          schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
          componentScope,
          allowedRetryDelayMinutes: DEFAULT_RETRY_DELAY_MINUTES,
        })
      : await approvalBasisHash(buildApprovalBasis({
          channelPost: post,
          revision,
          schedule: { scheduled_at: post.scheduled_at, time_zone: post.time_zone },
          allowedRetryDelayMinutes: DEFAULT_RETRY_DELAY_MINUTES,
        }));
    targets.push({
      channel_post_id: post.channel_post_id,
      revision_id: revision.revision_id,
      approval_basis_hash: basisHash,
      approval_component_hash: componentScope ? basisHash : null,
      allowed_retry_delay_minutes: DEFAULT_RETRY_DELAY_MINUTES,
    });
  }

  return {
    contract: PUBLIC_APPROVAL_CONTRACT,
    action: 'APPROVE',
    component_scope: componentScope,
    project_title: safeLabel(group?.project_title),
    targets,
  };
}

export async function buildPublicApprovalRequest({ group, posts, revisions, componentScope = null }) {
  const payload = await buildPublicApprovalPayload({ group, posts, revisions, componentScope });
  const summary = payload.targets.map((target, index) => {
    const post = posts[index];
    const revision = revisions.get(target.revision_id);
    return `- ${post.platform} / ${componentScope ?? '全体'} / 第${revision.revision_no}版 / ${post.scheduled_at}`;
  });
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
