// Copyright 2026 Firedance Multimedia LLC
// SPDX-License-Identifier: Apache-2.0
//
// Fast, model-free checks: banned words and phrases, regex patterns, sentence length.

/**
 * @typedef {{ file: string, line: number, rule: string, severity: 'error'|'warning', message: string, suggestion?: string, source: 'rule'|'model' }} Finding
 * @typedef {{ banned?: (string|{ phrase: string, suggestion?: string, severity?: string })[], patterns?: { pattern: string, flags?: string, message: string, suggestion?: string, severity?: string }[], maxSentenceWords?: number }} RuleConfig
 */

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {import('./extract.mjs').Unit[]} units @param {RuleConfig} config @returns {Finding[]} */
export function checkRules(units, config = {}) {
  const findings = [];
  const banned = (config.banned ?? []).map((b) => (typeof b === 'string' ? { phrase: b } : b));
  const bannedRes = banned.map((b) => ({
    ...b,
    // Whole words for words; anywhere for punctuation such as an em dash.
    re: /^[\w\s'-]+$/.test(b.phrase) ? new RegExp(`\\b${escape(b.phrase)}\\b`, 'i') : new RegExp(escape(b.phrase)),
  }));
  const patterns = (config.patterns ?? []).map((p) => ({ ...p, re: new RegExp(p.pattern, p.flags ?? 'i') }));

  for (const u of units) {
    for (const b of bannedRes) {
      if (b.re.test(u.text)) {
        findings.push({ file: u.file, line: u.line, rule: 'banned', severity: b.severity ?? 'error', source: 'rule',
          message: `Avoid "${b.phrase}"`, ...(b.suggestion ? { suggestion: b.suggestion } : {}) });
      }
    }
    for (const p of patterns) {
      if (p.re.test(u.text)) {
        findings.push({ file: u.file, line: u.line, rule: 'pattern', severity: p.severity ?? 'warning', source: 'rule',
          message: p.message, ...(p.suggestion ? { suggestion: p.suggestion } : {}) });
      }
    }
    if (config.maxSentenceWords) {
      for (const sentence of u.text.split(/(?<=[.!?])\s+/)) {
        const words = sentence.split(/\s+/).filter(Boolean).length;
        if (words > config.maxSentenceWords) {
          findings.push({ file: u.file, line: u.line, rule: 'sentence-length', severity: 'warning', source: 'rule',
            message: `Sentence has ${words} words (limit ${config.maxSentenceWords})` });
        }
      }
    }
  }
  return findings;
}
