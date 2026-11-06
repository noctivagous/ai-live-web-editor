import { html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export interface SegmentedItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export const NoctSegmentedMeta: NoctComponentMeta = {
  tag: 'noct-segmented',
  category: 'widgets',
  description: 'Compact single-select segmented control for tool modes and snap units',
  props: {
    items: {
      type: 'string',
      required: true,
      description: 'JSON array of segments (e.g., \'[{"id":"bar","label":"Bar"}]\')'
    },
    value: {
      type: 'string',
      required: false,
      description: 'ID of the selected segment'
    },
    label: {
      type: 'string',
      required: false,
      description: 'Accessible label for the group'
    }
  },
  slots: {},
  emits: ['segmented-select'],
  dependencies: [],
  examples: [
    '<noct-segmented items=\'[{"id":"cut","label":"Cut"},{"id":"fade","label":"Fade"}]\'></noct-segmented>'
  ]
};

@customElement('noct-segmented')
@WithMetadata(NoctSegmentedMeta)
export class NoctSegmented extends NoctElement {
  @property({ type: String }) items = '';
  @property({ type: String }) value = '';
  @property({ type: String }) label = '';

  @state()
  private parsedItems: SegmentedItem[] = [];

  connectedCallback() {
    super.connectedCallback();
    this.parseItems();
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has('items')) {
      this.parseItems();
    }
  }

  private parseItems() {
    try {
      this.parsedItems = this.items ? (JSON.parse(this.items) as SegmentedItem[]) : [];
    } catch {
      console.error('[NoctCode] Invalid segmented items JSON:', this.items);
      this.parsedItems = [];
    }
  }

  select(id: string) {
    const found = this.parsedItems.find(i => i.id === id);
    if (!found || found.disabled) return;
    this.value = id;
    this.emitEvent('segmented-select', { id, item: found });
  }

  private onKeydown(e: KeyboardEvent, id: string) {
    const list = this.parsedItems.filter(i => !i.disabled);
    const idx = list.findIndex(i => i.id === id);
    let target: string | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      target = list[(idx + 1) % list.length]?.id;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      target = list[(idx - 1 + list.length) % list.length]?.id;
    } else if (e.key === 'Home') {
      target = list[0]?.id;
    } else if (e.key === 'End') {
      target = list[list.length - 1]?.id;
    }
    if (target) {
      e.preventDefault();
      this.select(target);
      const el = this.renderRoot?.querySelector(`[data-seg="${target}"]`) as HTMLElement;
      if (el) el.focus();
    }
  }

  static styles = css`
    :host {
      display: inline-flex;
      box-sizing: border-box;
      background: var(--bg-pressed, #222222);
      border: var(--border-width, 1px) solid var(--bevel-shadow, #1a1a1a);
      box-shadow: inset 1px 1px 0 var(--bevel-shadow, #1a1a1a);
      min-height: var(--height-input, 24px);
    }

    .seg {
      background: none;
      border: none;
      border-right: var(--border-width, 1px) solid var(--bevel-shadow, #1a1a1a);
      color: var(--text-secondary, #999);
      font-size: var(--font-label, 11px);
      line-height: var(--line-label, 16px);
      letter-spacing: var(--letter-spacing-micro, 0.5px);
      padding: var(--space-xs, 4px) var(--space-md, 12px);
      cursor: pointer;
      white-space: nowrap;
    }

    .seg:last-child {
      border-right: none;
    }

    .seg:hover:not(:disabled) {
      color: var(--text-primary, #d0d0d0);
    }

    .seg[aria-checked="true"] {
      background: var(--bg-raised, #3a3a3a);
      color: var(--text-bright, #e0e0e0);
      box-shadow: inset 1px 1px 0 var(--bevel-highlight-subtle, #424242);
    }

    .seg:disabled {
      opacity: var(--opacity-disabled, 0.5);
      cursor: default;
    }

    .seg:focus-visible {
      outline: 2px solid var(--accent, #2f7dd2);
      outline-offset: -2px;
    }
  `;

  render() {
    const active = this.value || this.parsedItems.find(i => !i.disabled)?.id || '';
    return html`
      <div role="radiogroup" aria-label=${this.label || 'Options'} part="group" style="display:contents">
        ${this.parsedItems.map(item => html`
          <button
            class="seg"
            data-seg=${item.id}
            role="radio"
            tabindex=${item.id === active ? '0' : '-1'}
            aria-checked=${item.id === this.value ? 'true' : 'false'}
            ?disabled=${item.disabled}
            @click=${() => this.select(item.id)}
            @keydown=${(e: KeyboardEvent) => this.onKeydown(e, item.id)}
            part="seg"
          >${item.label}</button>
        `)}
      </div>
    `;
  }
}
