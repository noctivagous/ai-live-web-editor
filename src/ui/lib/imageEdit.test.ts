import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_IMAGE_EDIT, filterFor, isIdentityEdit, outputDims, outputForPath, type ImageEditState } from './imageEdit'

const edited = (patch: Partial<ImageEditState>): ImageEditState => ({ ...DEFAULT_IMAGE_EDIT, ...patch })

test('filterFor maps slider percentages to a canvas filter', () => {
  assert.equal(filterFor(DEFAULT_IMAGE_EDIT), 'brightness(1) contrast(1) saturate(1)')
  assert.equal(filterFor(edited({ brightness: 120, saturation: 50 })), 'brightness(1.2) contrast(1) saturate(0.5)')
})

test('isIdentityEdit spots the untouched state', () => {
  assert.equal(isIdentityEdit(DEFAULT_IMAGE_EDIT), true)
  assert.equal(isIdentityEdit(edited({ rotate: 90 })), false)
  assert.equal(isIdentityEdit(edited({ width: 100 })), false)
})

test('outputDims: rotation swaps axes, one-sided resize keeps aspect', () => {
  assert.deepEqual(outputDims(400, 200, DEFAULT_IMAGE_EDIT), { width: 400, height: 200 })
  assert.deepEqual(outputDims(400, 200, edited({ rotate: 90 })), { width: 200, height: 400 })
  assert.deepEqual(outputDims(400, 200, edited({ width: 100 })), { width: 100, height: 50 })
  assert.deepEqual(outputDims(400, 200, edited({ height: 50 })), { width: 100, height: 50 })
  assert.deepEqual(outputDims(400, 200, edited({ width: 10, height: 10 })), { width: 10, height: 10 })
})

test('outputForPath: png/jpeg/webp save in place; svg is vector; gif explains itself', () => {
  assert.deepEqual(outputForPath('/a/logo.PNG'), { mime: 'image/png', canSave: true })
  assert.equal(outputForPath('/a/photo.jpg').mime, 'image/jpeg')
  assert.equal(outputForPath('/a/photo.webp').canSave, true)
  const svg = outputForPath('/a/icon.svg')
  assert.equal(svg.vector, true)
  assert.equal(svg.canSave, false)
  const gif = outputForPath('/a/anim.gif')
  assert.equal(gif.canSave, false)
  assert.ok(gif.reason?.includes('gif'))
})
