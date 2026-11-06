import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export interface ToolbarItem {
  id: string;
  label?: string;
  icon?: string;
  active?: boolean;
  disabled?: boolean;
  divider?: boolean;
  group?: string;
  title?: string;
}

export const NoctToolbarMeta: NoctComponentMeta = {
  tag: 'noct-toolbar',
  category: 'layout',
  description: 'Toolbar for grouping icon buttons, toggles, and actions',
  props: {
    items: {
      type: 'string',
      required: false,
      description: 'JSON array of button definitions (e.g., \'[{"id":"bold","icon":"B","label":"Bold"}]\')'
    },
    orientation: {
      type: ['horizontal', 'vertical'],
      default: 'horizontal',
      description: 'Toolbar orientation'
    },
    size: {
      type: ['sm', 'md', 'lg'],
      default: 'md',
      description: 'Toolbar item size'
    },
    compact: {
      type: 'boolean',
      default: false,
      description: 'Remove outer padding for tighter layouts'
    }
  },
  slots: {
    default: 'Custom toolbar content (replaces items prop when provided)',
    start: 'Slot before the items (left in horizontal, top in vertical)',
    end: 'Slot after the items (right in horizontal, bottom in vertical)'
  },
  emits: ['toolbar-click', 'toolbar-toggle'],
  dependencies: [],
  examples: [
    '<noct-toolbar items=\'[{"id":"undo","icon":"↩"},{"id":"redo","icon":"↪"}]\'></noct-toolbar>',
    '<noct-toolbar orientation="vertical"><button>Cut</button><button>Copy</button></noct-toolbar>'
  ]
};

@customElement('noct-toolbar')
@WithMetadata(NoctToolbarMeta)
export class NoctToolbar extends NoctElement {
  @property({ type: String })
  items = '';

  @property({ type: String })
  orientation = 'horizontal';

  @property({ type: String })
  size = 'md';

  @property({ type: Boolean })
  compact = false;

  private parsedItems: ToolbarItem[] = [];

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'toolbar');
    }
  }

  static styles = css`
    :host {
      display: flex;
      box-sizing: border-box;
      background: var(--bg-raised, #3a3a3a);
      border: var(--border-width, 1px) solid var(--bevel-shadow, #1a1a1a);
      border-radius: var(--radius, 0);
      padding: var(--space-sm, 4px);
      gap: var(--unit, 2px);
      align-items: center;
      box-shadow: var(--shadow-bevel-subtle, inset 1px 1px 0 var(--bevel-highlight-subtle, #424242));
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
      scrollbar-color: var(--bg-raised, #3a3a3a) var(--bg-pressed, #222222);
      min-width: 0;
    }

    :host([orientation="vertical"]) {
      overflow-x: hidden;
      overflow-y: auto;
    }

    :host([compact]) {
      padding: var(--space-xs, 2px);
      border: none;
      background: none;
      border-radius: var(--radius, 0);
    }

    :host([orientation="vertical"]) {
      flex-direction: column;
      align-items: stretch;
    }

    .group {
      display: flex;
      gap: var(--unit, 2px);
      align-items: center;
    }

    :host([orientation="vertical"]) .group {
      flex-direction: column;
    }

    .divider {
      width: var(--border-width, 1px);
      height: var(--height-toolbar, 24px);
      background: var(--border-vscode, #3c3c3c);
      margin: 0 var(--space-xs, 4px);
      flex-shrink: 0;
      border-right: var(--border-width, 1px) solid var(--bevel-highlight-subtle, #424242);
    }

    :host([orientation="vertical"]) .divider {
      width: 100%;
      height: var(--border-width, 1px);
      margin: var(--space-xs, 4px) 0;
    }

    .tb-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--text-vscode, #cccccc);
      cursor: pointer;
      border-radius: var(--radius, 0);
      font-size: var(--font-base, 14px);
      line-height: 1;
      flex-shrink: 0;
    }

    .tb-btn:hover:not(:disabled) {
      background: var(--bg-hover, #404040);
      color: var(--text-primary, #d0d0d0);
    }

    .tb-btn:focus-visible {
      outline: 2px solid var(--accent, #2f7dd2);
      outline-offset: -2px;
    }

    .tb-btn:active:not(:disabled) {
      background: var(--bg-pressed, #222222);
      box-shadow: var(--shadow-bevel-pressed, inset -1px -1px 0 var(--bevel-highlight, #4a4a4a), inset 1px 1px 0 var(--bevel-shadow, #1a1a1a));
      padding-top: 1px;
      padding-left: 1px;
    }

    .tb-btn:disabled {
      opacity: var(--opacity-disabled, 0.4);
      cursor: default;
    }

    .tb-btn.active {
      background: var(--bg-pressed, #222222);
      color: var(--text-primary, #d0d0d0);
    }

    .tb-btn.sm {
      width: calc(var(--height-button, 24px) - 4px);
      height: calc(var(--height-button, 24px) - 4px);
      font-size: var(--font-sm, 12px);
    }

    .tb-btn.md {
      width: var(--height-button, 24px);
      height: var(--height-button, 24px);
      font-size: var(--font-base, 14px);
    }

    .tb-btn.lg {
      width: calc(var(--height-button, 24px) + 12px);
      height: calc(var(--height-button, 24px) + 12px);
      font-size: var(--font-lg, 16px);
    }

    .tb-btn.has-label {
      width: auto;
      padding: 0 var(--space-sm, 8px);
      gap: var(--space-xs, 4px);
    }

    .tb-btn .label {
      font-size: inherit;
    }

    .slot-start, .slot-end {
      display: flex;
      align-items: center;
      gap: var(--unit, 2px);
    }

    :host([orientation="vertical"]) .slot-start,
    :host([orientation="vertical"]) .slot-end {
      flex-direction: column;
    }

    ::slotted(*) {
      display: flex;
      align-items: center;
    }
  `;

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has('items')) {
      this.parseItems();
    }
  }

  private parseItems() {
    if (!this.items) {
      this.parsedItems = [];
      return;
    }
    try {
      this.parsedItems = JSON.parse(this.items) as ToolbarItem[];
    } catch {
      console.error('[NoctCode] Invalid toolbar items JSON:', this.items);
      this.parsedItems = [];
    }
  }

  private handleItemClick(item: ToolbarItem) {
    if (item.disabled) return;
    this.emitEvent('toolbar-click', { id: item.id, item });
  }

  private renderItems() {
    if (this.parsedItems.length === 0) return html``;

    let currentGroup = '';
    const groups: { group: string; items: ToolbarItem[] }[] = [];
    let current: ToolbarItem[] = [];

    for (const item of this.parsedItems) {
      if (item.divider) {
        if (current.length > 0) {
          groups.push({ group: currentGroup, items: current });
          current = [];
        }
        groups.push({ group: '', items: [item] });
        currentGroup = '';
        continue;
      }
      if (item.group && item.group !== currentGroup) {
        if (current.length > 0) {
          groups.push({ group: currentGroup, items: current });
        }
        currentGroup = item.group;
        current = [];
      }
      current.push(item);
    }
    if (current.length > 0) {
      groups.push({ group: currentGroup, items: current });
    }

    return groups.map((g, gi) => {
      if (g.items.length === 1 && g.items[0]?.divider) {
        return html`<div class="divider"></div>`;
      }
      return html`
        <div class="group" part="group">
          ${g.items.map(item => html`
            <button
              class="tb-btn ${this.size}${item.label ? ' has-label' : ''}${item.active ? ' active' : ''}"
              ?disabled=${item.disabled}
              title=${item.title || item.label || item.id}
              aria-label=${item.label || item.id}
              @click=${() => this.handleItemClick(item)}
              part="btn"
            >
              ${item.icon ? html`<span part="icon">${item.icon}</span>` : ''}
              ${item.label ? html`<span class="label" part="label">${item.label}</span>` : ''}
            </button>
          `)}
        </div>
      `;
    });
  }

  render() {
    return html`
      <div class="slot-start" part="slot-start">
        <slot name="start"></slot>
      </div>
      ${this.renderItems()}
      <slot></slot>
      <div class="slot-end" part="slot-end">
        <slot name="end"></slot>
      </div>
    `;
  }
}
