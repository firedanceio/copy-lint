#!/usr/bin/env node
// Copyright 2026 Firedance Multimedia LLC
// SPDX-License-Identifier: Apache-2.0

import { parseArgs } from 'node:util';
import { format, lint, loadConfig } from '../lib/index.mjs';

const HELP = `copy-lint: check copy against your style guide

Usage: copy-lint [files or globs...] [options]

  -c, --config <file>     Config file (default: copy-lint.json)
      --provider <name>   anthropic | openai | ollama | openai-compatible | none
  -m, --model <name>      Model to use (default for anthropic: claude-opus-5-5)
      --effort <level>    Anthropic effort: low | medium | high (default: medium)
      --rules-only        Skip the model review
  -f, --format <style>    text | json | github (default: text; github in GitHub Actions)
      --max-warnings <n>  Fail when there are more warnings than this (default: no limit)
  -h, --help

Keys come from the environment: ANTHROPIC_API_KEY, OPENAI_API_KEY or COPY_LINT_API_KEY, and
COPY_LINT_BASE_URL for OpenAI-compatible servers (Ollama: http://localhost:11434/v1).`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c' },
    provider: { type: 'string' },
    model: { type: 'string', short: 'm' },
    effort: { type: 'string' },
    'rules-only': { type: 'boolean' },
    format: { type: 'string', short: 'f' },
    'max-warnings': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

try {
  const result = await lint({
    paths: positionals,
    config: loadConfig(values.config),
    provider: values.provider,
    model: values.model,
    effort: values.effort,
    rulesOnly: values['rules-only'],
  });
  for (const w of result.warnings) console.error(`copy-lint: ${w}`);
  const style = values.format ?? (process.env.GITHUB_ACTIONS ? 'github' : 'text');
  const out = format(result, style);
  if (out) console.log(out);
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const warnings = result.findings.length - errors;
  const maxWarnings = values['max-warnings'] == null ? Infinity : Number(values['max-warnings']);
  process.exit(errors > 0 || warnings > maxWarnings ? 1 : 0);
} catch (e) {
  console.error(`copy-lint: ${e.message}`);
  process.exit(2);
}
