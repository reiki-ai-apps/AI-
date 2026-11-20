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
  const jst=new Date(now+9*3600000).toISOString();
  const videoDue=jst.slice(11,16)>='12:00';
  const videoComplete=video.status==='published'&&video.last_published_day_jst===jst.slice(0,10)&&
    Array.isArray(video.featured_video_keys)&&video.featured_video_keys.length>=2;
  const videoLate=videoDue&&!videoComplete;
  return {version:1,checked_at:new Date(now).toISOString(),
    status:failure?'action_required':code||stale||videoLate?'delayed':'current',
    reason:failure||(code?'update_incomplete':stale?'stale_edition':videoLate?'video_not_published_today':null),
    last_article_update_at:last,video_day:video.last_published_day_jst||null,
    video_status:videoComplete?'current':videoDue?'delayed':'pending'};
}
