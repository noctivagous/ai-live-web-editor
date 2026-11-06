import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

/**
 * Metadata for AI discovery
 */
export const NoctGridMeta: NoctComponentMeta = {
  tag: 'noct-grid',
  category: 'layout',
  description: 'CSS Grid layout with deterministic behavior for reliable AI composition',
  props: {
    columns: {
      type: 'string',
      default: '1fr',
      description: 'Grid template columns (CSS grid-template-columns)'
    },
    rows: {
      type: 'string',
      default: 'auto',
      description: 'Grid template rows (CSS grid-template-rows)'
    },
    gap: {
      type: 'string',
      default: '0',
      description: 'Gap between grid items (CSS gap)'
    },
    template: {
      type: 'string',
      required: false,
      description: 'Full grid-template shorthand'
    }
  },
  slots: {
    default: 'Grid items to display'
  },
  emits: ['layout-change'],
  dependencies: [],
  examples: [
    '<noct-grid columns="1fr 1fr 1fr" gap="16px"><div>Item 1</div><div>Item 2</div></noct-grid>',
    '<noct-grid template="repeat(3, 1fr) / auto"></noct-grid>'
  ]
};

@customElement('noct-grid')
@WithMetadata(NoctGridMeta)
export class NoctGrid extends NoctElement {
  @property({ type: String })
  columns = '1fr';

  @property({ type: String })
  rows = 'auto';

  @property({ type: String })
  gap = '0';

  @property({ type: String })
  template = '';

  static styles = css`
    :host {
      display: grid;
      box-sizing: border-box;
    }
  `;

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has('columns') || 
        changedProperties.has('rows') || 
        changedProperties.has('gap') || 
        changedProperties.has('template')) {
      this.updateGridStyles();
      this.emitEvent('layout-change', {
        columns: this.columns,
        rows: this.rows,
        gap: this.gap
      });
    }
  }

  private updateGridStyles() {
    if (this.template) {
      this.style.gridTemplate = this.template;
    } else {
      this.style.gridTemplateColumns = this.columns;
      this.style.gridTemplateRows = this.rows;
    }
    this.style.gap = this.gap;
  }

  render() {
    return html`<slot></slot>`;
  }
}
