#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { systemClock } from '../js/core/clock.js';
import { openFileDatabase } from '../js/store/filedb.js';
import { Repo } from '../js/store/repo.js';
import { kindForPlatform } from '../js/domain/production.js';
import { createPostGroup, updateInternal } from '../js/services/posts.js';
import { updateProduction } from '../js/services/production.js';

const TIME_ZONE = 'Asia/Tokyo';
const PLATFORMS = ['NOTE', 'YOUTUBE', 'INSTAGRAM', 'X'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`不明な引数です: ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} の値がありません。`);
    out[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    i += 1;
  }
  return out;
}

async function writeJson(path, value) {
  if (!path) return;
  const full = resolve(path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function requireIso(value, label) {
  if (!Number.isFinite(Date.parse(value ?? ''))) throw new Error(`${label} が不正です。`);
  return new Date(Date.parse(value)).toISOString();
}

function desiredProduction(post, gate) {
  const observedCount = gate.observed?.verified_primary_sources ?? gate.verified_primary_count ?? gate.checks?.story_count ?? null;
  const required = gate.required?.verified_primary_sources ?? gate.required_primary_count ?? observedCount ?? 3;
  const platformSteps = gate.platform_steps?.[post.platform];
  const selectedSteps = Array.isArray(platformSteps) && platformSteps.length > 0
    ? platformSteps
    : gate.production_steps;
  if (Array.isArray(selectedSteps) && selectedSteps.length > 0) {
    return {
      kind: kindForPlatform(post.platform),
      steps: selectedSteps.map((step) => ({
        id: String(step.id),
        label: String(step.label),
        done: Boolean(step.done),
        note: step.note == null ? null : String(step.note),
      })),
    };
  }
  const observed = gate.observed?.verified_primary_sources ?? gate.checks?.story_count ?? 0;
  const remediationNote = Array.isArray(gate.remediation?.next_actions)
    ? gate.remediation.next_actions.join('／')
    : null;
  return {
    kind: kindForPlatform(post.platform),
    steps: [{
      id: 'primary_sources',
      label: `一次情報${required}件の確認`,
      done: gate.status !== 'HOLD' && observed >= required,
      note: remediationNote ?? gate.reason ?? null,
    }],
  };
}

async function syncProductionProgress(ctx, posts, gate) {
  let updated = 0;
  for (const post of posts) {
    const desired = desiredProduction(post, gate);
    const current = post.production
      ? { kind: post.production.kind, steps: post.production.steps }
      : null;
    if (JSON.stringify(current) === JSON.stringify(desired)) continue;
    await updateProduction(ctx, post.channel_post_id, {
      ...desired,
      reason: `制作run ${gate.run_id} の品質ゲートを同期`,
    });
    updated += 1;
  }
  return updated;
}

async function syncTrackingMarker(ctx, posts) {
  let updated = 0;
  for (const post of posts) {
    const tags = post.internal?.tags ?? [];
    if (tags.includes('production-run')) continue;
    await updateInternal(ctx, post.channel_post_id, {
      memo: '制作runの進捗表示。公開予定時刻ではありません。',
      tags: [...new Set([...tags, 'production-run', 'hold'])],
    }, { reason: '制作runのカレンダー表示として登録' });
    updated += 1;
  }
  return updated;
}

async function supersedePriorRun(ctx, run) {
  const priorRunId = String(run.supersedes_run_id ?? '').trim();
  if (!priorRunId || priorRunId === run.run_id) return { run_id: null, cancelled_posts: 0 };
  const priorGroup = await ctx.repo.read(['postGroups'], async (tx) =>
    (await tx.getAll('postGroups')).find((row) => row.source_run_id === priorRunId && !row.deleted_at),
  );
  if (!priorGroup) return { run_id: priorRunId, cancelled_posts: 0 };
  const posts = await ctx.repo.listChannelPostsOfGroup(priorGroup.post_group_id);
  const active = posts.filter((post) => !post.cancelled_at && !post.deleted_at && post.display_state !== 'PUBLISHED');
  if (active.length === 0) return { run_id: priorRunId, cancelled_posts: 0 };
  const now = ctx.clock.nowIso();
  await ctx.repo.change(['postGroups', 'channelPosts'], async (tx, audit) => {
    await tx.put('postGroups', {
      ...priorGroup,
      internal: {
        ...(priorGroup.internal ?? {}),
        tags: [...new Set([...(priorGroup.internal?.tags ?? []), 'superseded'])],
      },
      updated_at: now,
    });
    for (const post of active) {
      await tx.put('channelPosts', {
        ...post,
        cancelled_at: now,
        updated_at: now,
      });
      await audit({
        actor: ctx.actor.userId,
        target_type: 'channelPost',
        target_id: post.channel_post_id,
        action: 'production.superseded',
        reason: `制作run ${run.run_id} へ引き継ぎ`,
        revision_id: post.current_revision_id,
      });
    }
  });
  return { run_id: priorRunId, cancelled_posts: active.length };
}

export async function syncProductionRun({ runFile, gateFile, dataFile, receipt }) {
  if (!runFile || !gateFile || !dataFile) {
    throw new Error('--run-file、--gate-file、--data-file は必須です。');
  }
  const run = JSON.parse(await readFile(resolve(runFile), 'utf8'));
  const gate = JSON.parse(await readFile(resolve(gateFile), 'utf8'));
  if (!run.run_id || gate.run_id !== run.run_id) throw new Error('run_id が一致しません。');

  const clock = systemClock(TIME_ZONE);
  const db = await openFileDatabase(resolve(dataFile));
  const repo = new Repo(db, clock);
  const ctx = {
    repo,
    db,
    clock,
    mode: 'SOLO',
    actor: { userId: 'production-sync', role: 'ADMIN' },
  };

  const existing = await repo.read(['postGroups'], async (tx) =>
    (await tx.getAll('postGroups')).find((row) => row.source_run_id === run.run_id && !row.deleted_at),
  );
  if (existing) {
    const posts = await repo.listChannelPostsOfGroup(existing.post_group_id);
    const productionUpdated = await syncProductionProgress(ctx, posts, gate);
    const markerUpdated = await syncTrackingMarker(ctx, posts);
    const result = {
      status: 'REPLAYED',
      changed: productionUpdated > 0 || markerUpdated > 0,
      run_id: run.run_id,
      post_group_id: existing.post_group_id,
      channel_post_ids: posts.map((post) => post.channel_post_id),
      platforms: posts.map((post) => post.platform),
      display_state: 'DRAFT',
      production_updated: productionUpdated,
      tracking_marker_updated: markerUpdated,
      reservation_created: false,
      public_actions: [],
    };
    await writeJson(receipt, result);
    return result;
  }

  const superseded = await supersedePriorRun(ctx, run);

  const scheduledAtIso = requireIso(run.started_at ?? run.finished_at, 'run.started_at');
  const isHold = gate.status === 'HOLD';
  const remediation = gate.remediation ?? {};
  const title = isHold
    ? '次回AIニュース｜原因改善・再確認中（HOLD）'
    : '次回AIニュース｜制作進行中';
  const verified = gate.observed?.verified_primary_sources ?? run.verified_primary_count ?? gate.checks?.story_count ?? '未確認';
  const required = gate.required?.verified_primary_sources ?? run.required_primary_count ?? verified ?? '未確認';
  const contentMode = gate.checks?.content_mode ?? run.content_mode ?? 'new';
  const body = [
    `制作run: ${run.run_id}`,
    `現在工程: ${run.stage ?? '未確認'}`,
    `一次情報: ${verified}/${required}件`,
    `形式: ${contentMode === 'verified_revisit' ? '検証済み情報の再解説' : '新着ニュース'}`,
    `状態: ${isHold ? '品質保留' : gate.status ?? run.result ?? '進行中'}`,
    gate.reason ?? '',
    ...(Array.isArray(remediation.next_actions) && remediation.next_actions.length > 0
      ? [`次の改善: ${remediation.next_actions.join('／')}`, `再開: ${remediation.resume_command ?? '同じrun_idで再検査'}`]
      : []),
    '公開予約・外部投稿はまだ実行していません。',
  ].filter(Boolean).join('\n');

  const created = await createPostGroup(ctx, {
    brandId: 'news',
    projectTitle: title,
    platforms: PLATFORMS,
    scheduledAtIso,
    timeZone: TIME_ZONE,
    payloads: Object.fromEntries(PLATFORMS.map((platform) => [platform, {
      title,
      body,
      hashtags: [],
      cta: '',
      visibility: 'PUBLIC',
    }])),
    assets: [],
    rights: { confirmed: false, rights_status: 'UNKNOWN', sources: [] },
    sourceSkill: run.source_skill ?? 'ai_news_v1',
    sourceRunId: run.run_id,
    memo: '制作runの進捗表示。公開予定時刻ではありません。',
    tags: ['production-run', isHold ? 'hold' : 'in-progress'],
  });
  const createdPosts = await repo.listChannelPostsOfGroup(created.postGroupId);
  const productionUpdated = await syncProductionProgress(ctx, createdPosts, gate);
  const markerUpdated = await syncTrackingMarker(ctx, createdPosts);

  const result = {
    status: 'IMPORTED',
    changed: true,
    run_id: run.run_id,
    post_group_id: created.postGroupId,
    channel_post_ids: created.channelPostIds,
    platforms: PLATFORMS,
    display_state: 'DRAFT',
    production_updated: productionUpdated,
    tracking_marker_updated: markerUpdated,
    calendar_at: scheduledAtIso,
    reservation_created: false,
    public_actions: [],
    superseded,
    synced_at: clock.nowIso(),
  };
  await writeJson(receipt, result);
  return result;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await syncProductionRun(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
