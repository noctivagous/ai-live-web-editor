import assert from 'node:assert/strict'
import test from 'node:test'
import { fieldMetaFor, groupTopLevelKeys, profileForConfigPath } from './configProfiles'

test('recognition: workflow, compose, cargo, pyproject; generic fallbacks per format', () => {
  assert.equal(profileForConfigPath('/.github/workflows/ci.yml', 'yaml').id, 'github-workflow')
  assert.equal(profileForConfigPath('/docker-compose.yml', 'yaml').id, 'docker-compose')
  assert.equal(profileForConfigPath('/random.yaml', 'yaml').id, 'yaml-generic')
  assert.equal(profileForConfigPath('/Cargo.toml', 'toml').id, 'cargo')
  assert.equal(profileForConfigPath('/pyproject.toml', 'toml').id, 'pyproject')
  assert.equal(profileForConfigPath('/other.toml', 'toml').id, 'toml-generic')
  assert.equal(profileForConfigPath('/.env', 'env').id, 'env-generic')
})

test('inherited field metadata: cargo edition is a select with editions', () => {
  const cargo = profileForConfigPath('/Cargo.toml', 'toml')
  const meta = fieldMetaFor(cargo, ['package', 'edition'])
  assert.equal(meta.control, 'select')
  assert.deepEqual(meta.options, ['2015', '2018', '2021', '2024'])
  assert.equal(fieldMetaFor(cargo, ['package', 'unknown']).control, undefined)
})

test('grouping: profile sections claim their keys, the rest follow', () => {
  const cargo = profileForConfigPath('/Cargo.toml', 'toml')
  const groups = groupTopLevelKeys(cargo, ['dependencies', 'package', 'patch', 'profile'])
  assert.deepEqual(groups.map((g) => g.title), ['Package', 'Dependencies', 'Build profiles', 'Other fields'])
  assert.deepEqual(groups[0].keys, ['package'])
  const generic = profileForConfigPath('/x.yml', 'yaml')
  assert.deepEqual(groupTopLevelKeys(generic, ['a', 'b']), [{ title: '', keys: ['a', 'b'] }])
})
