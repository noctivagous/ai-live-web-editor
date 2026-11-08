import assert from 'node:assert/strict'
import test from 'node:test'
import { fieldMetaFor, groupTopLevelKeys, profileForJsonPath } from './jsonProfiles'

test('recognition: known config filenames get their own profile, the rest are generic', () => {
  assert.equal(profileForJsonPath('/proj/package.json').id, 'package')
  assert.equal(profileForJsonPath('package.json').id, 'package')
  assert.equal(profileForJsonPath('/proj/package-lock.json').generated, true)
  assert.equal(profileForJsonPath('/proj/tsconfig.json').id, 'tsconfig')
  assert.equal(profileForJsonPath('/proj/tsconfig.app.json').id, 'tsconfig')
  assert.equal(profileForJsonPath('/proj/jsconfig.json').id, 'tsconfig')
  assert.equal(profileForJsonPath('/proj/project.ai.json').id, 'ai-project')
  assert.equal(profileForJsonPath('/proj/data.json').id, 'generic')
  assert.equal(profileForJsonPath('/proj/.vscode/settings.json').id, 'generic')
})

test('package profile: sections group identity, scripts and dependencies; the rest fall through', () => {
  const profile = profileForJsonPath('/package.json')
  const groups = groupTopLevelKeys(profile, ['name', 'scripts', 'dependencies', 'customThing', 'version'])
  assert.deepEqual(groups.map((g) => g.title), ['Package', 'Scripts', 'Dependencies', 'Other fields'])
  assert.deepEqual(groups[0].keys, ['name', 'version'])
  assert.deepEqual(groups[3].keys, ['customThing'])
})

test('generic profile: no sections — file order is the order', () => {
  const profile = profileForJsonPath('/data.json')
  const groups = groupTopLevelKeys(profile, ['b', 'a', 'c'])
  assert.deepEqual(groups, [{ title: '', keys: ['b', 'a', 'c'] }])
})

test('inherited field metadata: profile overrides, unknown paths are empty', () => {
  const pkg = profileForJsonPath('/package.json')
  assert.equal(fieldMetaFor(pkg, ['scripts']).control, 'stringMap')
  assert.equal(fieldMetaFor(pkg, ['type']).control, 'select')
  assert.deepEqual(fieldMetaFor(pkg, ['unknownField']), {})
  const ts = profileForJsonPath('/tsconfig.json')
  assert.equal(fieldMetaFor(ts, ['compilerOptions', 'target']).control, 'select')
  assert.equal(fieldMetaFor(ts, ['compilerOptions', 'strict']).description?.includes('strict'), true)
})
