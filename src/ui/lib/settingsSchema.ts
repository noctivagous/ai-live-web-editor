/**
 * The settings model: field definitions kept separate from the
 * values, the same model/instance split the plan system uses
 * (XForms-style — definitions in the model, answers in an instance).
 * The Settings window renders the declarative sections generically
 * from these definitions; sections whose content is an interactive
 * workflow rather than a form (provider setup with probe/validate,
 * search-key testing) are registered here as custom sections and
 * stay hand-built components.
 *
 * A field's `store` names its instance: 'project' values live in
 * project.ai.json (via /api/project/config), 'prefs' values in this
 * device's uiPrefs. Scope follows the store: project fields are
 * Project scope, prefs are Device scope, the custom provider/search
 * sections are Global (launcher) scope.
 */

export type SettingScope = 'global' | 'project' | 'device'
export type SettingStore = 'project' | 'prefs' | 'agent'
export type SettingControl = 'select' | 'toggle' | 'slider' | 'text' | 'checkboxes' | 'segmented'

export interface SettingOption { value: string, label: string }

export interface SettingField {
  /** Instance key: the property name in the store's record. */
  id: string
  section: string
  /** Optional subsection heading rendered above the row inside its
   * section (e.g. 'Header Bar' inside User Interface). */
  group?: string
  label: string
  hint?: string
  control: SettingControl
  store: SettingStore
  options?: SettingOption[]
  min?: number
  max?: number
  /** Coerce the control's string value to a number on save. */
  numeric?: boolean
  keywords?: string
}

export interface SettingSection {
  id: string
  title: string
  scope: SettingScope
  /** Set for sections rendered by a dedicated component, not fields. */
  custom?: 'providers' | 'search' | 'preview' | 'data' | 'shortcuts' | 'about' | 'themes'
  keywords?: string
}

export const SETTING_SECTIONS: SettingSection[] = [
  { id: 'providers', title: 'AI Providers & Models', scope: 'global', custom: 'providers', keywords: 'api key connection model provider modality openai meta' },
  { id: 'search', title: 'Search & Research', scope: 'global', custom: 'search', keywords: 'brave web search research backend' },
  { id: 'appearance', title: 'Appearance', scope: 'device', keywords: 'chat view panel deck' },
  { id: 'interface', title: 'User Interface', scope: 'device', keywords: 'menu bar menu strip classic menus top bar interface header' },
  { id: 'themes', title: 'Themes', scope: 'device', custom: 'themes', keywords: 'theme color font size dark pro classic gray design tokens editor theme' },
  { id: 'editor', title: 'Editor', scope: 'device', keywords: 'monaco font size tab wrap minimap line numbers code' },
  { id: 'files', title: 'Files & Explorer', scope: 'device', keywords: 'file pane sort hidden dotfiles explorer tree' },
  { id: 'shortcuts', title: 'Keyboard Shortcuts', scope: 'device', custom: 'shortcuts', keywords: 'keys hotkeys bindings rebind f2 delete deck shortcuts' },
  { id: 'agent', title: 'Agent & Chat', scope: 'global', keywords: 'agent chat default workflow sketch context trimming codebase map injection tokens' },
  { id: 'project', title: 'Project', scope: 'project', keywords: 'type format device targets style appkit catalog manifest' },
  { id: 'plans', title: 'Plans & Workflow', scope: 'project', keywords: 'plan level mutability default planning' },
  { id: 'preview', title: 'Preview & Live App', scope: 'global', custom: 'preview', keywords: 'playwright pool browser live target preview' },
  { id: 'data', title: 'Privacy & Data', scope: 'device', custom: 'data', keywords: 'export import reset clear chat sessions privacy data backup' },
  { id: 'about', title: 'About & Launcher', scope: 'global', custom: 'about', keywords: 'version workspace launcher setup wizard replay about' },
]

export const SETTING_FIELDS: SettingField[] = [
  // Agent & Chat — all three are launcher-global agent settings
  // (server): the workflow session itself is launcher-side state.
  {
    id: 'defaultWorkflow', section: 'agent', label: 'Default workflow', control: 'select', store: 'agent',
    hint: 'A freshly started launcher opens chats in this workflow. Files edits the project on disk; Sketch patches the live page. Switching workflow in a running session is unchanged.',
    options: [{ value: 'files', label: 'Files' }, { value: 'sketch', label: 'Sketch' }],
    keywords: 'chat new mode',
  },
  {
    id: 'contextTrim', section: 'agent', label: 'Context trimming', control: 'toggle', store: 'agent',
    hint: 'Older tool results in a running turn are folded to short summaries before each model call, so long turns cost fewer tokens. The full results stay in the chat history.',
    keywords: 'tokens trim fold tool results context window',
  },
  {
    id: 'mapInjection', section: 'agent', label: 'Codebase map in context', control: 'select', store: 'agent',
    hint: 'Adds the generated codebase map (files, imports, component signatures) to Files turns. Auto adds it only for projects with 15 or more files.',
    options: [{ value: 'auto', label: 'Auto (15+ files)' }, { value: 'always', label: 'Always' }, { value: 'off', label: 'Off' }],
    keywords: 'tokens index signatures codebase map',
  },
  // Appearance — device prefs (uiPrefs instance).
  {
    id: 'chatView', section: 'appearance', label: 'Default chat view', control: 'select', store: 'prefs',
    hint: 'Which presentation the chat pane opens in. Switching views in the chat header updates this.',
    options: [{ value: 'stationary', label: 'Stationary (pinned latest message)' }, { value: 'chat', label: 'Stream (scrolling)' }, { value: 'panel', label: 'Panel (dashboard indicators)' }],
    keywords: 'deck panel stationary scrolling',
  },
  // User Interface — device prefs (uiPrefs instance).
  {
    id: 'menuLayout', section: 'interface', label: 'Menu layout', control: 'select', store: 'prefs',
    hint: 'Multi-column card panels like Agent Actions and Wizards, or the classic single-column list.',
    options: [{ value: 'grid', label: 'Multi-column cards' }, { value: 'list', label: 'Single-column list' }],
    keywords: 'menu layout grid list columns cards',
  },
  // Header Bar subsection — device prefs (uiPrefs instance).
  {
    id: 'headerBar', section: 'interface', group: 'Header Bar', label: 'Header bar', control: 'segmented', store: 'prefs',
    hint: 'Buttons is the top button bar only. Classic is the classic menu strip only, with the AI connection and model selects moved into it. Both shows the strip under the button bar.',
    options: [{ value: 'buttons', label: 'Buttons' }, { value: 'classic', label: 'Classic' }, { value: 'both', label: 'Both' }],
    keywords: 'header bar buttons classic both strip top bar layout',
  },
  {
    id: 'menuDescriptions', section: 'interface', group: 'Header Bar', label: 'Show description lines', control: 'toggle', store: 'prefs',
    hint: 'Menu items show their description line under the title. Off leaves titles only (tags and stub reasons stay).',
    keywords: 'menu descriptions blurbs subtitles rows titles',
  },
  {
    id: 'fileSort', section: 'files', label: 'File pane sort order', control: 'select', store: 'prefs',
    hint: 'The file browser pane starts in this order; changing it in the pane updates this.',
    options: [{ value: 'name', label: 'Name A–Z' }, { value: 'name-desc', label: 'Name Z–A' }, { value: 'type', label: 'Ext A–Z' }, { value: 'type-desc', label: 'Ext Z–A' }, { value: 'modified', label: 'Modified, newest first' }, { value: 'modified-asc', label: 'Modified, oldest first' }],
    keywords: 'files explorer order',
  },
  {
    id: 'fileShowHidden', section: 'files', label: 'Show hidden files', control: 'toggle', store: 'prefs',
    hint: 'Dotfiles and dot-folders in the file browser pane.',
    keywords: 'dotfiles hidden files explorer',
  },
  {
    id: 'formatToolbar', section: 'files', label: 'Preview AI toolbar', control: 'toggle', store: 'prefs',
    hint: 'The toolbar under the preview bar with AI actions for the previewed file’s format. The preview bar’s “AI toolbar” checkbox switches it too.',
    keywords: 'preview toolbar ai actions format menus commands',
  },
  // Editor — device prefs (uiPrefs instance), applied to Monaco live.
  {
    id: 'editorFontSize', section: 'editor', label: 'Font size', control: 'slider', store: 'prefs', numeric: true,
    min: 10, max: 20,
    hint: 'Code editor font size, in points.',
    keywords: 'monaco text size',
  },
  {
    id: 'editorTabSize', section: 'editor', label: 'Tab size', control: 'select', store: 'prefs', numeric: true,
    hint: 'Spaces per indentation level in the code editor.',
    options: [{ value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' }],
    keywords: 'indent spaces monaco',
  },
  {
    id: 'editorWordWrap', section: 'editor', label: 'Word wrap', control: 'toggle', store: 'prefs',
    hint: 'Wrap long lines instead of scrolling sideways.',
    keywords: 'monaco lines',
  },
  {
    id: 'editorMinimap', section: 'editor', label: 'Minimap', control: 'toggle', store: 'prefs',
    hint: 'The miniature code overview at the editor’s right edge.',
    keywords: 'monaco overview',
  },
  {
    id: 'editorLineNumbers', section: 'editor', label: 'Line numbers', control: 'toggle', store: 'prefs',
    hint: 'Numbers in the editor gutter.',
    keywords: 'monaco gutter',
  },
  // Project — project.ai.json instance.
  {
    id: 'type', section: 'project', label: 'Project type', control: 'select', store: 'project',
    hint: 'Designates the project. Not designated is a valid state — the editor asserts no type defaults.',
    options: [
      { value: '', label: 'Not designated' },
      { value: 'web-app', label: 'Web app' },
      { value: 'canvas-tool', label: 'Canvas tool' },
      { value: 'game', label: 'Game' },
      { value: 'dashboard', label: 'Dashboard' },
      { value: 'content-site', label: 'Content site' },
    ],
    keywords: 'designate manifest kind',
  },
  {
    id: 'format', section: 'project', label: 'Format', control: 'select', store: 'project',
    hint: 'App fits the viewport and scrolls by region; page grows and scrolls as a document. Auto follows the type (content site → page, other types → app).',
    options: [
      { value: '', label: 'Auto (from type)' },
      { value: 'app', label: 'App — viewport-fit' },
      { value: 'page', label: 'Page — document flow' },
    ],
    keywords: 'overflow viewport document responsive',
  },
  {
    id: 'deviceTargets', section: 'project', label: 'Device targets', control: 'checkboxes', store: 'project',
    hint: 'Widths the layout gate checks. None checked means all three.',
    options: [
      { value: 'phone', label: 'Phone (375)' },
      { value: 'tablet', label: 'Tablet (768)' },
      { value: 'desktop', label: 'Desktop (1280)' },
    ],
    keywords: 'responsive widths phone tablet desktop',
  },
  {
    id: 'defaultDeviceTarget', section: 'project', label: 'Default device target', control: 'select', store: 'project',
    hint: 'The preview target a session starts on for this project.',
    options: [
      { value: '', label: 'Desktop' },
      { value: 'phone', label: 'Phone' },
      { value: 'tablet', label: 'Tablet' },
      { value: 'desktop', label: 'Desktop' },
    ],
    keywords: 'preview target session',
  },
  {
    id: 'styleSet', section: 'project', label: 'Style set', control: 'text', store: 'project',
    hint: 'The named token/style set the agent consults for this project, if any.',
    keywords: 'theme tokens styles',
  },
  {
    id: 'appkit', section: 'project', label: 'AppKit component stock', control: 'toggle', store: 'project',
    hint: 'Adds the Noct AppKit (Lit) catalog stock next to the default shadcn stock for this project.',
    keywords: 'catalog components noct lit',
  },
  // Plans & Workflow — project.ai.json instance.
  {
    id: 'planLevel', section: 'plans', label: 'Default plan level', control: 'select', store: 'project', numeric: true,
    hint: 'Used when /plan names no level. Level 1 is the lightest; 3 adds mutability, staged questions, and variants.',
    options: [
      { value: '1', label: 'Level 1' },
      { value: '2', label: 'Level 2' },
      { value: '3', label: 'Level 3' },
    ],
    keywords: 'planning extensiveness',
  },
  {
    id: 'planMutability', section: 'plans', label: 'Default plan mutability', control: 'slider', store: 'project', numeric: true,
    min: 0, max: 10,
    hint: 'How much of a new plan the agent may reshape without asking, 0 (nothing) to 10 (anything).',
    keywords: 'planning change freedom',
  },
]

export function fieldsForSection(sectionId: string): SettingField[] {
  return SETTING_FIELDS.filter(f => f.section === sectionId)
}

export function sectionById(id: string): SettingSection | undefined {
  return SETTING_SECTIONS.find(s => s.id === id)
}

/** Settings search: sections and fields matching the query, so the
 * window can jump straight to a setting by name. */
export function searchSettings(query: string): { sections: SettingSection[], fields: SettingField[] } {
  const q = query.trim().toLowerCase()
  if (!q) return { sections: [...SETTING_SECTIONS], fields: [...SETTING_FIELDS] }
  const hit = (text: string | undefined) => Boolean(text && text.toLowerCase().includes(q))
  return {
    sections: SETTING_SECTIONS.filter(s => hit(s.title) || hit(s.keywords)),
    fields: SETTING_FIELDS.filter(f => hit(f.label) || hit(f.hint) || hit(f.keywords)),
  }
}
