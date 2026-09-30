// Public health metadata contains only enums and timestamps, never raw API errors.
export function classifyUpdateFailure(log=''){
  if(/credit balance is too low|insufficient[_ ]credits/i.test(log))return 'credit_required';
  if(/Anthropic HTTP (401|403)|missing.*ANTHROPIC_API_KEY/i.test(log))return 'credentials_required';
  if(/Anthropic HTTP 429/i.test(log))return 'rate_limited';
  return '';
}
export function makeUpdateHealth({code,failure='',edition={},video={},now=Date.now()}){
  const date=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
  const last=date(edition.last_checked_at);
  const stale=!last||now-Date.parse(last)>24*3600000;
  return {version:1,checked_at:new Date(now).toISOString(),
    status:failure?'action_required':code||stale?'delayed':'current',
    reason:failure||(code?'update_incomplete':stale?'stale_edition':null),
    last_article_update_at:last,video_day:video.last_published_day_jst||null};
}
