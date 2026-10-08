// Copyright 2026 Firedance Multimedia LLC
// SPDX-License-Identifier: Apache-2.0
//
// Model review: send copy to the chosen model in batches with the style guide, map findings back
// to file and line.

const SYSTEM = `You review user-facing copy (website, app and marketing text) against the style guide below.

Report only clear breaks of the guide. A line that follows the guide gets no finding, even if you
would phrase it differently. Judge each line in the context of its neighbours from the same file.
For every finding give a rewrite of the whole line that follows the guide and keeps its meaning and
facts. Use "error" when the guide says never or must, "warning" otherwise.

<style_guide>
{GUIDE}
</style_guide>`;

/** Split units into batches small enough for one request each. */
export function batches(units, { maxUnits = 120, maxChars = 8000 } = {}) {
  const out = [];
  let current = [];
  let chars = 0;
  for (const u of units) {
    if (current.length && (current.length >= maxUnits || chars + u.text.length > maxChars)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(u);
    chars += u.text.length;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * @param {import('./extract.mjs').Unit[]} units
 * @param {string} guide  Style guide text (Markdown).
 * @param {import('./providers.mjs').Reviewer} reviewer
 * @param {{ onWarning?: (msg: string) => void, concurrency?: number }} [opts]
 * @returns {Promise<import('./rules.mjs').Finding[]>}
 */
export async function reviewWithModel(units, guide, reviewer, opts = {}) {
  const system = SYSTEM.replace('{GUIDE}', guide.trim());
  const groups = batches(units);
  const findings = [];
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  let next = 0;
  async function worker() {
    while (next < groups.length) {
      const group = groups[next++];
      const lines = group.map((u, i) => ({ id: i, file: u.file, text: u.text }));
      try {
        const reply = await reviewer({ system, user: `Review these lines:\n${JSON.stringify(lines, null, 1)}` });
        for (const f of reply.findings ?? []) {
          const u = group[f.id];
          if (!u || typeof f.message !== 'string') continue; // ignore ids the model made up
          findings.push({
            file: u.file, line: u.line, rule: String(f.rule || 'style'),
            severity: f.severity === 'error' ? 'error' : 'warning', source: 'model',
            message: f.message, ...(f.suggestion && f.suggestion !== u.text ? { suggestion: f.suggestion } : {}),
          });
        }
      } catch (e) {
        opts.onWarning?.(`model review skipped ${group.length} line(s) from ${group[0].file}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  return findings;
}
