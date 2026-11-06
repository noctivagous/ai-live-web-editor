import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctSplitterMeta: NoctComponentMeta = {
  tag: 'noct-splitter',
  category: 'layout',
  description: 'Resizable split panes with mouse-drag and keyboard-adjustable divider',
  props: {
    direction: {
      type: ['horizontal', 'vertical'],
      default: 'horizontal',
      description: 'Pane arrangement: side-by-side (horizontal) or stacked (vertical)'
    },
    position: {
      type: 'number',
      default: 240,
      description: 'Divider offset in pixels from the start edge'
    },
    min: {
      type: 'number',
      default: 120,
      description: 'Minimum pane size in pixels'
    },
    max: {
      type: 'number',
      default: 800,
      description: 'Maximum first-pane size in pixels'
    }
  },
  slots: {
    first: 'First (start) pane content',
    second: 'Second (end) pane content',
    default: 'Pane content when named slots are unused (even children split)'
  },
  emits: ['splitter-move'],
  dependencies: [],
  examples: [
    '<noct-splitter position="240"><div slot="first">Sidebar</div><div slot="second">Main</div></noct-splitter>'
  ]
};

@customElement('noct-splitter')
@WithMetadata(NoctSplitterMeta)
export class NoctSplitter extends NoctElement {
  @property({ type: String })
  direction: 'horizontal' | 'vertical' = 'horizontal';

  @property({ type: Number })
  position = 240;

  @property({ type: Number })
  min = 120;

  @property({ type: Number })
  max = 800;

  private dragging = false;
  private dragStart = 0;
  private dragOrig = 0;

  private clamp(value: number): number {
    return Math.min(this.max, Math.max(this.min, Math.round(value)));
  }

  private onHandlePointerDown(e: PointerEvent) {
    this.dragging = true;
    this.dragStart = this.direction === 'horizontal' ? e.clientX : e.clientY;
    this.dragOrig = this.position;
    this.setPointerCapture(e.pointerId);
  }

  private onHandlePointerMove(e: PointerEvent) {
    if (!this.dragging) return;
    const current = this.direction === 'horizontal' ? e.clientX : e.clientY;
    this.position = this.clamp(this.dragOrig + (current - this.dragStart));
    this.emitEvent('splitter-move', { position: this.position });
  }

  private onHandlePointerUp(e: PointerEvent) {
    if (!this.dragging) return;
    this.dragging = false;
    this.releasePointerCapture(e.pointerId);
  }

  private onHandleKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 1 : 10;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = this.position + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = this.position - step;
    else if (e.key === 'Home') next = this.min;
    else if (e.key === 'End') next = this.max;
    if (next === null) return;
    e.preventDefault();
    this.position = this.clamp(next);
    this.emitEvent('splitter-move', { position: this.position });
  }

  static styles = css`
    :host {
      display: grid;
      box-sizing: border-box;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
    }

    :host([direction="horizontal"]) {
      grid-template-columns: var(--split-pos, 240px) 6px 1fr;
      grid-template-rows: 1fr;
    }

    :host([direction="vertical"]) {
      grid-template-columns: 1fr;
      grid-template-rows: var(--split-pos, 240px) 6px 1fr;
    }

    .pane {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--bg-raised, #3a3a3a) var(--bg-pressed, #222222);
    }

    .handle {
      background: var(--bg-header, #323232);
      border: none;
      padding: 0;
      cursor: col-resize;
      min-width: 0;
      min-height: 0;
    }

    :host([direction="vertical"]) .handle {
      cursor: row-resize;
    }

    .handle:hover {
      background: var(--bg-hover, #404040);
    }

    .handle:focus-visible {
      outline: 2px solid var(--accent, #2f7dd2);
      outline-offset: -2px;
    }
  `;

  render() {
    const orient = this.direction === 'horizontal' ? 'vertical' : 'horizontal';
    return html`
      <div class="pane" part="first-pane"><slot name="first"></slot><slot></slot></div>
      <div
        class="handle"
        part="handle"
        role="separator"
        aria-orientation=${orient}
        aria-valuenow=${this.position}
        aria-valuemin=${this.min}
        aria-valuemax=${this.max}
        aria-label="Resize panes. Arrow keys adjust, Shift plus arrows fine-tune."
        tabindex="0"
        style="touch-action:none"
        @pointerdown=${this.onHandlePointerDown}
        @pointermove=${this.onHandlePointerMove}
        @pointerup=${this.onHandlePointerUp}
        @keydown=${this.onHandleKeydown}
      ></div>
      <div class="pane" part="second-pane"><slot name="second"></slot></div>
    `;
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (changedProperties.has('position')) {
      this.style.setProperty('--split-pos', `${this.clamp(this.position)}px`);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.setProperty('--split-pos', `${this.clamp(this.position)}px`);
  }
}
