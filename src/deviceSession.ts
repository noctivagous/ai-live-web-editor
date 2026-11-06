/**
 * Device target session state (phase-11-06 §B): which target the
 * user is currently designing against. Server-global like the
 * sketch session, mirrored to both chat surfaces through the
 * workflow snapshot. The *declared* targets live in the project
 * manifest (projectConfig); this is only the current selection.
 */

export type DeviceTarget = 'phone' | 'tablet' | 'desktop'

export const DEVICE_TARGETS: DeviceTarget[] = ['phone', 'tablet', 'desktop']

export const DEVICE_WIDTHS: Record<DeviceTarget, number> = {
  phone: 375,
  tablet: 768,
  desktop: 1280,
}

export function parseDeviceTarget(value: unknown): DeviceTarget | null {
  return value === 'phone' || value === 'tablet' || value === 'desktop' ? value : null
}

export function parseDeviceTargets(value: unknown): DeviceTarget[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = DEVICE_TARGETS.filter(t => value.includes(t))
  return out.length ? out : undefined
}

let current: DeviceTarget = 'desktop'

export function getDeviceTarget(): DeviceTarget {
  return current
}

export function setDeviceTarget(target: DeviceTarget): DeviceTarget {
  current = target
  return current
}
