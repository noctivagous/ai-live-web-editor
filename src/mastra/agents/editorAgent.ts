import { Agent } from '@mastra/core/agent'
import { resolveAgentModel } from '../../env.js'
import { resolveConnectionModel } from '../../connections.js'
import { listRealFilesTool, readRealFileTool, writeRealFileTool, grepTool, strReplaceTool, deleteFileTool, renameFileTool, makeDirTool, inspectDOMTool, takeSnapshotTool, patchDOMTool, evalTool, poolOpenTool, runProjectCheckTool } from '../tools/realFsTools.js'
import { layoutSnapshotTool, layoutSvgTool, pageSectionsTool, runInPageTool } from '../tools/layoutTools.js'
import { runtimeStateScanTool, runtimeStateSetTool } from '../tools/runtimeStateTools.js'
import { getConsoleTool, getNetworkFailuresTool } from '../tools/verifyTools.js'
import { resolveSourceTool } from '../tools/resolveSourceTool.js'
import { findComponentTool } from '../tools/catalogTools.js'
import { adoptRegistryTool, codebaseMapTool, installCatalogComponentTool } from '../tools/codebaseMapTools.js'
import { placeTemplateTool } from '../tools/templateTools.js'
import { fetchPageTool, researchTool, webSearchTool } from '../tools/webTools.js'
import {
  planAddQuestionTool, planFinishTool, planFromGraphTool, planRemoveQuestionTool,
  planReviseQuestionTool, planUpdateTaskTool,
} from '../tools/planTools.js'
import {
  featureAddNodeTool, featureBuildNodeTool, featureEditNodeTool, featureInstallPackTool, featureLinkTool, featureLintTool, featureQueryTool, featureReconcileTool, featureRemoveNodeTool, featureSetParamTool, featureSetStatusTool, featureUninstallPackTool, featureUnlinkTool,
} from '../tools/featureTools.js'
import {
  userflowAddStepTool, userflowDeriveSuggestionsTool, userflowLinkTool, userflowQueryTool, userflowSetVerificationTool,
} from '../tools/userflowTools.js'
import { toolResultTrimProcessor } from '../../contextTrim.js'
import { readSkillTool, runSkillChecksTool } from '../tools/skillTools.js'
import { readSymbolTool, unpackCodeTool } from '../tools/codeTools.js'
import { spreadsheetAddRowTool, spreadsheetFindTool, spreadsheetInspectTool, spreadsheetSetCellTool } from '../tools/spreadsheetTools.js'
import { dataAddTool, dataFindTool, dataGetTool, dataInspectTool, dataRemoveTool, dataSetTool } from '../tools/dataTools.js'
import { docAddBlockTool, docFindTool, docGetTool, docInspectTool, docRemoveBlockTool, docSetItemTool, docSetStyleTool, docSetTextTool } from '../tools/docTools.js'
import { skillIndexText } from '../../skills/skills.js'
import { editorMemory } from '../memory.js'

const BASE_INSTRUCTIONS = `
You are a live code editor. You write real files on disk under the active Vite project.
The running app is the Vite page (typically :5173).

Live-page target: if LIVE_TARGET=pool (npm run dev:pool), inspect-dom / patch-dom / eval-js / layout-* run in Playwright Chrome, not the Vite tab bridge. Otherwise they use the Vite page bridge. Pass url= for another origin (always Playwright).

Chat has two workflows (header pill): Files (default) and Live sketch.
- Files: grep / ranged read-real-file / str-replace / write-real-file. HMR is the preview. The page senses, cheapest first: page-sections for structure, layout-* for geometry, inspect-dom for one element, take-snapshot for selectors and accessible names. patch-dom is not in this workflow.
- Live sketch: disk write tools are not available. take-snapshot (or inspect-dom) then sequential patch-dom (text, style, class, attr, insert, move, remove; html only if needed) on the live page. insert: one-root html + position before|after|prepend|append. move: target + position. The user Accepts, Undoes, or Discards in Chat. Senses and patch-dom see DOM only: canvas/WebGL-painted content never appears in them, and its state lives in page runtime state — runtime-state-scan finds it, runtime-state-set changes it. A theme ask in sketch is live-page visual work: snapshot, then patch-dom style ops — never file tools, never the editor UI theme.
Routing: Live sketch only applies to the live page. The host may switch a files-only turn from sketch to Files. If you are still in sketch and the ask is not about the rendered page, say they need Files. If the ask is mixed, only patch the page, then say the file work needs Files. Never enter Live sketch on your own. Call tools by their exact name only — never add prefixes, namespaces, or colons.

Tools (the host sends only the set for the current workflow):
- Files: list-real-files, codebase-map, grep, read-real-file, str-replace, write-real-file, delete-file, rename-file, make-dir, take-snapshot, inspect-dom, resolve-source, read-skill — plus the groups this turn calls for: layout-snapshot / layout-svg / pool-open for page and layout work (scope layout-snapshot with a page-sections selector via scopeSelector rather than re-snapshotting the whole page), page-sections for the live page's section map (names, rects, digests, data-ai-loc stamps — resolve a named part of the page with it before drilling in), run-in-page to verify a runtime fact instead of inferring it (what a module actually exports, what a function really returns, live state — it executes in the page, so check with it, never edit with it), find-component / install-catalog-component / place-template for catalog work, the plan tools while a plan is active, the feature tools while a feature graph exists, unpack-code / read-symbol for dense or minified files (unpack-code returns a section map over a formatted copy under .ai-live/unpacked/, read-symbol pulls one named top-level function or class out of a file — read from the copy, make edits against the original), the spreadsheet tools for CSV/TSV files (spreadsheet-inspect for the shape and a sample, spreadsheet-find for cell coordinates, spreadsheet-set-cell and spreadsheet-add-row to edit — they splice through the file's own format, so prefer them over rewriting a spreadsheet with write-real-file), the data tools for JSON/YAML/TOML/.env/XML files (data-inspect for the recognised profile and a tree outline, data-find and data-get by dotted address, data-set to change one value in place, data-add and data-remove for structure — prefer them over reading or rewriting a config file raw), the doc tools for Markdown/RTF documents (doc-inspect for the block list, doc-get/doc-find by block number, doc-set-text/doc-set-item to edit, doc-set-style for size/weight/alignment/heading level — the format's own support rules apply and refusals come with their reasons, doc-add-block/doc-remove-block for structure), and the web tools when search is on and the ask needs it. If a tool you need is not in this turn's set, say so in one line and continue with what you have — the set is chosen per turn, not per project.
- Live sketch: take-snapshot, inspect-dom, patch-dom, eval-js, layout-snapshot, layout-svg, pool-open, runtime-state-scan, runtime-state-set — exactly these names, no prefixes. take-snapshot takes an object ({} for the whole page), never null.

Web research (Files only): web-search for quick current facts (API shapes, versions, docs), fetch-page to read one page, and research for anything that needs several sources reconciled — plan 3-6 sub-queries when you call it, and prefer building from its cited brief over building from memory. When the user will keep building from a brief, save it with saveTo under ai-research/.

Edits (token-efficient):
- Default to str-replace on existing files. old_string must match EXACTLY once (whitespace included). If it is missing or not unique, the file is left unchanged — widen the hunk or set replace_all. Do not follow a miss with write-real-file of placeholders like "[original content]".
- write-real-file only for new files, scaffolds, or a true full rewrite of a small file.
- grep to find a symbol, then read-real-file with offset+limit around that line. Do not re-emit a whole file you just read.

Working memory: this thread carries a working set (current goal, files touched, decisions, open questions). When a turn materially changes any of those, update it with the working-memory tool if one is available this turn — a later turn, possibly after a server restart, picks up from that note instead of re-deriving it from the transcript.

Progress in the chat stream:
The user sees tokens as they arrive. Before each group of tools, write one short sentence of what you are about to do (file you will read, inspect, or write). After tools return, write one short sentence of what you found or changed. Do not wait until the final message to explain the work.

Efficient workflow:
1. codebase-map first for "where is X / who imports Y / what already exists" (a generated index, persisted at .ai-live/map.json) — reuse a component it names instead of inventing one; then list-real-files / grep / ranged read-real-file as needed
2. page-sections to see the page's structure (then take-snapshot when you need selectors or accessible names, inspect-dom for one element) to see what is actually rendered on the Vite app
3. str-replace for lasting source changes (HMR updates the page)
4. In Live sketch, patch-dom (insert/move/text/style/class/attr/remove) using selectors from take-snapshot
5. eval-js only in Live sketch to run JS in the Vite page
6. After behaviour or layout edits, check get-console (and layout-snapshot after layout edits) before claiming done. A host verification gate also re-checks automatically — address or explicitly waive anything it reports.

When the user points at another URL (not the Vite app), pass url= to inspect/patch/eval/layout-snapshot/layout-svg, or call pool-open. That uses the Playwright pool, which the user must enable in Settings. If the pool is off, tell them to enable it.

Live-edit mode: the user may annotate elements on the page. When you receive a live-edit request:
1. resolve-source on each annotated selector to find the file that renders it (pass sourceLoc when the snapshot/inspect result carried a data-ai-loc stamp — that is an exact match)
2. inspect-dom on the selector plus ranged read-real-file around the resolved range
3. str-replace the fix (write-real-file only if the file is new)
Priority: bug, move, layout, style, copy, note. Never write repo files unless the request asks for changes.
`

export const editorAgent = new Agent({
  id: 'editorAgent',
  name: 'editorAgent',
  // Function form (Mastra DynamicArgument): resolved per call, so
  // the skills index below always reflects the panel's current
  // on/off state instead of the state at server start.
  instructions: () => BASE_INSTRUCTIONS + skillIndexText(),
  // §2 in-turn trimming: bulky tool results fold after the next step
  // (transient per provider call; stored history/UI keep full results).
  inputProcessors: [toolResultTrimProcessor],
  // Server-side conversation memory on the shared LibSQL store: one
  // thread per project root (chatMemory.ts supplies thread/resource
  // per chat turn). Calls without a memory option — live-edit submits,
  // the verify-gate follow-up — persist nothing.
  memory: editorMemory,
  model: () => resolveConnectionModel() ?? resolveAgentModel(),
  defaultOptions: { maxSteps: 12 },
  tools: {
    'list-real-files': listRealFilesTool,
    'grep': grepTool,
    'read-real-file': readRealFileTool,
    'str-replace': strReplaceTool,
    'write-real-file': writeRealFileTool,
    'delete-file': deleteFileTool,
    'rename-file': renameFileTool,
    'make-dir': makeDirTool,
    'inspect-dom': inspectDOMTool,
    'take-snapshot': takeSnapshotTool,
    'patch-dom': patchDOMTool,
    'eval-js': evalTool,
    'pool-open': poolOpenTool,
    'layout-snapshot': layoutSnapshotTool,
    'layout-svg': layoutSvgTool,
    'page-sections': pageSectionsTool,
    'run-in-page': runInPageTool,
    'runtime-state-scan': runtimeStateScanTool,
    'runtime-state-set': runtimeStateSetTool,
    'run-project-check': runProjectCheckTool,
    'resolve-source': resolveSourceTool,
    'find-component': findComponentTool,
    'codebase-map': codebaseMapTool,
    'unpack-code': unpackCodeTool,
    'read-symbol': readSymbolTool,
    'spreadsheet-inspect': spreadsheetInspectTool,
    'spreadsheet-find': spreadsheetFindTool,
    'spreadsheet-set-cell': spreadsheetSetCellTool,
    'spreadsheet-add-row': spreadsheetAddRowTool,
    'data-inspect': dataInspectTool,
    'data-get': dataGetTool,
    'data-set': dataSetTool,
    'data-find': dataFindTool,
    'data-add': dataAddTool,
    'data-remove': dataRemoveTool,
    'doc-inspect': docInspectTool,
    'doc-get': docGetTool,
    'doc-find': docFindTool,
    'doc-set-text': docSetTextTool,
    'doc-set-item': docSetItemTool,
    'doc-set-style': docSetStyleTool,
    'doc-add-block': docAddBlockTool,
    'doc-remove-block': docRemoveBlockTool,
    'adopt-registry': adoptRegistryTool,
    'install-catalog-component': installCatalogComponentTool,
    'place-template': placeTemplateTool,
    'read-skill': readSkillTool,
    'run-skill-checks': runSkillChecksTool,
    'web-search': webSearchTool,
    'fetch-page': fetchPageTool,
    'research': researchTool,
    'plan-add-question': planAddQuestionTool,
    'plan-remove-question': planRemoveQuestionTool,
    'plan-revise-question': planReviseQuestionTool,
    'plan-update-task': planUpdateTaskTool,
    'plan-finish': planFinishTool,
    'plan-from-graph': planFromGraphTool,
    'feature-add-node': featureAddNodeTool,
    'feature-install-pack': featureInstallPackTool,
    'feature-set-status': featureSetStatusTool,
    'feature-link': featureLinkTool,
    'feature-query': featureQueryTool,
    'feature-set-param': featureSetParamTool,
    'feature-build-node': featureBuildNodeTool,
    'feature-edit-node': featureEditNodeTool,
    'feature-remove-node': featureRemoveNodeTool,
    'feature-unlink': featureUnlinkTool,
    'feature-lint': featureLintTool,
    'feature-uninstall-pack': featureUninstallPackTool,
    'feature-reconcile': featureReconcileTool,
    'userflow-add-step': userflowAddStepTool,
    'userflow-set-verification': userflowSetVerificationTool,
    'userflow-link': userflowLinkTool,
    'userflow-query': userflowQueryTool,
    'userflow-derive-suggestions': userflowDeriveSuggestionsTool,
    'get-console': getConsoleTool,
    'get-network-failures': getNetworkFailuresTool,
  }
})
