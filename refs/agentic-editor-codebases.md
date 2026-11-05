# Related agentic code editors

People have already solved surgical edits and context blow-up. This note
surveys the open (and documented) codebases that matter for this product, and
what to copy vs skip.

Companion: [agent-context-and-edits.md](./agent-context-and-edits.md).

## Why look

This editor is a **one-project Vite app**, not a 10k-file monorepo. The same
two problems still show up:

1. Whole-file write is slow and token-heavy (`write-real-file`).
2. One agent run fills the window with tool dumps; chat currently sends no
   history.

The field has converged on a small set of answers. Utilize those, not a full
IDE-agent stack.

## Edit tools — the field has converged

Almost every serious agent uses **exact-match search/replace** plus **full
write for new files**. Unified `apply_patch` is a second format, used when
the model is trained on it.

| Project | Edit API | Notes |
|---|---|---|
| [Aider](https://aider.chat/docs/more/edit-formats.md) | `whole` / `diff` SEARCH/REPLACE / `udiff` | Default for capable models is SEARCH/REPLACE. `whole` only for weak models or tiny files. Fail closed if SEARCH does not match. |
| [Cline](https://cline.bot/blog/improving-diff-edits-by-10) | `write_to_file` + `replace_in_file` | Prompt: **default to replace**. Full write for create / huge rewrites. They spent a year raising `diffEditSuccess`; fallback to full write can **corrupt** files if the model emits `[original content here]`. |
| [OpenHands](https://docs.openhands.dev/sdk/guides/llm-gpt5-preset) | `FileEditorTool` (`str_replace`) or `ApplyPatchTool` for GPT-5 | Anthropic-style: `old_str` must match **exactly once**. Clip long tool output. |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent/blob/main/tools/edit_anthropic/bin/str_replace_editor) | `str_replace_editor`: view / create / str_replace / insert / undo | `insert` is line-based. OpenHands issue: models copy **line numbers from `cat -n` into old_str** and miss. |
| Codex / GPT-5 | `apply_patch` (*** Begin Patch) | Use when the model is trained on it. Cline even **swapped GPT-5 off apply_patch** back to replace/write for some configs. |
| [editkit](https://www.npmjs.com/package/editkit) | TS port of Aider parsers | SEARCH/REPLACE, unified diff, whole-file, fuzzy whitespace. Useful if we parse blocks instead of native tools. |

**Copy for us:** native tools `str-replace` (unique exact match, fail if 0 or
>1) + keep `write-real-file` for create/scaffold. Prompt: default to
str-replace on existing files. Return a short snippet around the edit, not
the whole file. Do **not** fall back to a hallucinated full rewrite when
replace misses — return the error and let the model retry.

**Skip:** line-number insert as the primary API (HMR and user edits shift
lines). Fuzzy match as the first path (silent wrong edit). Aider-style
fenced blocks in the *assistant text* — we already have Mastra native tools.

Cline’s lesson: when replace fails, **do not** let the model `write_to_file`
with placeholders. That is how files get truncated.

## Context — three different jobs, often mixed up

### A. Related context (what to send *this* turn)

| Project | Mechanism | Fit here |
|---|---|---|
| [Aider repo map](https://aider.chat/2023/10/22/repomap.html) | tree-sitter signatures + graph rank, token budget (`--map-tokens`) | Overkill for a 6-file Lumen app. The *idea* (signatures, not bodies) is right if the workspace grows. |
| Continue | `@file` / `@folder` / `@search` (ripgrep); agent **tools** replaced `@Codebase` RAG | Same as us: let the agent grep/read, do not auto-embed the repo. Continue even **deprecated** `@Codebase` in favor of tools + rules. |
| Cline / Roo | `list_files`, `search_files`, `read_file`; user `@file` mentions | Matches our list/read/inspect. Add grep. |
| Claude Code | `CLAUDE.md` (user rules) + auto memory files on disk | A short project `AGENTS.md` / editor instructions we already have in the agent prompt. Optional later: a tiny `.ai-session.md`. |

**Copy:** last few **text** turns + active/touched paths + last selector.
Grep + ranged read instead of stuffing file bodies into the system prompt.
Skip vector RAG and tree-sitter maps until there are hundreds of files.

### B. In-turn tool-result trim (the real “manager”)

| Project | Mechanism |
|---|---|
| OpenHands / Anthropic editor | Long tool output marked `<response clipped>` |
| Roo Code | [Smart Code Folding](https://github.com/minouris/ai-tools-analysis/blob/main/analyses/roo-cline.md): when full, keep signatures of recently touched files (~50k char budget) |
| OpenHands | Event-history **condenser** (not a second chat agent) |

**Copy:** clip `inspect-dom` HTML and full-file reads after the next step.
Mastra `processToolResult` / output processors. No extra agent.

### C. Session compact (only with a long thread)

| Project | Mechanism |
|---|---|
| [Roo Code](https://deepwiki.com/RooCodeInc/Roo-Code/7.3-context-window-management) | Condense (summarize old turns) then sliding-window truncate. Keep last N + system. They **removed** a separate condensing model because tool-call/reasoning blobs are provider-specific. |
| Claude Code | `/compact` summarizes; re-injects CLAUDE.md from disk; re-reads up to 5 recently edited files. Lossy. Community [rolling-context](https://github.com/NodeNestor/claude-rolling-context) only compresses *old* turns. |
| Continue | Rules in `.continue/rules`; no giant session by default |

**Copy later:** if chat persists, keep last ~4 text turns + a 20-line working
set (files touched, what changed). Summarize the rest. Re-read disk files
after compact rather than trusting the summary of their contents.

We do **not** send history today, so C is unused until Chat posts prior turns.

## Codebases worth reading (implementation)

- Aider `editblock_coder.py` — exact match, whitespace, `...` elision rules.
- Cline `replace_in_file` + `editing_files.ts` prompt — tool split and
  “default to replace”.
- OpenHands / SWE-agent `str_replace_editor` — unique `old_str`, clip, undo.
- Roo `src/core/context-management` + `condense` — when to summarize vs drop.
- Continue indexing README — tagging/content-addressing; we do not need
  LanceDB.

TypeScript shortcut: [editkit](https://www.npmjs.com/package/editkit) if we
ever parse SEARCH/REPLACE from model text. Native Mastra tools are simpler.

## What we should actually take

1. **Tools (now):** `grep`, ranged `read-real-file`, `str-replace` (exact,
   unique, fail closed). Keep `write-real-file` for new files. Never
   placeholder-full-write on replace miss.
2. **Prompt:** same Cline paragraph — default replace; full write for create
   or total rewrite.
3. **Related context (soon):** last few text turns + paths + last inspect
   selector. Tools fetch bytes.
4. **Trim (soon):** clip bulky tool results in the Mastra run.
5. **Skip for now:** embeddings, tree-sitter repo map, second compaction
   agent, apply_patch unless we pin a Codex/GPT-5-native path, line-number
   insert as the main edit API.

## Links

- https://aider.chat/docs/more/edit-formats.md
- https://aider.chat/2023/10/22/repomap.html
- https://dev.to/gabrielanhaia/exact-match-edits-vs-patches-how-claude-code-codex-and-aider-write-to-your-files-45d1
- https://cline.bot/blog/improving-diff-edits-by-10
- https://raw.githubusercontent.com/cline/cline/10cbbb2c6b387bc56dc5ab68a16a2c7cf405a43a/src/core/prompts/system-prompt/components/editing_files.ts
- https://docs.openhands.dev/sdk/guides/llm-gpt5-preset
- https://github.com/SWE-agent/SWE-agent/blob/main/tools/edit_anthropic/bin/str_replace_editor
- https://deepwiki.com/RooCodeInc/Roo-Code/7.3-context-window-management
- https://continue-docs.mintlify.app/guides/codebase-documentation-awareness
- https://claude.com/blog/using-claude-code-session-management-and-1m-context
- https://www.npmjs.com/package/editkit
