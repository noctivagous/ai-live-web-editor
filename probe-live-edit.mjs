import fs from 'fs'
import { chromium } from 'playwright'

const src = fs.readFileSync(new URL('./src/live-edit/overlay.js', import.meta.url), 'utf-8')
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' })
const page = await browser.newPage()
await page.setContent('<html><body><h1 id="title">Hi</h1><p class="sub">text</p></body></html>')
await page.addScriptTag({ content: src })

const api = await page.evaluate(() => Boolean(window.__AI_LIVE_EDIT__?.installed))
console.log('installed', api)

// id selector
await page.evaluate(() => window.__AI_LIVE_EDIT__.addAnnotation({ selector: '#title', text: 'make this bigger' }))
// data-attr + nth-of-type fallback via simulated click path: use buildSelector indirectly through select mode? use addAnnotation with generated selector
await page.evaluate(() => window.__AI_LIVE_EDIT__.addAnnotation({ selector: '.sub', text: 'padding 24', type: 'move' }))
await page.evaluate(() => {
  const anns = window.__AI_LIVE_EDIT__.exportAnnotations()
  anns[1].targetSelector = 'h1:nth-of-type(1)'
  window.__AI_LIVE_EDIT__.importAnnotations(anns)
})
await page.evaluate(() => window.__AI_LIVE_EDIT__.setPageNotes('whole page note'))
const exported = await page.evaluate(() => ({
  anns: window.__AI_LIVE_EDIT__.exportAnnotations(),
  notes: window.__AI_LIVE_EDIT__.getPageNotes(),
}))
console.log('exported', JSON.stringify(exported))
console.log('tags', await page.locator('.ai-le-tag').count(), 'outlines', await page.locator('.ai-le-outline').count())
await page.evaluate(() => window.__AI_LIVE_EDIT__.clearAll())
const after = await page.evaluate(() => ({
  anns: window.__AI_LIVE_EDIT__.exportAnnotations(),
  notes: window.__AI_LIVE_EDIT__.getPageNotes(),
  outlines: document.querySelectorAll('.ai-le-outline').length,
}))
console.log('afterClear', JSON.stringify(after))
await browser.close()
if (!api || exported.anns.length !== 2 || after.anns.length !== 0 || after.outlines !== 0) {
  console.error('PROBE_FAIL')
  process.exit(1)
}
console.log('PROBE_OK')
