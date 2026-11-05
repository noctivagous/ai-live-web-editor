# Agent edit tools and context policy

Notes from product discussion: surgical file edits for token efficiency, and
whether to add a related-context / compaction manager.

Current tools live in `src/mastra/tools/realFsTools.ts` and
`src/mastra/agents/editorAgent.ts`. Chat sends a single user line plus
`Current file:` (`src/ui/components/Chat.tsx`). There is no Mastra Memory and
no conversation history on the wire.

## 1. Surgical select / insert tools

**Verdict:** yes. Whole-file `write-real-file` is the token leak as soon as
files are more than a screen or two.

Lasting edits today are: **read the whole file** (capped at 20k chars) then
**write the whole file back**. The model has to emit every character of
`content` in the tool call. That is why a small copy or CSS change still sits
on `write-real-file /App.jsx` while thousands of tokens stream. `patch-dom`
only changes the live DOM; it does not save source.

### What pays for itself

1. **`str-replace` (highest value)**  
   `path` + unique `old_string` + `new_string` (+ optional `replace_all`).
   Same shape Cursor / Claude Code / Aider use. The model sends only the
   changed hunk. Fail if `old_string` is missing or not unique so it cannot
   silently edit the wrong place.

2. **`read-real-file` with `offset` / `limit`**  
   So it can pull ~80 lines around a component instead of the whole module.
   Pair with a cheap **`grep`** (path + pattern → line hits) so it does not
   reread the file to find the hunk.

3. **Keep `write-real-file`** for new files and first scaffolds.

### Weaker for token use

- **Line-number insert/delete** — line numbers drift the moment HMR or the
  user edits.
- **A “select in Monaco” tool** — useful as a *user* gesture (annotate already
  does “this element”), not as the model’s edit API.
- **AST / range tools** — extra machinery; unique-string replace covers almost
  all UI edits.

### Practical set

Later: `grep`, ranged `read-real-file`, `str-replace`, keep full write.
Prefer `str-replace` in the agent instructions for existing files.

Lumen is still small enough that full writes work; the cost shows up as soon
as `App.jsx` is a real app.

## 2. Related context / compaction manager

**Verdict:** yes for a **small working-set policy**. No for a standalone
“compaction manager” product until chat actually has a long thread.

Each Send is one user line plus `Current file: …`. There is no history, no
Mastra Memory, and no related-file pack. The model forgets the last turn. The
token blow-up is **inside a single run**: `read-real-file` returns up to 20k
chars, then `write-real-file` streams the whole file back. Compacting old chat
does not fix that.

Do this in three layers, in this order:

### Layer 1 — Related context (cheap, do soon)

Pack a short header on every request, not file bodies:

- last few **text** turns (drop tool dumps)
- active path + a few other open/touched paths
- last inspect selector / annotation, if any

Let tools fetch bytes. Annotate already does this well
(`src/live-edit/annotationAnalysis.ts` `buildLiveEditPrompt`). Chat should do
the same instead of a one-shot message.

### Layer 2 — In-turn compaction (this is the real manager)

Trim what stays in the 12-step window (`maxSteps: 12`):

- ranged read + `str-replace` so results stay small
- drop or clip huge tool results after the next step (`inspect-dom` HTML,
  full file reads)
- keep `write-real-file` for new files only

Mastra processors (`processToolResult` / output processors) are the right
hook. A second agent that “manages context” is extra latency for the same job.

### Layer 3 — Session compact (later)

Only after you persist a thread (Mastra Memory or a project `.ai-session.md`):

- keep last ~4 turns + a 20-line working set (files touched, what changed,
  open questions)
- summarize the rest when the window gets tight

Until people chat for tens of turns on one project, that layer is unused.

### Summary

A **working-set + tool-result trimmer**, wired into the existing agent, not a
related-context/compaction service. Surgical edit tools first; then send a few
text turns + paths; then clip tool payloads.

## Suggested order of work

1. `str-replace` + ranged `read-real-file` + `grep`
2. Chat sends last few text turns + active/touched paths
3. Clip or drop bulky tool results inside the Mastra run
4. Persistent thread + session summary only if long chats become real

## Related codebases

Survey of Aider, Cline, OpenHands, SWE-agent, Roo, Continue, Claude Code:
[agentic-editor-codebases.md](./agentic-editor-codebases.md).
