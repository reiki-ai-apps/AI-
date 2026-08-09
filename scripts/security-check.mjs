import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const textFiles = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "_site", "node_modules"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (/\.(?:html|js|mjs|ts|json|md|ya?ml|sql)$/i.test(entry.name)) textFiles.push(fullPath);
  }
}

collect(root);

const findings = [];
const secretPatterns = [
  new RegExp(["sk", "live", "[A-Za-z0-9]{16,}"].join("_"), "g"),
  new RegExp(["sk", "test", "[A-Za-z0-9]{16,}"].join("_"), "g"),
  new RegExp(["whsec", "[A-Za-z0-9]{16,}"].join("_"), "g"),
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

for (const file of textFiles) {
  if (file.endsWith(path.join("scripts", "security-check.mjs"))) continue;
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) findings.push(`${path.relative(root, file)}: secret-like value`);
  }
}

const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const requiredHtmlControls = [
  ["Content Security Policy", /http-equiv="Content-Security-Policy"/],
  ["referrer policy", /name="referrer" content="strict-origin-when-cross-origin"/],
  ["pinned Supabase client", /@supabase\/supabase-js@\d+\.\d+\.\d+/],
  ["external URL validation", /function safeExternalUrl\(/],
  ["safe source article navigation", /window\.open\(sourceUrl,'_blank','noopener,noreferrer'\)/],
  ["safe billing portal navigation", /safeExternalUrl\(data\?\.url,\['billing\.stripe\.com'\]\)/],
];
for (const [label, pattern] of requiredHtmlControls) {
  if (!pattern.test(html)) findings.push(`index.html: missing ${label}`);
}

if (/\beval\s*\(|new\s+Function\s*\(/.test(html)) {
  findings.push("index.html: dynamic code execution primitive");
}
if (/window\.open\(\s*u\.source_url/.test(html)) {
  findings.push("index.html: unvalidated source URL navigation");
}

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());
for (const [index, source] of inlineScripts.entries()) {
  try {
    new vm.Script(source, { filename: `index.inline-${index}.js` });
  } catch (error) {
    findings.push(`index.html: inline script ${index} syntax error: ${error.message}`);
  }
}

const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
for (const table of ["profiles", "subscriptions", "stripe_events", "user_states", "article_views", "support_requests", "reviews", "unique_visitors"]) {
  const pattern = new RegExp(`alter table public\\.${table} enable row level security`, "i");
  if (!pattern.test(schema)) findings.push(`supabase/schema.sql: RLS missing for ${table}`);
}
if (!/security definer\s+set search_path = ''/i.test(schema)) {
  findings.push("supabase/schema.sql: hardened SECURITY DEFINER search_path missing");
}
if (!/function public\.record_article_view\(p_article_key text\)/i.test(schema)) {
  findings.push("supabase/schema.sql: server-derived article view RPC missing");
}
if (/create or replace function public\.record_article_view\(p_article_key text,\s*p_limit/i.test(schema)) {
  findings.push("supabase/schema.sql: client-controlled article limit still accepted");
}
if (/grant\s+(?:all|insert|update|delete)[^;]*on table public\.subscriptions to authenticated/i.test(schema)) {
  findings.push("supabase/schema.sql: authenticated users can mutate subscriptions");
}
if (/record_article_view'[\s\S]{0,180}p_limit/.test(html)) {
  findings.push("index.html: client still sends a subscription limit to the RPC");
}
if (!/rpc\('public_review_status',\{p_reviewer_key_hash:reviewerHash\}\)/.test(html)) {
  findings.push("index.html: anonymous review status check missing");
}
if (!/rpc\('submit_public_review',\{p_reviewer_key_hash:reviewerHash/.test(html)) {
  findings.push("index.html: anonymous review submission missing");
}
if (!/grant execute on function public\.public_review_status\(text\) to anon, authenticated/i.test(schema)) {
  findings.push("supabase/schema.sql: public review status RPC is not granted safely");
}
if (!/grant execute on function public\.submit_public_review\(text, text, integer, text\) to anon, authenticated/i.test(schema)) {
  findings.push("supabase/schema.sql: public review submission RPC is not granted safely");
}
if (!/create unique index if not exists reviews_reviewer_key_hash_key/i.test(schema)) {
  findings.push("supabase/schema.sql: public review duplicate-prevention index missing");
}
if (!/rpc\('register_unique_visitor',\{p_visitor_key_hash:visitorHash\}\)/.test(html)) {
  findings.push("index.html: anonymous unique visitor registration RPC missing");
}
if (!/grant execute on function public\.register_unique_visitor\(text\) to anon, authenticated/i.test(schema)) {
  findings.push("supabase/schema.sql: unique visitor RPC is not granted safely");
}
if (!/revoke all on table public\.unique_visitors from anon, authenticated/i.test(schema)) {
  findings.push("supabase/schema.sql: raw unique visitor hashes are exposed");
}
if (/data-registered-count|rpc\('registered_user_count'\)|id=["']onlineNow["']|これまでに\s*<b>[\s\S]*?人が閲覧/.test(html)) {
  findings.push("index.html: user-visible audience or registration count remains");
}
if (/grant execute on function public\.registered_user_count\(\) to (?:anon|authenticated|anon, authenticated)/i.test(schema)) {
  findings.push("supabase/schema.sql: registered-user count is exposed to an application role");
}
if (!/function public\.register_unique_visitor\(p_visitor_key_hash text\)\s*returns boolean/i.test(schema)) {
  findings.push("supabase/schema.sql: unique visitor RPC must not return a total count");
}

if (findings.length) {
  console.error("Security checks failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Security checks passed (${textFiles.length} files, ${inlineScripts.length} inline script).`);
