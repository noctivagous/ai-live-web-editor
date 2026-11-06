/**
 * Catalog stock session state (phase-11-06 §G): which component
 * stocks the catalog serves by default. The shadcn (React) stock
 * is the default. The Noct AppKit (Lit) stock is OFF by default —
 * it turns on only for projects that opt in via the manifest
 * (`project.ai.json` → `"appkit": true`), adopted into this
 * session on project select, the same pattern as the device
 * target (deviceSession). An exact-tag lookup or an explicit
 * includeAppkit tool call can still reach AppKit entries while
 * the stock is off; search and the brief cannot.
 */

let appkitEnabled = false

export function getAppkitEnabled(): boolean {
  return appkitEnabled
}

export function setAppkitEnabled(enabled: boolean): boolean {
  appkitEnabled = enabled
  return appkitEnabled
}
