/**
 * Component metadata interface for AI discovery
 * Every NoctCode component exports metadata so AI can query:
 * "what component handles layout?" without vector search
 */
export interface NoctComponentMeta {
  tag: string;
  category: string;
  description: string;
  props: Record<string, NoctPropMeta>;
  slots: Record<string, string>;
  emits: string[];
  dependencies: string[];
  examples?: string[];
}

export interface NoctPropMeta {
  type: string | string[];
  default?: unknown;
  required?: boolean;
  description?: string;
}

/**
 * Decorator to attach metadata to component class
 */
export function WithMetadata(meta: NoctComponentMeta) {
  return function <T extends new (...args: any[]) => any>(constructor: T) {
    return class extends constructor {
      static metadata = meta;
    };
  };
}

/**
 * Get metadata from a component class
 */
export function getComponentMetadata(tag: string): NoctComponentMeta | undefined {
  const el = customElements.get(tag);
  if (el && 'metadata' in el) {
    return (el as any).metadata;
  }
  return undefined;
}
