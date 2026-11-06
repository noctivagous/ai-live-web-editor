import { LitElement, css } from 'lit';
import { html as staticHtml, unsafeStatic } from 'lit/static-html.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, property } from 'lit/decorators.js';
import { NoctElement } from '../core/NoctElement.js';
import { WithMetadata, NoctComponentMeta } from '../core/metadata.js';

export const NoctTagMeta: NoctComponentMeta = {
  tag: 'noct-tag',
  category: 'layout',
  description: 'Generic container element to replace div/header/span in NoctCode apps',
  props: {
    as: {
      type: ['div', 'header', 'footer', 'main', 'section', 'article', 'aside', 'nav', 'span', 'p', 'h1', 'h2', 'h3', 'a'],
      default: 'div',
      description: 'HTML element to render as (for semantic HTML); as="a" forwards href'
    },
    role: {
      type: 'string',
      required: false,
      description: 'ARIA role for accessibility'
    },
    inline: {
      type: 'boolean',
      default: false,
      description: 'Render as inline element (span-like)'
    }
  },
  slots: {
    default: 'Tag content'
  },
  emits: ['tag-click'],
  dependencies: [],
  examples: [
    '<noct-tag as="header">Header content</noct-tag>',
    '<noct-tag as="nav" role="navigation">Nav items</noct-tag>',
    '<noct-tag inline>Inline text</noct-tag>'
  ]
};

@customElement('noct-tag')
@WithMetadata(NoctTagMeta)
export class NoctTag extends NoctElement {
  @property({ type: String })
  as = 'div';

  @property({ type: String })
  role = '';

  @property({ type: Boolean })
  inline = false;

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
    }
    
    :host([inline]) {
      display: inline;
    }
    
    .tag-root {
      width: 100%;
      height: 100%;
      margin: 0;
    }
  `;

  render() {
    const tag = unsafeStatic(this.inline ? 'span' : this.as);
    const ariaRole = this.role || this.getDefaultRole();
    // Forward href so as="a" renders a real, keyboard-focusable link.
    const href = this.as === 'a' ? (this.getAttribute('href') ?? undefined) : undefined;

    return staticHtml`
      <${tag}
        class="tag-root"
        part="tag-root"
        role="${ariaRole}"
        href="${ifDefined(href)}"
        @click=${(e: Event) => this.emitEvent('tag-click', { originalEvent: e })}
      >
        <slot></slot>
      </${tag}>
    `;
  }

  private getDefaultRole(): string {
    const roleMap: Record<string, string> = {
      'nav': 'navigation',
      'header': 'banner',
      'footer': 'contentinfo',
      'main': 'main',
      'aside': 'complementary',
      'section': 'region',
      'article': 'article'
    };
    return roleMap[this.as] || '';
  }
}
