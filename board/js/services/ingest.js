// §25 PublicationPackage契約 / §27 接続API / §28 版付き実装契約 / §30 統合失敗
//
// 制作スキル(ORBIT / FORGE / AIクリエイティブ / AWE ほか)は、この封筒だけを渡す。
// ここで行うのは「受理・検証・変換」まで。公開判断は必ず人のApprovalを通す (§22 統合の絶対原則)。
//
// 冪等性の契約 (§27 / §28A):
//   unique = (tenant_id, source_skill, idempotency_key)
//   同じキー + 同じ server_digest → 200 で既存を再生（新しい版を作らない）
//   同じキー + 異なる digest      → 409 IDEMPOTENCY_MISMATCH
//   申告 request_digest が再計算値と違う → 422

import { canonicalize, omit } from '../core/jcs.js';
import { domainDigest, sha256OfBytes, isSha256Hex } from '../core/digest.js';
import { uuid, isUuid } from '../core/ids.js';
import { assertCan } from '../domain/rbac.js';
import { isBrandId } from '../domain/brands.js';
import { isPlatformId } from '../domain/platforms.js';
import { createPostGroup } from './posts.js';
import { ValidationError } from './posts.js';

export const CONTRACT_VERSION = '1.0';
export const PACKAGE_DIGEST_DOMAIN = 'REIKI-PACKAGE-V1';
export const INGEST_ROUTE = '/integration/v1/publication-packages';

export const ALLOWED_SOURCE_SKILLS = Object.freeze([
  'ai_news_v1',
  'ai_creative_v1',
  'rebuild_manga_v1',
  'kiki_toa_v1',
  'manual',
]);

export class ContractError extends Error {
  constructor(code, status, message, errors = []) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
}

/**
 * §28A server_digest。
 * projection から request_digest と submitted_at を外し、RFC 8785 で正規化してハッシュする。
 * サーバー側で必ず再計算し、申告値と一致しなければ 422。
 */
export async function computeServerDigest(body, { tenantId, sourceSkill, idempotencyKey, method = 'POST', route = INGEST_ROUTE }) {
  const projection = {
    method,
    route,
    tenant_id: tenantId,
    source_skill: sourceSkill,
    idempotency_key: idempotencyKey,
    body: omit(body, 'request_digest', 'submitted_at'),
  };
  return domainDigest(PACKAGE_DIGEST_DOMAIN, projection);
}

// ---------------------------------------------------------------------------
// 検証 — §28 の required・型・制約。エラーは JSON Pointer 付きで返す。
// ---------------------------------------------------------------------------

function err(pointer, message) {
  return { pointer, message };
}

export function validatePackage(pkg) {
  const errors = [];

  if (!pkg || typeof pkg !== 'object') {
    return [err('', 'PublicationPackage がオブジェクトではありません。')];
  }

  if (pkg.contract_version !== CONTRACT_VERSION) {
    errors.push(
      err('/contract_version', `対応していない契約版です（対応版: ${CONTRACT_VERSION}）。`),
    );
  }
  if (!isUuid(pkg.package_id)) errors.push(err('/package_id', 'package_id はUUIDで指定してください。'));
  if (!isUuid(pkg.tenant_id)) errors.push(err('/tenant_id', 'tenant_id はUUIDで指定してください。'));
  if (!isBrandId(pkg.brand_id)) errors.push(err('/brand_id', 'brand_id は news か creative を指定してください。'));
  if (!ALLOWED_SOURCE_SKILLS.includes(pkg.source_skill)) {
    errors.push(err('/source_skill', `未登録の制作スキルです: ${pkg.source_skill}`));
  }
  const key = pkg.idempotency_key ?? '';
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) {
    errors.push(err('/idempotency_key', 'idempotency_key は16〜128文字で指定してください。'));
  }
  if (!isSha256Hex(pkg.request_digest ?? '')) {
    errors.push(err('/request_digest', 'request_digest はSHA-256の64桁hexで指定してください。'));
  }
  if (!pkg.project_title || !String(pkg.project_title).trim()) {
    errors.push(err('/project_title', 'project_title は必須です。'));
  }

  const payloads = pkg.platform_payloads;
  if (!Array.isArray(payloads) || payloads.length < 1 || payloads.length > 4) {
    errors.push(err('/platform_payloads', 'platform_payloads は1〜4件で指定してください。'));
  } else {
    const seen = new Set();
    payloads.forEach((p, i) => {
      const at = `/platform_payloads/${i}`;
      if (!isPlatformId(p?.platform)) {
        errors.push(err(`${at}/platform`, 'platform は YOUTUBE / INSTAGRAM / TIKTOK / X のいずれかです。'));
      } else if (seen.has(p.platform)) {
        errors.push(err(`${at}/platform`, `同じSNSが重複しています: ${p.platform}`));
      } else {
        seen.add(p.platform);
      }
      const body = p?.body ?? '';
      if (typeof body !== 'string' || body.length < 1 || body.length > 50_000) {
        errors.push(err(`${at}/body`, 'body は1〜50000文字で指定してください。'));
      }
      const sched = p?.suggested_schedule;
      if (!sched || !Number.isFinite(Date.parse(sched.scheduled_at ?? ''))) {
        errors.push(err(`${at}/suggested_schedule/scheduled_at`, '希望日時をUTCのISO8601で指定してください。'));
      }
      if (!sched?.time_zone) {
        errors.push(err(`${at}/suggested_schedule/time_zone`, 'IANAタイムゾーンを指定してください。'));
      }
    });
  }

  const assets = pkg.assets ?? [];
  if (!Array.isArray(assets) || assets.length > 20) {
    errors.push(err('/assets', 'assets は0〜20件で指定してください。'));
  } else {
    assets.forEach((a, i) => {
      const at = `/assets/${i}`;
      if (!isUuid(a?.asset_id)) errors.push(err(`${at}/asset_id`, 'asset_id はUUIDで指定してください。'));
      if (!isSha256Hex(a?.sha256 ?? '')) errors.push(err(`${at}/sha256`, 'sha256 は64桁hexで指定してください。'));
      if (!a?.mime) errors.push(err(`${at}/mime`, 'mime は必須です。'));
      if (!Number.isFinite(a?.bytes) || a.bytes < 1) errors.push(err(`${at}/bytes`, 'bytes は1以上で指定してください。'));
      if (!a?.rights_status) errors.push(err(`${at}/rights_status`, 'rights_status は必須です。'));
    });
  }

  const reviews = pkg.reviews ?? [];
  if (!Array.isArray(reviews)) {
    errors.push(err('/reviews', 'reviews は配列です。'));
  } else {
    reviews.forEach((r, i) => {
      const at = `/reviews/${i}`;
      if (!['PASS', 'FAIL', 'EVIDENCE_MISSING'].includes(r?.verdict)) {
        errors.push(err(`${at}/verdict`, 'verdict は PASS / FAIL / EVIDENCE_MISSING のいずれかです。'));
      }
      // §25「品質／AWE」: 隔離審査の証拠は saw_other_findings=false を必須にする。
      if (r?.review_type === 'AWE' && r?.saw_other_findings !== false) {
        errors.push(err(`${at}/saw_other_findings`, 'AWEの証拠は saw_other_findings=false が必須です。'));
      }
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 受信
// ---------------------------------------------------------------------------

/**
 * PublicationPackage を受け取り、PostGroup / ChannelPost / PostRevision へ変換する。
 *
 * @param {object} ctx
 * @param {object} pkg PublicationPackage JSON
 * @param {Map<string, Uint8Array>} [assetBytes] archive_member 名 → 中身 (素材ZIPから)
 * @returns {{status:number, packageId:string, postGroupId:string, replayed:boolean, warnings:string[]}}
 */
export async function ingestPackage(ctx, pkg, assetBytes = new Map()) {
  assertCan(ctx.actor.role, 'package.import');

  const errors = validatePackage(pkg);
  if (errors.length) {
    const unsupported = errors.some((e) => e.pointer === '/contract_version');
    throw new ContractError(
      unsupported ? 'SCHEMA_UNSUPPORTED' : 'VALIDATION_FAILED',
      422,
      unsupported
        ? `対応していない契約版です。contract_version="${CONTRACT_VERSION}" で送り直してください。`
        : '受信したPackageの内容に不備があります。',
      errors,
    );
  }

  // §28A: server_digest はサーバーが再計算する。申告値と違えば 422。
  const serverDigest = await computeServerDigest(pkg, {
    tenantId: pkg.tenant_id,
    sourceSkill: pkg.source_skill,
    idempotencyKey: pkg.idempotency_key,
  });
  if (pkg.request_digest !== serverDigest) {
    throw new ContractError('VALIDATION_FAILED', 422, 'request_digest が本文と一致しません。', [
      err('/request_digest', `再計算値 ${serverDigest} と一致しません。`),
    ]);
  }

  // §30 同じPackageの再送 → 既存 package_id を返し、新規版を作らない。
  const ingestKey = [pkg.tenant_id, pkg.source_skill, pkg.idempotency_key];
  const existing = await ctx.repo.read(['publicationPackages'], (tx) =>
    tx.getBy('publicationPackages', 'ingest_key', ingestKey),
  );
  if (existing) {
    if (existing.server_digest === serverDigest) {
      return {
        status: 200,
        packageId: existing.package_id,
        postGroupId: existing.post_group_id,
        replayed: true,
        warnings: [],
      };
    }
    throw new ContractError(
      'IDEMPOTENCY_MISMATCH',
      409,
      '同じidempotency_keyで異なる内容が送られました。前の内容を成功扱いにはしません。',
      [err('/request_digest', `既存 ${existing.server_digest} / 今回 ${serverDigest}`)],
    );
  }

  // §30 素材Hash不一致 → 隔離して再アップロードを要求。
  const warnings = [];
  const quarantined = [];
  for (const asset of pkg.assets ?? []) {
    const member = asset.archive_member;
    if (!member) continue;
    const bytes = assetBytes.get(member);
    if (!bytes) {
      warnings.push(`素材ファイルが見つかりません: ${member}`);
      quarantined.push(asset.asset_id);
      continue;
    }
    const actual = await sha256OfBytes(bytes);
    if (actual !== asset.sha256) {
      quarantined.push(asset.asset_id);
      warnings.push(`素材Hashが一致しません（${member}）。隔離しました。再アップロードしてください。`);
    }
  }
  if (quarantined.length) {
    throw new ContractError('ASSET_DIGEST_MISMATCH', 422, '素材の内容が申告Hashと一致しません。', [
      err('/assets', `隔離した素材: ${quarantined.join(', ')}`),
    ]);
  }

  const first = pkg.platform_payloads[0];
  const created = await createPostGroup(ctx, {
    brandId: pkg.brand_id,
    projectTitle: pkg.project_title,
    platforms: pkg.platform_payloads.map((p) => p.platform),
    scheduledAtIso: new Date(Date.parse(first.suggested_schedule.scheduled_at)).toISOString(),
    timeZone: first.suggested_schedule.time_zone,
    payloads: Object.fromEntries(
      pkg.platform_payloads.map((p) => [
        p.platform,
        {
          body: p.body,
          title: p.title ?? pkg.project_title,
          hashtags: p.hashtags ?? [],
          cta: p.cta ?? '',
          visibility: p.visibility ?? 'PUBLIC',
        },
      ]),
    ),
    assets: (pkg.assets ?? []).map((a) => ({
      asset_id: a.asset_id,
      sha256: a.sha256,
      mime: a.mime,
      bytes: a.bytes,
      order: a.order,
      alt_text: a.alt_text ?? '',
      rights_status: a.rights_status,
      file_name: a.archive_member ?? null,
    })),
    rights: {
      // 上流の品質PASSは公開承認ではない。権利確認の事実だけを引き継ぐ (§22)。
      confirmed: (pkg.claims ?? []).length > 0,
      rights_status: (pkg.assets ?? [])[0]?.rights_status ?? 'UNKNOWN',
      sources: (pkg.claims ?? []).map((c) => ({
        claim_id: c.claim_id,
        source_url: c.source_url,
        verified_at: c.verified_at ?? null,
        epistemic_status: c.epistemic_status ?? null,
      })),
    },
    ownerUserId: pkg.operations?.owner ?? ctx.actor.userId,
    approverUserId: (pkg.operations?.approver_candidates ?? [])[0] ?? ctx.actor.userId,
    sourceSkill: pkg.source_skill,
    sourceRunId: pkg.source_run_id ?? null,
    packageId: pkg.package_id,
  });

  const record = {
    package_id: pkg.package_id,
    tenant_id: pkg.tenant_id,
    source_skill: pkg.source_skill,
    idempotency_key: pkg.idempotency_key,
    request_digest: pkg.request_digest,
    server_digest: serverDigest,
    contract_version: pkg.contract_version,
    source_revision: pkg.source_revision ?? 1,
    source_artifact_id: pkg.source_artifact_id ?? null,
    received_at: ctx.clock.nowIso(),
    post_group_id: created.postGroupId,
    // 受理しただけ。公開承認はまだ存在しない (§22)。
    status: 'ACCEPTED',
    quality_reviews: pkg.reviews ?? [],
  };

  await ctx.repo.change(['publicationPackages'], async (tx, audit) => {
    await tx.add('publicationPackages', record);
    await audit({
      actor: ctx.actor.userId,
      target_type: 'publicationPackage',
      target_id: pkg.package_id,
      action: 'package.accepted',
      before_hash: null,
      after_hash: serverDigest,
      reason: `${pkg.source_skill} から「${pkg.project_title}」を受理（品質PASSは公開承認ではありません）`,
      correlation_id: created.correlationId,
    });
  });

  return {
    status: 201,
    packageId: pkg.package_id,
    postGroupId: created.postGroupId,
    channelPostIds: created.channelPostIds,
    replayed: false,
    warnings,
  };
}

/**
 * 送信側がrequest_digestを埋めるためのヘルパー。
 * サンプルPackageの生成とテストで使う。
 */
export async function sealPackage(pkg) {
  const digest = await computeServerDigest(pkg, {
    tenantId: pkg.tenant_id,
    sourceSkill: pkg.source_skill,
    idempotencyKey: pkg.idempotency_key,
  });
  return { ...pkg, request_digest: digest };
}

/** 受信内容の要約 (取込画面のプレビュー用)。 */
export function summarizePackage(pkg) {
  return {
    projectTitle: pkg.project_title,
    sourceSkill: pkg.source_skill,
    brandId: pkg.brand_id,
    platforms: (pkg.platform_payloads ?? []).map((p) => p.platform),
    assetCount: (pkg.assets ?? []).length,
    claimCount: (pkg.claims ?? []).length,
    reviews: (pkg.reviews ?? []).map((r) => ({ type: r.review_type, verdict: r.verdict })),
    canonicalLength: canonicalize(pkg).length,
  };
}
