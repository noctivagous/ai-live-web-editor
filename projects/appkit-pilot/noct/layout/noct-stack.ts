import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctStackMeta: NoctComponentMeta = {
  tag: 'noct-stack',
  category: 'layout',
  description: 'Flexbox stack layout for vertical or horizontal arrangement',
  props: {
    direction: {
      type: ['row', 'column', 'row-reverse', 'column-reverse'],
      default: 'column',
      description: 'Stack direction (flex-direction)'
    },
    gap: {
      type: 'string',
      default: '0',
      description: 'Gap between items (gap property)'
    },
    align: {
      type: ['start', 'center', 'end', 'stretch'],
      default: 'stretch',
      description: 'Alignment on cross axis (align-items)'
    },
    justify: {
      type: ['start', 'center', 'end', 'between', 'around', 'evenly'],
      default: 'start',
      description: 'Distribution on main axis (justify-content)'
    },
    wrap: {
      type: 'boolean',
      default: false,
      description: 'Allow items to wrap (flex-wrap)'
    }
  },
  slots: {
    default: 'Stack items'
  },
  emits: ['layout-change'],
  dependencies: [],
  examples: [
    '<noct-stack direction="row" gap="16px"><button>One</button><button>Two</button></noct-stack>',
    '<noct-stack align="center" justify="center"></noct-stack>'
  ]
};

@customElement('noct-stack')
@WithMetadata(NoctStackMeta)
export class NoctStack extends NoctElement {
  @property({ type: String })
  direction = 'column';

  @property({ type: String })
  gap = '0';

  @property({ type: String })
  align = 'stretch';

  @property({ type: String })
  justify = 'start';

  @property({ type: Boolean })
  wrap = false;

  static styles = css`
    :host {
      display: flex;
      box-sizing: border-box;
    }
  `;

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has('direction') || 
        changedProperties.has('gap') || 
        changedProperties.has('align') || 
        changedProperties.has('justify') ||
        changedProperties.has('wrap')) {
      this.updateStackStyles();
      this.emitEvent('layout-change', {
        direction: this.direction,
        gap: this.gap
      });
    }
  }

  private updateStackStyles() {
    this.style.flexDirection = this.direction;
    this.style.gap = this.gap;
    this.style.alignItems = this.align;
    
    const justifyMap: Record<string, string> = {
      'start': 'flex-start',
      'end': 'flex-end',
      'between': 'space-between',
      'around': 'space-around',
      'evenly': 'space-evenly'
    };
    this.style.justifyContent = justifyMap[this.justify] || this.justify;
    this.style.flexWrap = this.wrap ? 'wrap' : 'nowrap';
  }

  render() {
    return html`<slot></slot>`;
  }
}
