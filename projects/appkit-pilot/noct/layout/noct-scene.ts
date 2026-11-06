import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctSceneMeta: NoctComponentMeta = {
  tag: 'noct-scene',
  category: 'layout',
  description: 'GUI scene container with snap points and zoom/pan support',
  props: {
    snap: {
      type: ['none', 'corners', 'edges', 'grid'],
      default: 'none',
      description: 'Snap behavior for child elements'
    },
    zoom: {
      type: 'boolean',
      default: false,
      description: 'Enable zoom functionality'
    },
    pan: {
      type: 'boolean',
      default: false,
      description: 'Enable pan functionality'
    },
    width: {
      type: 'string',
      default: '100%',
      description: 'Scene width'
    },
    height: {
      type: 'string',
      default: '100%',
      description: 'Scene height'
    }
  },
  slots: {
    default: 'Scene content (floating elements, windows, etc.)'
  },
  emits: ['scene-ready', 'zoom-change', 'pan-change'],
  dependencies: [],
  examples: [
    '<noct-scene snap="corners" width="800px" height="600px"></noct-scene>',
    '<noct-scene zoom pan></noct-scene>'
  ]
};

@customElement('noct-scene')
@WithMetadata(NoctSceneMeta)
export class NoctScene extends NoctElement {
  @property({ type: String })
  snap = 'none';

  @property({ type: Boolean })
  zoom = false;

  @property({ type: Boolean })
  pan = false;

  @property({ type: String })
  width = '100%';

  @property({ type: String })
  height = '100%';

  static styles = css`
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      box-sizing: border-box;
    }
    
    .scene-container {
      width: 100%;
      height: 100%;
      position: relative;
    }
  `;

  firstUpdated() {
    setTimeout(() => {
      this.emitEvent('scene-ready', {
        snap: this.snap,
        zoom: this.zoom,
        pan: this.pan
      });
    });
  }

  render() {
    return html`
      <div 
        class="scene-container"
        style="width: ${this.width}; height: ${this.height};"
      >
        <slot></slot>
      </div>
    `;
  }
}
