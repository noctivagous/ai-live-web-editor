import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import { NoctComponentMeta, WithMetadata } from './metadata.js';

/**
 * Base class for all NoctCode components
 * Provides common functionality and metadata support
 */
export class NoctElement extends LitElement {
  /**
   * Get component metadata
   */
  static getMetadata(): NoctComponentMeta | undefined {
    return (this as any).metadata;
  }

  /**
   * Component version for tracking
   */
  @property({ type: String })
  version = '0.1.0';

  /**
   * Debug mode - logs component lifecycle
   */
  @property({ type: Boolean })
  debug = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.debug) {
      console.log(`[NoctCode] ${this.tagName.toLowerCase()} connected`, this);
    }
  }

  /**
   * Helper to emit typed events
   */
  protected emitEvent(eventName: string, detail?: any) {
    const event = new CustomEvent(eventName, {
      detail,
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
    if (this.debug) {
      console.log(`[NoctCode] Event emitted: ${eventName}`, detail);
    }
  }
}
