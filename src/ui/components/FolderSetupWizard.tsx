import React, { useState } from 'react'
import { applyProjectTemplate, convertToPage, postProjectConfig, postWorkflow, type ProjectSetupInfo, type ProjectTemplateId } from '../lib/api'
import { publishWorkflowChanged } from '../lib/workflowSync'

/**
 * Folder setup wizard (Open slice C): what the Preview pane shows
 * when the opened folder has nothing to preview yet — an empty
 * folder, loose files with no page, or a multi-page site with no
 * start page. Every option is a real operation (the launcher's
 * template/convert endpoints, or B's designation), never a dead end;
 * "Not now" leaves the folder exactly as it is, with a Set up
 * preview button to reopen this.
 */

const PAGE_TEMPLATES: { id: ProjectTemplateId, name: string, detail: string }[] = [
  { id: 'seed-app', name: 'App starter', detail: 'A working React app: index.html, the App component, and build setup. Installs its packages — takes a moment.' },
  { id: 'blank-page', name: 'Blank page', detail: 'One empty HTML page, set as the start page.' },
  { id: 'article', name: 'Article page', detail: 'A page with a title and sections, set as the start page.' },
  { id: 'pricing', name: 'Pricing page', detail: 'A page with three pricing plans, set as the start page.' },
]

const CONVERTIBLE = /\.(txt|md|markdown|text)$/i

export function FolderSetupWizard({ setup, files, onApplied, onDismiss }: {
  setup: ProjectSetupInfo
  /** The project's file list ('/notes.txt' paths), for conversions. */
  files: string[]
  /** Called after any successful operation: the parent reloads the
   * project state (files, classification, preview snapshot). */
  onApplied: () => void
  onDismiss: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string>(setup.htmlFiles.includes('index.html') ? 'index.html' : (setup.htmlFiles[0] || ''))

  const textFiles = files.filter((f) => CONVERTIBLE.test(f) && !f.slice(1).includes('/')).slice(0, 4)
  const isMulti = setup.kind === 'html'

  async function run(label: string, op: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    try {
      await op()
      publishWorkflowChanged()
      onApplied()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const detection = isMulti
    ? `This site has ${setup.htmlFiles.length} pages and no start page. Every page can be previewed either way — the start page is the one the preview opens on.`
    : setup.kind === 'empty'
      ? 'This folder is empty. Start from a template, or close this and add files in the editor.'
      : 'This folder has files but no page to preview. Turn a text file into a page, or start from a template.'

  const optionBtn: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', background: '#1b1b20', border: '1px solid #2a2a31',
    borderRadius: 10, padding: '10px 12px', cursor: 'pointer', color: '#e4e4e7',
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#141417', padding: 20, minHeight: 0 }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7', marginBottom: 6 }}>Set up this folder</div>
        <div style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.6, marginBottom: 14 }}>{detection}</div>

        {isMulti && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {setup.htmlFiles.map((f) => (
              <label key={f} style={{ ...optionBtn, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="start-page" checked={chosen === f} onChange={() => setChosen(f)} />
                <span className="mono" style={{ fontSize: 12.5 }}>{f}</span>
              </label>
            ))}
            <button
              type="button"
              className="deck-btn primary"
              disabled={!chosen || busy !== null}
              onClick={() => void run('start', async () => {
                await postProjectConfig({ entry: chosen })
                await postWorkflow({ previewMark: `/${chosen}` })
              })}
            >
              {busy === 'start' ? 'Setting…' : `Use ${chosen || '…'} as the start page`}
            </button>
          </div>
        )}

        {setup.kind === 'loose' && textFiles.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {textFiles.map((f) => (
              <button
                key={f}
                type="button"
                style={optionBtn}
                disabled={busy !== null}
                onClick={() => void run(f, () => convertToPage(f))}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{busy === f ? 'Turning…' : `Turn ${f.slice(1)} into a page`}</div>
                <div style={{ fontSize: 11.5, color: '#a1a1aa', marginTop: 2, lineHeight: 1.5 }}>
                  Creates {f.replace(CONVERTIBLE, '.html').slice(1)} from its text and sets it as the start page. The original file stays as it is.
                </div>
              </button>
            ))}
          </div>
        )}

        {!isMulti && (
          <div style={{ display: 'grid', gap: 8 }}>
            {PAGE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                style={optionBtn}
                disabled={busy !== null}
                onClick={() => void run(t.id, () => applyProjectTemplate(t.id))}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{busy === t.id ? 'Setting up…' : t.name}</div>
                <div style={{ fontSize: 11.5, color: '#a1a1aa', marginTop: 2, lineHeight: 1.5 }}>{t.detail}</div>
              </button>
            ))}
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 12, lineHeight: 1.5 }}>{error}</div>}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="deck-btn" onClick={onDismiss} disabled={busy !== null}>Not now</button>
        </div>
      </div>
    </div>
  )
}
