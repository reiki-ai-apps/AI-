// サンプル月のデータ。図2と同じ密度・同じ状態分布になるよう組み立てる。
//
// 重要: 直接ストアへ書き込まず、必ず services 経由で作る。
// これにより「投稿済みには外部証拠がある」「予約済みには有効な承認がある」といった
// §13 の不変条件をサンプルデータも満たすことが保証される。

import { dateKey, daysInMonth, instantFromZoned } from '../core/tz.js';
import { PLATFORM_ORDER } from '../domain/platforms.js';
import { createPostGroup } from '../services/posts.js';
import { submitForApproval, approve } from '../services/approvals.js';
import { claimManualExecution, confirmManualPublish } from '../services/manual.js';
import { pauseDay } from '../services/dayplans.js';

const NEWS_TITLES = [
  '今週のAIニュース5選',
  '新モデル発表の要点',
  '生成AI規制の最新動向',
  '研究論文ダイジェスト',
  '国内AI導入事例まとめ',
  'AIツール価格改定まとめ',
  '週末に読むAI長文記事',
];

const CREATIVE_TITLES = [
  '商品PVの制作事例',
  '3秒で変わる広告映像',
  'ロゴアニメーションの作り方',
  '実写×AIの合成カット',
  '楽曲リリックビデオ',
  'サムネイル改善ビフォーアフター',
];

const NEWS_PLATFORMS = ['X', 'YOUTUBE'];
const CREATIVE_PLATFORMS = ['INSTAGRAM', 'TIKTOK'];

/**
 * その日にどの系統をどう置くか。図2の分布を再現する。
 * offset = 今日からの相対日数 (負なら過去)。
 */
function planFor(day, offset) {
  if (offset === 3 || offset === 15) return { empty: true };
  if (offset === 11) return { paused: 'お盆明けの制作スケジュール調整のため' };

  const rows = [];
  const both = day % 3 !== 1;

  if (offset < 0) {
    rows.push({ brandId: 'news', kind: 'PUBLISHED', hour: 9, minute: 0 });
    if (both) rows.push({ brandId: 'creative', kind: 'PUBLISHED', hour: 12, minute: 0 });
  } else if (offset === 0) {
    // 図2の8月11日: ニュース 投稿1・承認1 / クリエイティブ 予約2
    rows.push({ brandId: 'news', kind: 'PUBLISHED', hour: 9, minute: 0 });
    rows.push({ brandId: 'news', kind: 'PENDING_APPROVAL', hour: 18, minute: 30 });
    rows.push({ brandId: 'creative', kind: 'SCHEDULED', hour: 12, minute: 0 });
    rows.push({ brandId: 'creative', kind: 'SCHEDULED', hour: 20, minute: 0 });
  } else {
    const needsApproval = offset === 7 || offset === 12;
    rows.push({ brandId: 'news', kind: needsApproval ? 'PENDING_APPROVAL' : 'SCHEDULED', hour: 18, minute: 30 });
    if (both) rows.push({ brandId: 'creative', kind: 'SCHEDULED', hour: 20, minute: 0 });
  }
  return { rows };
}

/**
 * サンプルデータを投入する。
 * @param {object} ctx {repo, clock, actor, mode}
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function loadSampleMonth(ctx, onProgress = () => {}) {
  const tz = ctx.clock.timeZone;
  const nowMs = ctx.clock.nowMs();
  const todayKey = dateKey(nowMs, tz);
  const year = Number(todayKey.slice(0, 4));
  const month = Number(todayKey.slice(5, 7));
  const todayDay = Number(todayKey.slice(8, 10));
  const total = daysInMonth(year, month);

  let newsIndex = 0;
  let creativeIndex = 0;
  let done = 0;

  for (let day = 1; day <= total; day += 1) {
    const offset = day - todayDay;
    const plan = planFor(day, offset);
    done += 1;
    onProgress(done, total);

    if (plan.empty) continue;
    if (plan.paused) {
      await pauseDay(ctx, `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, {
        reason: plan.paused,
      });
      continue;
    }

    for (const row of plan.rows) {
      const isNews = row.brandId === 'news';
      const title = isNews
        ? NEWS_TITLES[newsIndex++ % NEWS_TITLES.length]
        : CREATIVE_TITLES[creativeIndex++ % CREATIVE_TITLES.length];
      const platform = isNews
        ? NEWS_PLATFORMS[(day + row.hour) % NEWS_PLATFORMS.length]
        : CREATIVE_PLATFORMS[(day + row.hour) % CREATIVE_PLATFORMS.length];

      const scheduledAtMs = instantFromZoned(
        { year, month, day, hour: row.hour, minute: row.minute },
        tz,
      );

      const created = await createPostGroup(ctx, {
        brandId: row.brandId,
        projectTitle: title,
        platforms: [platform],
        scheduledAtIso: new Date(scheduledAtMs).toISOString(),
        timeZone: tz,
        payloads: {
          [platform]: {
            body: bodyFor(isNews, title),
            title,
            hashtags: isNews ? ['#AIニュース'] : ['#AIクリエイティブ'],
            cta: isNews ? '詳しくはプロフィールのリンクから' : '制作のご相談はDMへ',
            visibility: 'PUBLIC',
          },
        },
        assets: [
          {
            asset_id: crypto.randomUUID(),
            sha256: await fakeHash(`${title}-${day}`),
            mime: isNews ? 'image/png' : 'video/mp4',
            bytes: isNews ? 240_000 : 18_400_000,
            order: 0,
            alt_text: `${title}のサムネイル`,
            rights_status: 'CLEARED',
            file_name: isNews ? 'thumb.png' : 'main.mp4',
          },
        ],
        rights: {
          confirmed: true,
          rights_status: 'CLEARED',
          sources: isNews
            ? [{ claim_id: crypto.randomUUID(), source_url: 'https://www.anthropic.com/news', verified_at: new Date(nowMs).toISOString(), epistemic_status: 'PRIMARY' }]
            : [],
        },
        sourceSkill: isNews ? 'ai_news_v1' : 'ai_creative_v1',
      });

      const id = created.channelPostIds[0];
      await submitForApproval(ctx, id);
      if (row.kind === 'PENDING_APPROVAL') continue;

      // 承認の期限は「予定時刻＋許容遅延」なので、過去分は余裕を持たせる。
      const allowed = row.kind === 'PUBLISHED' ? 60 * 24 * 40 : 30;
      await approve(ctx, id, { allowedRetryDelayMinutes: allowed });
      if (row.kind !== 'PUBLISHED') continue;

      await claimManualExecution(ctx, id, { reason: 'サンプル: 手動投稿の記録' });
      await confirmManualPublish(ctx, id, {
        publicUrl: publicUrlFor(platform),
        publishedAtIso: new Date(scheduledAtMs).toISOString(),
        accountMatches: true,
        contentMatches: true,
        publishedAtMatches: true,
      });
    }
  }

  await ctx.repo.setSetting('sample_loaded_at', ctx.clock.nowIso());
  return { days: total };
}

function bodyFor(isNews, title) {
  return isNews
    ? `${title}\n\n今週の注目トピックをまとめました。出典は各記事のリンクから確認できます。`
    : `${title}\n\n制作の意図と、実際に効いたポイントを短くまとめています。`;
}

function publicUrlFor(platform) {
  const slug = Math.random().toString(36).slice(2, 12);
  switch (platform) {
    case 'YOUTUBE': return `https://www.youtube.com/watch?v=${slug}`;
    case 'INSTAGRAM': return `https://www.instagram.com/p/${slug}/`;
    case 'TIKTOK': return `https://www.tiktok.com/@reiki/video/${slug}`;
    default: return `https://x.com/reiki/status/${Date.now()}${slug.slice(0, 3)}`;
  }
}

async function fakeHash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 接続設定に並べるSNSアカウント。トークンは保持しない (§31)。 */
export async function seedSocialAccounts(ctx) {
  const now = ctx.clock.nowIso();
  const existing = await ctx.repo.listSocialAccounts();
  if (existing.length) return existing;

  const accounts = PLATFORM_ORDER.map((platform) => ({
    social_account_id: `${platform.toLowerCase()}-default`,
    platform,
    account_name: '@reiki',
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
