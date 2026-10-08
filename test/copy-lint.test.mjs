import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fromMarkdown, fromMarkup } from '../lib/extract.mjs';
import { checkRules } from '../lib/rules.mjs';
import { batches, reviewWithModel } from '../lib/review.mjs';
import { anthropicReviewer, openAiCompatibleReviewer, parseJsonObject, reviewerFromEnv } from '../lib/providers.mjs';
import { format, lint, loadConfig } from '../lib/index.mjs';

test('markdown extraction keeps line numbers and skips code, front matter keys and link URLs', () => {
  const md = '---\ntitle: Hello there\nslug: x\n---\n# Big news\n\n```js\nconst a = 1;\n```\nRead the [guide](https://x.y/z).\n';
  assert.deepEqual(fromMarkdown(md, 'a.md').map((u) => [u.line, u.text]), [[2, 'Hello there'], [5, 'Big news'], [10, 'Read the guide.']]);
});

test('markup extraction finds text and alt/aria-label, ignores scripts', () => {
  const html = '<script>const x = "nope"</script>\n<h1>Hi &amp; welcome</h1>\n<img alt="A red lamp">';
  const units = fromMarkup(html, 'a.html');
  assert.deepEqual(units.map((u) => [u.line, u.text]), [[2, 'Hi & welcome'], [3, 'A red lamp']]);
});

test('rules: banned words as whole words, punctuation anywhere, patterns and sentence length', () => {
  const units = [{ file: 'f', line: 1, text: 'Unlocked doors and a seamless flow — wow' }, { file: 'f', line: 2, text: 'Ready?' }];
  const f = checkRules(units, { banned: ['unlock', 'seamless', '—'], patterns: [{ pattern: '\\?$', message: 'no questions' }], maxSentenceWords: 3 });
  const rules = f.map((x) => `${x.line}:${x.rule}:${x.message}`);
  assert.ok(rules.includes('1:banned:Avoid "seamless"'));
  assert.ok(rules.includes('1:banned:Avoid "—"'));
  assert.ok(!rules.includes('1:banned:Avoid "unlock"'), 'unlock should not match Unlocked');
  assert.ok(rules.includes('2:pattern:no questions'));
  assert.ok(rules.some((r) => r.startsWith('1:sentence-length')));
});

test('batching respects size limits', () => {
  const units = Array.from({ length: 250 }, (_, i) => ({ file: 'f', line: i, text: 'x'.repeat(50) }));
  const b = batches(units, { maxUnits: 100, maxChars: 4000 });
  assert.deepEqual(b.map((g) => g.length), [80, 80, 80, 10]);
});

test('model findings map back to file and line; invented ids are dropped; failures become warnings', async () => {
  const units = [{ file: 'a.md', line: 4, text: 'Is this yours?' }, { file: 'a.md', line: 9, text: 'Pair device' }];
  const reviewer = async ({ system, user }) => {
    assert.match(system, /<style_guide>\nBe literal\.\n<\/style_guide>/);
    assert.match(user, /Is this yours/);
    return { findings: [{ id: 0, rule: 'headlines', severity: 'error', message: 'Say what they do', suggestion: 'Pair device' }, { id: 7, rule: 'x', severity: 'error', message: 'ghost' }] };
  };
  const found = await reviewWithModel(units, 'Be literal.', reviewer);
  assert.deepEqual(found, [{ file: 'a.md', line: 4, rule: 'headlines', severity: 'error', source: 'model', message: 'Say what they do', suggestion: 'Pair device' }]);
  const warnings = [];
  await reviewWithModel(units, 'g', async () => { throw new Error('boom'); }, { onWarning: (w) => warnings.push(w) });
  assert.match(warnings[0], /skipped 2 line\(s\).*boom/);
});

test('anthropic reviewer sends structured-output request with fallbacks and reads JSON', async () => {
  let sent;
  const client = { beta: { messages: { create: async (req) => { sent = req; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"findings":[]}' }] }; } } } };
  const r = anthropicReviewer({ client });
  assert.deepEqual(await r({ system: 's', user: 'u' }), { findings: [] });
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.equal(sent.fallbacks, 'default');
  assert.deepEqual(sent.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal(sent.output_config.effort, 'medium');
});

test('anthropic reviewer reports refusals', async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }) } } };
  await assert.rejects(anthropicReviewer({ client })({ system: 's', user: 'u' }), /declined.*cyber/);
});

test('openai-compatible reviewer posts chat completions to the base URL and parses fenced JSON', async () => {
  let call;
  const fetchImpl = async (url, init) => { call = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"findings":[{"id":0}]}\n```' } }] }), { status: 200 }); };
  const r = openAiCompatibleReviewer({ model: 'llama3.1', baseUrl: 'http://localhost:11434/v1/', fetchImpl });
  assert.deepEqual(await r({ system: 's', user: 'u' }), { findings: [{ id: 0 }] });
  assert.equal(call.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(call.body.model, 'llama3.1');
  assert.equal(call.auth, undefined);
  assert.throws(() => openAiCompatibleReviewer({}), /Set the model/);
});

test('provider selection from the environment', () => {
  assert.equal(reviewerFromEnv({}, {}), null);
  assert.equal(typeof reviewerFromEnv({ provider: 'ollama', model: 'llama3.1' }, {}), 'function');
  assert.throws(() => reviewerFromEnv({ provider: 'nope' }, {}), /Unknown provider/);
  assert.equal(parseJsonObject('noise {"a":1} noise').a, 1);
});

test('lint the example, rules only, and format for GitHub', async () => {
  const config = loadConfig('examples/copy-lint.json');
  const result = await lint({ config, rulesOnly: true });
  const msgs = result.findings.map((f) => `${f.line}:${f.message}`);
  assert.ok(msgs.includes('2:Avoid "unlock"'));
  assert.ok(msgs.includes('2:Avoid "magic"'));
  assert.ok(msgs.includes('3:Avoid "—"'));
  assert.ok(msgs.includes('3:Avoid "seamlessly"'));
  assert.ok(msgs.includes('4:Avoid questions as headlines or labels'));
  assert.match(format(result, 'github'), /^::error file=examples\/page\.html,line=2,title=copy-lint \(banned\)::Avoid "unlock"/m);
});

test('a lint run with a model provider but a fake reviewer merges model findings', async () => {
  const config = loadConfig('examples/copy-lint.json');
  const reviewer = async () => ({ findings: [{ id: 0, rule: 'headlines', severity: 'warning', message: 'Too much hype', suggestion: 'Lights that follow your music' }] });
  const result = await lint({ config, reviewer });
  assert.ok(result.modelUsed);
  assert.ok(result.findings.some((f) => f.source === 'model' && f.suggestion === 'Lights that follow your music'));
});

test('CLI exits 1 on errors in rules-only mode', () => {
  let code = 0;
  try { execFileSync('node', ['bin/copy-lint.mjs', '-c', 'examples/copy-lint.json', '--rules-only'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});
