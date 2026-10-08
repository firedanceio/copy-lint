// Copyright 2026 Firedance Multimedia LLC
// SPDX-License-Identifier: Apache-2.0
//
// Model providers. Bring your own model and key:
//   anthropic  Claude through the official Anthropic SDK (ANTHROPIC_API_KEY or an `ant auth` profile)
//   openai     any OpenAI-compatible Chat Completions endpoint: OpenAI, Ollama, LM Studio,
//              OpenRouter, vLLM... (COPY_LINT_BASE_URL, COPY_LINT_API_KEY or OPENAI_API_KEY)
// Keys are read from the environment and never written anywhere.

import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** JSON schema every provider is asked to fill. */
export const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The id of the line the finding is about' },
          rule: { type: 'string', description: 'Short name of the style-guide rule broken' },
          severity: { type: 'string', enum: ['error', 'warning'] },
          message: { type: 'string', description: 'What is wrong, in one sentence' },
          suggestion: { type: 'string', description: 'A rewrite of the line that follows the guide' },
        },
        required: ['id', 'rule', 'severity', 'message', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

/** Pull the first JSON object out of model text (models sometimes wrap it in a code fence). */
export function parseJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model reply had no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * @typedef {{ system: string, user: string }} Prompt
 * @typedef {(prompt: Prompt) => Promise<{ findings: any[] }>} Reviewer
 */

/** @returns {Reviewer} */
export function anthropicReviewer({ model = DEFAULT_ANTHROPIC_MODEL, effort = 'medium', client } = {}) {
  const anthropic = client ?? new Anthropic();
  return async ({ system, user }) => {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 16000,
      // If a safety classifier declines, the API retries on a recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema: FINDINGS_SCHEMA } },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(`model declined to review this batch (${response.stop_details?.category ?? 'no category'})`);
    }
    if (response.stop_reason === 'max_tokens') throw new Error('model reply was cut off; review fewer files at once');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return parseJsonObject(text);
  };
}

/** @returns {Reviewer} */
export function openAiCompatibleReviewer({ model, baseUrl, apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!model) throw new Error('Set the model to use, e.g. --model <name> or COPY_LINT_MODEL');
  const url = `${(baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
  return async ({ system, user }) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${system}\n\nReply with a JSON object matching this schema and nothing else:\n${JSON.stringify(FINDINGS_SCHEMA)}` },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return parseJsonObject(data.choices?.[0]?.message?.content ?? '');
  };
}

/** Pick a provider from options and environment. Returns null for rules-only runs. */
export function reviewerFromEnv(opts = {}, env = process.env) {
  const provider = (opts.provider ?? env.COPY_LINT_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY || env.COPY_LINT_BASE_URL ? 'openai' : 'none')).toLowerCase();
  const model = opts.model ?? env.COPY_LINT_MODEL;
  if (provider === 'none') return null;
  if (provider === 'anthropic') return anthropicReviewer({ model, effort: opts.effort ?? env.COPY_LINT_EFFORT });
  if (provider === 'openai' || provider === 'ollama' || provider === 'openai-compatible') {
    const baseUrl = opts.baseUrl ?? env.COPY_LINT_BASE_URL ?? (provider === 'ollama' ? 'http://localhost:11434/v1' : undefined);
    return openAiCompatibleReviewer({ model, baseUrl, apiKey: env.COPY_LINT_API_KEY ?? env.OPENAI_API_KEY });
  }
  throw new Error(`Unknown provider "${provider}". Use anthropic, openai, ollama, openai-compatible or none.`);
}
