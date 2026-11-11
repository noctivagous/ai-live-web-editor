import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { isKeyEnvName, resetTargetFiles, runResetSettings, scrubEnvContent } from './resetSettings.js'

function scratchEnv(withKeysFiles: boolean): { envDir: string; dbPath: string } {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-reset-'))
  const dbPath = path.join(envDir, '.ai-live', 'app-settings.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(path.join(envDir, 'agent-settings.json'), '{"chatEngine":"musecode"}')
  fs.writeFileSync(dbPath, 'db-bytes')
  fs.writeFileSync(`${dbPath}-wal`, 'wal-bytes')
  // Fake key values are built by concatenation so no
  // credential-shaped literal ever sits in this file (AGENTS.md).
  fs.writeFileSync(path.join(envDir, '.env'), [
    '# a comment',
    'EDITOR_PORT=4112',
    'CONN_KEY_META=' + 'fake-meta-key',
    'OPENAI_API_KEY=' + 'sk-' + 'fakefakefakefake',
    'PLAIN_SETTING=stays',
    '',
  ].join('\n'))
  if (withKeysFiles) fs.writeFileSync(path.join(envDir, 'providers.json'), '{"connections":[]}')
  return { envDir, dbPath }
}

describe('resetTargetFiles', () => {
  it('default keeps keys: agent settings + the app-settings DB and its sidecars only', () => {
    const files = resetTargetFiles('/cfg', '/cfg/.ai-live/app-settings.db', false)
    assert.deepEqual(files.map((f) => path.basename(f)), [
      'agent-settings.json', 'app-settings.db', 'app-settings.db-wal', 'app-settings.db-shm',
    ])
  })
  it('--with-keys adds providers.json', () => {
    const files = resetTargetFiles('/cfg', '/cfg/.ai-live/app-settings.db', true)
    assert.ok(files.some((f) => f.endsWith('providers.json')))
  })
})

describe('scrubEnvContent', () => {
  it('removes key entries by name, keeps everything else in order, reports names only', () => {
    const { content, removedNames } = scrubEnvContent([
      '# comment',
      'CONN_KEY_META=aaa',
      'EDITOR_PORT=4112',
      'export BRAVE_API_KEY=bbb',
      'SESSION_TOKEN=ccc',
      'PLAIN=ddd',
    ].join('\n'))
    assert.deepEqual(removedNames, ['CONN_KEY_META', 'BRAVE_API_KEY', 'SESSION_TOKEN'])
    assert.equal(content, ['# comment', 'EDITOR_PORT=4112', 'PLAIN=ddd'].join('\n'))
    assert.ok(!content.includes('aaa') && !content.includes('bbb'))
  })
  it('isKeyEnvName follows the repo key conventions', () => {
    assert.equal(isKeyEnvName('CONN_KEY_OPENAI'), true)
    assert.equal(isKeyEnvName('ANTHROPIC_API_KEY'), true)
    assert.equal(isKeyEnvName('EDITOR_TOKEN'), true)
    assert.equal(isKeyEnvName('TOKEN'), false)
    assert.equal(isKeyEnvName('EDITOR_PORT'), false)
  })
})

describe('runResetSettings against a scratch dir', () => {
  it('default: backs up then removes agent settings + DB, keys and .env untouched', () => {
    const { envDir, dbPath } = scratchEnv(true)
    try {
      const report = runResetSettings({ envDir, dbPath, withKeys: false, stamp: 'TEST' })
      const backupDir = path.join(envDir, 'settings-backup-TEST')
      assert.equal(report.backupDir, backupDir)
      assert.ok(!fs.existsSync(path.join(envDir, 'agent-settings.json')))
      assert.ok(!fs.existsSync(dbPath))
      assert.ok(!fs.existsSync(`${dbPath}-wal`))
      assert.ok(fs.existsSync(path.join(backupDir, 'agent-settings.json')))
      assert.ok(fs.existsSync(path.join(backupDir, 'app-settings.db')))
      // Keys kept:
      assert.ok(fs.existsSync(path.join(envDir, 'providers.json')), 'providers.json stays')
      assert.match(fs.readFileSync(path.join(envDir, '.env'), 'utf8'), /CONN_KEY_META/)
      assert.equal(report.envScrubbed, false)
      assert.ok(report.absent.some((f) => f.endsWith('app-settings.db-shm')))
    } finally {
      fs.rmSync(envDir, { recursive: true, force: true })
    }
  })

  it('--with-keys: providers.json removed and .env scrubbed, originals backed up', () => {
    const { envDir, dbPath } = scratchEnv(true)
    try {
      const report = runResetSettings({ envDir, dbPath, withKeys: true, stamp: 'TEST' })
      assert.ok(!fs.existsSync(path.join(envDir, 'providers.json')))
      const envAfter = fs.readFileSync(path.join(envDir, '.env'), 'utf8')
      assert.ok(!envAfter.includes('CONN_KEY_META'))
      assert.ok(!envAfter.includes('OPENAI_API_KEY'))
      assert.match(envAfter, /EDITOR_PORT=4112/)
      assert.match(envAfter, /PLAIN_SETTING=stays/)
      assert.deepEqual(report.envScrubbedNames, ['CONN_KEY_META', 'OPENAI_API_KEY'])
      const backupEnv = fs.readFileSync(path.join(envDir, 'settings-backup-TEST', '.env'), 'utf8')
      assert.match(backupEnv, /CONN_KEY_META/, 'the backup holds the original .env')
    } finally {
      fs.rmSync(envDir, { recursive: true, force: true })
    }
  })

  it('an empty settings dir is all-absent and creates no backup', () => {
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ale-reset-empty-'))
    try {
      const report = runResetSettings({ envDir, dbPath: path.join(envDir, '.ai-live', 'app-settings.db'), withKeys: false, stamp: 'TEST' })
      assert.equal(report.backupDir, null)
      assert.equal(report.removed.length, 0)
      assert.ok(report.absent.length >= 4)
      assert.ok(!fs.existsSync(path.join(envDir, 'settings-backup-TEST')))
    } finally {
      fs.rmSync(envDir, { recursive: true, force: true })
    }
  })
})
