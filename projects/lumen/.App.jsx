import { useEffect, useMemo, useState } from 'react'

const THEMES = [
  { id: 'lumen', name: 'Lumen', swatch: '#c45c26' },
  { id: 'aurora', name: 'Aurora', swatch: '#3ee0c6' },
  { id: 'field', name: 'Field', swatch: '#3f7d4e' },
]

const NAV = [
  { id: 'Overview', icon: '◈', hint: 'Workspace pulse' },
  { id: 'Inbox', icon: '✉', hint: 'unread' },
  { id: 'Projects', icon: '▦', hint: '4 active' },
  { id: 'Calendar', icon: '◷', hint: 'Today' },
  { id: 'Files', icon: '▤', hint: 'Shared drive' },
  { id: 'Settings', icon: '⚙', hint: 'Workspace' },
]

const CARDS = {
  Overview: [
    { k: 'Open tasks', v: '18', d: '3 due today' },
    { k: 'In review', v: '6', d: '2 waiting on you' },
    { k: 'Shipped', v: '11', d: 'this week' },
  ],
  Inbox: [
    { k: 'Unread', v: '12', d: '4 mentions' },
    { k: 'Assigned', v: '7', d: 'needs a reply' },
    { k: 'Snoozed', v: '3', d: 'back tomorrow' },
  ],
  Projects: [
    { k: 'Active', v: '4', d: 'on track' },
    { k: 'At risk', v: '1', d: 'needs a decision' },
    { k: 'Archived', v: '9', d: 'last quarter' },
  ],
  Calendar: [
    { k: 'Today', v: '3', d: 'meetings' },
    { k: 'Focus', v: '2h', d: 'blocked' },
    { k: 'This week', v: '14', d: 'events' },
  ],
  Files: [
    { k: 'Recent', v: '28', d: 'updated today' },
    { k: 'Shared', v: '64', d: 'with the team' },
    { k: 'Storage', v: '41%', d: 'of 100 GB' },
  ],
  Settings: [
    { k: 'Members', v: '16', d: '2 pending' },
    { k: 'Roles', v: '4', d: 'custom' },
    { k: 'Plan', v: 'Pro', d: 'renews May 12' },
  ],
}

const PROJECT_FILTERS = ['All', 'Active', 'At risk', 'Archived']

const PROJECTS = [
  {
    id: 'aurora-pilot',
    name: 'Aurora pilot',
    code: 'AUR-12',
    status: 'Active',
    lead: 'Jonah Park',
    initials: 'JP',
    progress: 72,
    due: 'Apr 18',
    updated: 'Today',
    summary: 'Night palette and theme switcher for the greenhouse cohort. Search contrast is the last open token.',
    next: 'Lift the search field one step so it holds on daylight shots and night shots.',
    milestones: [
      { name: 'Token set', done: true },
      { name: 'Theme switcher', done: true },
      { name: 'Contrast pass', done: false },
      { name: 'Pilot freeze', done: false },
    ],
    team: [
      { name: 'Jonah Park', initials: 'JP' },
      { name: 'Avery Chen', initials: 'AC' },
      { name: 'Sam Okonkwo', initials: 'SO' },
    ],
  },
  {
    id: 'q2-launch',
    name: 'Q2 launch',
    code: 'Q2-04',
    status: 'Active',
    lead: 'Mira Solano',
    initials: 'MS',
    progress: 64,
    due: 'Apr 24',
    updated: 'Today',
    summary: 'Copy deck and field notes for Thursday’s review. The ship train is held until sign-off.',
    next: 'Decide whether Overview keeps “workspace pulse” as its subtitle.',
    milestones: [
      { name: 'Field notes', done: true },
      { name: 'Copy deck', done: true },
      { name: 'Sign-off', done: false },
      { name: 'Thursday review', done: false },
    ],
    team: [
      { name: 'Mira Solano', initials: 'MS' },
      { name: 'Avery Chen', initials: 'AC' },
      { name: 'Priya Nair', initials: 'PN' },
    ],
  },
  {
    id: 'onboarding',
    name: 'Onboarding empty state',
    code: 'ONB-07',
    status: 'Active',
    lead: 'Nora Feldman',
    initials: 'NF',
    progress: 41,
    due: 'Apr 11',
    updated: 'Mon',
    summary: 'The first-run inbox should read as a welcome, not a loading skeleton.',
    next: 'Replace the placeholder bars before Friday’s onboarding trial.',
    milestones: [
      { name: 'Research notes', done: true },
      { name: 'Welcome copy', done: false },
      { name: 'Empty state', done: false },
      { name: 'Trial', done: false },
    ],
    team: [
      { name: 'Nora Feldman', initials: 'NF' },
      { name: 'Avery Chen', initials: 'AC' },
      { name: 'Priya Nair', initials: 'PN' },
    ],
  },
  {
    id: 'field-notes',
    name: 'Field notes',
    code: 'FLD-03',
    status: 'Active',
    lead: 'Priya Nair',
    initials: 'PN',
    progress: 88,
    due: 'Apr 4',
    updated: 'Today',
    summary: 'Twelve greenhouse interviews, three patterns. Quotes are tagged for the empty state.',
    next: 'Lift the tagged quotes into the inbox empty state.',
    milestones: [
      { name: 'Interviews', done: true },
      { name: 'Patterns', done: true },
      { name: 'Tag quotes', done: true },
      { name: 'Handoff', done: false },
    ],
    team: [
      { name: 'Priya Nair', initials: 'PN' },
      { name: 'Nora Feldman', initials: 'NF' },
    ],
  },
  {
    id: 'inbox-pane',
    name: 'Inbox reading pane',
    code: 'INB-19',
    status: 'At risk',
    lead: 'Avery Chen',
    initials: 'AC',
    progress: 54,
    due: 'Apr 10',
    updated: 'Yesterday',
    summary: 'Reading pane, unread dot, and snooze label are still open from crit. Needs a decision before Friday.',
    next: 'Lock the three crit comments, or the weekly pulse stays at risk.',
    milestones: [
      { name: 'Wireframe', done: true },
      { name: 'Unread dot', done: false },
      { name: 'Snooze label', done: false },
      { name: 'Lock', done: false },
    ],
    team: [
      { name: 'Avery Chen', initials: 'AC' },
      { name: 'Design Crit', initials: 'DC' },
      { name: 'Kai Ito', initials: 'KI' },
    ],
  },
  {
    id: 'brand-v3',
    name: 'Brand kit v3',
    code: 'BRD-03',
    status: 'Archived',
    lead: 'Sam Okonkwo',
    initials: 'SO',
    progress: 100,
    due: 'Mar 2',
    updated: 'Mar 2',
    summary: 'Orange-only mark. Replaced by the three theme swatches in kit v4.',
    next: 'Nothing open. Settings avatars were the last screen still on v3.',
    milestones: [
      { name: 'Mark', done: true },
      { name: 'Swatches', done: true },
      { name: 'Handoff', done: true },
    ],
    team: [{ name: 'Sam Okonkwo', initials: 'SO' }],
  },
  {
    id: 'sidebar-rail',
    name: 'Sidebar rail',
    code: 'NAV-02',
    status: 'Archived',
    lead: 'Kai Ito',
    initials: 'KI',
    progress: 100,
    due: 'Mar 8',
    updated: 'Mar 8',
    summary: 'Collapse keeps the icon. The unread count moves to the tooltip instead of a badge.',
    next: 'Closed. No badge unless every section gets one.',
    milestones: [
      { name: 'Collapse', done: true },
      { name: 'Tooltip', done: true },
    ],
    team: [
      { name: 'Kai Ito', initials: 'KI' },
      { name: 'Avery Chen', initials: 'AC' },
    ],
  },
  {
    id: 'type-license',
    name: 'Type license',
    code: 'TYP-1842',
    status: 'Archived',
    lead: 'Ellis Ward',
    initials: 'EW',
    progress: 100,
    due: 'Feb 20',
    updated: 'Feb 20',
    summary: 'Display cut cleared for product UI. The marketing site still needs the webfont add-on.',
    next: 'Closed for product. Split the PO only if marketing starts.',
    milestones: [
      { name: 'Quote', done: true },
      { name: 'Invoice', done: true },
    ],
    team: [
      { name: 'Ellis Ward', initials: 'EW' },
      { name: 'Mira Solano', initials: 'MS' },
    ],
  },
  {
    id: 'offsite',
    name: 'Offsite shortlist',
    code: 'OFF-01',
    status: 'Archived',
    lead: 'Remy Cho',
    initials: 'RC',
    progress: 100,
    due: 'Mar 14',
    updated: 'Mar 14',
    summary: 'Three spaces. Field studio had the focus room; the hold was released.',
    next: 'Closed. Reopen only if the June date moves.',
    milestones: [
      { name: 'Shortlist', done: true },
      { name: 'Hold', done: true },
      { name: 'Release', done: true },
    ],
    team: [
      { name: 'Remy Cho', initials: 'RC' },
      { name: 'Priya Nair', initials: 'PN' },
    ],
  },
  {
    id: 'greenhouse-march',
    name: 'Greenhouse March',
    code: 'FLD-01',
    status: 'Archived',
    lead: 'Priya Nair',
    initials: 'PN',
    progress: 100,
    due: 'Mar 21',
    updated: 'Mar 21',
    summary: 'Visit notes filed under Field / March. Patterns moved to the Field notes project.',
    next: 'Closed. Quotes live with Field notes now.',
    milestones: [
      { name: 'Visit', done: true },
      { name: 'Notes filed', done: true },
    ],
    team: [{ name: 'Priya Nair', initials: 'PN' }],
  },
  {
    id: 'weekly-pulse',
    name: 'Weekly pulse',
    code: 'PLS-09',
    status: 'Archived',
    lead: 'Team Lumen',
    initials: 'TL',
    progress: 100,
    due: 'Mar 28',
    updated: 'Mar 28',
    summary: 'Eleven shipped. The leftover at-risk item became the inbox reading pane.',
    next: 'Closed for last quarter.',
    milestones: [
      { name: 'Board review', done: true },
      { name: 'Archive', done: true },
    ],
    team: [{ name: 'Team Lumen', initials: 'TL' }],
  },
  {
    id: 'billing-seats',
    name: 'Billing seats',
    code: 'BIL-16',
    status: 'Archived',
    lead: 'Lumen Billing',
    initials: 'LB',
    progress: 100,
    due: 'Mar 1',
    updated: 'Mar 1',
    summary: 'Sixteen seats, no overage. Receipt path stays with finance@.',
    next: 'Closed. Pending members are a Settings task, not this project.',
    milestones: [
      { name: 'Seat count', done: true },
      { name: 'Receipt path', done: true },
    ],
    team: [{ name: 'Lumen Billing', initials: 'LB' }],
  },
  {
    id: 'crit-inbox',
    name: 'Inbox crit',
    code: 'CRT-03',
    status: 'Archived',
    lead: 'Design Crit',
    initials: 'DC',
    progress: 100,
    due: 'Mar 18',
    updated: 'Mar 18',
    summary: 'Three comments — reading pane, unread dot, snooze label — moved to the live project.',
    next: 'Closed. Follow-up lives on Inbox reading pane.',
    milestones: [
      { name: 'Crit', done: true },
      { name: 'Comments filed', done: true },
    ],
    team: [{ name: 'Design Crit', initials: 'DC' }],
  },
  {
    id: 'voice-note',
    name: 'Support voice note',
    code: 'BRD-04',
    status: 'Archived',
    lead: 'Sam Okonkwo',
    initials: 'SO',
    progress: 100,
    due: 'Mar 11',
    updated: 'Mar 11',
    summary: 'One-pager shipped with brand kit v4. Product UI does not need a change this week.',
    next: 'Closed.',
    milestones: [
      { name: 'Draft', done: true },
      { name: 'Ship with v4', done: true },
    ],
    team: [{ name: 'Sam Okonkwo', initials: 'SO' }],
  },
]

const EMAILS = [
  {
    id: 'mira-signoff',
    from: 'Mira Solano',
    initials: 'MS',
    email: 'mira@lumen.app',
    subject: 'Q2 launch checklist — need your sign-off',
    preview: 'Field notes are in. Can you approve the copy deck before Thursday’s review?',
    body: `Hi Avery,\n\nThe field notes from the Aurora pilot are in. Design locked the type ramp, and I dropped the copy deck in Files.\n\nCan you sign off before Thursday’s review? Two open questions:\n\n1. Do we keep “workspace pulse” as the Overview subtitle?\n2. Should the empty inbox mention snoozed threads?\n\nI’ll hold the ship train until I hear back.\n\n— Mira`,
    time: '9:14 AM',
    when: 'Today',
    unread: true,
    tag: 'Assigned',
  },
  {
    id: 'jonah-contrast',
    from: 'Jonah Park',
    initials: 'JP',
    email: 'jonah@lumen.app',
    subject: 'Re: Aurora contrast on the top bar',
    preview: 'Mentioned you — the search field disappears against the dark top bar at noon.',
    body: `Avery — flagging you on this because you own the theme tokens.\n\nOn Aurora, the search field and the top bar are almost the same value in daylight. I can still find it, but new folks keep clicking the title.\n\nI tried lifting --input-bg one step and it holds on both the greenhouse photos and the night shots. Happy to pair if you want a second pass before we freeze the palette.\n\nJonah`,
    time: '8:41 AM',
    when: 'Today',
    unread: true,
    tag: 'Mention',
  },
  {
    id: 'priya-notes',
    from: 'Priya Nair',
    initials: 'PN',
    email: 'priya@lumen.app',
    subject: 'Greenhouse visit notes are in Files',
    preview: 'Twelve interviews, three patterns. The inbox is where people expect the day to start.',
    body: `Avery,\n\nNotes from yesterday’s greenhouse visit are in the shared drive under Field / March.\n\nTwelve interviews, three patterns worth keeping:\n\n• People open Lumen to the inbox, not Overview.\n• “Assigned” means they owe a reply, not that they own the project.\n• Snooze only works if the thread comes back with the original ask still visible.\n\nI tagged the quotes you can lift straight into the empty state.\n\nPriya`,
    time: '7:55 AM',
    when: 'Today',
    unread: true,
    tag: null,
  },
  {
    id: 'standup-move',
    from: 'Lumen Calendar',
    initials: 'LC',
    email: 'calendar@lumen.app',
    subject: 'Standup moved to 10:30',
    preview: 'Room 2 is booked. Same agenda, twenty minutes later, notes doc unchanged.',
    body: `Your 10:00 standup was moved to 10:30 so Room 2 can finish the vendor call.\n\nSame agenda. Notes doc is unchanged. Avery is still facilitating.\n\nDecline if you need the earlier focus block — the notes will be in Files by 11.`,
    time: '7:02 AM',
    when: 'Today',
    unread: false,
    tag: null,
  },
  {
    id: 'ellis-invoice',
    from: 'Ellis Ward',
    initials: 'EW',
    email: 'ellis@foundrytype.co',
    subject: 'Snoozed: invoice for the type license',
    preview: 'Back tomorrow. The display cut is cleared for product UI, not for the marketing site.',
    body: `Avery,\n\nBringing this back as requested. Invoice 1842 covers the display cut for product UI only — the marketing site still needs the webfont add-on.\n\nAmount is unchanged from the quote Mira signed. Reply if you want me to split it into two POs.\n\nEllis Ward\nFoundry Type`,
    time: '4:18 PM',
    when: 'Yesterday',
    unread: false,
    tag: 'Snoozed',
  },
  {
    id: 'crit-comments',
    from: 'Design Crit',
    initials: 'DC',
    email: 'crit@lumen.app',
    subject: '3 comments on the inbox wireframe',
    preview: 'You were mentioned on the reading pane, the unread dot, and the snooze label.',
    body: `Three open comments mention you:\n\n1. Reading pane — keep the original ask above the fold, even on long threads.\n2. Unread dot — use the accent, not a second red, so themes stay coherent.\n3. Snooze label — “back tomorrow” tested clearer than a date alone.\n\nThread is in Files → Crit → Inbox. We’ll lock this in tomorrow’s review if no one objects.`,
    time: '2:06 PM',
    when: 'Yesterday',
    unread: true,
    tag: 'Mention',
  },
  {
    id: 'sam-brand',
    from: 'Sam Okonkwo',
    initials: 'SO',
    email: 'sam@lumen.app',
    subject: 'Brand kit v4 is in the shared drive',
    preview: 'Updated marks, the three theme swatches, and a one-page voice note for support.',
    body: `Kit v4 is up. I replaced the old orange-only mark with the three theme swatches and added a one-page voice note for support.\n\nNothing in the product UI needs to change this week. The avatar treatment in Settings is the only screen still on v3.\n\nSam`,
    time: '11:20 AM',
    when: 'Yesterday',
    unread: false,
    tag: null,
  },
  {
    id: 'nora-empty',
    from: 'Nora Feldman',
    initials: 'NF',
    email: 'nora@lumen.app',
    subject: 'Onboarding empty state needs a pass',
    preview: 'Assigned to you. The first-run inbox should not look like a loading skeleton.',
    body: `Avery — this one’s assigned to you.\n\nThe first-run inbox still uses the skeleton bars. New workspaces read that as “still loading” and wait. Priya’s notes say they expect a short list, even if it’s just a welcome note from us.\n\nCan you replace the placeholder before Friday’s onboarding trial? I can write the welcome copy if you want a draft tonight.\n\nNora`,
    time: '5:44 PM',
    when: 'Mon',
    unread: true,
    tag: 'Assigned',
  },
  {
    id: 'kai-sidebar',
    from: 'Kai Ito',
    initials: 'KI',
    email: 'kai@lumen.app',
    subject: 'Sidebar collapse clips the hint text',
    preview: 'When the rail is narrow, the unread count disappears. Fine if the icon stays.',
    body: `Small one. Collapsing the sidebar clips the hint under Inbox, so the unread count vanishes.\n\nThat’s fine if the icon stays and the tooltip still says how many are unread. I wouldn’t add a badge unless we do it for every section.\n\nKai`,
    time: '1:12 PM',
    when: 'Mon',
    unread: false,
    tag: null,
  },
  {
    id: 'billing-renewal',
    from: 'Lumen Billing',
    initials: 'LB',
    email: 'billing@lumen.app',
    subject: 'Pro plan renews May 12',
    preview: '16 seats, no overage. Receipt will go to finance@ the morning of renewal.',
    body: `Your Pro plan renews on May 12.\n\n16 seats, no overage this cycle. The receipt will go to finance@ the morning of renewal. Nothing to approve unless you want to add the two pending members before then.`,
    time: '9:00 AM',
    when: 'Mon',
    unread: false,
    tag: null,
  },
  {
    id: 'weekly-pulse',
    from: 'Team Lumen',
    initials: 'TL',
    email: 'pulse@lumen.app',
    subject: 'Weekly pulse: 11 shipped, 1 at risk',
    preview: 'Inbox is the at-risk item. Everything else on the board closed or moved cleanly.',
    body: `This week: 11 shipped, 1 at risk.\n\nThe at-risk item is the inbox canvas — still a placeholder while the rest of the shell is stable. Overview, themes, and the sidebar all closed.\n\nIf the message list lands before Friday, we can pull it back to on track.\n\n— Team Lumen`,
    time: '6:30 PM',
    when: 'Sun',
    unread: false,
    tag: null,
  },
  {
    id: 'remy-offsite',
    from: 'Remy Cho',
    initials: 'RC',
    email: 'remy@lumen.app',
    subject: 'Snoozed: vendor shortlist for the offsite',
    preview: 'Back tomorrow. Three spaces, one with a quiet room for the focus block.',
    body: `Bringing this back as you asked.\n\nThree spaces can hold the offsite:\n\n• North hall — cheapest, no quiet room.\n• Glasshouse — the one Priya liked, books through June.\n• Field studio — has a focus room and a kitchen.\n\nI can hold Field studio until Friday if you reply yes.\n\nRemy`,
    time: '11:05 AM',
    when: 'Sun',
    unread: false,
    tag: 'Snoozed',
  },
]

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const EVENTS = [
  {
    id: 'focus-morning',
    title: 'Focus block — inbox tokens',
    date: '2026-04-07',
    start: '8:00 AM',
    end: '10:00 AM',
    location: 'Quiet desk',
    type: 'Focus',
    attendees: ['Avery Chen'],
    notes: 'Two hours blocked before standup. Finish unread-dot and snooze label before crit.',
  },
  {
    id: 'standup',
    title: 'Team standup',
    date: '2026-04-07',
    start: '10:30 AM',
    end: '10:50 AM',
    location: 'Room 2',
    type: 'Meeting',
    attendees: ['Avery Chen', 'Jonah Park', 'Mira Solano', 'Priya Nair'],
    notes: 'Moved from 10:00 so Room 2 can finish the vendor call. Avery facilitating. Notes doc unchanged.',
  },
  {
    id: 'aurora-pair',
    title: 'Pair on Aurora contrast',
    date: '2026-04-07',
    start: '2:00 PM',
    end: '2:45 PM',
    location: 'Design bay',
    type: 'Meeting',
    attendees: ['Avery Chen', 'Jonah Park'],
    notes: 'Lift search field one step. Check daylight and night shots before palette freeze.',
  },
  {
    id: 'inbox-crit',
    title: 'Inbox wireframe review',
    date: '2026-04-08',
    start: '11:00 AM',
    end: '12:00 PM',
    location: 'Crit room',
    type: 'Review',
    attendees: ['Avery Chen', 'Design Crit', 'Kai Ito'],
    notes: 'Lock reading pane, unread dot, and snooze label. Three open comments from yesterday.',
  },
  {
    id: 'focus-copy',
    title: 'Focus — welcome copy draft',
    date: '2026-04-08',
    start: '1:30 PM',
    end: '3:00 PM',
    location: 'Quiet desk',
    type: 'Focus',
    attendees: ['Avery Chen'],
    notes: 'Onboarding empty state. Nora can supply welcome copy if needed tonight.',
  },
  {
    id: 'vendor-hold',
    title: 'Offsite vendor hold check-in',
    date: '2026-04-09',
    start: '9:30 AM',
    end: '10:00 AM',
    location: 'Video',
    type: 'Meeting',
    attendees: ['Avery Chen', 'Remy Cho'],
    notes: 'Field studio hold expires Friday. Confirm quiet room and kitchen.',
  },
  {
    id: 'q2-signoff',
    title: 'Q2 launch sign-off',
    date: '2026-04-09',
    start: '3:00 PM',
    end: '3:45 PM',
    location: 'Room 1',
    type: 'Review',
    attendees: ['Avery Chen', 'Mira Solano', 'Priya Nair'],
    notes: 'Copy deck and field notes. Decide Overview subtitle and empty-inbox snooze copy.',
  },
  {
    id: 'onboarding-trial',
    title: 'Onboarding trial prep',
    date: '2026-04-10',
    start: '10:00 AM',
    end: '11:30 AM',
    location: 'Lab',
    type: 'Meeting',
    attendees: ['Avery Chen', 'Nora Feldman', 'Priya Nair'],
    notes: 'Replace skeleton bars before Friday’s trial. First-run inbox should read as a welcome.',
  },
  {
    id: 'weekly-pulse-meet',
    title: 'Weekly pulse',
    date: '2026-04-10',
    start: '4:00 PM',
    end: '4:30 PM',
    location: 'Room 2',
    type: 'Meeting',
    attendees: ['Team Lumen'],
    notes: 'Inbox is the at-risk item. Pull back to on track if the message list lands.',
  },
  {
    id: 'thursday-review',
    title: 'Thursday design review',
    date: '2026-04-09',
    start: '1:00 PM',
    end: '2:00 PM',
    location: 'Greenhouse loft',
    type: 'Review',
    attendees: ['Avery Chen', 'Mira Solano', 'Jonah Park', 'Sam Okonkwo'],
    notes: 'Ship train held until sign-off. Field notes and type ramp locked.',
  },
  {
    id: 'billing-note',
    title: 'Pro plan renewal note',
    date: '2026-04-11',
    start: '9:00 AM',
    end: '9:15 AM',
    location: 'Async',
    type: 'Reminder',
    attendees: ['Avery Chen'],
    notes: 'Renews May 12. Sixteen seats, no overage. Add pending members if needed.',
  },
  {
    id: 'pilot-freeze',
    title: 'Aurora pilot freeze',
    date: '2026-04-18',
    start: '11:00 AM',
    end: '12:00 PM',
    location: 'Room 1',
    type: 'Review',
    attendees: ['Jonah Park', 'Avery Chen', 'Sam Okonkwo'],
    notes: 'Contrast pass must land first. Freeze palette after greenhouse cohort check.',
  },
  {
    id: 'q2-ship',
    title: 'Q2 launch freeze',
    date: '2026-04-24',
    start: '2:00 PM',
    end: '3:00 PM',
    location: 'All hands',
    type: 'Meeting',
    attendees: ['Mira Solano', 'Avery Chen', 'Team Lumen'],
    notes: 'Final ship gate after Thursday review follow-ups.',
  },
]

function statusColor(status) {
  if (status === 'At risk') return 'var(--warn)'
  if (status === 'Archived') return 'var(--muted)'
  return 'var(--accent)'
}

function eventTypeColor(type) {
  if (type === 'Focus') return 'var(--accent)'
  if (type === 'Review') return 'var(--warn)'
  if (type === 'Reminder') return 'var(--muted)'
  return 'var(--accent)'
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function buildMonthCells(monthDate) {
  const first = startOfMonth(monthDate)
  const startOffset = first.getDay()
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startOffset; i += 1) {
    const day = new Date(first.getFullYear(), first.getMonth(), -startOffset + i + 1)
    cells.push({ date: day, inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ date: new Date(first.getFullYear(), first.getMonth(), d), inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      inMonth: false,
    })
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      inMonth: false,
    })
  }
  return cells
}

function formatLongDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - d.getDay())
  return d
}

function endOfWeek(date) {
  const d = startOfWeek(date)
  d.setDate(d.getDate() + 6)
  return d
}

export default function App() {
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])
  const [section, setSection] = useState('Inbox')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState('aurora')
  const [selectedId, setSelectedId] = useState(EMAILS[0].id)
  const [readIds, setReadIds] = useState(
    () => new Set(EMAILS.filter((email) => !email.unread).map((email) => email.id)),
  )
  const [projectFilter, setProjectFilter] = useState('All')
  const [selectedProjectId, setSelectedProjectId] = useState(PROJECTS[0].id)
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(today))
  const [selectedDayKey, setSelectedDayKey] = useState(() => toDateKey(today))
  const [selectedEventId, setSelectedEventId] = useState(EVENTS[0]?.id ?? null)
  const themeName = THEMES.find((item) => item.id === theme)?.name ?? 'Aurora'
  const unreadCount = EMAILS.filter((email) => !readIds.has(email.id)).length
  const mentionCount = EMAILS.filter((email) => email.tag === 'Mention').length
  const assignedCount = EMAILS.filter((email) => email.tag === 'Assigned').length
  const snoozedCount = EMAILS.filter((email) => email.tag === 'Snoozed').length
  const activeCount = PROJECTS.filter((project) => project.status === 'Active').length
  const riskCount = PROJECTS.filter((project) => project.status === 'At risk').length
  const archivedCount = PROJECTS.filter((project) => project.status === 'Archived').length

  const q = query.trim().toLowerCase()
  const filteredEvents = EVENTS.filter((event) => {
    if (!q) return true
    return [event.title, event.location, event.type, event.notes, event.attendees.join(' '), event.date]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })

  const eventsByDate = useMemo(() => {
    const map = new Map()
    for (const event of filteredEvents) {
      if (!map.has(event.date)) map.set(event.date, [])
      map.get(event.date).push(event)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start.localeCompare(b.start, undefined, { numeric: true }))
    }
    return map
  }, [filteredEvents])

  const selectedDay = parseDateKey(selectedDayKey)
  const dayEvents = eventsByDate.get(selectedDayKey) ?? []
  const selectedEvent = filteredEvents.find((event) => event.id === selectedEventId)
    ?? dayEvents[0]
    ?? filteredEvents[0]
    ?? null

  const todayKey = toDateKey(today)
  const todayEvents = eventsByDate.get(todayKey) ?? EVENTS.filter((e) => e.date === todayKey)
  const weekStart = startOfWeek(today)
  const weekEnd = endOfWeek(today)
  const weekEvents = EVENTS.filter((event) => {
    const d = parseDateKey(event.date)
    return d >= weekStart && d <= weekEnd
  })
  const focusMinutes = todayEvents
    .filter((event) => event.type === 'Focus')
    .reduce((sum, event) => {
      // rough hours from labels like "2h blocked"
      if (event.id === 'focus-morning') return sum + 120
      if (event.id === 'focus-copy') return sum + 90
      return sum + 60
    }, 0)
  const focusLabel = focusMinutes >= 60
    ? `${Math.round(focusMinutes / 60 * 10) / 10}h`.replace(/\.0h$/, 'h')
    : `${focusMinutes}m`

  const cards = section === 'Inbox'
    ? [
        { k: 'Unread', v: String(unreadCount), d: `${mentionCount} mentions` },
        { k: 'Assigned', v: String(assignedCount), d: 'needs a reply' },
        { k: 'Snoozed', v: String(snoozedCount), d: 'back tomorrow' },
      ]
    : section === 'Projects'
      ? [
          { k: 'Active', v: String(activeCount), d: 'on track' },
          { k: 'At risk', v: String(riskCount), d: 'needs a decision' },
          { k: 'Archived', v: String(archivedCount), d: 'last quarter' },
        ]
      : section === 'Calendar'
        ? [
            { k: 'Today', v: String(todayEvents.length || EVENTS.filter((e) => e.date === todayKey).length), d: 'meetings & blocks' },
            { k: 'Focus', v: focusLabel === '0m' ? '2h' : focusLabel, d: 'blocked' },
            { k: 'This week', v: String(weekEvents.length), d: 'events' },
          ]
        : CARDS[section]

  const visibleEmails = EMAILS.filter((email) => {
    if (!q) return true
    return [email.from, email.email, email.subject, email.preview, email.body, email.tag]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
  const selected = visibleEmails.find((email) => email.id === selectedId) ?? visibleEmails[0] ?? null
  const visibleProjects = PROJECTS.filter((project) => {
    if (projectFilter !== 'All' && project.status !== projectFilter) return false
    if (!q) return true
    return [
      project.name,
      project.code,
      project.status,
      project.lead,
      project.summary,
      project.next,
      project.team.map((member) => member.name).join(' '),
      project.milestones.map((item) => item.name).join(' '),
    ]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
  const selectedProject = visibleProjects.find((project) => project.id === selectedProjectId) ?? visibleProjects[0] ?? null

  const monthCells = useMemo(() => buildMonthCells(monthCursor), [monthCursor])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (dayEvents.length === 0) return
    if (!dayEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(dayEvents[0].id)
    }
  }, [selectedDayKey, dayEvents, selectedEventId])

  function openEmail(id) {
    setSelectedId(id)
    setReadIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  function selectDay(date) {
    const key = toDateKey(date)
    setSelectedDayKey(key)
    const events = eventsByDate.get(key) ?? []
    if (events[0]) setSelectedEventId(events[0].id)
  }

  function goToday() {
    setMonthCursor(startOfMonth(today))
    setSelectedDayKey(todayKey)
    const events = eventsByDate.get(todayKey) ?? EVENTS.filter((e) => e.date === todayKey)
    if (events[0]) setSelectedEventId(events[0].id)
  }

  const searchPlaceholder = section === 'Inbox'
    ? 'Search mail'
    : section === 'Projects'
      ? 'Search projects'
      : section === 'Calendar'
        ? 'Search events'
        : 'Search the workspace'

  return (
    <div style={shell}>
      <aside style={{ ...sidebar, width: collapsed ? 72 : 232 }}>
        <div style={brandRow}>
          <div style={mark}>L</div>
          {!collapsed && (
            <div>
              <div style={brandName}>Lumen</div>
              <div style={brandSub}>Workspace</div>
            </div>
          )}
        </div>
        <nav style={nav}>
          {NAV.map((item) => {
            const on = item.id === section
            const hint = item.id === 'Inbox'
              ? `${unreadCount} unread`
              : item.id === 'Projects'
                ? `${activeCount} active`
                : item.id === 'Calendar'
                  ? `${(eventsByDate.get(todayKey) ?? EVENTS.filter((e) => e.date === todayKey)).length || 3} today`
                  : item.hint
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                style={{
                  ...navBtn,
                  background: on ? 'var(--sidebar-active)' : 'transparent',
                  color: on ? 'var(--sidebar-active-ink)' : 'var(--sidebar-idle)',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderLeft: on ? '3px solid var(--accent)' : '3px solid transparent',
                }}
                title={item.id}
              >
                <span style={navIcon}>{item.icon}</span>
                {!collapsed && (
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                    <span>{item.id}</span>
                    <span style={navHint}>{hint}</span>
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <button type="button" onClick={() => setCollapsed((v) => !v)} style={collapseBtn}>
          {collapsed ? '›' : '‹ Collapse'}
        </button>
      </aside>

      <div style={mainCol}>
        <header style={topbar}>
          <div>
            <div style={crumb}>Lumen / {section}</div>
            <h1 style={title}>{section}</h1>
          </div>
          <div style={topActions}>
            <div style={switcher} role="radiogroup" aria-label="Color theme">
              {THEMES.map((item) => {
                const on = item.id === theme
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTheme(item.id)}
                    style={{
                      ...themeBtn,
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? 'var(--on-accent)' : 'var(--ink)',
                      fontWeight: on ? 700 : 550,
                    }}
                    title={`${item.name} theme`}
                  >
                    <span
                      style={{
                        ...swatch,
                        background: item.swatch,
                        boxShadow: on ? '0 0 0 2px var(--on-accent)' : 'none',
                      }}
                    />
                    {item.name}
                  </button>
                )
              })}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              style={search}
              aria-label="Search"
            />
            <button type="button" style={primaryBtn}>New</button>
            <div style={avatar} title="Avery Chen">AC</div>
          </div>
        </header>

        <main style={content}>
          <section style={statRow}>
            {cards.map((card) => (
              <article key={card.k} style={statCard}>
                <div style={statLabel}>{card.k}</div>
                <div style={statValue}>{card.v}</div>
                <div style={statDetail}>{card.d}</div>
              </article>
            ))}
          </section>

          <section style={section === 'Projects' || section === 'Inbox' || section === 'Calendar' ? panelFill : panel}>
            {section === 'Inbox' ? (
              <>
                <div style={panelHead}>
                  <h2 style={panelTitle}>Inbox</h2>
                  <div style={pillRow}>
                    <span style={pill}>{visibleEmails.length} messages</span>
                    <span style={pill}>{unreadCount} unread</span>
                    <span style={pill}>{query ? `Filter: ${query}` : 'All items'}</span>
                  </div>
                </div>
                <div style={inboxSplit}>
                  <div style={mailList} role="listbox" aria-label="Inbox messages">
                    {visibleEmails.length === 0 ? (
                      <p style={emptyCopy}>No messages match “{query}”.</p>
                    ) : (
                      visibleEmails.map((email) => {
                        const on = selected?.id === email.id
                        const unread = !readIds.has(email.id)
                        return (
                          <button
                            key={email.id}
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => openEmail(email.id)}
                            style={{
                              ...mailRow,
                              background: on ? 'var(--pill-bg)' : 'transparent',
                              borderColor: on ? 'var(--accent)' : 'var(--line)',
                            }}
                          >
                            <span style={mailAvatar} aria-hidden="true">{email.initials}</span>
                            <span style={mailBody}>
                              <span style={mailTop}>
                                <span style={{ ...mailFrom, fontWeight: unread ? 700 : 550 }}>
                                  {unread && <span style={unreadDot} aria-label="Unread" />}
                                  {email.from}
                                </span>
                                <span style={mailTime}>{email.when === 'Today' ? email.time : email.when}</span>
                              </span>
                              <span style={{ ...mailSubject, fontWeight: unread ? 700 : 550 }}>{email.subject}</span>
                              <span style={mailPreview}>{email.preview}</span>
                              {email.tag && <span style={mailTag}>{email.tag}</span>}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                  {selected ? (
                    <article style={mailRead} aria-label="Message">
                      <div style={readHead}>
                        <div style={mailAvatarLg} aria-hidden="true">{selected.initials}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={readFrom}>{selected.from}</div>
                          <div style={readMeta}>{selected.email} · {selected.when} {selected.time}</div>
                        </div>
                        {selected.tag && <span style={pill}>{selected.tag}</span>}
                      </div>
                      <h3 style={readSubject}>{selected.subject}</h3>
                      <p style={readBody}>{selected.body}</p>
                    </article>
                  ) : (
                    <p style={emptyCopy}>Select a message to read it.</p>
                  )}
                </div>
              </>
            ) : section === 'Projects' ? (
              <>
                <div style={panelHead}>
                  <h2 style={panelTitle}>Project viewer</h2>
                  <div style={pillRow}>
                    {PROJECT_FILTERS.map((filter) => {
                      const on = projectFilter === filter
                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setProjectFilter(filter)}
                          style={{
                            ...filterBtn,
                            background: on ? 'var(--accent)' : 'var(--pill-bg)',
                            color: on ? 'var(--on-accent)' : 'var(--pill-ink)',
                            fontWeight: on ? 700 : 550,
                          }}
                          aria-pressed={on}
                        >
                          {filter}
                        </button>
                      )
                    })}
                    <span style={pill}>{visibleProjects.length} shown</span>
                  </div>
                </div>
                <p style={panelCopy}>
                  Open a project to see progress, the next decision, and who is on it.
                  {query ? ` Filtered by “${query}”.` : ' Four active, one waiting on a decision.'}
                </p>
                <div style={inboxSplit}>
                  <div style={mailList} role="listbox" aria-label="Projects">
                    {visibleProjects.length === 0 ? (
                      <p style={emptyCopy}>No projects match “{query || projectFilter}”.</p>
                    ) : (
                      visibleProjects.map((project) => {
                        const on = selectedProject?.id === project.id
                        return (
                          <button
                            key={project.id}
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => setSelectedProjectId(project.id)}
                            style={{
                              ...projectRow,
                              background: on ? 'var(--pill-bg)' : 'transparent',
                              borderColor: on ? 'var(--accent)' : 'var(--line)',
                            }}
                          >
                            <span style={{ ...statusMark, background: statusColor(project.status) }} aria-hidden="true" />
                            <span style={mailBody}>
                              <span style={mailTop}>
                                <span style={projectName}>{project.name}</span>
                                <span style={mailTime}>{project.progress}%</span>
                              </span>
                              <span style={mailPreview}>{project.code} · {project.lead} · {project.due}</span>
                              <span style={progressTrack} aria-hidden="true">
                                <span
                                  style={{
                                    ...progressFill,
                                    width: `${project.progress}%`,
                                    background: statusColor(project.status),
                                  }}
                                />
                              </span>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                  {selectedProject ? (
                    <article style={mailRead} aria-label="Project">
                      <div style={readHead}>
                        <div style={mailAvatarLg} aria-hidden="true">{selectedProject.initials}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={readMeta}>{selectedProject.code} · Updated {selectedProject.updated}</div>
                          <div style={readFrom}>{selectedProject.name}</div>
                        </div>
                        <span
                          style={{
                            ...pill,
                            color: statusColor(selectedProject.status),
                            border: '1px solid var(--line)',
                          }}
                        >
                          {selectedProject.status}
                        </span>
                      </div>
                      <div style={metaRow}>
                        <span>Lead · {selectedProject.lead}</span>
                        <span>Due {selectedProject.due}</span>
                      </div>
                      <div
                        style={progressBlock}
                        role="progressbar"
                        aria-valuenow={selectedProject.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Progress"
                      >
                        <div style={progressTrackLg}>
                          <div
                            style={{
                              ...progressFill,
                              width: `${selectedProject.progress}%`,
                              background: statusColor(selectedProject.status),
                            }}
                          />
                        </div>
                        <span style={progressLabel}>{selectedProject.progress}%</span>
                      </div>
                      <p style={readBody}>{selectedProject.summary}</p>
                      <div
                        style={{
                          ...nextCallout,
                          borderColor: statusColor(selectedProject.status),
                          background: selectedProject.status === 'At risk' ? 'var(--warn-bg)' : 'var(--card)',
                        }}
                      >
                        <div style={nextLabel}>Next</div>
                        <div>{selectedProject.next}</div>
                      </div>
                      <h3 style={sectionLabel}>Milestones</h3>
                      <ul style={milestoneList}>
                        {selectedProject.milestones.map((item) => (
                          <li key={item.name} style={milestoneItem}>
                            <span
                              style={{
                                ...check,
                                background: item.done ? statusColor(selectedProject.status) : 'transparent',
                                color: item.done ? 'var(--on-accent)' : 'var(--muted)',
                                borderColor: item.done ? statusColor(selectedProject.status) : 'var(--line)',
                              }}
                              aria-hidden="true"
                            >
                              {item.done ? '✓' : ''}
                            </span>
                            <span style={{ color: item.done ? 'var(--muted)' : 'var(--ink)' }}>{item.name}</span>
                          </li>
                        ))}
                      </ul>
                      <h3 style={sectionLabel}>Team</h3>
                      <div style={teamRow}>
                        {selectedProject.team.map((member) => (
                          <div key={member.name} style={teamChip} title={member.name}>
                            <span style={teamAvatar} aria-hidden="true">{member.initials}</span>
                            <span>{member.name}</span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ) : (
                    <p style={emptyCopy}>Select a project to open it.</p>
                  )}
                </div>
              </>
            ) : section === 'Calendar' ? (
              <>
                <div style={panelHead}>
                  <h2 style={panelTitle}>Calendar</h2>
                  <div style={pillRow}>
                    <button type="button" onClick={() => setMonthCursor((m) => addMonths(m, -1))} style={calNavBtn} aria-label="Previous month">
                      ‹
                    </button>
                    <span style={{ ...pill, fontWeight: 700 }}>
                      {MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
                    </span>
                    <button type="button" onClick={() => setMonthCursor((m) => addMonths(m, 1))} style={calNavBtn} aria-label="Next month">
                      ›
                    </button>
                    <button type="button" onClick={goToday} style={filterBtn}>Today</button>
                    <span style={pill}>{filteredEvents.length} events</span>
                    {query ? <span style={pill}>Filter: {query}</span> : null}
                  </div>
                </div>
                <p style={panelCopy}>
                  Month grid with the day’s agenda. Pick a date to see meetings, focus blocks, and reviews.
                  {query ? ` Showing matches for “${query}”.` : ''}
                </p>
                <div style={calendarSplit}>
                  <div style={monthPanel} aria-label="Month">
                    <div style={weekdayRow}>
                      {WEEKDAYS.map((day) => (
                        <div key={day} style={weekdayCell}>{day}</div>
                      ))}
                    </div>
                    <div style={monthGrid} role="grid" aria-label={`${MONTHS[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`}>
                      {monthCells.map(({ date, inMonth }) => {
                        const key = toDateKey(date)
                        const events = eventsByDate.get(key) ?? []
                        const isSelected = key === selectedDayKey
                        const isToday = sameDay(date, today)
                        return (
                          <button
                            key={key + String(inMonth)}
                            type="button"
                            role="gridcell"
                            aria-selected={isSelected}
                            onClick={() => selectDay(date)}
                            style={{
                              ...dayCell,
                              opacity: inMonth ? 1 : 0.45,
                              background: isSelected ? 'var(--pill-bg)' : 'transparent',
                              borderColor: isSelected ? 'var(--accent)' : isToday ? 'var(--accent)' : 'var(--line)',
                              boxShadow: isToday && !isSelected ? 'inset 0 0 0 1px var(--accent)' : 'none',
                            }}
                          >
                            <span style={{
                              ...dayNumber,
                              color: isToday ? 'var(--accent)' : 'var(--ink)',
                              fontWeight: isToday || isSelected ? 700 : 550,
                            }}
                            >
                              {date.getDate()}
                            </span>
                            <span style={dayDots}>
                              {events.slice(0, 3).map((event) => (
                                <span
                                  key={event.id}
                                  style={{ ...dayDot, background: eventTypeColor(event.type) }}
                                  title={event.title}
                                />
                              ))}
                              {events.length > 3 ? <span style={dayMore}>+{events.length - 3}</span> : null}
                            </span>
                            {events[0] ? (
                              <span style={dayEventPeek}>{events[0].title}</span>
                            ) : (
                              <span style={{ ...dayEventPeek, color: 'transparent' }}>.</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div style={agendaCol}>
                    <div style={agendaHead}>
                      <div>
                        <div style={readMeta}>Agenda</div>
                        <div style={readFrom}>{formatLongDate(selectedDay)}</div>
                      </div>
                      <span style={pill}>{dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}</span>
                    </div>

                    <div style={agendaList} role="listbox" aria-label="Day agenda">
                      {dayEvents.length === 0 ? (
                        <p style={emptyCopy}>
                          {query
                            ? `No events on this day match “${query}”.`
                            : 'Nothing scheduled. Pick another day or clear the filter.'}
                        </p>
                      ) : (
                        dayEvents.map((event) => {
                          const on = selectedEvent?.id === event.id
                          return (
                            <button
                              key={event.id}
                              type="button"
                              role="option"
                              aria-selected={on}
                              onClick={() => setSelectedEventId(event.id)}
                              style={{
                                ...eventRow,
                                background: on ? 'var(--pill-bg)' : 'transparent',
                                borderColor: on ? 'var(--accent)' : 'var(--line)',
                              }}
                            >
                              <span
                                style={{ ...eventTypeBar, background: eventTypeColor(event.type) }}
                                aria-hidden="true"
                              />
                              <span style={mailBody}>
                                <span style={mailTop}>
                                  <span style={projectName}>{event.title}</span>
                                  <span style={mailTag}>{event.type}</span>
                                </span>
                                <span style={mailPreview}>
                                  {event.start} – {event.end} · {event.location}
                                </span>
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>

                    {selectedEvent ? (
                      <article style={eventDetail} aria-label="Event">
                        <div style={readHead}>
                          <div
                            style={{
                              ...mailAvatarLg,
                              background: 'var(--pill-bg)',
                              color: eventTypeColor(selectedEvent.type),
                              border: '1px solid var(--line)',
                            }}
                            aria-hidden="true"
                          >
                            {selectedEvent.type.slice(0, 1)}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={readMeta}>
                              {selectedEvent.start} – {selectedEvent.end} · {selectedEvent.location}
                            </div>
                            <div style={readFrom}>{selectedEvent.title}</div>
                          </div>
                          <span
                            style={{
                              ...pill,
                              color: eventTypeColor(selectedEvent.type),
                              border: '1px solid var(--line)',
                            }}
                          >
                            {selectedEvent.type}
                          </span>
                        </div>
                        <div style={metaRow}>
                          <span>{formatLongDate(parseDateKey(selectedEvent.date))}</span>
                          <span>{selectedEvent.attendees.length} attending</span>
                        </div>
                        <p style={readBody}>{selectedEvent.notes}</p>
                        <h3 style={sectionLabel}>Attendees</h3>
                        <div style={teamRow}>
                          {selectedEvent.attendees.map((name) => {
                            const initials = name
                              .split(/\s+/)
                              .map((part) => part[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()
                            return (
                              <div key={name} style={teamChip} title={name}>
                                <span style={teamAvatar} aria-hidden="true">{initials}</span>
                                <span>{name}</span>
                              </div>
                            )
                          })}
                        </div>
                      </article>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={panelHead}>
                  <h2 style={panelTitle}>{section} canvas</h2>
                  <div style={pillRow}>
                    <span style={pill}>Theme · {themeName}</span>
                    <span style={pill}>{query ? `Filter: ${query}` : 'All items'}</span>
                  </div>
                </div>
                <p style={panelCopy}>
                  This is the app shell: a persistent sidebar, top bar, and content canvas.
                  Switch sections to see the frame stay put while the page inside changes.
                </p>
                <div style={placeholder}>
                  <div style={placeholderBar} />
                  <div style={{ ...placeholderBar, width: '72%' }} />
                  <div style={{ ...placeholderBar, width: '54%' }} />
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

const shell = {
  display: 'flex',
  height: '100%',
  minHeight: '100%',
  background: 'var(--bg)',
  color: 'var(--ink)',
}

const sidebar = {
  flex: '0 0 auto',
  background: 'var(--sidebar)',
  color: 'var(--sidebar-ink)',
  display: 'flex',
  flexDirection: 'column',
  padding: 12,
  transition: 'width 160ms ease',
  overflow: 'hidden',
}

const brandRow = { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 8px 16px' }
const mark = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 700,
  flex: '0 0 auto',
}
const brandName = { fontWeight: 700, letterSpacing: '-0.02em' }
const brandSub = { fontSize: 12, color: 'var(--sidebar-muted)' }
const nav = { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }
const navBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  border: 0,
  borderRadius: 10,
  padding: '10px 12px',
  cursor: 'pointer',
  textAlign: 'left',
}
const navIcon = { width: 18, textAlign: 'center', flex: '0 0 auto' }
const navHint = { fontSize: 11, color: 'var(--sidebar-muted)' }
const collapseBtn = {
  marginTop: 8,
  border: 0,
  background: 'transparent',
  color: 'var(--sidebar-muted)',
  cursor: 'pointer',
  padding: 10,
  borderRadius: 8,
  textAlign: 'left',
}
const mainCol = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }
const topbar = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '16px 28px',
  borderBottom: '1px solid var(--line)',
  background: 'var(--topbar)',
  flexWrap: 'wrap',
}
const crumb = { fontSize: 12, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }
const title = { margin: '2px 0 0', fontSize: 22, letterSpacing: '-0.03em' }
const topActions = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const switcher = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 3,
  borderRadius: 999,
  border: '1px solid var(--line)',
  background: 'var(--switcher-bg)',
}
const themeBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: 0,
  borderRadius: 999,
  padding: '6px 10px',
  cursor: 'pointer',
  background: 'transparent',
}
const swatch = { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' }
const search = {
  width: 220,
  border: '1px solid var(--line)',
  background: 'var(--input-bg)',
  color: 'var(--ink)',
  borderRadius: 999,
  padding: '8px 14px',
  outline: 'none',
}
const primaryBtn = {
  border: 0,
  background: 'var(--btn-bg)',
  color: 'var(--btn-ink)',
  borderRadius: 999,
  padding: '8px 14px',
  cursor: 'pointer',
  fontWeight: 650,
}
const avatar = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  background: 'var(--avatar-bg)',
  color: 'var(--avatar-ink)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 12,
  fontWeight: 700,
}
const content = {
  flex: 1,
  overflow: 'auto',
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}
const statRow = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }
const statCard = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: 16,
  boxShadow: 'var(--shadow)',
}
const statLabel = { fontSize: 13, color: 'var(--muted)' }
const statValue = { fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em', marginTop: 4 }
const statDetail = { fontSize: 13, marginTop: 4, color: 'var(--ink)' }
const panel = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 16,
  padding: 20,
  boxShadow: 'var(--shadow)',
  flex: 1,
}
const panelFill = { ...panel, display: 'flex', flexDirection: 'column', minHeight: 0 }
const panelHead = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }
const panelTitle = { margin: 0, fontSize: 16 }
const pillRow = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
const pill = {
  fontSize: 12,
  background: 'var(--pill-bg)',
  color: 'var(--pill-ink)',
  borderRadius: 999,
  padding: '4px 10px',
}
const filterBtn = {
  fontSize: 12,
  borderRadius: 999,
  padding: '4px 10px',
  border: 0,
  cursor: 'pointer',
  background: 'var(--pill-bg)',
  color: 'var(--pill-ink)',
}
const panelCopy = { color: 'var(--muted)', maxWidth: 720, lineHeight: 1.5 }
const placeholder = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }
const placeholderBar = { height: 12, width: '88%', borderRadius: 999, background: 'var(--placeholder)' }
const inboxSplit = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 400px) minmax(0, 1fr)',
  gap: 16,
  marginTop: 14,
  minHeight: 0,
  alignItems: 'stretch',
}
const calendarSplit = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 0.9fr)',
  gap: 16,
  marginTop: 14,
  minHeight: 0,
  alignItems: 'start',
}
const monthPanel = {
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: 12,
  background: 'var(--topbar)',
  minWidth: 0,
}
const weekdayRow = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 6,
  marginBottom: 6,
}
const weekdayCell = {
  fontSize: 11,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  textAlign: 'center',
  padding: '4px 0',
}
const monthGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 6,
}
const dayCell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  minHeight: 78,
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: '8px 8px 6px',
  cursor: 'pointer',
  color: 'inherit',
  textAlign: 'left',
  background: 'transparent',
}
const dayNumber = { fontSize: 13, fontVariantNumeric: 'tabular-nums' }
const dayDots = { display: 'flex', gap: 3, alignItems: 'center', minHeight: 8 }
const dayDot = { width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto' }
const dayMore = { fontSize: 10, color: 'var(--muted)' }
const dayEventPeek = {
  fontSize: 11,
  color: 'var(--muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
  lineHeight: 1.3,
}
const calNavBtn = {
  ...filterBtn,
  width: 28,
  height: 28,
  padding: 0,
  display: 'grid',
  placeItems: 'center',
  fontSize: 16,
  lineHeight: 1,
}
const agendaCol = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
}
const agendaHead = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
}
const agendaList = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxHeight: 220,
  overflow: 'auto',
  paddingRight: 4,
}
const eventRow = {
  display: 'grid',
  gridTemplateColumns: '4px minmax(0, 1fr)',
  gap: 10,
  textAlign: 'left',
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: '10px 12px',
  cursor: 'pointer',
  color: 'inherit',
  alignItems: 'stretch',
}
const eventTypeBar = {
  width: 4,
  borderRadius: 999,
  alignSelf: 'stretch',
}
const eventDetail = {
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: '16px 18px',
  background: 'var(--topbar)',
  minWidth: 0,
}
const mailList = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxHeight: 560,
  overflow: 'auto',
  paddingRight: 4,
}
const mailRow = {
  display: 'grid',
  gridTemplateColumns: '36px minmax(0, 1fr)',
  gap: 10,
  textAlign: 'left',
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: '10px 12px',
  cursor: 'pointer',
  color: 'inherit',
}
const projectRow = {
  ...mailRow,
  gridTemplateColumns: '8px minmax(0, 1fr)',
  alignItems: 'start',
}
const statusMark = { width: 8, height: 8, borderRadius: 999, marginTop: 6 }
const projectName = { fontWeight: 650, letterSpacing: '-0.01em', minWidth: 0 }
const progressTrack = {
  display: 'block',
  height: 4,
  borderRadius: 999,
  background: 'var(--placeholder)',
  overflow: 'hidden',
  marginTop: 6,
}
const progressTrackLg = { ...progressTrack, height: 8, flex: 1, marginTop: 0 }
const progressFill = { display: 'block', height: '100%', borderRadius: 999 }
const progressBlock = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }
const progressLabel = { fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }
const metaRow = { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 13, color: 'var(--muted)' }
const nextCallout = { marginTop: 16, border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', lineHeight: 1.45 }
const nextLabel = { fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }
const sectionLabel = { margin: '18px 0 8px', fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)' }
const milestoneList = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }
const milestoneItem = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }
const check = {
  width: 18,
  height: 18,
  borderRadius: 6,
  border: '1px solid var(--line)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  flex: '0 0 auto',
}
const teamRow = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const teamChip = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid var(--line)',
  borderRadius: 999,
  padding: '4px 10px 4px 4px',
  fontSize: 13,
}
const teamAvatar = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: 'var(--avatar-bg)',
  color: 'var(--avatar-ink)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 10,
  fontWeight: 700,
}
const mailAvatar = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  background: 'var(--avatar-bg)',
  color: 'var(--avatar-ink)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  fontWeight: 700,
}
const mailAvatarLg = { ...mailAvatar, width: 42, height: 42, fontSize: 13 }
const mailBody = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }
const mailTop = { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }
const mailFrom = { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }
const unreadDot = { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flex: '0 0 auto' }
const mailTime = { fontSize: 12, color: 'var(--muted)', flex: '0 0 auto' }
const mailSubject = { fontSize: 14, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const mailPreview = { fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const mailTag = {
  alignSelf: 'flex-start',
  marginTop: 4,
  fontSize: 11,
  background: 'var(--pill-bg)',
  color: 'var(--pill-ink)',
  borderRadius: 999,
  padding: '2px 8px',
}
const mailRead = {
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: '18px 20px',
  background: 'var(--topbar)',
  minWidth: 0,
  overflow: 'auto',
  maxHeight: 560,
}
const readHead = { display: 'flex', alignItems: 'center', gap: 12 }
const readFrom = { fontWeight: 700, letterSpacing: '-0.02em' }
const readMeta = { fontSize: 12, color: 'var(--muted)', marginTop: 2 }
const readSubject = { margin: '16px 0 8px', fontSize: 20, letterSpacing: '-0.03em', lineHeight: 1.3 }
const readBody = { margin: '12px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.55, color: 'var(--ink)', fontSize: 14 }
const emptyCopy = { color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }
