/**
 * ALE's own agents on the OpenCode engine (re-platform slice 7).
 *
 * Until this slice, OpenCode turns ran OpenCode's DEFAULT build
 * agent: none of ALE's behavioural contract, and every registered
 * tool offered on every turn. This module defines the two
 * ALE-authored agents the generated config carries — `ale-files`
 * and `ale-sketch` — and derives EVERYTHING about them from the
 * existing sources of truth, so the two engines cannot drift:
 *
 *   INSTRUCTIONS — derived from BASE_INSTRUCTIONS
 *   (src/mastra/agents/editorAgent.ts) by a structural filter at
 *   config-generation time: the shared text is kept verbatim, the
 *   OTHER workflow's lines/blocks are dropped (see
 *   deriveAgentInstructions for the exact rules). The skill index
 *   is appended exactly as the Mastra agent composes it
 *   (skillIndexText()). One source: edit BASE_INSTRUCTIONS and
 *   both engines' agents change.
 *
 *   TOOL POLICY — src/agentTools.ts stays the policy source. The
 *   per-turn allowed set is COMPUTED by its own functions
 *   (fileToolsForTurn for Files, SKETCH_ACTIVE_TOOLS for Sketch);
 *   this module only turns an allowed set into OpenCode
 *   permission rules (deny everything else the plugin registered).
 *   Derivation tests pin the equality so a hand-copied second
 *   policy can never sneak in.
 *
 * Enforcement is layered, strongest first (all verified live
 * against the pinned OpenCode 2.2.6 server with a recording stub
 * provider — see the slice-7 notes):
 *   1. Agent permissions in the generated config (the route
 *      boundary): a deny rule HIDES the tool from the provider
 *      request AND blocks a hallucinated call server-side
 *      ("No tool named X is currently available"); the tool's
 *      execute never runs. Plugin tools are matched by bare tool
 *      name; natives by their action names (edit covers the
 *      edit/write tools).
 *   2. Per-turn session permissions: the translator PATCHes the
 *      session's permission list before every prompt with the
 *      exact deny set for THIS turn's computed tool set (the
 *      patch REPLACES the session list, verified live). This is
 *      what expresses the signal-dependent subsets within Files
 *      (plan/graph/research groups) — with the same hide+block
 *      semantics as layer 1.
 *   3. The plugin's tool.execute.before hook as backstop
 *      (opencode/toolPolicy.ts): at execution time the plugin
 *      asks the host whether this session's current turn allows
 *      the tool, and throws to deny. It covers any prompt path
 *      that reached execution with stale session permissions;
 *      layers 1–2 mean it should never fire in practice.
 *
 * Native-tool stance (the owner's slice-5 default — OpenCode as
 * itself — bounded by each workflow's own contract):
 *   - ale-files: natives untouched. ALE's fs tools stay the
 *     aleFsTools opt-in override (slice 5), nothing more.
 *   - ale-sketch: the sketch contract ("disk write tools are not
 *     available" — BASE_INSTRUCTIONS) denies the native write
 *     surface at the agent level: `edit` (edit/write tools),
 *     `shell` (can write files), and `execute` (Code Mode — a
 *     code-execution channel has no place in a patch-the-page
 *     workflow; page JS is eval-js's job). Read-only natives
 *     (read/glob/grep), web reads and question stay.
 *   The two sketch-only ALE tools (patch-dom, eval-js) are denied
 *   on ale-files at the agent level — the mirror boundary.
 *
 * `console-expect` is in neither agentTools set (on this branch
 * the tool exists only on the OpenCode path); it joins a turn's
 * allowed set exactly when the "Check console errors" setting is
 * on — the only turns where the translator opens an expectation
 * scope for its declarations to land in.
 */
import { createHash } from 'node:crypto'
import {
  fileToolsForTurn, FILE_ACTIVE_TOOLS, SKETCH_ACTIVE_TOOLS, type FilesTurnSignals,
} from '../agentTools.js'
import { skillIndexText } from '../skills/skills.js'
import type { SketchMode } from '../sketchSession.js'

export const ALE_FILES_AGENT = 'ale-files'
export const ALE_SKETCH_AGENT = 'ale-sketch'

/** The agent id for a turn's (routed) workflow mode. */
export function agentIdForMode(mode: SketchMode): string {
  return mode === 'sketch' ? ALE_SKETCH_AGENT : ALE_FILES_AGENT
}

/**
 * Every tool name the ALE plugin can register — the universe the
 * deny rules are computed over. The plugin's inventory IS the
 * agentTools universe (its waves port the editorAgent tool set
 * name for name) plus console-expect, which exists only on this
 * path — so the universe is FILE_ACTIVE_TOOLS ∪ SKETCH_ACTIVE_TOOLS
 * ∪ {console-expect}, derived here without importing the handler
 * modules into the supervisor's graph. The derivation tests pin
 * this list against the plugin's actual handler tables, so a tool
 * added on either side without the other fails the suite. Slice 8:
 * the conditionally-registered override groups (fs / web /
 * read-skill) shrink the universe the translator computes deny
 * rules over — see registeredToolUniverse below.
 */
export const ALE_TOOL_UNIVERSE: readonly string[] = [
  ...new Set<string>([...FILE_ACTIVE_TOOLS, ...SKETCH_ACTIVE_TOOLS, 'console-expect']),
]

const UNIVERSE_SET: ReadonlySet<string> = new Set(ALE_TOOL_UNIVERSE)

/**
 * The conditionally-registered tool groups (slice 8 generalizes
 * slice 5's fs mechanism): each group overlaps an OpenCode native
 * and registers only when its agent-settings override toggle is
 * on. The names are literals here — agents.ts stays out of the
 * handler modules' import graph — and the pin tests compare them
 * against the handler tables (FS_TOOL_NAMES / WEB_TOOL_NAMES /
 * PROJECT_TOOL_NAMES) so a rename on either side fails the suite.
 */
export const ALE_FS_TOOL_GROUP: readonly string[] = [
  'list-real-files', 'grep', 'read-real-file', 'str-replace', 'write-real-file',
  'delete-file', 'rename-file', 'make-dir', 'run-project-check',
]
/** web-search/fetch-page overlap the native websearch/webfetch;
 * research has no native counterpart but is built on the same
 * backends and gated as one set by agentTools, so it travels
 * with its primitives (see the aleWebTools setting). */
export const ALE_WEB_TOOL_GROUP: readonly string[] = ['web-search', 'fetch-page', 'research']
/** read-skill overlaps the native skill tool; run-skill-checks
 * has no native counterpart and is never grouped. */
export const ALE_SKILL_TOOL_GROUP: readonly string[] = ['read-skill']

export interface AleToolToggles {
  fs: boolean
  web: boolean
  skill: boolean
}

/**
 * The tool universe for one spawn's toggles: the full universe
 * minus the groups that spawn did not register. Deny rules are
 * computed over THIS set on the OpenCode path — a deny rule for
 * an unregistered tool would be inert, but computing over the
 * registered set keeps the per-turn policy exactly the tools the
 * model could ever reach (the pin tests assert the equality per
 * toggle combination).
 */
export function registeredToolUniverse(toggles: AleToolToggles): string[] {
  const off = new Set<string>([
    ...(toggles.fs ? [] : ALE_FS_TOOL_GROUP),
    ...(toggles.web ? [] : ALE_WEB_TOOL_GROUP),
    ...(toggles.skill ? [] : ALE_SKILL_TOOL_GROUP),
  ])
  return ALE_TOOL_UNIVERSE.filter((name) => !off.has(name))
}

export interface PermissionRule {
  action: string
  resource: string
  effect: 'allow' | 'deny' | 'ask'
}

function denyRule(action: string): PermissionRule {
  return { action, resource: '*', effect: 'deny' }
}

/**
 * The per-turn deny rules for an allowed set: one rule per
 * registered ALE tool NOT in the set, sorted for determinism.
 * Pure — the pin tests compare its output against agentTools'
 * computed sets directly. `universe` defaults to the full
 * inventory; the translator passes the spawn's registered
 * universe (registeredToolUniverse) so unregistered override
 * groups never enter the policy at all.
 */
export function turnDenyRules(allowed: Iterable<string>, universe: readonly string[] = ALE_TOOL_UNIVERSE): PermissionRule[] {
  const keep = new Set(allowed)
  return universe.filter((name) => !keep.has(name)).sort().map(denyRule)
}

/** A Files turn's allowed ALE tools, computed by agentTools. */
export function filesTurnAllowed(signals: FilesTurnSignals, consoleCheckOn: boolean): string[] {
  const tools = fileToolsForTurn(signals)
  return consoleCheckOn ? [...tools, 'console-expect'] : tools
}

/** A Sketch turn's allowed ALE tools: the fixed sketch set. */
export function sketchTurnAllowed(consoleCheckOn: boolean): string[] {
  return consoleCheckOn ? [...SKETCH_ACTIVE_TOOLS, 'console-expect'] : [...SKETCH_ACTIVE_TOOLS]
}

/** The allowed ALE tools for one turn, by routed mode. */
export function turnAllowedTools(
  mode: SketchMode,
  signals: FilesTurnSignals,
  consoleCheckOn: boolean,
): string[] {
  return mode === 'sketch' ? sketchTurnAllowed(consoleCheckOn) : filesTurnAllowed(signals, consoleCheckOn)
}

/* ------------------------------------------------------------------ */
/* Instruction derivation                                              */
/* ------------------------------------------------------------------ */

/** Blocks (blank-line separated) that belong to ONE workflow: the
 * block is dropped for the other workflow's agent when its first
 * line starts with one of these prefixes. */
const FILES_ONLY_BLOCK_PREFIXES = [
  'Web research (Files only):',
  'Edits (token-efficient):',
  'Live-edit mode:',
]
/** Bullet lines that belong to one workflow, dropped for the other. */
const FILES_ONLY_LINE_PREFIXES = ['- Files:']
const SKETCH_ONLY_LINE_PREFIXES = ['- Live sketch:']
/** Numbered lines inside the "Efficient workflow:" block that
 * belong to one workflow (grep/str-replace steps are Files work;
 * the patch-dom / eval-js steps are Sketch work). */
const FILES_ONLY_EFFICIENT_LINES = ['1. ', '3. ']
const SKETCH_ONLY_EFFICIENT_LINES = ['4. ', '5. ']

/**
 * Derive one workflow's agent system text from BASE_INSTRUCTIONS.
 * Structural, not editorial: surviving lines are byte-identical to
 * the source, in source order; only whole lines/blocks that belong
 * to the other workflow are dropped —
 *   - the "- Files:" / "- Live sketch:" bullets (both places),
 *   - the Files-only blocks (Web research, Edits, Live-edit mode)
 *     for the sketch agent,
 *   - the mode-specific numbered steps of "Efficient workflow:".
 * Everything else — the intro, the routing paragraph, working
 * memory, progress, the step budget, the other-URL note — is the
 * shared contract and stays on both agents. If BASE_INSTRUCTIONS
 * is restructured, the marker-string tests in agents.test.ts fail
 * loudly rather than letting the derivation silently rot.
 */
export function deriveAgentInstructions(base: string, mode: SketchMode): string {
  const dropBlockPrefixes = mode === 'sketch' ? FILES_ONLY_BLOCK_PREFIXES : []
  const dropLinePrefixes = mode === 'sketch' ? FILES_ONLY_LINE_PREFIXES : SKETCH_ONLY_LINE_PREFIXES
  const dropEfficient = mode === 'sketch' ? FILES_ONLY_EFFICIENT_LINES : SKETCH_ONLY_EFFICIENT_LINES
  const out: string[] = []
  let inEfficientBlock = false
  for (const block of base.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const first = lines.find((l) => l.trim().length > 0) ?? ''
    if (dropBlockPrefixes.some((p) => first.startsWith(p))) continue
    inEfficientBlock = first.startsWith('Efficient workflow:')
    const kept = lines.filter((line) => {
      if (dropLinePrefixes.some((p) => line.startsWith(p))) return false
      if (inEfficientBlock && dropEfficient.some((p) => line.startsWith(p))) return false
      return true
    })
    if (kept.some((l) => l.trim().length > 0)) out.push(kept.join('\n'))
  }
  return out.join('\n\n')
}

/** BASE_INSTRUCTIONS, loaded lazily: editorAgent.ts constructs
 * the Mastra agent (and its memory store) at import time, and the
 * supervisor's static import graph (the launcher imports it) must
 * not grow that weight. The dynamic import runs once, when an
 * OpenCode server is actually being spawned — in the API process,
 * where the agent stack is already at home. */
let baseInstructionsCache: string | null = null
export async function loadBaseInstructions(): Promise<string> {
  if (baseInstructionsCache === null) {
    const mod = await import('../mastra/agents/editorAgent.js')
    baseInstructionsCache = mod.BASE_INSTRUCTIONS
  }
  return baseInstructionsCache
}

/* ------------------------------------------------------------------ */
/* The generated-config agents fragment                                */
/* ------------------------------------------------------------------ */

export interface AleAgentsFragment {
  agents: Record<string, Record<string, unknown>>
  default_agent: string
  /** Stable hash of the fragment, for the supervisor's respawn
   * fingerprint: when the instructions change (a skill toggled in
   * the panel changes the skill index), the sidecar respawns with
   * the fresh config — the OpenCode-path analogue of the Mastra
   * agent resolving its instructions per call. */
  hash: string
}

/**
 * Build the `agents` fragment of the generated OpenCode config:
 * the two ALE agents with their derived instructions (BASE
 * derivation + the skill index, composed exactly as the Mastra
 * agent composes them), the step cap mirroring the Mastra path's
 * maxSteps (chatStream's CHAT_MAX_STEPS = 12), and the route
 * boundary as agent permissions (layer 1 above).
 */
export async function buildAleAgentsFragment(): Promise<AleAgentsFragment> {
  const base = await loadBaseInstructions()
  const skillIndex = skillIndexText()
  const agents: Record<string, Record<string, unknown>> = {
    [ALE_FILES_AGENT]: {
      description: 'ALE Files workflow: edit the project on disk (grep, read, replace, write) with the page senses for the live app.',
      mode: 'primary',
      system: deriveAgentInstructions(base, 'files') + skillIndex,
      steps: 12,
      permissions: ['patch-dom', 'eval-js'].map(denyRule),
    },
    [ALE_SKETCH_AGENT]: {
      description: 'ALE Live Sketch: patch the live page in place (snapshot, then patch-dom). No disk writes — the user accepts, undoes or discards.',
      mode: 'primary',
      system: deriveAgentInstructions(base, 'sketch') + skillIndex,
      steps: 12,
      permissions: ['edit', 'shell', 'execute'].map(denyRule),
    },
  }
  const hash = createHash('sha256')
    .update(JSON.stringify(agents))
    .digest('hex')
    .slice(0, 16)
  return { agents, default_agent: ALE_FILES_AGENT, hash }
}

/** Universe sanity for the derivation tests: every name agentTools
 * can compute is a name the plugin can register. */
export function universeCovers(name: string): boolean {
  return UNIVERSE_SET.has(name)
}
