import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { deliveryBriefLines } from './deliveryBrief.js'
import { ALE_DELIVERY_TOOLS } from '../mcpserver/deliveryTools.js'
import { ALE_TOOLS, visibleAleTools } from '../mcpserver/registry.js'

describe('delivery brief (slice 1 skeleton)', () => {
  it('contributes no lines while nothing is known — each line is omitted honestly, never padded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-delivery-brief-'))
    assert.deepEqual(deliveryBriefLines(root), [])
  })
})

describe('delivery MCP tool family (slice 1 registration point)', () => {
  it('is composed into the registry, and every delivery tool is facet-tagged for §10.2 gating', () => {
    for (const t of ALE_DELIVERY_TOOLS) {
      assert.equal(t.facet, 'delivery', `${t.name} must be tagged facet: 'delivery'`)
      assert.ok(ALE_TOOLS.includes(t), `${t.name} must be composed into ALE_TOOLS`)
    }
  })

  it('visibleAleTools matches ALE_TOOLS when no facet is off', () => {
    assert.deepEqual(visibleAleTools().map(t => t.name), ALE_TOOLS.map(t => t.name))
  })
})
