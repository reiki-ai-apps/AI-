#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { processGatewayApproval } from './process-gateway-approval.mjs';

const dataFile = resolve(process.argv[2] ?? 'board/data/board.json');
const receiptDir = resolve(process.argv[3] ?? 'board/data/approval-receipts');
const input = await new Promise((resolveInput, reject) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { text += chunk; });
  process.stdin.on('end', () => resolveInput(text));
  process.stdin.on('error', reject);
});
const records = JSON.parse(input);
if (!Array.isArray(records)) throw new Error('承認record配列が必要です。');

const results = [];
for (const record of records) {
  if (!record?.request_id) throw new Error('request_idがない承認recordです。');
  const receiptFile = resolve(receiptDir, `gateway-${record.request_id}.json`);
  try {
    await readFile(receiptFile, 'utf8');
    results.push({ request_id: record.request_id, status: 'RECEIPT_EXISTS' });
    continue;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const receipt = await processGatewayApproval({
    event: { repository: { full_name: 'reiki-ai-apps/AI-' }, client_payload: { approval: record } },
    dataFile,
    receiptFile,
  });
  results.push({ request_id: record.request_id, status: receipt.status });
}

process.stdout.write(`${JSON.stringify({ processed: results.length, results }, null, 2)}\n`);
