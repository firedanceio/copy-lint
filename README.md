# copy-lint

Check the words on your website and in your app against **your own style guide**. Fast rule checks
catch banned words, em dashes, long sentences and anything you can write as a pattern. Then the
model of your choice reads the copy against the guide and suggests rewrites for the lines that
break it.

Example output, with one rule finding and one model finding:

```text
page.html:2  error   banned     Avoid "unlock"
    -> Say what the person can now do
page.html:4  error   headlines  Action screens say what the person is doing, not ask a question
    -> Pair device
```

- **Your guide, in plain Markdown.** No rule syntax to learn for the parts a model can judge.
- **Your model, your key.** Claude, OpenAI, or anything that speaks the OpenAI Chat Completions
  API: Ollama, LM Studio, OpenRouter, vLLM. Run fully local if you like.
- **Rules work without any model.** Use `--rules-only` in CI where you don't want API calls.
- **CLI and GitHub Action.** Findings show up as annotations on pull requests.

## Quick start

```sh
npm install -g github:firedanceio/copy-lint
```

1. Write your style guide, e.g. `STYLE.md` (see [examples/STYLE.md](examples/STYLE.md)).
2. Add `copy-lint.json`:
   ```json
   {
     "guide": "STYLE.md",
     "include": ["src/**/*.{md,mdx,astro,html}"],
     "banned": ["seamless", { "phrase": "unlock", "suggestion": "Say what they can now do" }, "—"],
     "patterns": [{ "pattern": "^[^.!]*\\?$", "message": "No questions as headlines" }],
     "maxSentenceWords": 30
   }
   ```
3. Run it:
   ```sh
   copy-lint                 # rules + model review
   copy-lint --rules-only    # no model, no key needed
   copy-lint src/pages/about.astro
   ```

## Choosing a model

| Provider | Set | Example |
|---|---|---|
| Claude (default when `ANTHROPIC_API_KEY` is set) | `ANTHROPIC_API_KEY` | `copy-lint` (uses `claude-opus-5-5`; `--model` to change, `--effort low` to save cost) |
| OpenAI | `OPENAI_API_KEY` | `copy-lint --provider openai --model <model>` |
| Ollama | nothing | `copy-lint --provider ollama --model llama3.1` |
| Any OpenAI-compatible server | `COPY_LINT_BASE_URL`, optional `COPY_LINT_API_KEY` | `COPY_LINT_BASE_URL=http://localhost:1234/v1 copy-lint --provider openai-compatible --model <model>` |

Keys are read from the environment only and never written to disk or output. Claude requests go
through the official Anthropic SDK with structured output, so findings come back as valid JSON;
if Claude's safety checks decline a batch, the API retries it on a recommended fallback model.
For other providers copy-lint asks for JSON and parses it defensively. A batch that fails is
reported and skipped, never guessed.

## What it reads

| Files | Copy taken from |
|---|---|
| `.md`, `.mdx` | Prose, headings, list items, link text, front matter `title`/`description`/`summary` |
| `.html`, `.astro`, `.vue`, `.svelte` | Text between tags, plus `alt`, `title`, `aria-label`, `placeholder` |
| anything else | Each non-empty line |

Code blocks, scripts, styles and comments are skipped. Findings point at the source file and line.

## GitHub Action

```yaml
- uses: firedanceio/copy-lint@0.1.0
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  with:
    config: copy-lint.json
    max-warnings: 10
```

Leave out the key (or set `rules-only: 'true'`) to run only the rule checks.

## Options

```text
-c, --config <file>     Config file (default: copy-lint.json)
    --provider <name>   anthropic | openai | ollama | openai-compatible | none
-m, --model <name>      Model to use
    --effort <level>    Anthropic effort: low | medium | high (default: medium)
    --rules-only        Skip the model review
-f, --format <style>    text | json | github
    --max-warnings <n>  Fail when there are more warnings than this
```

Exit codes: `0` clean, `1` errors (or too many warnings), `2` couldn't run.

## From JavaScript

```js
import { lint, loadConfig } from 'copy-lint';
const { findings } = await lint({ config: loadConfig('copy-lint.json') });
```

## Licence

Apache-2.0. Made by [Firedance](https://firedance.io), where it keeps our site and app copy in our
own voice.
