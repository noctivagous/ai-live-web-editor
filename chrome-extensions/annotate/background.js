/**
 * ALE Annotate — background service worker.
 *
 * The extension's only jobs: toggle annotate mode on the active tab
 * (toolbar action or Alt+Shift+A) and reflect the state on the badge.
 *
 * There is deliberately NO static content_scripts entry in the manifest:
 * content.js is injected with chrome.scripting only when the user invokes
 * the extension on a tab, which is what the activeTab permission grants.
 * No network calls, no telemetry, no storage of page data here.
 *
 * Note: this worker does not gate on tab.url — without a prior invocation
 * grant the Tabs API may not even expose it. Scriptability is decided by
 * simply trying: sendMessage first (covers tabs where the content script
 * already lives), then injection. Pages Chrome refuses to script
 * (chrome://, the Web Store, …) fail both, and the badge flashes instead.
 */

async function flashRefusal(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '—' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b91c1c' });
    setTimeout(() => { chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}); }, 1600);
  } catch (e) { /* badge is cosmetic */ }
}

async function toggleAnnotate(tab) {
  if (!tab || typeof tab.id !== 'number') return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ale-annotate:toggle' });
    return;
  } catch (e) {
    // No content script in this tab yet — inject, then toggle.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'ale-annotate:toggle' });
  } catch (e) {
    // Page refused injection (not scriptable, navigation mid-flight, …).
    // Leave the page untouched; the next click retries from scratch.
    await flashRefusal(tab.id);
  }
}

chrome.action.onClicked.addListener((tab) => { toggleAnnotate(tab); });

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-annotate') return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0]) toggleAnnotate(tabs[0]);
});

// Screenshot requests from the content script: captureVisibleTab must run
// here (content scripts cannot call it). Returns the full visible tab as a
// JPEG data URL; the content script crops it to the annotation's element.
// Permitted by the activeTab grant from invoking the extension on the tab
// (or a host permission, where one exists). No other message is answered.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'ale-annotate:capture' || !sender.tab) return;
  chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 82 })
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // keep the channel open for the async response
});

// The content script reports annotate-mode state so the badge can show
// whether picking is live on this tab.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'ale-annotate:state' || !sender.tab) return;
  const on = !!msg.enabled;
  chrome.action.setBadgeText({ tabId: sender.tab.id, text: on ? 'ON' : '' }).catch(() => {});
  if (on) chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#2563eb' }).catch(() => {});
});
