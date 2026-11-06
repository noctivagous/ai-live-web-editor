import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctWellMeta: NoctComponentMeta = {
  tag: 'noct-well',
  category: 'layout',
  description: 'Recessed readout surface for outputs, logs, previews, and read-only values',
  props: {
    label: {
      type: 'string',
      required: false,
      description: 'Small caption shown above the recessed surface'
    },
    mono: {
      type: 'boolean',
      default: false,
      description: 'Render content in the technical mono stack with tabular figures'
    }
  },
  slots: {
    default: 'Well content'
  },
  emits: [],
  dependencies: [],
  examples: [
    '<noct-well label="Output"><pre>{…}</pre></noct-well>',
    '<noct-well mono>selected: none</noct-well>'
  ]
};

@customElement('noct-well')
@WithMetadata(NoctWellMeta)
export class NoctWell extends NoctElement {
  @property({ type: String })
  label = '';

  @property({ type: Boolean })
  mono = false;

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      min-width: 0;
    }

    .label {
      display: block;
      font-size: var(--font-label, 11px);
      line-height: var(--line-label, 16px);
      letter-spacing: var(--letter-spacing-micro, 0.5px);
      text-transform: uppercase;
      color: var(--text-tertiary, #888);
      margin: 0 0 var(--space-xs, 4px) 2px;
    }

    .surface {
      background: var(--bg-input, #1f1f1f);
      border: 1px solid var(--bevel-shadow, #1a1a1a);
      box-shadow: inset 1px 1px 2px rgba(0, 0, 0, 0.5);
      border-radius: 0;
      padding: 12px;
      color: var(--text-primary, #d0d0d0);
      font-size: var(--font-base, 13px);
      line-height: var(--line-base, 20px);
      overflow: auto;
      min-width: 0;
    }

    :host([mono]) .surface {
      font-family: var(--font-mono-tech, var(--font-mono));
      font-size: var(--font-micro, 10px);
      line-height: var(--line-micro, 16px);
      font-feature-settings: var(--font-feature-numeric, "tnum" 1);
      white-space: pre;
    }

    ::slotted(pre) {
      margin: 0;
      font: inherit;
      white-space: pre-wrap;
    }
  `;

  render() {
    return html`
      ${this.label ? html`<span class="label" part="label">${this.label}</span>` : ''}
      <div class="surface" part="surface">
        <slot></slot>
      </div>
    `;
  }
}
