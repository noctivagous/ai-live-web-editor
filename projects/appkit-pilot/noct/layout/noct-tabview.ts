import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export interface TabItem {
  id: string;
  label: string;
  icon?: string;
  closable?: boolean;
  disabled?: boolean;
  badge?: string | number;
}

export const NoctTabviewMeta: NoctComponentMeta = {
  tag: 'noct-tabview',
  category: 'layout',
  description: 'Tab view with selectable tabs and associated content panels via named slots',
  props: {
    items: {
      type: 'string',
      required: true,
      description: 'JSON array of tab definitions (e.g., \'[{"id":"tab1","label":"Tab 1"}]\')'
    },
    active: {
      type: 'string',
      required: false,
      description: 'ID of the active tab'
    },
    orientation: {
      type: ['top', 'bottom', 'left', 'right'],
      default: 'top',
      description: 'Tab bar position relative to content'
    },
    closable: {
      type: 'boolean',
      default: false,
      description: 'Show close button on all tabs'
    },
    size: {
      type: ['sm', 'md', 'lg'],
      default: 'md',
      description: 'Tab size'
    }
  },
  slots: {
    default: 'Content panels — each slot named after its tab id (e.g., slot="tab1")',
    extra: 'Extra content in the tab bar (e.g., a button)'
  },
  emits: ['tab-change', 'tab-close'],
  dependencies: [],
  examples: [
    '<noct-tabview items=\'[{"id":"edit","label":"Edit"},{"id":"view","label":"View"}]\'><div slot="edit">Editor</div></noct-tabview>',
    '<noct-tabview items=\'[{"id":"out","label":"Output","closable":true}]\' orientation="bottom"></noct-tabview>'
  ]
};

@customElement('noct-tabview')
@WithMetadata(NoctTabviewMeta)
export class NoctTabview extends NoctElement {
  @property({ type: String })
  items = '';

  @property({ type: String })
  active = '';

  @property({ type: String })
  orientation = 'top';

  @property({ type: Boolean })
  closable = false;

  @property({ type: String })
  size = 'md';

  private parsedItems: TabItem[] = [];
  private _activeId = '';

  get activeId(): string {
    return this._activeId;
  }

  static styles = css`
    :host {
      display: flex;
      box-sizing: border-box;
      color: var(--text-vscode, #cccccc);
      font-size: var(--font-base, 13px);
      overflow: hidden;
    }

    :host([orientation="top"]) { flex-direction: column; }
    :host([orientation="bottom"]) { flex-direction: column-reverse; }
    :host([orientation="left"]) { flex-direction: row; }
    :host([orientation="right"]) { flex-direction: row-reverse; }

    .bar {
      display: flex;
      flex-shrink: 0;
      background: var(--border-vscode-alt, #252526);
      border-bottom: var(--border-width, 1px) solid var(--border-vscode, #3c3c3c);
      min-height: 0;
      overflow: hidden;
      box-shadow: var(--shadow-bevel-subtle, inset 1px 1px 0 var(--bevel-highlight-subtle, #424242));
    }

    .bar.top { border-bottom: var(--border-width, 1px) solid var(--border-vscode, #3c3c3c); }
    .bar.bottom { border-top: var(--border-width, 1px) solid var(--border-vscode, #3c3c3c); }
    .bar.left {
      border-bottom: none;
      border-right: var(--border-width, 1px) solid var(--border-vscode, #3c3c3c);
      flex-direction: column;
    }
    .bar.right {
      border-bottom: none;
      border-left: var(--border-width, 1px) solid var(--border-vscode, #3c3c3c);
      flex-direction: column;
    }

    .tab-list {
      display: flex;
      flex: 1;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
      scrollbar-color: var(--bg-raised, #3a3a3a) var(--bg-pressed, #222222);
    }

    .bar.left .tab-list,
    .bar.right .tab-list {
      flex-direction: column;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: var(--space-sm, 6px);
      padding: var(--space-md, 8px) var(--space-lg, 14px);
      cursor: pointer;
      white-space: nowrap;
      border-right: var(--border-width, 1px) solid var(--border-vscode, #3c3c3c);
      color: var(--text-secondary, #999);
      user-select: none;
      position: relative;
      flex-shrink: 0;
      background: var(--bg-base, #2b2b2b);
    }

    .bar.left .tab,
    .bar.right .tab {
      border-right: none;
      border-bottom: var(--border-width, 1px) solid var(--border-vscode, #3c3c3c);
    }

    .tab:hover:not(.active):not(:disabled) {
      background: var(--bg-hover, #404040);
      color: var(--text-primary, #d0d0d0);
    }

    .tab.active {
      color: var(--text-bright, #e0e0e0);
      background: var(--bg-input-alt, #1e1e1e);
    }

    .bar.top .tab.active {
      border-bottom: var(--border-width, 1px) solid var(--bg-input-alt, #1e1e1e);
      margin-bottom: -1px;
    }

    .bar.bottom .tab.active {
      border-top: var(--border-width, 1px) solid var(--bg-input-alt, #1e1e1e);
      margin-top: -1px;
    }

    .bar.left .tab.active {
      border-right: var(--border-width, 1px) solid var(--bg-input-alt, #1e1e1e);
      margin-right: -1px;
    }

    .bar.right .tab.active {
      border-left: var(--border-width, 1px) solid var(--bg-input-alt, #1e1e1e);
      margin-left: -1px;
    }

    .tab:disabled {
      opacity: var(--opacity-disabled, 0.4);
      cursor: default;
    }

    .tab:focus-visible {
      outline: 2px solid var(--accent, #2f7dd2);
      outline-offset: -2px;
    }

    .tab.sm { padding: var(--space-sm, 4px) var(--space-md, 10px); font-size: var(--font-sm, 12px); }
    .tab.md { padding: var(--space-md, 8px) var(--space-lg, 14px); font-size: var(--font-base, 13px); }
    .tab.lg { padding: var(--space-md, 10px) var(--space-lg, 18px); font-size: var(--font-base, 14px); }

    .tab-icon {
      font-size: inherit;
    }

    .badge {
      background: var(--accent-blue, #007acc);
      color: var(--text-on-accent, #fff);
      font-size: var(--font-sm, 11px);
      line-height: 1;
      padding: var(--space-xs, 2px) var(--space-sm, 6px);
      border-radius: var(--radius, 0);
      min-width: 16px;
      text-align: center;
      font-weight: 600;
    }

    .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--icon-size-md, 18px);
      height: var(--icon-size-md, 18px);
      border: none;
      background: none;
      color: var(--text-secondary, #999);
      cursor: pointer;
      border-radius: var(--radius-sm, 0);
      font-size: var(--font-base, 14px);
      line-height: 1;
      padding: 0;
      margin-left: var(--unit, 2px);
      flex-shrink: 0;
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-bright, #e0e0e0);
    }

    .content {
      flex: 1;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--bg-raised, #3a3a3a) var(--bg-pressed, #222222);
      background: var(--bg-input-alt, #1e1e1e);
      min-height: 0;
    }

    .extra {
      display: flex;
      align-items: center;
      padding: 0 var(--space-sm, 4px);
      flex-shrink: 0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.parseItems();
    if (this._activeId && !this.active) {
      this.active = this._activeId;
    }
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has('items')) {
      this.parseItems();
    }
    if (changedProperties.has('active')) {
      this.selectTab(this.active);
    }
  }

  private parseItems() {
    if (!this.items) {
      this.parsedItems = [];
      return;
    }
    try {
      this.parsedItems = JSON.parse(this.items) as TabItem[];
      if (!this._activeId && this.parsedItems.length > 0) {
        this.selectTab(this.parsedItems[0]!.id);
      }
    } catch {
      console.error('[NoctCode] Invalid tabview items JSON:', this.items);
      this.parsedItems = [];
    }
  }

  selectTab(id: string) {
    if (id === this._activeId) return;
    const found = this.parsedItems.find(t => t.id === id);
    if (!found || found.disabled) return;
    this._activeId = id;
    this.active = id;
    this.emitEvent('tab-change', { id, tab: found });
    this.requestUpdate();
  }

  closeTab(id: string) {
    const tab = this.parsedItems.find(t => t.id === id);
    if (!tab) return;
    this.emitEvent('tab-close', { id, tab });

    const idx = this.parsedItems.indexOf(tab);
    this.parsedItems = this.parsedItems.filter(t => t.id !== id);
    this.requestUpdate();

    if (this._activeId === id) {
      const next = this.parsedItems[Math.min(idx, this.parsedItems.length - 1)];
      this.selectTab(next?.id ?? '');
    }
  }

  private handleClose(e: Event, id: string) {
    e.stopPropagation();
    this.closeTab(id);
  }

  private focusTab(id: string) {
    this.selectTab(id);
    const el = this.renderRoot?.querySelector(`[data-tab-id="${id}"]`) as HTMLElement;
    if (el) el.focus();
  }

  private handleTabKeydown(e: KeyboardEvent, id: string) {
    const enabled = this.parsedItems.filter(t => !t.disabled);
    const idx = enabled.findIndex(t => t.id === id);
    const vertical = this.orientation === 'left' || this.orientation === 'right';
    let target: string | null = null;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.selectTab(id);
        return;
      case 'ArrowRight':
        if (!vertical) {
          target = enabled[(idx + 1) % enabled.length]?.id ?? null;
        }
        break;
      case 'ArrowDown':
        if (vertical) {
          target = enabled[(idx + 1) % enabled.length]?.id ?? null;
        }
        break;
      case 'ArrowLeft':
        if (!vertical) {
          target = enabled[(idx - 1 + enabled.length) % enabled.length]?.id ?? null;
        }
        break;
      case 'ArrowUp':
        if (vertical) {
          target = enabled[(idx - 1 + enabled.length) % enabled.length]?.id ?? null;
        }
        break;
      case 'Home':
        e.preventDefault();
        target = enabled[0]?.id ?? null;
        break;
      case 'End':
        e.preventDefault();
        target = enabled[enabled.length - 1]?.id ?? null;
        break;
    }
    if (target) {
      e.preventDefault();
      this.focusTab(target);
    }
  }

  render() {
    if (this.parsedItems.length === 0) {
      return html`<div class="content"><slot></slot></div>`;
    }

    return html`
      <div class="bar ${this.orientation}" part="bar">
        <div class="tab-list" part="tab-list" role="tablist">
          ${this.parsedItems.map(tab => html`
            <div
              class="tab ${this.size}${tab.id === this._activeId ? ' active' : ''}"
              data-tab-id=${tab.id}
              role="tab"
              tabindex=${tab.id === this._activeId ? '0' : '-1'}
              aria-selected=${tab.id === this._activeId ? 'true' : 'false'}
              aria-label=${tab.label}
              aria-disabled=${tab.disabled ? 'true' : 'false'}
              @click=${() => this.selectTab(tab.id)}
              @keydown=${(e: KeyboardEvent) => this.handleTabKeydown(e, tab.id)}
              part="tab"
            >
              ${tab.icon ? html`<span class="tab-icon" part="tab-icon">${tab.icon}</span>` : ''}
              <span part="tab-label">${tab.label}</span>
              ${tab.badge != null ? html`<span class="badge" part="badge">${tab.badge}</span>` : ''}
              ${tab.closable || this.closable ? html`
                <button class="close-btn" @click=${(e: Event) => this.handleClose(e, tab.id)} part="close-btn">&times;</button>
              ` : ''}
            </div>
          `)}
        </div>
        <div class="extra" part="extra">
          <slot name="extra"></slot>
        </div>
      </div>
      <div class="content" part="content">
        ${this._activeId ? html`
          <slot name=${this._activeId}>
            <span style="color:var(--text-tertiary, #666);padding:16px;display:block">Empty panel</span>
          </slot>
        ` : ''}
        <slot></slot>
      </div>
    `;
  }
}
