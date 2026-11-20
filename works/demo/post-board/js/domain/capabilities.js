// §21 4SNSアダプター能力情報 / §38 公式仕様の確認先
//
// 原則: UNKNOWNの機能は無効のまま。実アカウント検証後だけSUPPORTEDへ昇格する (G27)。
// 初期値は §38 の一次情報 (2026年8月11日時点) をそのまま写している。
//
// この結果、4SNSとも supports_direct_publish は初期状態で有効にならない。
// つまり手動投稿Fallback (§16) が実際の運用経路になる。

export const CAPABILITY_VALUES = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  UNKNOWN: 'UNKNOWN',
});

export const RECONCILIATION_STRENGTH = Object.freeze({
  STRONG: 'STRONG',
  EVENTUAL: 'EVENTUAL',
  UNSUPPORTED: 'UNSUPPORTED',
});

const VERIFIED_AT = '2026-08-11';

/** §38 の表。primaryUrl は一次情報の場所 (G27「確認日と一次URLを持つ」)。 */
export const PLATFORM_CAPABILITIES = Object.freeze({
  NOTE: Object.freeze({
    platform: 'NOTE',
    // 台帳に載せた日。中身の確認はまだで、UNKNOWNのままなので機能は有効にならない (G27)。
    verifiedAt: '2026-08-14',
    primaryUrls: Object.freeze(['https://note.com/']),
    confirmed: '確認できたことはまだありません',
    unknownNote: '公式の投稿API・予約・取消・状態照会の有無をすべて未確認。'
      + '一次情報を確認するまで手動投稿だけで運用する',
    capabilities: Object.freeze({
      supports_direct_publish: 'UNKNOWN',
      supports_native_schedule: 'UNKNOWN',
      supports_cancel: 'UNKNOWN',
      supports_status_lookup: 'UNKNOWN',
      supports_idempotency: 'UNKNOWN',
    }),
    reconciliation_strength: 'UNSUPPORTED',
    max_media_size: 10_485_760, // 10 MiB。未確認のため小さめに置く
    allowed_media_types: Object.freeze(['image/png', 'image/jpeg', 'image/gif']),
  }),
  YOUTUBE: Object.freeze({
    platform: 'YOUTUBE',
    verifiedAt: VERIFIED_AT,
    primaryUrls: Object.freeze([
      'https://developers.google.com/youtube/v3/guides/uploading_a_video',
      'https://developers.google.com/youtube/v3/docs/videos',
    ]),
    confirmed: 'OAuth＋videos.insert、再開可能upload。未検証API projectは公開不可',
    unknownNote: 'audit_status・公開可否・取消・強い重複照合・実Quotaは未確認',
    capabilities: Object.freeze({
      // 監査確認までは公開無効 (§38 仕様固定のルール)
      supports_direct_publish: 'UNKNOWN',
      supports_native_schedule: 'UNKNOWN',
      supports_cancel: 'UNKNOWN',
      supports_status_lookup: 'UNKNOWN',
      supports_idempotency: 'UNKNOWN',
    }),
    reconciliation_strength: 'UNSUPPORTED',
    max_media_size: 137_438_953_472, // 128 GiB (videos.insert の上限)
    allowed_media_types: Object.freeze(['video/mp4', 'video/quicktime', 'video/webm']),
  }),
  YOUTUBE_SHORTS: Object.freeze({
    platform: 'YOUTUBE_SHORTS',
    verifiedAt: VERIFIED_AT,
    primaryUrls: Object.freeze([
      'https://developers.google.com/youtube/v3/guides/uploading_a_video',
      'https://developers.google.com/youtube/v3/docs/videos',
    ]),
    confirmed: 'ShortsもYouTube videos.insertで動画として登録する。縦動画・長さは公開直前に再検査',
    unknownNote: 'audit_status・公開可否・実Quotaは未確認',
    capabilities: Object.freeze({
      supports_direct_publish: 'UNKNOWN', supports_native_schedule: 'UNKNOWN',
      supports_cancel: 'UNKNOWN', supports_status_lookup: 'UNKNOWN', supports_idempotency: 'UNKNOWN',
    }),
    reconciliation_strength: 'UNSUPPORTED',
    max_media_size: 137_438_953_472,
    allowed_media_types: Object.freeze(['video/mp4', 'video/quicktime', 'video/webm']),
  }),
  INSTAGRAM: Object.freeze({
    platform: 'INSTAGRAM',
    verifiedAt: VERIFIED_AT,
    primaryUrls: Object.freeze([
      'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing',
    ]),
    confirmed: 'Content Publishingは対応アカウント／権限条件付き',
    unknownNote: '対象アカウント能力・取消・強い重複照合は未確認',
    capabilities: Object.freeze({
      supports_direct_publish: 'UNKNOWN',
      supports_native_schedule: 'UNKNOWN',
      supports_cancel: 'UNKNOWN',
      supports_status_lookup: 'UNKNOWN',
      supports_idempotency: 'UNKNOWN',
    }),
    reconciliation_strength: 'UNSUPPORTED',
    max_media_size: 104_857_600,
    allowed_media_types: Object.freeze(['image/jpeg', 'image/png', 'video/mp4']),
  }),
  TIKTOK: Object.freeze({
    platform: 'TIKTOK',
    verifiedAt: VERIFIED_AT,
    primaryUrls: Object.freeze([
      'https://developers.tiktok.com/doc/content-posting-api-get-started/',
      'https://developers.tiktok.com/doc/content-sharing-guidelines/',
    ]),
    confirmed: '内部専用の自社アカウント投稿はDirect Post不適合。未監査はprivate限定',
    unknownNote: 'intended_use_allowed・audit・eligibility・scope・public_visibilityは未確認',
    capabilities: Object.freeze({
      // 内部用途は明確に不適合なので UNKNOWN ではなく UNSUPPORTED (§38)
      supports_direct_publish: 'UNSUPPORTED',
      supports_native_schedule: 'UNKNOWN',
      supports_cancel: 'UNKNOWN',
      supports_status_lookup: 'UNKNOWN',
      supports_idempotency: 'UNKNOWN',
    }),
    reconciliation_strength: 'UNSUPPORTED',
    max_media_size: 4_294_967_296,
    allowed_media_types: Object.freeze(['video/mp4', 'video/quicktime']),
  }),
  X: Object.freeze({
    platform: 'X',
    verifiedAt: VERIFIED_AT,
    primaryUrls: Object.freeze(['https://docs.x.com/x-api/posts/create-post']),
    confirmed: 'OAuthでPOST /2/tweets。AI生成表示フィールドあり',
    unknownNote: '外部冪等性・取消・強い重複照合は未確認',
    capabilities: Object.freeze({
      supports_direct_publish: 'UNKNOWN',
      supports_native_schedule: 'UNSUPPORTED',
      supports_cancel: 'UNKNOWN',
      supports_status_lookup: 'UNKNOWN',
      supports_idempotency: 'UNKNOWN',
    }),
    reconciliation_strength: 'UNSUPPORTED',
    max_media_size: 536_870_912,
    allowed_media_types: Object.freeze(['image/jpeg', 'image/png', 'video/mp4']),
  }),
});

export const CAPABILITY_LABELS = Object.freeze({
  supports_direct_publish: '直接投稿',
  supports_native_schedule: 'SNS側予約',
  supports_cancel: '取消',
  supports_status_lookup: '状態照合',
  supports_idempotency: 'SNS側の冪等性',
});

/**
 * 機能が有効か。UNKNOWNは常に無効 (G27)。
 * 「たぶん動く」で外部投稿を始めさせない。
 */
export function isEnabled(platform, capability) {
  const entry = PLATFORM_CAPABILITIES[platform];
  if (!entry) throw new RangeError(`未知のSNSです: ${platform}`);
  return entry.capabilities[capability] === CAPABILITY_VALUES.SUPPORTED;
}

/** 能力の日本語表示。UNKNOWNは「未確認（無効）」と明示する。色だけで伝えない (§32)。 */
export function capabilityLabel(value) {
  switch (value) {
    case 'SUPPORTED':
      return '利用可';
    case 'UNSUPPORTED':
      return '利用不可';
    case 'UNKNOWN':
      return '未確認（無効）';
    default:
      return '未確認（無効）';
  }
}

export function capabilityTone(value) {
  return value === 'SUPPORTED' ? 'published' : value === 'UNSUPPORTED' ? 'neutral' : 'attention';
}

/**
 * §15 予約時の再検査 / §21 preflight 相当。
 * 直接投稿できないSNSは、予約しても手動投稿導線に載せる。
 *
 * @returns {{ mode:'DIRECT'|'MANUAL', reason:string }}
 */
export function publishMode(platform) {
  if (isEnabled(platform, 'supports_direct_publish')) {
    return { mode: 'DIRECT', reason: '直接投稿が有効です。' };
  }
  const entry = PLATFORM_CAPABILITIES[platform];
  const value = entry.capabilities.supports_direct_publish;
  return {
    mode: 'MANUAL',
    reason:
      value === 'UNSUPPORTED'
        ? `${platform} は現在の用途では直接投稿に対応していません。手動投稿で進めます。`
        : `${platform} の直接投稿はまだ確認できていません。確認が済むまで手動投稿で進めます。`,
  };
}

/** 照合の強さ。STRONG以外では SAFE_NOT_FOUND を名乗らせない (§21)。 */
export function reconciliationStrength(platform) {
  const entry = PLATFORM_CAPABILITIES[platform];
  if (!entry) throw new RangeError(`未知のSNSです: ${platform}`);
  return entry.reconciliation_strength;
}

/** 素材の事前検証 (§21 max_media_size / allowed_media_types)。 */
export function validateAssetForPlatform(platform, { mime, bytes }) {
  const entry = PLATFORM_CAPABILITIES[platform];
  if (!entry) throw new RangeError(`未知のSNSです: ${platform}`);
  const problems = [];
  if (mime && !entry.allowed_media_types.includes(mime)) {
    problems.push(`${entry.platform} はこの形式（${mime}）に対応していません。`);
  }
  if (Number.isFinite(bytes) && bytes > entry.max_media_size) {
    problems.push(`${entry.platform} の容量上限を超えています。`);
  }
  return { ok: problems.length === 0, problems };
}

/** §38 仕様固定のルール: 90日ごと / リリース30日前 に再確認する。 */
export const RECHECK_INTERVAL_DAYS = 90;

export function needsRecheck(platform, nowMs) {
  const entry = PLATFORM_CAPABILITIES[platform];
  const verifiedMs = Date.parse(`${entry.verifiedAt}T00:00:00Z`);
  return nowMs - verifiedMs > RECHECK_INTERVAL_DAYS * 86_400_000;
}
