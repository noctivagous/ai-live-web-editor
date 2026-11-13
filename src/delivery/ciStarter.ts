import fs from 'node:fs'
import path from 'node:path'

/**
 * The CI starter (§13.8): when a project has no pipeline,
 * offer to write one plain workflow file — `.github/workflows/
 * ci.yml` — that runs the project's own checks on push and
 * pull request. The file is a normal project file the user
 * owns from the moment it lands (nothing in ALE rewrites or
 * manages it afterwards), shaped for the stack actually
 * detected: a node project gets install + its own test/build
 * scripts; a python project gets install + pytest when the
 * project declares it. When nothing runnable can be known,
 * the starter refuses in plain words rather than writing a
 * workflow that checks nothing.
 */

export type CiStarterResult =
  | { ok: true, file: string, stack: 'node' | 'python' }
  | { ok: false, error: string }

const HEADER = [
  '# Written by the Delivery facet\'s CI starter — a plain',
  '# project file: edit it, rename it, or delete it freely.',
  '',
].join('\n')

function nodeWorkflow(root: string): string | { error: string } {
  let pkg: { scripts?: Record<string, string>, engines?: { node?: string } }
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) } catch {
    return { error: 'package.json could not be read as JSON, so no starter was written.' }
  }
  const scripts = pkg.scripts ?? {}
  const hasTest = typeof scripts.test === 'string' && scripts.test.trim() !== ''
  const hasBuild = typeof scripts.build === 'string' && scripts.build.trim() !== ''
  if (!hasTest && !hasBuild) {
    return { error: 'This project\'s package.json has no test or build script for a starter to run — add one first, or write the workflow by hand.' }
  }
  const hasLock = fs.existsSync(path.join(root, 'package-lock.json'))
  const nodeVersion = /^\d/.test(pkg.engines?.node ?? '') ? pkg.engines!.node! : '20'
  const lines = [
    'name: CI',
    '',
    'on:',
    '  push:',
    '  pull_request:',
    '',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    `          node-version: '${nodeVersion}'`,
    ...(hasLock ? ['          cache: npm'] : []),
    `      - run: ${hasLock ? 'npm ci' : 'npm install'}`,
    ...(hasTest ? ['      - run: npm test'] : []),
    ...(hasBuild ? ['      - run: npm run build'] : []),
    '',
  ]
  return lines.join('\n')
}

function pythonWorkflow(root: string): string {
  const reqPath = path.join(root, 'requirements.txt')
  const pyprojectPath = path.join(root, 'pyproject.toml')
  const hasReq = fs.existsSync(reqPath)
  const texts = [hasReq ? fs.readFileSync(reqPath, 'utf-8') : '', fs.existsSync(pyprojectPath) ? fs.readFileSync(pyprojectPath, 'utf-8') : ''].join('\n')
  const hasPytest = /pytest/.test(texts)
  const lines = [
    'name: CI',
    '',
    'on:',
    '  push:',
    '  pull_request:',
    '',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-python@v5',
    '        with:',
    "          python-version: '3.12'",
    ...(hasReq ? ['      - run: pip install -r requirements.txt'] : ['      - run: pip install .']),
    ...(hasPytest
      ? ['      - run: pytest']
      : ['      - name: Check the code compiles', '        run: python -m compileall .']),
    '',
  ]
  return lines.join('\n')
}

export function addCiStarter(root: string): CiStarterResult {
  const rel = path.join('.github', 'workflows', 'ci.yml')
  if (fs.existsSync(path.join(root, rel))) {
    return { ok: false, error: '.github/workflows/ci.yml already exists — it is yours; the starter will not overwrite it.' }
  }
  let content: string
  let stack: 'node' | 'python'
  if (fs.existsSync(path.join(root, 'package.json'))) {
    const wf = nodeWorkflow(root)
    if (typeof wf !== 'string') return { ok: false, error: wf.error }
    content = wf
    stack = 'node'
  } else if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'requirements.txt'))) {
    content = pythonWorkflow(root)
    stack = 'python'
  } else {
    return { ok: false, error: 'No stack the starter knows was detected (it writes for node and python projects) — write the workflow file by hand instead.' }
  }
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  fs.writeFileSync(path.join(root, rel), HEADER + content, 'utf-8')
  return { ok: true, file: '.github/workflows/ci.yml', stack }
}
