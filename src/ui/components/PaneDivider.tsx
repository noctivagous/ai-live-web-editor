import React from 'react'

function hoverable(e: React.MouseEvent<HTMLDivElement>, on: boolean) {
  e.currentTarget.style.background = on ? '#2a4a6f' : '#17171b'
}

export function VDivider({ onMouseDown, title }: {
  onMouseDown: (e: React.MouseEvent) => void
  title: string
}) {
  return (
    <div onMouseDown={onMouseDown} title={title}
      style={{ width: 5, cursor: 'col-resize', background: '#17171b', flexShrink: 0, borderRadius: 3 }}
      onMouseEnter={e => hoverable(e, true)}
      onMouseLeave={e => hoverable(e, false)} />
  )
}

export function HDivider({ onMouseDown, title }: {
  onMouseDown: (e: React.MouseEvent) => void
  title: string
}) {
  return (
    <div onMouseDown={onMouseDown} title={title}
      style={{ height: 5, cursor: 'row-resize', background: '#17171b', flexShrink: 0, borderRadius: 3 }}
      onMouseEnter={e => hoverable(e, true)}
      onMouseLeave={e => hoverable(e, false)} />
  )
}
