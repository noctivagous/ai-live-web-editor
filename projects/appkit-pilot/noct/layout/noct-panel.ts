import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctPanelMeta: NoctComponentMeta = {
  tag: 'noct-panel',
  category: 'layout',
  description: 'Titled app panel: beveled container with a titlebar (title + optional subtitle and actions) and a body slot',
  props: {
    title: {
      type: 'string',
      required: true,
      description: 'Panel title shown in the titlebar'
    },
    subtitle: {
      type: 'string',
      required: false,
      description: 'Small secondary text next to the title'
    },
    collapsible: {
      type: 'boolean',
      default: false,
      description: 'Show a collapse toggle in the titlebar'
    },
    collapsed: {
      type: 'boolean',
      default: false,
      description: 'Collapse the panel body (only when collapsible)'
    }
  },
  slots: {
    default: 'Panel body content',
    actions: 'Titlebar actions (right side)'
  },
  emits: ['panel-toggle'],
  dependencies: [],
  examples: [
    '<noct-panel title="Grid"><p>Body</p></noct-panel>',
    '<noct-panel title="Output" subtitle="read-only"><span slot="actions"><button>Clear</button></span><pre>…</pre></noct-panel>'
  ]
};

@customElement('noct-panel')
@WithMetadata(NoctPanelMeta)
export class NoctPanel extends NoctElement {
  @property({ type: String })
  title = '';

  @property({ type: String })
  subtitle = '';

  @property({ type: Boolean })
  collapsible = false;

  @property({ type: Boolean, reflect: true })
  collapsed = false;

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'region');
    }
  }

  private toggle() {
    if (!this.collapsible) return;
    this.collapsed = !this.collapsed;
    this.emitEvent('panel-toggle', { collapsed: this.collapsed });
  }

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      background: var(--bg-raised, #3a3a3a);
      border: 1px solid var(--bevel-shadow, #1a1a1a);
      box-shadow: inset 1px 1px 0 var(--bevel-highlight-subtle, #424242);
      border-radius: 0;
      min-width: 0;
    }

    .titlebar {
      display: flex;
      align-items: center;
      gap: var(--space-sm, 8px);
      padding: 6px 12px;
      background: var(--bg-header, #323232);
      border-bottom: 1px solid var(--bevel-shadow, #1a1a1a);
      box-shadow: inset 0 1px 0 var(--bevel-highlight-subtle, #424242);
      min-height: 32px;
      box-sizing: border-box;
    }

    .toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1px solid var(--bevel-shadow, #1a1a1a);
      background: var(--bg-raised, #3a3a3a);
      box-shadow: inset 1px 1px 0 var(--bevel-highlight, #4a4a4a), inset -1px -1px 0 var(--bevel-shadow, #1a1a1a);
      color: var(--text-secondary, #999);
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      flex-shrink: 0;
    }

    .toggle:hover {
      background: var(--bg-hover, #404040);
      color: var(--text-primary, #d0d0d0);
    }

    .toggle:focus-visible {
      outline: 2px solid var(--accent, #2f7dd2);
      outline-offset: 1px;
    }

    .title {
      font-size: var(--font-label, 11px);
      line-height: var(--line-label, 16px);
      letter-spacing: var(--letter-spacing-micro, 0.5px);
      text-transform: uppercase;
      font-weight: 600;
      color: var(--text-label, #b8b8b8);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .subtitle {
      font-size: var(--font-label, 11px);
      line-height: var(--line-label, 16px);
      color: var(--text-tertiary, #888);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .spacer {
      flex: 1;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .body {
      padding: var(--space-lg, 16px);
      min-width: 0;
    }

    :host([collapsed]) .body {
      display: none;
    }

    :host([collapsed]) .titlebar {
      border-bottom: none;
    }

    ::slotted(*) {
      min-width: 0;
    }
  `;

  render() {
    return html`
      <div class="titlebar" part="titlebar">
        ${this.collapsible ? html`
          <button class="toggle" part="toggle" @click=${this.toggle}
            aria-expanded=${this.collapsed ? 'false' : 'true'}
            aria-label=${this.collapsed ? 'Expand panel' : 'Collapse panel'}>
            ${this.collapsed ? '▸' : '▾'}
          </button>
        ` : ''}
        <h2 class="title" part="title">${this.title}</h2>
        ${this.subtitle ? html`<span class="subtitle" part="subtitle">${this.subtitle}</span>` : ''}
        <span class="spacer"></span>
        <span class="actions" part="actions"><slot name="actions"></slot></span>
      </div>
      <div class="body" part="body">
        <slot></slot>
      </div>
    `;
  }
}
