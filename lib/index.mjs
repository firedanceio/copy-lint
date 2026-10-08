// Copyright 2026 Firedance Multimedia LLC
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { extract } from './extract.mjs';
import { checkRules } from './rules.mjs';
import { AUTHENTICITY_GUIDE, checkAuthenticity } from './authenticity.mjs';
import { reviewWithModel } from './review.mjs';
import { reviewerFromEnv } from './providers.mjs';

export { extract } from './extract.mjs';
export { checkRules } from './rules.mjs';
export { checkAuthenticity, STOCK_PHRASES } from './authenticity.mjs';
export { reviewWithModel } from './review.mjs';
export { anthropicReviewer, openAiCompatibleReviewer, reviewerFromEnv } from './providers.mjs';

export const DEFAULT_INCLUDE = ['**/*.{md,mdx,html,astro,vue,svelte}'];
const ALWAYS_EXCLUDE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

/** Read copy-lint.json (if present) and resolve paths relative to it. */
export function loadConfig(path = 'copy-lint.json') {
  const file = resolve(path);
  if (!existsSync(file)) return { root: process.cwd() };
  const config = JSON.parse(readFileSync(file, 'utf8'));
  return { ...config, root: dirname(file) };
}

/** Files to lint: explicit paths, or the config's include globs. */
export async function findFiles(paths, config) {
  const root = config.root ?? process.cwd();
  const patterns = paths?.length ? paths : config.include ?? DEFAULT_INCLUDE;
  const exclude = [...ALWAYS_EXCLUDE, ...(config.exclude ?? [])];
  const files = new Set();
  for (const p of patterns) {
    if (existsSync(resolve(root, p)) && !/[*?{[]/.test(p)) {
      files.add(resolve(root, p));
      continue;
    }
    for await (const f of glob(p, { cwd: root, exclude })) files.add(resolve(root, f));
  }
  return [...files].sort();
}

/**
 * Lint copy. Rules always run; the model review runs when a provider is configured and a style
 * guide is available.
 * @returns {Promise<{ findings: import('./rules.mjs').Finding[], files: number, lines: number, warnings: string[], modelUsed: boolean }>}
 */
export async function lint({ paths = [], config = loadConfig(), provider, model, effort, reviewer, rulesOnly = false } = {}) {
  const warnings = [];
  const root = config.root ?? process.cwd();
  const files = await findFiles(paths, config);
  const units = [];
  const sources = {};
  for (const f of files) {
    const name = relative(process.cwd(), f) || f;
    sources[name] = readFileSync(f, 'utf8');
    units.push(...extract(sources[name], name));
  }

  const findings = checkRules(units, config);
  if (config.authenticity) findings.push(...checkAuthenticity(units, config.authenticity, sources));
  let modelUsed = false;
  if (!rulesOnly) {
    const guidePath = config.guide ? resolve(root, config.guide) : null;
    const r = reviewer ?? reviewerFromEnv({ provider: provider ?? config.provider, model: model ?? config.model, effort });
    if (r && !guidePath) warnings.push('No style guide set ("guide" in copy-lint.json); skipped the model review.');
    else if (r && !existsSync(guidePath)) warnings.push(`Style guide not found: ${config.guide}; skipped the model review.`);
    else if (r && units.length) {
      const guide = readFileSync(guidePath, 'utf8') + (config.authenticity ? AUTHENTICITY_GUIDE : '');
      findings.push(...(await reviewWithModel(units, guide, r, { onWarning: (w) => warnings.push(w) })));
      modelUsed = true;
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { findings, files: files.length, lines: units.length, warnings, modelUsed };
}

export function format(result, style = 'text') {
  if (style === 'json') return JSON.stringify(result, null, 2);
  if (style === 'github') {
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    return result.findings
      .map((f) => `::${f.severity === 'error' ? 'error' : 'warning'} file=${f.file},line=${f.line},title=copy-lint (${esc(f.rule)})::${esc(f.message + (f.suggestion ? `\nSuggestion: ${f.suggestion}` : ''))}`)
      .join('\n');
  }
  const lines = result.findings.map((f) => `${f.file}:${f.line}  ${f.severity.padEnd(7)} ${f.rule}  ${f.message}${f.suggestion ? `\n    -> ${f.suggestion}` : ''}`);
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  lines.push(`\n${result.files} file(s), ${result.lines} line(s) of copy: ${errors} error(s), ${result.findings.length - errors} warning(s)${result.modelUsed ? '' : ' (rules only)'}`);
  return lines.join('\n');
}
