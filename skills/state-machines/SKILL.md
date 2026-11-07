---
name: state-machines
description: Knowledge pack for modelling interactive state as an explicit machine: states as data, a transitions table, guards and actions separated — instead of boolean-flag soup and impossible states.
triggers: state machine, xstate, fsm, finite state, workflow states
dependsOn: xstate
---

# State machines pack

## When to reach for a machine

Any UI state that is today two or more booleans which must agree
(`isLoading && isEditing && hasError`) is a machine asking to
exist. One state variable with named states makes impossible
combinations unrepresentable: a panel is `idle | loading | ready
| error`, never loading-and-error at once.

## The shape

- **States as data**: a plain object keyed by state name; each
  state declares its `on` transitions.
- **Transitions table first**: write the full (state, event) ->
  next state table before any rendering code. Events are verbs in
  caps (`LOAD`, `RESOLVE`, `REJECT`, `RETRY`, `RESET`).
- **Guards** (can this event fire here?) are pure functions on
  context; **actions** (what changes besides the state) run on
  transitions, never inside guards.
- **Context** holds the data the machine carries (the loaded
  items, the error) — separate from the state name, always.

## XState-style sketch

```ts
const machine = createMachine({
  id: 'panel',
  initial: 'idle',
  context: { items: [], error: null },
  states: {
    idle:    { on: { LOAD: 'loading' } },
    loading: { on: { RESOLVE: 'ready', REJECT: 'error' } },
    ready:   { on: { LOAD: 'loading', RESET: 'idle' } },
    error:   { on: { RETRY: 'loading', RESET: 'idle' } },
  },
})
```

With no library available, the same table drives a 20-line
reducer: `transition(state, event)` looks the pair up, returns
the next state, and ignores unknown pairs — an ignored event is
a no-op, never a crash.

## Pitfalls

- Deriving state from props on every render (`useEffect` syncing
  flags) recreates the flag soup with extra steps; send events
  instead.
- One machine per concern. A machine that models the page, the
  modal and the toast is three machines wearing a trench coat.
- Persist the state name + context, never a snapshot of derived
  UI; restore by re-entering the state.
