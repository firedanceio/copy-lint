// Copyright 2026 Firedance Multimedia LLC
// SPDX-License-Identifier: Apache-2.0
//
// Pull human-readable copy out of files, one unit per line of text, keeping line numbers.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&mdash;': '—', '&ndash;': '–' };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);

/**
 * @typedef {{ file: string, line: number, text: string }} Unit
 */

/** Markdown / MDX: prose lines, skipping front matter, code fences, HTML comments and link URLs. */
export function fromMarkdown(source, file) {
  const units = [];
  const lines = source.split('\n');
  let inFence = false;
  let inFrontMatter = lines[0]?.trim() === '---';
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (inFrontMatter) {
      if (i > 0 && line.trim() === '---') inFrontMatter = false;
      // Front matter titles and descriptions are copy too.
      const m = line.match(/^(title|summary|description|subtitle|headline):\s*["']?(.+?)["']?\s*$/i);
      if (m) units.push({ file, line: i + 1, text: m[2] });
      return;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence || /^\s*(import|export)\s/.test(line)) return;
    const text = line
      .replace(/<!--.*?-->/g, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>)\s+/, '')
      .replace(/[*_`]{1,3}/g, '')
      .trim();
    if (/[A-Za-z]{2,}/.test(text)) units.push({ file, line: i + 1, text: decode(text) });
  });
  return units;
}

/** HTML-like files (HTML, Astro, Vue, Svelte): text between tags plus alt/title/aria-label/placeholder. */
export function fromMarkup(source, file) {
  const units = [];
  // Blank out blocks that aren't copy, keeping newlines so line numbers stay right.
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  let s = source
    .replace(/^---\n[\s\S]*?\n---/, blank) // Astro front matter (component script)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  const lineAt = (index) => s.slice(0, index).split('\n').length;
  for (const m of s.matchAll(/\b(alt|title|aria-label|placeholder)="([^"{}]+)"/gi)) {
    if (/[A-Za-z]{2,}/.test(m[2])) units.push({ file, line: lineAt(m.index), text: decode(m[2].trim()) });
  }
  for (const m of s.matchAll(/>([^<>]+)</g)) {
    const text = m[1].replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]{2,}/.test(text)) units.push({ file, line: lineAt(m.index + 1 + m[1].search(/\S/)), text: decode(text) });
  }
  return units.sort((a, b) => a.line - b.line);
}

export function extract(source, file) {
  if (/\.(md|mdx|markdown)$/i.test(file)) return fromMarkdown(source, file);
  if (/\.(html?|astro|vue|svelte)$/i.test(file)) return fromMarkup(source, file);
  // Plain text: every non-empty line.
  return source.split('\n').map((t, i) => ({ file, line: i + 1, text: t.trim() })).filter((u) => /[A-Za-z]{2,}/.test(u.text));
}
