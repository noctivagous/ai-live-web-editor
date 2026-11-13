/**
 * Structural checks for the ALE Annotate extension. No dependencies:
 *   node test/check.mjs
 * Exits non-zero on the first failing group, printing what failed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || !detail ? '' : ' — ' + detail));
  if (!ok) failures++;
}

const manifestRaw = readFileSync(join(root, 'manifest.json'), 'utf8');
let manifest = null;
try { manifest = JSON.parse(manifestRaw); } catch (e) { check('manifest.json parses', false, e.message); }
check('manifest.json parses', !!manifest);
if (manifest) {
  check('Manifest V3', manifest.manifest_version === 3);
  check('service worker declared', manifest.background && manifest.background.service_worker === 'background.js');
  check('background.js exists', existsSync(join(root, 'background.js')));
  check('no static content_scripts (invocation-only injection)', !('content_scripts' in manifest));
  check('no host_permissions (activeTab only)', !('host_permissions' in manifest));
  const allowed = ['activeTab', 'scripting', 'clipboardWrite', 'storage'];
  const perms = manifest.permissions || [];
  check('permissions are minimal', perms.every((p) => allowed.includes(p)), 'got: ' + perms.join(','));
  check('toggle command present', !!(manifest.commands && manifest.commands['toggle-annotate']));
  check('action has no popup (click toggles directly)', !(manifest.action && manifest.action.default_popup));
}

for (const file of ['background.js', 'content.js']) {
  const src = readFileSync(join(root, file), 'utf8');
  try { new vm.Script(src, { filename: file }); check(file + ' parses', true); }
  catch (e) { check(file + ' parses', false, e.message); }
}

const content = readFileSync(join(root, 'content.js'), 'utf8');
check('content.js makes no network calls', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(content));
check('content.js uses shadow DOM', /attachShadow/.test(content));
check('content.js never assigns page text via innerHTML', !/\.innerHTML\s*=/.test(content));
check('content.js exposes its test API', /__ALE_ANNOTATE_EXT__/.test(content));
check('content.js composes the clipboard payload', /Annotations for:/.test(content) && /Selector:/.test(content));
check('content.js persists to chrome.storage.local', /chrome\.storage\.local/.test(content) || /chrome\.storage && chrome\.storage\.local/.test(content));
check('content.js migrates the slice-1 session record', /adoptLegacySession/.test(content));
check('content.js handles text selections', /describeSelection/.test(content) && /kind: 'selection'/.test(content));
check('content.js payload quotes selections', /Selected text in/.test(content) && /Quote:/.test(content));
check('content.js requests screenshots via the background', /ale-annotate:capture/.test(content));
check('content.js crops screenshots to the target', /cropAndStore/.test(content));

const background = readFileSync(join(root, 'background.js'), 'utf8');
check('background injects via scripting', /chrome\.scripting\.executeScript/.test(background));
check('background toggles via message', /ale-annotate:toggle/.test(background));
check('background captures the visible tab for screenshots', /captureVisibleTab/.test(background));

process.exit(failures ? 1 : 0);
