import type React from 'react'

/**
 * Original menu-bar icons, authored for this editor — none of them come
 * from lucide. Every glyph follows the lucide contract so the set is
 * interchangeable: 24×24 viewBox, `fill="none"`, 2px round-cap stroke in
 * `currentColor`. Theme flexibility falls out of that: each icon inherits
 * the surrounding text color, so all five UI themes, hover states, and
 * the open-menu inverted state recolor the marks with zero per-theme
 * work. Anything needing a fixed brand color takes an explicit prop
 * instead of `currentColor`.
 *
 * Usage mirrors lucide: `<ProjectIcon size={13} aria-hidden />`.
 */

export interface MenuIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
}

function frame({ size = 24, ...props }: MenuIconProps, children: React.ReactNode) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Project — a plan document on a foundation rule. */
export function ProjectIcon(props: MenuIconProps) {
  return frame(props, (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
      <path d="M4 21h16" />
    </>
  ))
}

/** Agent Actions — a single four-point working spark. */
export function AgentActionsIcon(props: MenuIconProps) {
  return frame(props, (
    <path d="M12 3c.7 4.6 2.7 7.4 9 8.2-6.3.8-8.3 3.6-9 8.2-.7-4.6-2.7-7.4-9-8.2 6.3-.8 8.3-3.6 9-8.2z" />
  ))
}

/** Insert — a plus between placement brackets. */
export function InsertIcon(props: MenuIconProps) {
  return frame(props, (
    <>
      <path d="M9 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2" />
      <path d="M15 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
      <path d="M12 9v6" />
      <path d="M9 12h6" />
    </>
  ))
}

/** Verify — a check set in a hexagon seal. */
export function VerifyIcon(props: MenuIconProps) {
  return frame(props, (
    <>
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" />
      <path d="M8.5 12.5l2.5 2.5 5-5.5" />
    </>
  ))
}

/** Wizards — a conjurer's hat: cone, band, and brim. */
export function WizardsIcon(props: MenuIconProps) {
  return frame(props, (
    <>
      <path d="M12 3 7 17h10z" />
      <path d="M8.4 13.2h7.2" />
      <path d="M4 17h16" />
    </>
  ))
}

/** View — a split viewport with the active pane dotted. */
export function ViewIcon(props: MenuIconProps) {
  return frame(props, (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M12 5v14" />
      <circle cx="7.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ))
}

/** Settings — a control knob: closed dial, needle, hub. */
export function SettingsIcon(props: MenuIconProps) {
  return frame(props, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12l3.5-3.5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ))
}

/** Help — a lifebuoy: two rings and four spokes. */
export function HelpIcon(props: MenuIconProps) {
  return frame(props, (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
    </>
  ))
}
