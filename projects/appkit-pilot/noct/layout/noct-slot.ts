import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctSlotMeta: NoctComponentMeta = {
  tag: 'noct-slot',
  category: 'layout',
  description: 'Named slot container for slot-based composition',
  props: {
    name: {
      type: 'string',
      default: '',
      description: 'Slot name (empty for default slot)'
    },
    fallback: {
      type: 'string',
      required: false,
      description: 'Fallback content when slot is empty'
    }
  },
  slots: {
    default: 'Content to place in this slot',
    fallback: 'Fallback content when no content provided'
  },
  emits: ['slot-change'],
  dependencies: [],
  examples: [
    '<noct-slot name="header"><h1>Default Header</h1></noct-slot>',
    '<noct-slot name="sidebar"></noct-slot>'
  ]
};

@customElement('noct-slot')
@WithMetadata(NoctSlotMeta)
export class NoctSlot extends NoctElement {
  @property({ type: String })
  name = '';

  @property({ type: String })
  fallback = '';

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
    }
    
    ::slotted(*) {
      box-sizing: border-box;
    }
  `;

  render() {
    return html`
      <slot name="${this.name}">
        ${this.fallback ? html`<span>${this.fallback}</span>` : ''}
      </slot>
    `;
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has('name')) {
      this.emitEvent('slot-change', { name: this.name });
    }
  }
}
