/**
 * ai-live-editor's OpenCode plugin (re-platform slices 1–4).
 *
 * This file is an ASSET, not part of the editor's own runtime: the
 * generated OpenCode config names this directory in its `plugins`
 * array, and the OpenCode server (Bun) loads it from here. It must
 * stay free of Node-only APIs and of imports besides
 * `@opencode/plugin` (resolved from the editor repo's node_modules).
 *
 * Slice 1 registered get-console; slice 2 added the wave-1 page
 * senses (take-snapshot, inspect-dom, page-sections,
 * layout-snapshot, layout-svg) and page actuation (patch-dom,
 * eval-js, run-in-page, pool-open); slice 3 adds wave 2 —
 * get-network-failures and resolve-source through the same
 * dispatch, plus console-expect on its own endpoint. Tool names,
 * descriptions and input schemas mirror the Mastra originals
 * (src/mastra/tools/realFsTools.ts + layoutTools.ts +
 * verifyTools.ts + resolveSourceTool.ts) so prompting and
 * instructions carry over unchanged. Every execute is one HTTP
 * call back into the editor host, so all bridge/pool plumbing and
 * result shaping stay in the editor where they already live:
 * get-console POSTs /api/page/console (slice 1); the wave-1 and
 * wave-2 dispatch tools POST { tool, input } to /api/page/tool
 * (handlers in opencode/pageTools.ts + opencode/verifyTools.ts);
 * console-expect POSTs /api/console/expect, a write into the
 * host's shared expectation registry that the translator checks
 * when the turn ends. Slice 4 adds wave 3 — the thirteen
 * feature-graph tools and five userflow tools — POSTing
 * { tool, input } to /api/graph/tool (handlers in
 * opencode/graphTools.ts, over the same graph stores the Mastra
 * tools and the editor UI share). Slice 5 (wave 4) completes the
 * inventory: group A — plans, skills, catalog/map/templates,
 * runtime-state, code tools — POSTs { tool, input } to
 * /api/project/tool (handlers in opencode/projectTools.ts);
 * group B — spreadsheet/data/doc tools to /api/data/tool, web
 * tools to /api/web/tool (handlers in opencode/contentTools.ts +
 * opencode/webTools.ts), and the ALE fs tools to /api/fs/tool
 * (handlers in opencode/fsTools.ts). The fs table was the first
 * conditional registration (slice 5): it is added only when the
 * supervisor spawned the server with ALE_OPENCODE_FS_TOOLS=1,
 * which it does only when the `aleFsTools` agent setting is on
 * (default off) — with the toggle off, the agent sees OpenCode's
 * native fs tools only and no ALE fs tool is registered at all.
 * Slice 8 generalizes the mechanism to the web group and
 * read-skill (see the registration notes at their tables).
 *
 * Failure rule: an unreachable or erroring host becomes tool
 * CONTENT (an ok:false / error JSON value), never a throw — the
 * agent reads the failure and can say so, exactly like the Mastra
 * tools' error values.
 *
 * Slice 7 adds ALE's own agents (ale-files / ale-sketch, defined
 * in the generated config from BASE_INSTRUCTIONS + agentTools —
 * see src/opencode/agents.ts) and per-turn tool gating. The
 * primary gating is OpenCode's permission machinery (agent rules
 * + the translator's per-turn session PATCH): denied tools are
 * hidden from the model and blocked server-side before any plugin
 * code runs. This plugin adds the BACKSTOP: a tool.execute.before
 * hook that, for ALE tools only, asks the editor host
 * (POST /api/opencode/tool-check) whether the session's current
 * turn allows the tool, and throws to deny when the host says no.
 * Host silence or an unreachable host never denies — the tool's
 * own execute reports host failures as content, as always.
 * Registration count: 65 unconditional (31 waves 1–3 incl.
 * get-console + console-expect, 16 of wave 4 group A, 18 wave 4
 * group B content), plus three OPT-IN override groups, each
 * gated by a supervisor spawn env from an agent setting (the
 * owner's OpenCode-as-itself default; Settings doors in slice
 * 8's Advanced subsection): the 9 fs tools on
 * ALE_OPENCODE_FS_TOOLS=1 (slice 5), the 3 web tools on
 * ALE_OPENCODE_WEB_TOOLS=1, and read-skill on
 * ALE_OPENCODE_SKILL_TOOLS=1 — 78 with every override on.
 *
 * `codemode: false` matters: without it, v2 exposes plugin tools
 * only as JavaScript inside the `execute` tool (Code Mode); ALE's
 * chat UI renders named tool calls, so the tools must be direct
 * function tools. Verified live against OpenCode 2.2.6.
 */
import { Plugin } from "@opencode/plugin"

/** Shared POST-and-stringify for a host callback. The labels keep
 * slice 1's get-console error wording exact ("the editor's console
 * endpoint…", "…for the console read:…") while the wave-1 tools
 * name themselves. */
async function callHost(url, body, { endpoint, call }, signal) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
    const data = await response.json().catch(() => null)
    return {
      content: JSON.stringify(
        data ?? { ok: false, error: `the editor's ${endpoint} endpoint answered HTTP ${response.status}` },
      ),
    }
  } catch (e) {
    return {
      content: JSON.stringify({
        ok: false,
        error: `could not reach the editor host for ${call}: ${e instanceof Error ? e.message : String(e)}`,
      }),
    }
  }
}

const presetEnum = { type: "string", enum: ["minimal", "layout", "standard", "debug", "typography", "paint"] }
const coordinateEnum = { type: "string", enum: ["viewport", "document"] }

/** The layout tools' shared fields — mirrors `snapshotFields` in
 * src/mastra/tools/layoutTools.ts. */
const snapshotFields = {
  selectors: { type: "array", items: { type: "string" }, description: "CSS selectors to include; omit for page-wide snapshot" },
  scopeSelector: { type: "string", description: "Only include elements under this selector" },
  maxTotal: { type: "integer", minimum: 1, maximum: 2000, description: "Max elements returned (default 300)" },
  includeComputedStyles: { type: "boolean", description: "Include layout computed styles (default true when clipping analysis is on)" },
  computedStylePreset: { ...presetEnum, description: "Style preset; default layout" },
  coordinateSpace: { ...coordinateEnum, description: "viewport (default) or document rects" },
  includeTextSnippets: { type: "boolean", description: "Include short text snippets per element" },
  includeOverlapAnalysis: { type: "boolean", description: "Detect overlapping rectangles (default true)" },
  includeGapAnalysis: { type: "boolean", description: "Detect gaps between siblings (default false)" },
  includeClippingAnalysis: { type: "boolean", description: "Detect overflow clipping (default true)" },
  analysisMaxFindings: { type: "integer", minimum: 1, maximum: 100, description: "Max findings per analysis type" },
  url: { type: "string", description: "Another origin: use the Playwright pool. Omit for the Vite app page bridge." },
}

/** Wave-1 page tools: name / description / JSONSchema input,
 * copied from the Mastra originals (zod → JSONSchema by hand;
 * property order and descriptions preserved). */
const PAGE_TOOLS = [
  {
    name: "take-snapshot",
    description:
      "Accessibility-style text snapshot of the live page (roles, names, CSS selectors) — the selector harvest for patch-dom, and the accessibility view. For page STRUCTURE use page-sections first (cheaper, semantic); snapshot when you need per-element selectors or accessible names, and scope it with scopeSelector when you only need one region. Use the selector on each line with patch-dom. verbose includes generic nodes. Snapshot sees DOM text only: canvas/WebGL-painted content never appears here — when the target text is absent, the content may be painted or in page runtime state (runtime-state-scan covers the stores). Pass url for the Playwright pool.",
    input: {
      type: "object",
      properties: {
        verbose: { type: "boolean", description: "Include generic nodes, not only landmarks/controls/headings" },
        scopeSelector: { type: "string", description: "Only snapshot under this selector" },
        url: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "inspect-dom",
    description:
      "Deep-dive ONE known element on the live page: capped HTML and text, rect, a child summary (count + tags, so you can tell a leaf from a subtree), and the data-ai-loc source stamp (sourceLoc) when the element carries one. This is the LAST step of the page senses, on one selector — for structure use page-sections first, for geometry layout-snapshot. Default: the Vite app page. Pass url (another origin) to use the optional Playwright pool.",
    input: {
      type: "object",
      properties: {
        selector: { type: "string" },
        url: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "page-sections",
    description:
      'Map the live page\'s semantic sections in one call: landmark regions (header/nav/main/section/article/aside/footer + ARIA roles) with names (heading or aria-label), rects, short text digests, element/interactive counts, and drill-in handles (selector, plus the data-ai-loc source stamp when present). Pages without landmarks fall back to structural chunks of the body\'s large children, and the result says so in its mode. Run this BEFORE layout-snapshot or inspect-dom when you need to find a named part of the page ("the pricing section") — then drill into that one section. Content painted on canvas/WebGL appears only as the canvas element itself — for the painted content, see runtime-state-scan. Read-only; runs on the page bridge, or in the Playwright pool when url is another origin.',
    input: {
      type: "object",
      properties: {
        url: { type: "string", description: "Another origin: use the Playwright pool. Omit for the Vite app page bridge." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "layout-snapshot",
    description:
      "Capture a layout-rectangle snapshot of the live Vite app (page bridge): element rects, layout styles, overlap analysis. This is the heavyweight page sense — for the geometry of ONE region, pass scopeSelector with a selector from page-sections instead of snapshotting the whole page; for structure and names rather than geometry, page-sections is cheaper. Pass url (another origin) to use the Playwright pool.",
    input: {
      type: "object",
      properties: { ...snapshotFields },
      additionalProperties: false,
    },
  },
  {
    name: "layout-svg",
    description:
      "Render an SVG wireframe of the live Vite app layout (page bridge). Pass url (another origin) to use the Playwright pool.",
    input: {
      type: "object",
      properties: {
        ...snapshotFields,
        scale: { type: "number", minimum: 0.1, maximum: 4, description: "SVG scale (default 1)" },
        showLabels: { type: "boolean", description: "Label each rect (default true)" },
        showDimensions: { type: "boolean", description: "Show width x height on rects" },
        showOverlaps: { type: "boolean", description: "Overlay overlap analysis (also enables it)" },
        showGaps: { type: "boolean", description: "Overlay gap analysis (also enables it)" },
        showClipping: { type: "boolean", description: "Overlay clipping analysis (also enables it)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "patch-dom",
    description:
      "Patch a live element. Ops: text, style, class, attr, html, insert, move, remove. insert needs html + position (before|after|prepend|append). move needs target + position. Cannot change canvas-painted pixels: painted content lives in page runtime state (runtime-state-scan finds it, runtime-state-set changes it). Recorded in Live sketch. Pass url for the Playwright pool.",
    input: {
      type: "object",
      properties: {
        selector: { type: "string" },
        op: { type: "string", enum: ["html", "text", "style", "attr", "class", "remove", "insert", "move"] },
        html: { type: "string", description: "For html/insert: fragment. insert must have exactly one root element." },
        text: { type: "string" },
        style: { type: "string" },
        className: { type: "string" },
        attr: {
          type: "object",
          properties: { name: { type: "string" }, value: { type: "string" } },
          required: ["name", "value"],
          additionalProperties: false,
        },
        target: { type: "string", description: "move: destination selector" },
        position: { type: "string", enum: ["before", "after", "prepend", "append"], description: "insert/move placement; default append" },
        url: { type: "string" },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "eval-js",
    description:
      "Run JavaScript in the live Vite app, or in the Playwright pool when url is another origin.",
    input: {
      type: "object",
      properties: {
        code: { type: "string" },
        url: { type: "string" },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "run-in-page",
    description:
      "Run JavaScript IN the live page to VERIFY a fact at runtime, and get a structured result back: {ok, value, console, error, elapsedMs}. The code is the body of an async function — use return to send a value back; await works; console output during the run is captured. Use it to check instead of inferring: what a module actually exports (await import(...)), what a function really returns for an input, live app state, whether an element is truly overflowing (el.scrollWidth > el.clientWidth). Unlike the other page senses this EXECUTES — it runs with the app's own powers in the app's own page (unsandboxed on purpose; a sandbox could not see the app) and it can change page state, so use it to check, never to edit (edits go through str-replace / patch-dom, and runtime state through runtime-state-set). A run that times out (10s) may keep running in the page. Values come back serialized safely: elements, functions and circular structures arrive as descriptions. Default: the Vite app; pass url for the Playwright pool.",
    input: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript statements; return the value to send back. Top-level await is available." },
        url: { type: "string" },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "pool-open",
    description:
      "Open a URL in the optional Playwright Chrome pool (headed, persistent profile). Requires Playwright pool enabled in Settings.",
    input: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
]

/** Wave-2 tools on the dispatch endpoint: name / description /
 * JSONSchema input, copied from the Mastra originals
 * (src/mastra/tools/verifyTools.ts + resolveSourceTool.ts). */
const VERIFY_TOOLS = [
  {
    name: "get-network-failures",
    description:
      "List failed network requests from the live page. Pool returns request-level failures; the Vite bridge only has timing-level data (labelled). Pass url for the Playwright pool.",
    input: {
      type: "object",
      properties: {
        maxEntries: { type: "integer", minimum: 1, maximum: 200, description: "Max entries (default 100)" },
        sinceSeq: { type: "integer", minimum: 0, description: "Only entries after this sequence number" },
        url: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "resolve-source",
    description:
      "Map a live-DOM selector (take-snapshot line, inspect-dom selector, annotate selector) to the source file/component that renders it. When the bridge returned a sourceLoc (dev-only data-ai-loc stamp), pass it for an exact match. Call this before grep when a selector needs a file. Fails closed when ambiguous.",
    input: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector from the live page (snapshot line, overlay, or stableId path)" },
        stableId: { type: "string", description: "Bridge stableId (id:foo or path:...) when known" },
        textSnippet: { type: "string", description: "Visible text of the element, if known" },
        classList: { type: "array", items: { type: "string" }, description: "Class tokens of the element, if known" },
        tagName: { type: "string", description: "Lowercase tag name, if known" },
        sourceLoc: {
          type: "object",
          properties: {
            file: { type: "string", description: "Project-relative stamp path, e.g. /src/App.jsx" },
            line: { type: "integer", minimum: 1, description: "1-based stamped line" },
          },
          required: ["file"],
          additionalProperties: false,
          description: "Exact join: bridge sourceLoc from the data-ai-loc stamp. Wins over heuristic anchors.",
        },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
]

const featureStatusEnum = { type: "string", enum: ["proposed", "planned", "building", "done", "verified", "blocked", "dropped", "suggested"] }
const featureEdgeEnum = { type: "string", enum: ["depends-on", "configures", "renders", "data-flows", "derived-from"] }

/** Wave-3 graph tools: name / description / JSONSchema input,
 * copied from the Mastra originals (src/mastra/tools/featureTools.ts
 * + userflowTools.ts; zod → JSONSchema by hand, property order,
 * descriptions and required fields preserved). All POST to the
 * graph dispatch, /api/graph/tool. */
const GRAPH_TOOLS = [
  {
    name: "feature-add-node",
    description:
      "Add ONE node to the project feature graph, in place (starts the graph when none exists). Regions group features; a node's parent is its region or containing feature. Bind premade work instead of describing it from scratch: component = a catalog tag, template = a template id, pack = a feature pack id, derivedFrom = the layout/template/pack the node derives from (the ladder: master-detail → settings screen → admin pack). Setting nodes carry params (the parameters they hold). Every other node stays exactly as it is — never rebuild the graph to add a node.",
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: "Node name, e.g. \"Checkout flow\", \"Currency\", \"Storefront\"" },
        kind: { type: "string", enum: ["region", "feature", "screen", "component", "setting", "data", "service"], description: "region | feature | screen | component | setting | data | service" },
        parentId: { type: "string", description: "Containing node id (a region for top features); omit for top level" },
        status: { ...featureStatusEnum, description: "Default proposed" },
        component: { type: "string", description: "Catalog component tag this node is built from" },
        template: { type: "string", description: "Catalog template id this node is built from" },
        pack: { type: "string", description: "Feature pack id this node arrived with" },
        derivedFrom: { type: "string", description: "Layout, template or pack id this node derives from / realizes" },
        params: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["text", "choice", "boolean", "color", "number"] },
              options: { type: "array", items: { type: "string" } },
              default: { type: "string" },
            },
            required: ["name", "type"],
            additionalProperties: false,
          },
          description: "Parameters, for setting nodes",
        },
        note: { type: "string" },
      },
      required: ["name", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-set-status",
    description:
      "Set one feature graph node's build status as work lands (proposed → planned → building → done → verified; blocked when something stops it, dropped when the user cuts it). Region progress is computed from the leaves, so only leaf/feature statuses need setting — never compute or store a region percentage yourself.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "The node id" },
        status: { ...featureStatusEnum },
      },
      required: ["id", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-link",
    description:
      "Link two feature graph nodes with a typed edge. depends-on: the source needs the target built first. configures: a setting/parameter node affects the target (this is how a settings window links to what it changes in the app). renders: a feature produces a screen. data-flows: data moves source → target. derived-from: the ladder — the source derives from / realizes a layout, template or pack node. Containment is NOT an edge: set parentId on feature-add-node instead.",
    input: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source node id" },
        to: { type: "string", description: "Target node id" },
        type: { ...featureEdgeEnum },
      },
      required: ["from", "to", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-install-pack",
    description:
      "Install a catalog feature pack (tier 3) into the project feature graph: the pack's subgraph is grafted in with fresh ids, every node bound to the pack and status proposed, its internal edges remapped, and its declared configures links wired to existing graph nodes whose names match. Links that match nothing come back as unwired with their role AND are recorded on the graph as pending links: they wire themselves when a node with a matching name is added or renamed later (the add/edit results report resolvedLinks when that happens); until then they can also be wired by hand with feature-link. Say which ones were left pending. Refuses a pack that is already installed. The graft is graph-only: afterwards, build the grafted features out in the returned build order (an install plan tracks this well) — feature-build-node places each node's bindings and parameter values; update node statuses as work lands.",
    input: {
      type: "object",
      properties: {
        packId: { type: "string", description: "The pack id from find-component, e.g. \"admin-configuration\"" },
        parentId: { type: "string", description: "Attach the pack's root nodes under this graph node (e.g. a region); omit for top level" },
      },
      required: ["packId"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-query",
    description:
      "Query the project feature graph before planning or building feature work. Modes: overview (regions + progress rollup), region (one node's subtree — pass id), status (nodes with a status — pass status, e.g. blocked), configures (what a setting node configures and what configures it — pass id), prerequisites (everything that must exist before a node, in build order — pass id), search (nodes by name — pass text), pending (pack links still waiting for a node whose name matches — they wire themselves when one appears).",
    input: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["overview", "region", "status", "configures", "prerequisites", "search", "pending"] },
        id: { type: "string", description: "Node id, for region / configures / prerequisites" },
        status: { ...featureStatusEnum, description: "For mode status" },
        text: { type: "string", description: "For mode search" },
      },
      required: ["mode"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-set-param",
    description:
      "Set one parameter value on a graph node, validated against the node's parameter schema (a choice must be one of its options, a boolean \"true\"/\"false\", a number numeric, a color a hex color). The value is stored on the node AND the node's effective values are rewritten to src/config/<node>.json — the file the built app reads — so the graph and the app never disagree about a setting. See a node's schema and current values with feature-query.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node id from feature-query or feature-add-node" },
        name: { type: "string", description: "Parameter name from the node's parameter schema" },
        value: { type: "string", description: "The new value, as a string (numbers and booleans included)" },
      },
      required: ["id", "name", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-build-node",
    description:
      "Start building one graph node: place its bindings into the project — a component binding is copy-installed from the catalog, a template binding is placed (both never replace an existing file; a repeat build reports \"already\") — seed its parameter values from defaults, write its effective values to src/config/<node>.json for the app to read, and move the node to building. Returns a per-binding report; a binding that cannot be placed reports an error for that binding only. After this, write the node's own code with the ordinary file tools, then mark it done with feature-set-status.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node id from feature-query or feature-add-node" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-edit-node",
    description:
      "Rename a graph node and/or move it: pass name to rename, parentId to reparent — or parentId: null to lift the node to the top level. Reparenting refuses anything that would create a containment cycle (the target is the node itself or inside its subtree). Only what you pass changes; use feature-query first when unsure of the shape.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node id from feature-query or feature-add-node" },
        name: { type: "string", description: "New name; omit to keep the current one" },
        parentId: { type: ["string", "null"], description: "New parent id; null = top level; omit = unchanged" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-remove-node",
    description:
      "Remove a node from the graph. mode \"lift\" (default): the node goes, its children move up to its parent, edges touching it are removed. mode \"cascade\": the node AND its whole subtree go. To remove a whole installed pack cleanly, prefer feature-uninstall-pack. Removal is structural only — files the nodes were built into stay in the project.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node id from feature-query or feature-add-node" },
        mode: { type: "string", enum: ["lift", "cascade"], description: "Default lift" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-unlink",
    description:
      "Remove ONE typed edge between two graph nodes (the inverse of feature-link) — e.g. a configures link that no longer holds, or a depends-on that was wrong. Reports when no such edge exists.",
    input: {
      type: "object",
      properties: {
        from: { type: "string", description: "Edge source node id" },
        to: { type: "string", description: "Edge target node id" },
        type: { ...featureEdgeEnum, description: "depends-on | configures | renders | data-flows | derived-from" },
      },
      required: ["from", "to", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-lint",
    description:
      "Check the feature graph for structural damage — the kind a hand edit to graph.json can cause: duplicate ids, parents or edge endpoints that no longer exist, containment cycles, depends-on cycles, unknown kinds/statuses, and parameter values that no longer fit their schema. Read-only: it reports problems with the nodes involved; fix them with feature-edit-node / feature-remove-node / feature-unlink / feature-set-param. Run it after any manual graph edit, or when a query result looks wrong.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "feature-uninstall-pack",
    description:
      "Remove an installed feature pack from the graph: every node the pack brought goes, with its edges. Host nodes parented under a pack node are kept and lifted to the nearest surviving ancestor. Graph-only — files a build-out already placed (components, templates, src/config values) stay in the project; uninstall retracts the map, not what was built from it.",
    input: {
      type: "object",
      properties: {
        packId: { type: "string", description: "The pack id, e.g. \"admin-configuration\" — installed packs show in feature-query overview via node pack bindings" },
      },
      required: ["packId"],
      additionalProperties: false,
    },
  },
  {
    name: "feature-reconcile",
    description:
      "Reconcile the feature graph (as-intended) against the project on disk (as-built): for every node marked done or verified, check that what it claims actually exists — a component binding's installed file (or a same-named component in the codebase map), a template binding's placed file, a parameterized node's src/config values file. Missing pieces come back as drift items with the node involved. Read-only: fix drift by re-placing with feature-build-node, correcting the status with feature-set-status, or restoring the file. Run it after deletions, renames, or when a \"done\" feature seems absent from the app.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "userflow-add-step",
    description:
      "Add ONE step to the project user flow graph, in place (starts the graph when none exists). Steps live in journeys (the graph's regions): pass the journey by name or id — a name that does not exist yet starts that journey. Step types: screen (what the user sees), action (what the user does), outcome (what should happen as a result). Steps start unverified; record how a step actually behaves with userflow-set-verification once it has been driven. Every other step stays exactly as it is — never rebuild the graph to add a step.",
    input: {
      type: "object",
      properties: {
        journey: { type: "string", description: "Journey name or id, e.g. \"Checkout\"" },
        name: { type: "string", description: "Step name, e.g. \"Cart page\", \"Pay with card\", \"Order confirmed\"" },
        type: { type: "string", enum: ["screen", "action", "outcome"], description: "screen | action | outcome" },
        note: { type: "string" },
      },
      required: ["journey", "name", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "userflow-set-verification",
    description:
      "Record how one user flow step actually behaved when driven: ok (it worked), blocked or error (it did not — pass blockKind, evidence and runId to say why: unreachable, missing-affordance, console-error, dead-end, state-blocked), or untested to reset it. Verifying ok (or resetting) clears any recorded block, so a block never outlives the state it described.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "The step id" },
        state: { type: "string", enum: ["untested", "ok", "blocked", "error"], description: "untested | ok | blocked | error" },
        blockKind: { type: "string", enum: ["unreachable", "missing-affordance", "console-error", "dead-end", "state-blocked"], description: "For blocked / error: what kind of block it was" },
        evidence: { type: "string", description: "What was seen — the console error text, the affordance that was missing" },
        runId: { type: "string", description: "The run that recorded this block" },
      },
      required: ["id", "state"],
      additionalProperties: false,
    },
  },
  {
    name: "userflow-link",
    description:
      "Link two user flow steps with a typed edge, or link a step to the feature behind it. navigates-to: the source step leads the user to the target. submits: the source sends a form / commits data at the target. branches-on: the flow forks on the target (a decision or state). requires: the source cannot happen until the target has (a state, an account, a prior step). exercises: the cross-graph link — from is a flow step, to is a FEATURE node id from the feature graph (feature-query finds them); this is how a step names the built features it uses. Containment is NOT an edge: a step's journey is set on userflow-add-step.",
    input: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source step id" },
        to: { type: "string", description: "Target step id — or, for type exercises, a feature node id" },
        type: { type: "string", enum: ["navigates-to", "submits", "branches-on", "requires", "exercises"], description: "navigates-to | submits | branches-on | requires | exercises" },
      },
      required: ["from", "to", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "userflow-derive-suggestions",
    description:
      "Reflect the user flow graph into the feature graph: derive dogfood suggestions from the steps' current records. Every blocked or error step yields a fix suggestion and every step exercising no feature yields a coverage suggestion — one per step, as feature nodes with status suggested in the \"Suggested by dogfooding\" region, carrying their provenance (source step, block kind, evidence, run). Deterministic and idempotent: live suggestions are not duplicated, a suggestion whose step has since verified ok is withdrawn, and suggestions the user dismissed are never offered again (a step blocking with a different kind is a new suggestion). Suggestions count toward nothing in the feature rollup until the user accepts one in the graph pane. Call this after recording a dogfood run's verifications so the run reflects into Features by itself; report the counts it returns.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "userflow-query",
    description:
      "Query the project user flow graph before planning user-facing work. Modes: overview (journeys + step counts + verification totals), journey (one journey's steps and their edges — pass id as a journey id or name), coverage (the two graphs read together: features no step exercises, steps exercising no feature, features sitting on blocked steps — needs the feature graph), search (steps by name — pass text).",
    input: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["overview", "journey", "coverage", "search"] },
        id: { type: "string", description: "Journey id or name, for mode journey" },
        text: { type: "string", description: "For mode search" },
      },
      required: ["mode"],
      additionalProperties: false,
    },
  },
]

/** Wave-4 group-A project tools: name / description / JSONSchema
 * input, copied from the Mastra originals (src/mastra/tools/
 * planTools.ts + skillTools.ts + catalogTools.ts +
 * codebaseMapTools.ts + templateTools.ts + runtimeStateTools.ts +
 * codeTools.ts). All POST to the project dispatch,
 * /api/project/tool (handlers in opencode/projectTools.ts). */
const PROJECT_TOOLS = [
  {
    name: "plan-add-question",
    description:
      'Add ONE question to the ACTIVE plan, in place. Use when the user asks to add/ask about something in the plan ("add a question about offline support"). Every other question, answer, note and task stays exactly as it is — never rebuild the plan to add a question. Always give the question a sensible default proposal (what happens if the user skips it).',
    input: {
      type: "object",
      properties: {
        label: { type: "string", description: "The question text" },
        control: { type: "string", enum: ["choice", "text"], description: "choice when there is a small set of options" },
        options: { type: "array", items: { type: "string" }, description: "Options for a choice question (2-5)" },
        defaultProposal: { type: "string", description: "What happens if the user does not answer" },
      },
      required: ["label", "defaultProposal"],
      additionalProperties: false,
    },
  },
  {
    name: "plan-remove-question",
    description:
      "Remove ONE question from the ACTIVE plan by its id (ids are in the plan summary in your brief, or read the plan file at ai-plans/<slug>.md). Use when the user asks to drop a question. Everything else in the plan is untouched.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: 'The question id, e.g. "qm3k…"' },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "plan-revise-question",
    description:
      "Revise ONE question in the ACTIVE plan in place — reword it, change its options, or replace its default proposal (e.g. in response to the user's note on it, or new information in chat). The user's existing answer and note on that question are preserved.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "The question id" },
        label: { type: "string", description: "New question text" },
        options: { type: "array", items: { type: "string" }, description: "New options (choice questions)" },
        defaultProposal: { type: "string", description: "New default proposal" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "plan-from-graph",
    description:
      "Generate a plan FROM the feature graph: pass a region/feature nodeId (its subtree) or an installed packId, and the plan's tasks are that subgraph's unbuilt nodes in depends-on order, each tied to its graph node. Already-built nodes are skipped and reported; unbuilt prerequisites outside the selection are pulled in. Marking these tasks doing/done with plan-update-task writes the node statuses back (building/done) automatically. Use this instead of drafting tasks from memory whenever the work is a region or pack the graph already describes.",
    input: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "A graph node id — plan its subtree (find ids with feature-query)" },
        packId: { type: "string", description: "An installed pack id — plan building out that pack" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "plan-update-task",
    description:
      'Update one task\'s status in the ACTIVE plan while executing it: mark it "doing" when you start it and "done" (with a one-line detail of what was produced) when it lands. The plan overlay and the plan file reflect this live.',
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "The task id (from the plan file / execute prompt)" },
        status: { type: "string", enum: ["todo", "doing", "done"] },
        detail: { type: "string", description: "One line: what was produced or found" },
      },
      required: ["id", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "plan-finish",
    description:
      "Finish executing the ACTIVE plan: writes the review summary (what was built, anything left open) and marks the plan done. Call after the last task is done.",
    input: {
      type: "object",
      properties: {
        summary: { type: "string", description: "The review summary: what shipped, what is left, anything the user should check" },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    name: "read-skill",
    description:
      "Load one skill's full body by name (skills are listed by one-liners in your instructions; bodies load only on trigger). Call this when the task in front of you matches a skill's description but its body was not auto-loaded — e.g. mid-turn you realise the work is a layout task, or the project uses a library a knowledge pack covers. Do not guess a skill body you have not loaded.",
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: 'Skill name from the index, e.g. "making-layouts"' },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "run-skill-checks",
    description:
      "Run a skill's declared result-verify criteria (its verify.json) against the live project and report a verdict per criterion: pass, fail, or couldn't-check, each with its evidence. Call this after work a skill guided, before claiming done — when the skill carries checks, its claims are only proven by running them. The same run doubles as an investigation: when a problem is reported (a layout broken somewhere, errors appearing), run the relevant skill's checks first — the verdicts name the viewport and the element at fault, which localises the fault before you change anything. Fix what fails, or report the failure honestly; never present a failed or unrun criterion as passed.",
    input: {
      type: "object",
      properties: {
        skill: { type: "string", description: 'Skill name whose criteria to run, e.g. "making-layouts"' },
      },
      required: ["skill"],
      additionalProperties: false,
    },
  },
  {
    name: "find-component",
    description:
      "Search the editor's catalog BEFORE building common UI from scratch, TOP-DOWN: feature packs first (tier 3 — whole features as portable subgraphs: admin/configuration, settings, printing, auth), then components (tier 1 — ready-made copy-own components in the NoctComponentMeta format), with templates (tier 2) placed via place-template. Buttons, dialogs, tabs, forms, settings pages, app shells, layout primitives, tables, segmented controls and the like live at tier 1. The default component stock is shadcn (React components, vendored at catalog/stock/shadcn). A second stock, the Noct AppKit (Lit elements, noct-* tags), is OFF by default: it is searched only when the project opts in (project.ai.json \"appkit\": true) or when you pass includeAppkit. Search returns compact summaries; pass a tag for one component's full entry (typed props, slots, emits, examples, source file), or a pack id for a pack's full subgraph (nodes, edges, parameter schemas, external links). An exact tag lookup resolves entries from either stock, including AppKit while that stock is off. When a pack matches the need, prefer installing the pack (an install plan grafting it into the feature graph) over assembling its pieces; when a component fits, prefer copying it into the project (install-catalog-component) over hand-rolling an equivalent.",
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: 'What you need, in words: "settings panel", "split panes", "data table", "admin configuration"' },
        tag: { type: "string", description: 'Exact component tag for its full catalog entry, e.g. "noct-app-settings" or "Button"' },
        pack: { type: "string", description: 'Exact feature pack id for its full subgraph, e.g. "admin-configuration"' },
        limit: { type: "integer", minimum: 1, maximum: 12, description: "Max component results (default 6)" },
        includeAppkit: { type: "boolean", description: "Also search the Noct AppKit (Lit) stock, which is off by default unless the project opts in" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "codebase-map",
    description:
      'Generated index of the active project: entry file, every source file\'s components/exports/renders/imports ranked by how imported they are, plus styles/token files — within a ~1k-token budget. Call this FIRST when you need "where is X rendered / who imports Y / what components already exist" instead of grepping file bodies. The same map is persisted at .ai-live/map.json. Pass focus (a component or need, e.g. "Button") to get the registry entry for reusing an existing component instead of inventing one.',
    input: {
      type: "object",
      properties: {
        budgetTokens: { type: "integer", minimum: 1, maximum: 4000, description: "Signature budget in tokens (default 1000)" },
        focus: { type: "string", description: 'A component name or need to look up in the project registry, e.g. "button" or "pricing card"' },
      },
      additionalProperties: false,
    },
  },
  {
    name: "adopt-registry",
    description:
      "Adopt the inferred project component registry: writes it to .ai-live/components.json so it is treated as declared thereafter. Opt-in only — call this when the user agrees the discovered components are the project's registry. Never call it unprompted on project open/import.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "install-catalog-component",
    description:
      "Copy a catalog component file into the active project (src/components/ui/), alongside — never replacing — the project's own components, so it appears in the codebase map/registry and later turns import it by name. Use after find-component identifies a fit. Fails if the file is already present.",
    input: {
      type: "object",
      properties: {
        tag: { type: "string", description: 'Exact catalog tag, e.g. "Button"' },
      },
      required: ["tag"],
      additionalProperties: false,
    },
  },
  {
    name: "place-template",
    description:
      "Place one of the editor's layout templates (named arrangements from catalog/templates.json — hero module, three-column row, pricing section) into the active project as ONE file write at its target path. Use this instead of generating a common layout from scratch: after placing, customise the constants at the top of the file with str-replace and import the component where it belongs. Fails if the target file already exists (placing never replaces). Pass a template id; omit it to list the available templates.",
    input: {
      type: "object",
      properties: {
        template: { type: "string", description: 'Template id, e.g. "pricing-section". Omit to list templates.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: "runtime-state-scan",
    description:
      "Inventory the live page's web storage (localStorage + sessionStorage keys and sizes) and, with match, report every store/key/path whose value contains that string (case-insensitive). Use when named content is absent from take-snapshot/inspect-dom: DOM senses see elements only — canvas/WebGL-painted content and app state never appear there. Source (grep) tells whether the content lives in code; this tells whether it lives in runtime state. Read-only. To change a value once found, use runtime-state-set. Pass url for the Playwright pool.",
    input: {
      type: "object",
      properties: {
        match: { type: "string", description: "Target text to search stored values for (case-insensitive); omit for an inventory only." },
        url: { type: "string", description: "Another origin: use the Playwright pool. Omit for the Vite app page bridge." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "runtime-state-set",
    description:
      "Change one value in the live page's web storage: a JSON path (a.b[0].c) within the stored value, or the whole value when path is omitted. Returns sizes plus the previous raw value as backup, verified by read-back; reload:true reloads the page so the app rehydrates from the new state. Pairs with runtime-state-scan (find first) and a re-scan to confirm. Storage writes persist like the app's own state — report the backup. Prefer app UI or source edits when those reach the same state; use this when the state exists only at runtime (e.g. canvas-painted content with no source copy). Pass url for the Playwright pool.",
    input: {
      type: "object",
      properties: {
        store: { type: "string", enum: ["localStorage", "sessionStorage"], description: "Which store. Default localStorage." },
        key: { type: "string", description: "Storage key to write." },
        path: { type: "string", description: "JSON path within the stored value (a.b[0].c); omit to replace the whole value." },
        value: { description: "New value (JSON). For a path set it must fit the path; whole-value replaces with this JSON text." },
        reload: { type: "boolean", description: "Reload the page after a verified write so the app rehydrates. Default false." },
        url: { type: "string", description: "Another origin: use the Playwright pool. Omit for the Vite app page bridge." },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "unpack-code",
    description:
      "De-minify a dense JS/TS file (a bundle, a vendored library, a generated or one-line file) and index its top-level sections. Writes a formatted copy under .ai-live/unpacked/ — the original is never touched — and returns a section map (kind, name, line range, signature) into that copy. Read the sections you need from the copy with read-real-file offset/limit; make edits against the ORIGINAL file, never the copy. Use this instead of reading a minified file raw.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: 'Project-relative path to the .js/.jsx/.ts/.tsx/.mjs/.cjs file, e.g. "/dist/bundle.min.js"' },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read-symbol",
    description:
      "Read ONE top-level function, class or constant by name from a JS/TS file — dense, minified or ordinary — without reading the rest of the file. The file is unpacked first (formatted copy under .ai-live/unpacked/, regenerated from the current source on every call) and the named section's source is returned. Top-level symbols only: if the name is not found, the result lists the names that do exist. Get names from unpack-code's section map or the codebase map. Make edits against the ORIGINAL file, never the copy.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: 'Project-relative path to the file, e.g. "/src/app.ts" or "/dist/bundle.min.js"' },
        name: { type: "string", description: 'Exact top-level symbol name, e.g. "checkout"' },
      },
      required: ["path", "name"],
      additionalProperties: false,
    },
  },
]

/** Wave-4 group-B structured-content tools: spreadsheet (4),
 * structured data (6) and documents (8), served by the host's one
 * /api/data/tool dispatch. Names, descriptions and schemas
 * transcribed from the Mastra originals (spreadsheetTools.ts,
 * dataTools.ts, docTools.ts). */
const CONTENT_TOOLS = [
  {
    name: "spreadsheet-inspect",
    description:
      "Inspect a CSV/TSV file as a spreadsheet: row and column counts, the header row, and a sample of the first rows. Use this before reading or editing a spreadsheet — it is far cheaper than reading the raw file, and it tells you the shape your edits must fit.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: 'Project-relative path to the .csv or .tsv file, e.g. "/data/sales.csv"' },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "spreadsheet-find",
    description:
      "Find cells in a CSV/TSV file whose text contains a query (case-insensitive). Returns 1-based row/column coordinates and the matching values, so a follow-up spreadsheet-set-cell can target the exact cell.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to the .csv or .tsv file" },
        query: { type: "string", description: "Text to look for inside cell values" },
      },
      required: ["path", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "spreadsheet-set-cell",
    description:
      "Set one cell of a CSV/TSV file (1-based row and column; row 1 is usually the header). The new value is spliced into exactly that cell — quoting is handled for you and every other cell, and the file’s line endings, stay byte-identical. To append data, use spreadsheet-add-row instead.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to the .csv or .tsv file" },
        row: { type: "integer", minimum: 1, description: "1-based row number" },
        col: { type: "integer", minimum: 1, description: "1-based column number" },
        value: { type: "string", description: "The new cell text" },
      },
      required: ["path", "row", "col", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "spreadsheet-add-row",
    description:
      "Append one row to the end of a CSV/TSV file. Values are serialised with the file’s delimiter and quoting rules, and the row lands on a fresh line (the file’s own line-ending style is kept). Returns the new row’s 1-based number.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to the .csv or .tsv file" },
        values: { type: "array", items: { type: "string" }, minItems: 1, description: "The new row’s cell values, in column order" },
      },
      required: ["path", "values"],
      additionalProperties: false,
    },
  },
  {
    name: "data-inspect",
    description:
      "Inspect a structured-data file (JSON, YAML, TOML, .env, XML): its format, the profile it is recognised as (package.json, GitHub Actions workflow, Cargo.toml, …), and an outline of its tree with scalar values. Use this before reading or editing such a file — the outline gives you the addresses data-get and data-set take, at a fraction of the cost of the raw file.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .json, .yaml, .yml, .toml, .env or .xml file" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "data-get",
    description:
      "Read one addressed value from a structured-data file (JSON, YAML, TOML, .env, XML). A scalar returns its value and kind; a section returns an outline of just that subtree.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .json, .yaml, .yml, .toml, .env or .xml file" },
        address: { type: "string", description: 'Dotted address of a value, e.g. "dependencies.react" or "jobs.build.steps[0].uses"' },
      },
      required: ["path", "address"],
      additionalProperties: false,
    },
  },
  {
    name: "data-set",
    description:
      "Set one scalar value in a structured-data file (JSON, YAML, TOML, .env, XML) by dotted address. The new value is spliced into exactly that value’s place through the format’s own rules — comments, formatting and every other value stay byte-identical. Booleans must be true/false, numbers must parse. Sections and non-plain values cannot be set; for a whole-file rewrite use write-real-file instead.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .json, .yaml, .yml, .toml, .env or .xml file" },
        address: { type: "string", description: 'Dotted address of a value, e.g. "dependencies.react" or "jobs.build.steps[0].uses"' },
        value: { type: "string", description: "The new value, as text (typed by the value it replaces: true/false for booleans, a number literal for numbers)" },
      },
      required: ["path", "address", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "data-find",
    description:
      "Find keys and scalar values containing a query (case-insensitive) in a structured-data file (JSON, YAML, TOML, .env, XML). Returns dotted addresses data-get and data-set can target directly.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .json, .yaml, .yml, .toml, .env or .xml file" },
        query: { type: "string", description: "Text to look for in key names and values" },
      },
      required: ["path", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "data-add",
    description:
      "Add a new value to a structured-data file (JSON, YAML, TOML, .env, XML). Give the parent section’s address (\"\" for the top level), a key for object-like sections (omit it to append to a list; use @name to add an XML attribute), and the value as text. The value is typed the way it reads — true/false become booleans, a number literal becomes a number, null becomes null, anything else a string — unless you pass type to force it (quote a version like \"2021\" as type \"string\"). The new entry is inserted in the file’s own style; everything else stays byte-identical.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .json, .yaml, .yml, .toml, .env or .xml file" },
        parent: { type: "string", description: 'Dotted address of the section or list to add to; "" for the top level' },
        key: { type: "string", description: "The new key (sections/objects), an element name or @attribute for XML; omit to append to a list" },
        value: { type: "string", description: "The new value, as text" },
        type: { type: "string", enum: ["string", "number", "boolean", "null"], description: "Force the value’s type instead of inferring it from the text" },
      },
      required: ["path", "parent", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "data-remove",
    description:
      "Remove one value from a structured-data file (JSON, YAML, TOML, .env, XML) by dotted address — an object entry, a list item, a whole section, an XML element or an @attribute. Only that value’s own lines/span are deleted; the rest of the file stays byte-identical.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .json, .yaml, .yml, .toml, .env or .xml file" },
        address: { type: "string", description: 'Dotted address of a value, e.g. "dependencies.react" or "jobs.build.steps[0].uses"' },
      },
      required: ["path", "address"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-inspect",
    description:
      "Inspect a document (Markdown or RTF) as blocks: the block list with kinds, heading levels and a short preview of each. Use this before editing a document — the block numbers are what the other doc tools take.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-get",
    description: "Read one block of a document (Markdown or RTF) in full: its kind, text, list items and style.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
        block: { type: "integer", minimum: 1, description: "1-based block number, as doc-inspect lists them" },
      },
      required: ["path", "block"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-find",
    description: "Find blocks in a document (Markdown or RTF) whose text contains a query (case-insensitive). Returns block numbers the other doc tools can target.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
        query: { type: "string", description: "Text to look for in block text and list items" },
      },
      required: ["path", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-set-text",
    description:
      "Replace the text of one block in a document (Markdown or RTF): a heading, paragraph, quote, or a code block’s code. For list blocks use doc-set-item; tables, frontmatter and raw HTML are not text-editable here.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
        block: { type: "integer", minimum: 1, description: "1-based block number, as doc-inspect lists them" },
        text: { type: "string", description: "The new text for the block" },
      },
      required: ["path", "block", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-set-item",
    description:
      "Change one item of a list block in a document (Markdown): its text, and optionally its task checkbox state (checked true/false) for task lists.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
        block: { type: "integer", minimum: 1, description: "1-based block number, as doc-inspect lists them" },
        item: { type: "integer", minimum: 1, description: "1-based item number within the list block" },
        text: { type: "string", description: "The new item text (omit to only toggle the checkbox)" },
        checked: { type: "boolean", description: "For task lists: the checkbox state to set" },
      },
      required: ["path", "block", "item"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-set-style",
    description:
      "Style one block of a document: font size (points), bold, alignment, or a Markdown heading level. The format decides what it can honestly represent — Markdown, for instance, has no alignment and its sizes ARE heading levels — and the tool refuses with the same reason the editor’s toolbar greys out, rather than faking it.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
        block: { type: "integer", minimum: 1, description: "1-based block number, as doc-inspect lists them" },
        fontSizePt: { type: "number", description: "Font size in points" },
        bold: { type: "boolean" },
        align: { type: "string", enum: ["left", "center", "right", "justify"] },
        level: { type: "integer", minimum: 1, maximum: 6, description: "Heading level (Markdown headings)" },
      },
      required: ["path", "block"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-add-block",
    description:
      "Append a new block (heading, paragraph or list) at the end of a document (Markdown or RTF), with the given text — for a list, the text becomes its first item. Headings can take a level (Markdown).",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
        kind: { type: "string", enum: ["heading", "paragraph", "list"] },
        text: { type: "string", description: "The new block’s text (a list’s first item)" },
        level: { type: "integer", minimum: 1, maximum: 6, description: "Heading level, for kind \"heading\"" },
      },
      required: ["path", "kind", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "doc-remove-block",
    description: "Remove one block from a document (Markdown or RTF) by its 1-based block number. Only that block goes; the rest of the file keeps its shape.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative path to a .md or .rtf file" },
        block: { type: "integer", minimum: 1, description: "1-based block number, as doc-inspect lists them" },
      },
      required: ["path", "block"],
      additionalProperties: false,
    },
  },
]

/** Wave-4 group-B web tools, served by the host's /api/web/tool
 * dispatch. Names, descriptions and schemas transcribed from the
 * Mastra originals (webTools.ts). The search backend's key is
 * resolved inside the host process and never appears here — only
 * { tool, input } crosses. */
const WEB_TOOLS = [
  {
    name: "web-search",
    description:
      "Search the web using the search source chosen in the chat header (the active provider's built-in web search, or Brave Search). Use for current facts: API shapes, library docs, versions, prior art. Returns compact results (title, url, snippet) — follow up with fetch-page or research when a snippet is not enough.",
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        count: { type: "integer", minimum: 1, maximum: 10, description: "Max results (default 6)" },
        freshness: { type: "string", enum: ["day", "week", "month", "year"], description: "Only results from this window (Brave backend)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch-page",
    description:
      "Fetch one public web page and return its readable text (title + body, truncated). Use to read a doc, article or reference page found via web-search. Loopback/private hosts are refused.",
    input: {
      type: "object",
      properties: {
        url: { type: "string", description: "The page URL (http/https, public)" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "research",
    description:
      "Deep research: run several web searches, read the best pages, and compile a cited brief (conclusions with [n] source citations, disagreements flagged). YOU plan the fan-out: pass 3-6 specific sub-queries that together cover the question. Use before building something that depends on external facts — a library choice, an API integration, a format spec. With saveTo (a .md path in the project), the brief is also written to disk so later turns can build from it.",
    input: {
      type: "object",
      properties: {
        question: { type: "string", description: "The research question, stated fully" },
        queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Sub-queries that together cover the question" },
        saveTo: { type: "string", description: 'Optional project-relative .md path to save the brief, e.g. "ai-research/brave-api.md"' },
      },
      required: ["question", "queries"],
      additionalProperties: false,
    },
  },
]

/** Wave-4 group-B fs tools — ALE's filesystem tool set, served by
 * the host's /api/fs/tool dispatch. Names, descriptions and
 * schemas transcribed from the Mastra originals (realFsTools.ts;
 * its zod fields carry no property descriptions).
 *
 * CONDITIONAL REGISTRATION (owner decision, slice 5): these tools
 * overlap OpenCode's native fs tools, and the owner wants
 * OpenCode performing as itself by default. This table is
 * registered ONLY when the supervisor spawned the server with
 * ALE_OPENCODE_FS_TOOLS=1 — which it does only when the
 * `aleFsTools` agent setting is on (default off). When off, the
 * model sees OpenCode's natives only; no ALE fs tool exists. */
const FS_TOOLS = [
  {
    name: "list-real-files",
    description: "List files from real FS projects/ (dot-directories like .git are skipped; capped at 1000 with totalFiles + truncated when the project is larger)",
    input: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "grep",
    description:
      'Regex search in the project. Each hit includes line plus window: the exact source lines around the match (windowStart–windowEnd). Copy window, or a unique slice of it, as str-replace old_string — do not read-real-file that range unless you need lines outside the window. Pass path when the file is already known, including Current file. Omit path to search the whole project — never pass null or the string "null". Skip node_modules.',
    input: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        caseInsensitive: { type: "boolean" },
        maxHits: { type: "integer", minimum: 1 },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "read-real-file",
    description:
      "Read a source file. Paths may be /src/x, src/x, or ./src/x; results return the canonical /… path. Prefer offset+limit (1-based lines) for existing files instead of the whole file.",
    input: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "str-replace",
    description:
      "Exact unique string replace in an existing file. Fails closed if old_string is missing or not unique. Never writes on miss. A miss returns window (exact nearby source) or windows (one per match) — copy the next old_string from that and do not re-read the file. Prefer this over write-real-file for edits.",
    input: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
  {
    name: "write-real-file",
    description:
      'Create or fully overwrite a file. Paths may be /src/x, src/x, or ./src/x; the result returns the canonical /… path and whether the file was created. Use for new files and scaffolds. For existing files, use str-replace. Do not write placeholders like "[original content]".',
    input: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "delete-file",
    description:
      "Delete a file, or a folder with recursive:true (a folder with contents is refused without it, with the entry count). Paths may be /src/x, src/x, or ./src/x.",
    input: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "rename-file",
    description:
      "Rename or move a file or folder. The target must not exist yet; missing target folders are created. Paths may be /src/x, src/x, or ./src/x.",
    input: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "make-dir",
    description:
      "Create a folder (and any missing parents). Refused when a file or folder already exists at the path. Paths may be /src/x, src/x, or ./src/x.",
    input: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "run-project-check",
    description:
      "Run the active project's build script (from its package.json) with a timeout and return the tail of the output. Use to verify behaviour changes before claiming done.",
    input: { type: "object", properties: {}, additionalProperties: false },
  },
]

export default Plugin.define({
  id: "ai-live-editor",
  async setup(ctx) {
    const hostUrl = typeof ctx.options?.hostUrl === "string" && ctx.options.hostUrl
      ? ctx.options.hostUrl
      : "http://127.0.0.1:4112"
    // Slice 7 backstop (see the header): before any ALE tool
    // executes, ask the host whether this session's current turn
    // allows it, and throw to deny on an explicit no. Native
    // OpenCode tools are not ALE's to gate here — the generated
    // config's agent permissions govern them.
    const ALE_TOOL_NAMES = new Set([
      "get-console",
      ...PAGE_TOOLS.map((t) => t.name),
      ...VERIFY_TOOLS.map((t) => t.name),
      ...GRAPH_TOOLS.map((t) => t.name),
      ...PROJECT_TOOLS.map((t) => t.name),
      ...CONTENT_TOOLS.map((t) => t.name),
      ...WEB_TOOLS.map((t) => t.name),
      ...FS_TOOLS.map((t) => t.name),
      "console-expect",
    ])
    if (typeof ctx.tool?.hook === "function") {
      await ctx.tool.hook("execute.before", async (input) => {
        if (!input || !ALE_TOOL_NAMES.has(input.tool)) return
        let verdict = null
        try {
          const response = await fetch(`${hostUrl}/api/opencode/tool-check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: input.sessionID, tool: input.tool }),
          })
          verdict = await response.json().catch(() => null)
        } catch {
          verdict = null
        }
        if (verdict && verdict.allow === false) {
          throw new Error(
            typeof verdict.reason === "string" && verdict.reason
              ? verdict.reason
              : `${input.tool} is not available in this turn`,
          )
        }
      })
    }
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "get-console",
        description:
          "Read recent console output and page errors from the project's live page in the browser " +
          "(ring buffer, newest last). Filter by level, last-N, or since a sequence number. " +
          "Use this when the user asks about console errors, or to check what the page logged after a change.",
        input: {
          type: "object",
          properties: {
            levels: {
              type: "array",
              items: { type: "string", enum: ["log", "info", "warn", "error", "debug", "pageerror"] },
              description: "Only these levels (default all)",
            },
            maxEntries: { type: "number", description: "Max entries (default 100)" },
            sinceSeq: { type: "number", description: "Only entries after this sequence number" },
          },
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) =>
          callHost(`${hostUrl}/api/page/console`, input ?? {}, { endpoint: "console", call: "the console read" }, context?.signal),
      })
      for (const tool of PAGE_TOOLS) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { codemode: false },
          execute: async (input, context) =>
            callHost(`${hostUrl}/api/page/tool`, { tool: tool.name, input: input ?? {} }, { endpoint: "page-tool", call: tool.name }, context?.signal),
        })
      }
      for (const tool of VERIFY_TOOLS) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { codemode: false },
          execute: async (input, context) =>
            callHost(`${hostUrl}/api/page/tool`, { tool: tool.name, input: input ?? {} }, { endpoint: "page-tool", call: tool.name }, context?.signal),
        })
      }
      for (const tool of GRAPH_TOOLS) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { codemode: false },
          execute: async (input, context) =>
            callHost(`${hostUrl}/api/graph/tool`, { tool: tool.name, input: input ?? {} }, { endpoint: "graph-tool", call: tool.name }, context?.signal),
        })
      }
      for (const tool of PROJECT_TOOLS) {
        // read-skill is an OPT-IN override (agent setting
        // `aleSkillTools`, default off): it overlaps OpenCode's
        // native skill tool, which — with ALE's skills directory
        // registered in the generated config — loads the same
        // SKILL.md bodies. Registered only when the supervisor
        // spawned the server with ALE_OPENCODE_SKILL_TOOLS=1.
        // run-skill-checks has no native counterpart and is not
        // part of the switch.
        if (tool.name === "read-skill" && process.env.ALE_OPENCODE_SKILL_TOOLS !== "1") continue
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { codemode: false },
          execute: async (input, context) =>
            callHost(`${hostUrl}/api/project/tool`, { tool: tool.name, input: input ?? {} }, { endpoint: "project-tool", call: tool.name }, context?.signal),
        })
      }
      for (const tool of CONTENT_TOOLS) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { codemode: false },
          execute: async (input, context) =>
            callHost(`${hostUrl}/api/data/tool`, { tool: tool.name, input: input ?? {} }, { endpoint: "data-tool", call: tool.name }, context?.signal),
        })
      }
      // ALE web tools are an OPT-IN override (agent setting
      // `aleWebTools`, default off): web-search / fetch-page
      // overlap OpenCode's native websearch / webfetch, and
      // research — which has no native counterpart — is built on
      // the same search backends and gated as one set by the
      // host's turn policy, so the three register together or
      // not at all. Registered only when the supervisor spawned
      // the server with ALE_OPENCODE_WEB_TOOLS=1; when off, the
      // model sees OpenCode's native web tools only.
      if (process.env.ALE_OPENCODE_WEB_TOOLS === "1") {
        for (const tool of WEB_TOOLS) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.input,
            options: { codemode: false },
            execute: async (input, context) =>
              callHost(`${hostUrl}/api/web/tool`, { tool: tool.name, input: input ?? {} }, { endpoint: "web-tool", call: tool.name }, context?.signal),
          })
        }
      }
      // ALE fs tools are an OPT-IN override (agent setting
      // `aleFsTools`, default off): the supervisor passes
      // ALE_OPENCODE_FS_TOOLS=1 at spawn only when the setting is
      // on. Read here, inside setup, so each spawn's environment
      // decides — when off, no ALE fs tool is registered at all
      // and OpenCode's native fs tools stand alone.
      if (process.env.ALE_OPENCODE_FS_TOOLS === "1") {
        for (const tool of FS_TOOLS) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.input,
            options: { codemode: false },
            execute: async (input, context) =>
              callHost(`${hostUrl}/api/fs/tool`, { tool: tool.name, input: input ?? {} }, { endpoint: "fs-tool", call: tool.name }, context?.signal),
          })
        }
      }
      editor.add({
        name: "console-expect",
        description:
          "Declare ONE literal string you expect to appear in the page console during this turn. Pattern: plant a console.log carrying the literal via a code edit, declare it here, and the host checks the post-turn console read for it — matched or missing is reported on the turn. Remove the planted log before the turn ends. One literal per call; multiple calls accumulate.",
        input: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1, description: "The exact literal to look for in console entry text (substring match, any level)" },
          },
          required: ["text"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) =>
          callHost(`${hostUrl}/api/console/expect`, input ?? {}, { endpoint: "console-expect", call: "the console-expect declaration" }, context?.signal),
      })
    })
  },
})
