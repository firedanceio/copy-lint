// Copyright 2026 Firedance Multimedia LLC
// SPDX-License-Identifier: Apache-2.0
//
// Optional "sounds human" checks. None of these prove anything about who wrote a text; they flag
// habits that make copy read as generic or machine-written, so a person can add real detail.

/** Phrases that read as filler or machine-written. Whole-word, case-insensitive. */
export const STOCK_PHRASES = [
  'delve', 'delves', 'tapestry', 'testament to', 'embark on', 'navigate the', 'in the realm of',
  "in today's fast-paced", 'in today’s fast-paced', 'ever-evolving', 'game-changer', 'game changer', 'game-changing',
  'unlock', 'unleash', 'elevate', 'supercharge', 'seamless', 'seamlessly', 'effortlessly', 'harness the power',
  'take it to the next level', 'look no further', "let's dive", 'let’s dive', 'dive into', 'dive in',
  "it's worth noting", 'it’s worth noting', 'it is worth noting', 'whether you\'re', 'whether you’re',
  'the best part?', 'in conclusion', 'at the end of the day', 'when it comes to', 'a wide range of',
  'plays a crucial role', 'crucial role', 'robust', 'cutting-edge', 'state-of-the-art', 'revolutionize',
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STOCK_RES = STOCK_PHRASES.map((p) => ({ phrase: p, re: new RegExp(`(^|\\W)${escape(p)}(?=\\W|$)`, 'i') }));

export const DEFAULTS = {
  minWordsForStats: 150, // shorter pieces are too small to judge rhythm or voice
  minRhythmVariation: 0.4, // stdev / mean of sentence length per file
  maxBoldLeadBullets: 3, // "- **Label:** text" lines per file
  minFirstPersonPer100Words: 0.4, // "we", "our", "I"... (set to 0 to turn off)
};

const sentencesOf = (text) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘])/).map((s) => s.trim()).filter((s) => /\w/.test(s));

/**
 * @param {import('./extract.mjs').Unit[]} units
 * @param {Partial<typeof DEFAULTS> | true} options
 * @param {Record<string, string>} [sources]  Raw file contents by unit file name (for bullet checks).
 * @returns {import('./rules.mjs').Finding[]}
 */
export function checkAuthenticity(units, options = true, sources = {}) {
  const o = { ...DEFAULTS, ...(options === true ? {} : options) };
  const findings = [];
  const warn = (file, line, rule, message, suggestion) =>
    findings.push({ file, line, rule, severity: 'warning', source: 'rule', message, ...(suggestion ? { suggestion } : {}) });

  for (const u of units) {
    for (const { phrase, re } of STOCK_RES) {
      if (re.test(u.text)) warn(u.file, u.line, 'stock-phrase', `"${phrase}" reads as filler or machine-written`, 'Say the specific thing instead');
    }
  }

  const byFile = new Map();
  for (const u of units) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file).push(u);
  }
  for (const [file, list] of byFile) {
    const body = list.filter((u) => u.text.split(/\s+/).length >= 6); // skip headings and labels
    const text = body.map((u) => u.text).join(' ');
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < o.minWordsForStats) continue;
    const first = body[0]?.line ?? 1;

    const lengths = body.flatMap((u) => sentencesOf(u.text)).map((s) => s.split(/\s+/).length);
    if (lengths.length >= 8) {
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / (lengths.length - 1));
      const variation = sd / mean;
      if (variation < o.minRhythmVariation) {
        warn(file, first, 'rhythm', `Sentences are all about the same length (variation ${variation.toFixed(2)}, aim for ${o.minRhythmVariation}+)`,
          'Mix in some very short sentences and a few longer ones');
      }
    }

    if (o.minFirstPersonPer100Words > 0) {
      const firstPerson = (text.match(/\b(we|we're|we've|we'd|our|ours|us|I|I'm|I've|my)\b/gi) ?? []).length;
      const rate = (firstPerson / words) * 100;
      if (rate < o.minFirstPersonPer100Words) {
        warn(file, first, 'first-person', `No first-hand voice (${firstPerson} first-person words in ${words})`,
          'Add what you actually tried, saw or got wrong');
      }
    }

    const source = sources[file];
    if (source) {
      const bold = source.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => /^\s*[-*+]\s+\*\*[^*]+\*\*/.test(l));
      if (bold.length > o.maxBoldLeadBullets) {
        warn(file, bold[0][1], 'bold-bullets', `${bold.length} bullets start with a bold label; lists like that read as templated`,
          'Turn some into sentences, or drop the bold labels');
      }
    }
  }
  return findings;
}

/** Added to the model's instructions when authenticity checks are on. */
export const AUTHENTICITY_GUIDE = `
## Sounding human (copy-lint authenticity check)

Also flag lines that read as generic or machine-written: claims anyone could make about any product,
tidy three-part lists, stock transitions ("Here's how", "The best part?", "In short"), and summaries
that repeat what was just said. In the suggestion, keep the meaning and make it specific: a concrete
detail, a number, something the writer actually did or saw. Never invent facts or experiences in a
suggestion; if a line needs a real detail the text doesn't contain, say so in the message instead.`;
