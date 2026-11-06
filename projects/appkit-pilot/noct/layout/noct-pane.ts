import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctPaneMeta: NoctComponentMeta = {
  tag: 'noct-pane',
  category: 'layout',
  description: 'Headerless beveled container for control clusters, toolbar rows, and sidebar sections',
  props: {
    pad: {
      type: ['normal', 'tight', 'none'],
      default: 'normal',
      description: 'Body padding: normal (16px), tight (8px), or none'
    }
  },
  slots: {
    default: 'Pane content'
  },
  emits: [],
  dependencies: [],
  examples: [
    '<noct-pane><button>2 Col</button><button>3 Col</button></noct-pane>',
    '<noct-pane pad="none"><noct-palette></noct-palette></noct-pane>'
  ]
};

@customElement('noct-pane')
@WithMetadata(NoctPaneMeta)
export class NoctPane extends NoctElement {
  @property({ type: String })
  pad = 'normal';

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

    .body {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-sm, 8px);
      padding: var(--space-lg, 16px);
      min-width: 0;
    }

    :host([pad="tight"]) .body {
      padding: var(--space-sm, 8px);
      gap: 4px;
    }

    :host([pad="none"]) .body {
      display: block;
      padding: 0;
    }

    ::slotted(*) {
      min-width: 0;
    }
  `;

  render() {
    return html`
      <div class="body" part="body">
        <slot></slot>
      </div>
    `;
  }
}
