#!/usr/bin/env node
/**
 * Standalone Bedrock connectivity test — no docker, no app, just a raw
 * HTTP call so you can quickly try different model IDs / inference
 * profile IDs and see the exact error AWS sends back.
 *
 * Usage:
 *   AWS_BEARER_TOKEN=<your key> node scratch-test-bedrock.mjs [options]
 *
 * Options:
 *   --mode chat|embed        (default: chat)
 *   --model <id-or-arn>      (default: openai.gpt-5.6-sol for chat,
 *                              cohere.embed-v4:0 for embed)
 *   --region <region>        (default: ap-southeast-1)
 *
 * Examples:
 *   node scratch-test-bedrock.mjs --model openai.gpt-5.6-sol
 *   node scratch-test-bedrock.mjs --model apac.openai.gpt-5.6-sol
 *   node scratch-test-bedrock.mjs --model "arn:aws:bedrock:ap-southeast-1:257709321323:application-inference-profile/abc123"
 *   node scratch-test-bedrock.mjs --mode embed --model cohere.embed-v4:0
 */

function parseArgs(argv) {
  // Same fallback order as the app: AWS_REGION env var, then ap-southeast-1.
  const args = { mode: 'chat', region: process.env.AWS_REGION || 'ap-southeast-1', model: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') args.mode = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--region') args.region = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.AWS_BEARER_TOKEN;
  if (!token) {
    console.error('AWS_BEARER_TOKEN is not set. Run: AWS_BEARER_TOKEN=<key> node scratch-test-bedrock.mjs ...');
    process.exit(1);
  }

  const model = args.model ?? (args.mode === 'embed' ? 'cohere.embed-v4:0' : 'openai.gpt-5.6-sol');
  const region = args.region;

  if (args.mode === 'chat') {
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;
    console.log(`POST ${url}`);
    const body = {
      system: [{ text: 'You are a helpful assistant.' }],
      messages: [{ role: 'user', content: [{ text: 'Say "hello" and nothing else.' }] }],
      inferenceConfig: { maxTokens: 32 },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    console.log(`Status: ${res.status}`);
    console.log(await res.text());
  } else {
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`;
    console.log(`POST ${url}`);
    const body = {
      texts: ['hello world'],
      input_type: 'search_document',
      embedding_types: ['float'],
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    // Embedding responses are huge (1536 floats) — truncate for readability.
    console.log(text.length > 500 ? text.slice(0, 500) + '... (truncated)' : text);
  }
}

main().catch((err) => {
  console.error('Request failed:', err);
  process.exit(1);
});
