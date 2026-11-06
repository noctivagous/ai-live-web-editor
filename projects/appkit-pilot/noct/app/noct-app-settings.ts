import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctAppSettingsMeta: NoctComponentMeta = {
  tag: 'noct-app-settings',
  category: 'app',
  description: 'Application settings panel with organized sections',
  props: {
    show: {
      type: 'boolean',
      default: false,
      description: 'Show/hide settings panel'
    },
    title: {
      type: 'string',
      default: 'App Settings',
      description: 'Settings panel title'
    }
  },
  slots: {
    'general': 'General settings section',
    'advanced': 'Advanced settings section',
    default: 'Main settings content'
  },
  emits: ['settings-change', 'close'],
  dependencies: [],
  examples: [
    '<noct-app-settings show><noct-stack slot="general">...</noct-stack></noct-app-settings>'
  ]
};

@customElement('noct-app-settings')
@WithMetadata(NoctAppSettingsMeta)
export class NoctAppSettings extends NoctElement {
  @property({ type: Boolean })
  show = false;

  @property({ type: String })
  title = 'App Settings';

  static styles = css`
    :host {
      display: block;
    }
    
    .settings-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    
    .settings-panel {
      background: #1e1e1e;
      border-radius: 8px;
      padding: 24px;
      max-width: 600px;
      max-height: 80vh;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--bg-raised, #3a3a3a) var(--bg-pressed, #222222);
      color: #e0e0e0;
    }
    
    .settings-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #333;
    }
    
    h2 {
      color: #7c4dff;
      margin: 0;
    }
    
    .close-btn {
      background: none;
      border: none;
      color: #888;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
    }
    
    .close-btn:hover {
      color: #e0e0e0;
    }
    
    .section {
      margin-bottom: 20px;
    }
    
    .section h3 {
      color: #bb86fc;
      margin-bottom: 12px;
    }
  `;

  render() {
    if (!this.show) return html``;

    return html`
      <div class="settings-overlay" @click=${this.handleOverlayClick}>
        <div class="settings-panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="settings-header">
            <h2>${this.title}</h2>
            <button class="close-btn" @click=${this.close}>&times;</button>
          </div>
          
          <div class="section">
            <h3>General</h3>
            <slot name="general"></slot>
          </div>
          
          <div class="section">
            <h3>Advanced</h3>
            <slot name="advanced"></slot>
          </div>
          
          <slot></slot>
        </div>
      </div>
    `;
  }

  private handleOverlayClick(e: Event) {
    if (e.target === e.currentTarget) {
      this.close();
    }
  }

  private close() {
    this.show = false;
    this.emitEvent('close', {});
  }
}
