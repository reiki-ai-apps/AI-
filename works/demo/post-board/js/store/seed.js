// デモ版の見本データ — 架空の「見本チャンネル」の約3週間分（過去10日〜先9日）。
//
// 重要: 直接ストアへ書き込まず、必ず本物と同じ services 経由で作る。
// これにより「投稿済みには外部証拠がある」「予約済みには有効な承認がある」といった
// 不変条件を見本データも満たす。題名・本文・アカウント名はすべて架空。

import { dateKey, instantFromZoned, shiftDateKey } from '../core/tz.js';
import { PLATFORM_ORDER } from '../domain/platforms.js';
import { defaultSteps, kindForPlatform } from '../domain/production.js';
import { createPostGroup, updateInternal } from '../services/posts.js';
import { submitForApproval, approve, recordComponentApproval, reject } from '../services/approvals.js';
import { claimManualExecution, confirmManualPublish, markOutcomeUnknown } from '../services/manual.js';
import { pauseDay } from '../services/dayplans.js';
import { updateProduction } from '../services/production.js';

export const DEMO_ACCOUNT = '@mihon_channel';

const NEWS_TITLES = [
  '今週の道具ニュース5選',
  '新作キットのお知らせ',
  'よくある質問に答えます',
  '週末イベントのお知らせ',
  'みんなのおすすめ道具まとめ',
  '季節の手入れカレンダー',
  '初心者がそろえる道具3つ',
];

const CREATIVE_TITLES = [
  '30秒でわかる木のスプーン作り',
  '制作の裏側：本棚づくり',
  'ビフォーアフター：古い椅子',
  '手ぬぐいの染め方',
  '端材で作るコースター',
  '1分でできるロープの結び方',
];

// 見本の画像（このフォルダの media/ にある架空のサムネイル）。番号は題名の並び順。
const ALL_TITLES = [...NEWS_TITLES, ...CREATIVE_TITLES];
const mediaNo = (title) => String(ALL_TITLES.indexOf(title) + 1).padStart(2, '0');

/**
 * 日ごとの予定。offset = 今日からの日数。
 * kind: PUBLISHED / SCHEDULED / PENDING / DRAFT / REJECTED / UNKNOWN
 * 予定時刻が今より前になった SCHEDULED は、投稿済みとして作る。
 */
const PLAN = {
  '-10': [['news', 'X', 8, 'PUBLISHED'], ['creative', 'INSTAGRAM', 19, 'PUBLISHED']],
  '-9': [['news', 'YOUTUBE', 18, 'PUBLISHED']],
  '-8': [['creative', 'TIKTOK', 20, 'PUBLISHED'], ['news', 'X', 8, 'PUBLISHED']],
  '-7': [['creative', 'INSTAGRAM', 19, 'PUBLISHED']],
  '-6': [],
  '-5': [['news', 'YOUTUBE', 18, 'PUBLISHED'], ['creative', 'TIKTOK', 20, 'PUBLISHED']],
  '-4': [['news', 'X', 8, 'PUBLISHED']],
  '-3': [['creative', 'INSTAGRAM', 19, 'PUBLISHED'], ['news', 'X', 12, 'PUBLISHED']],
  '-2': [['news', 'YOUTUBE', 18, 'PUBLISHED'], ['creative', 'TIKTOK', 20, 'PUBLISHED']],
  '-1': [['news', 'X', 8, 'PUBLISHED'], ['creative', 'INSTAGRAM', 21, 'UNKNOWN']],
  '0': [['news', 'X', 8, 'SCHEDULED'], ['creative', 'INSTAGRAM', 12, 'SCHEDULED'], ['news', 'YOUTUBE', 18, 'SCHEDULED'], ['creative', 'TIKTOK', 21, 'SCHEDULED']],
  '1': [['news', 'X', 18, 'PENDING'], ['creative', 'INSTAGRAM', 20, 'SCHEDULED']],
  '2': [['news', 'YOUTUBE', 18, 'SCHEDULED'], ['creative', 'TIKTOK', 20, 'PENDING']],
  '3': [],
  '4': [['news', 'X', 8, 'SCHEDULED'], ['creative', 'INSTAGRAM', 19, 'REJECTED']],
  '5': 'PAUSED',
  '6': [['news', 'YOUTUBE', 18, 'PENDING'], ['creative', 'TIKTOK', 20, 'DRAFT']],
  '7': [['news', 'X', 8, 'SCHEDULED']],
  '8': [['creative', 'INSTAGRAM', 19, 'SCHEDULED'], ['news', 'X', 12, 'DRAFT']],
  '9': [['news', 'YOUTUBE', 18, 'DRAFT']],
};

const BODY = {
  news: (t) => `${t}\n\n見本チャンネルの今週のお知らせです。詳しくはプロフィールのリンクから。`,
  creative: (t) => `${t}\n\n作り方の手順と、うまくいくコツを短くまとめました。`,
};
const HASHTAGS = { news: ['#見本チャンネル', '#道具'], creative: ['#見本チャンネル', '#手づくり'] };
const CTA = { news: '詳しくはプロフィールのリンクから', creative: '質問はコメント欄へどうぞ' };

/**
 * 見本データを入れる。ctx.db.persist を止めておけば最後に1回だけ保存される。
 * @param {object} ctx {repo, clock, actor, mode, db}
 */
export async function buildDemoData(ctx) {
  const tz = ctx.clock.timeZone;
  const nowMs = ctx.clock.nowMs();
  const today = dateKey(nowMs, tz);
  let newsIndex = 0;
  let creativeIndex = 0;
  const problems = [];

  for (let offset = -10; offset <= 9; offset += 1) {
    const key = shiftDateKey(today, offset);
    const plan = PLAN[String(offset)];
    if (plan === 'PAUSED') {
      await pauseDay(ctx, key, { reason: '撮影機材の点検のためお休み' }).catch((e) => problems.push(e));
      continue;
    }
    for (const [brandId, platform, hour, plannedKind] of plan) {
      const isNews = brandId === 'news';
      const title = isNews
        ? NEWS_TITLES[newsIndex++ % NEWS_TITLES.length]
        : CREATIVE_TITLES[creativeIndex++ % CREATIVE_TITLES.length];
      const [year, month, day] = key.split('-').map(Number);
      const scheduledAtMs = instantFromZoned({ year, month, day, hour, minute: hour === 18 ? 30 : 0 }, tz);
      const past = scheduledAtMs <= nowMs;
      let kind = plannedKind;
      if (kind === 'SCHEDULED' && past) kind = 'PUBLISHED';
      if ((kind === 'PENDING' || kind === 'REJECTED' || kind === 'DRAFT') && past) kind = 'PUBLISHED';

      const n = mediaNo(title);
      // 記事・動画（CONTENT）とサムネイル（THUMBNAIL）を別々に承認する本物の仕組みをそのまま使う。
      // 過去の投稿は承認の期限が切れているので、まとめて承認する古い方式で作る。
      const useComponents = !past;
      const assets = [
        {
          asset_id: `demo-asset-${offset}-${hour}-content`,
          sha256: await fakeHash(`${title}-${key}-content`),
          mime: 'image/svg+xml',
          bytes: 2048,
          order: 0,
          alt_text: `${title}の${isNews ? '中身' : '動画の見本'}（架空）`,
          rights_status: 'CLEARED',
          file_name: `content-${n}.svg`,
          asset_role: 'CONTENT',
          preview_url: `media/content-${n}.svg`,
        },
        {
          asset_id: `demo-asset-${offset}-${hour}-thumb`,
          sha256: await fakeHash(`${title}-${key}-thumb`),
          mime: 'image/svg+xml',
          bytes: 1024,
          order: 1,
          alt_text: `${title}のサムネイル（架空）`,
          rights_status: 'CLEARED',
          file_name: `thumb-${n}.svg`,
          asset_role: 'THUMBNAIL',
          preview_url: `media/thumb-${n}.svg`,
        },
      ];

      try {
        const created = await createPostGroup(ctx, {
          brandId,
          projectTitle: title,
          platforms: [platform],
          scheduledAtIso: new Date(scheduledAtMs).toISOString(),
          timeZone: tz,
          payloads: {
            [platform]: {
              body: BODY[brandId](title),
              title,
              hashtags: HASHTAGS[brandId],
              cta: CTA[brandId],
              visibility: 'PUBLIC',
            },
          },
          assets,
          rights: { confirmed: true, rights_status: 'CLEARED', sources: [] },
          requiresComponentApprovals: useComponents,
          sourceSkill: isNews ? 'demo_news' : 'demo_creative',
          tags: ['demo'],
        });
        const id = created.channelPostIds[0];

        if (kind === 'DRAFT') {
          const steps = defaultSteps(kindForPlatform(platform)).map((s, i) => ({ ...s, done: i < 2 }));
          await updateProduction(ctx, id, { steps, reason: '見本: 制作の途中' });
          continue;
        }

        await submitForApproval(ctx, id);
        if (kind === 'PENDING') continue;
        if (kind === 'REJECTED') {
          await reject(ctx, id, { comment: 'サムネイルの文字が小さいので、大きくしてください。' });
          continue;
        }

        if (useComponents) {
          await recordComponentApproval(ctx, id, { componentScope: 'CONTENT' });
          await recordComponentApproval(ctx, id, { componentScope: 'THUMBNAIL' });
          await approve(ctx, id);
        } else {
          await approve(ctx, id, { allowedRetryDelayMinutes: 60 * 24 * 40 });
        }
        if (kind === 'SCHEDULED') {
          // SNS側の予約投稿まで済んだ印。TikTokだけは「外部予約待ち」のまま残して、次の作業として見せる。
          if (platform !== 'TIKTOK') {
            await updateInternal(ctx, id, { tags: ['external-schedule-verified'] }, { reason: '見本: SNS側の予約を確認' });
          }
          continue;
        }

        await claimManualExecution(ctx, id, { reason: '見本: 手動投稿の記録' });
        if (kind === 'UNKNOWN') {
          await markOutcomeUnknown(ctx, id, { reason: '見本: 投稿したかどうか確認できていない' });
          continue;
        }
        await confirmManualPublish(ctx, id, {
          externalPostId: `demo-${platform.toLowerCase()}-${key.replace(/-/g, '')}-${hour}`,
          publishedAtIso: new Date(scheduledAtMs + 2 * 60_000).toISOString(),
          accountMatches: true,
          contentMatches: true,
          publishedAtMatches: true,
        });
      } catch (error) {
        problems.push(error);
      }
    }
  }

  await ctx.repo.setSetting('sample_loaded_at', ctx.clock.nowIso());
  if (problems.length) console.warn('見本データの一部を作れませんでした', problems);
  return { problems: problems.length };
}

/** 本物の画面から呼ばれる「サンプル月を入れる」もデモ版では同じ見本を入れる。 */
export async function loadSampleMonth(ctx) {
  return buildDemoData(ctx);
}

async function fakeHash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 接続設定に並べるSNSアカウント（架空）。トークンは持たない。 */
export async function seedSocialAccounts(ctx) {
  const now = ctx.clock.nowIso();
  const existing = await ctx.repo.listSocialAccounts();
  if (existing.length) return existing;

  const accounts = PLATFORM_ORDER.map((platform) => ({
    social_account_id: `${platform.toLowerCase()}-default`,
    platform,
    account_name: DEMO_ACCOUNT,
    connected: false,
    status: 'NOT_CONNECTED',
    last_synced_at: null,
    credential_expires_at: null,
    created_at: now,
  }));
  await ctx.repo.write(['socialAccounts'], async (tx) => {
    for (const a of accounts) await tx.put('socialAccounts', a);
  });
  return accounts;
}
