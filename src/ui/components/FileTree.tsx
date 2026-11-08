import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, ChevronsDownUp, Copy, Eye, EyeOff, File as FileIcon, FileArchive,
  FileBraces, FileCode, FileCog, FileImage, FilePlus, FileText, Folder, FolderOpen, FolderPlus,
  Pencil, RefreshCw, Search, Trash, X,
} from 'lucide-react'
import {
  allDirPaths, baseName, buildTree, countMatches, entriesUnder, filterTree, flattenVisible,
  parentPath, siblingNames, sortTree, validateEntryName, visibleTree,
  type SortMode, type TreeNode,
} from '../lib/fileTree'
import { ButtonGrid } from './ButtonGrid'
import { loadUiPrefs, saveUiPrefs, UI_PREFS_CHANGED_EVENT, type FilePreviewModePref } from '../lib/uiPrefs'
import { effectiveCombo, matchShortcut } from '../lib/shortcuts'
import { getWorkflow, postWorkflow, readFile } from '../lib/api'
import { publishWorkflowChanged, subscribeWorkflow } from '../lib/workflowSync'
import { isRenderable, isScriptFile, looksLikeComponent } from '../lib/previewRender'

/* File browser pane: a real tree over the launcher's flat file list.
   Everything it shows comes from /api/fs/list (files + dirs + mtimes);
   everything it changes goes through the fs API (write for create /
   duplicate, /api/fs/rename, /api/fs/delete, /api/fs/mkdir) — the pane
   keeps no shadow state of the disk. Deliberately not here yet: git
   decorations and problem badges (no data source in the launcher) and
   an Open Editors section (the app has a single active file, no tabs). */

export interface FsOpResult { ok: boolean, error?: string }

function fileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'html', 'css', 'scss'].includes(ext)) return FileCode
  if (ext === 'json') return FileBraces
  if (['md', 'txt'].includes(ext)) return FileText
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return FileImage
  if (['zip', 'tar', 'gz'].includes(ext)) return FileArchive
  if (['env', 'yml', 'yaml', 'toml', 'lock'].includes(ext) || name === 'package.json') return FileCog
  return FileIcon
}

type EditState =
  | { kind: 'rename', path: string }
  | { kind: 'create-file', dir: string }
  | { kind: 'create-folder', dir: string }

export function FileTree({ files, dirs = [], mtimes = {}, active, onSelect, onRefresh, onCreateFile, onCreateFolder, onRename, onDelete, onDuplicate, startPage, onSetStartPage }: {
  files: string[]
  dirs?: string[]
  mtimes?: Record<string, number>
  active: string
  onSelect: (p: string) => void
  onRefresh: () => void
  onCreateFile: (path: string) => Promise<FsOpResult>
  onCreateFolder: (path: string) => Promise<FsOpResult>
  onRename: (from: string, to: string) => Promise<FsOpResult>
  onDelete: (path: string, recursive: boolean) => Promise<FsOpResult>
  onDuplicate: (path: string) => Promise<FsOpResult>
  /** The designated start page (project.ai.json entry, root-relative), badged in the tree. */
  startPage?: string | null
  /** Promote a file to the start page (writes the manifest via App). */
  onSetStartPage?: (path: string) => void
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [sort, setSortState] = useState<SortMode>(() => loadUiPrefs().fileSort)
  const [showHidden, setShowHiddenState] = useState(() => loadUiPrefs().fileShowHidden)
  const setSort = (m: SortMode) => { setSortState(m); saveUiPrefs({ fileSort: m }) }
  const setShowHidden = (fn: (v: boolean) => boolean) => setShowHiddenState(v => {
    const next = fn(v)
    saveUiPrefs({ fileShowHidden: next })
    return next
  })
  const [overrides, setOverrides] = useState(() => loadUiPrefs().shortcutOverrides)
  const [previewMode, setPreviewModeState] = useState<FilePreviewModePref>(() => loadUiPrefs().filePreviewMode)
  useEffect(() => {
    const onPrefs = () => {
      setOverrides(loadUiPrefs().shortcutOverrides)
      setPreviewModeState(loadUiPrefs().filePreviewMode)
    }
    window.addEventListener(UI_PREFS_CHANGED_EVENT, onPrefs)
    return () => window.removeEventListener(UI_PREFS_CHANGED_EVENT, onPrefs)
  }, [])
  const setPreviewMode = (m: FilePreviewModePref) => { setPreviewModeState(m); saveUiPrefs({ filePreviewMode: m }) }

  // The preview mark (slice B): session state on the launcher, mirrored
  // through the workflow snapshot. The pane renders the eye; marking
  // posts back. A fresh file list means a (possibly) new project, whose
  // seed was set server-side at select time — re-read it then.
  const [mark, setMark] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const refresh = async () => {
      try {
        const wf = await getWorkflow()
        if (live && wf) setMark(wf.previewMark ?? null)
      } catch { /* launcher down */ }
    }
    void refresh()
    const off = subscribeWorkflow(() => { void refresh() })
    return () => { live = false; off() }
  }, [files])
  async function markFile(path: string) {
    if (!isRenderable(path)) {
      // A plain script file may still be a component (a Lit element
      // in a .ts file): sniff its content before refusing the mark.
      let component = false
      if (isScriptFile(path)) {
        try {
          const data = await readFile(path) as { content?: string }
          component = typeof data?.content === 'string' && looksLikeComponent(data.content)
        } catch { /* unreadable: refuse below */ }
      }
      if (!component) {
        setNotice(`No rendering for ${baseName(path)} — the preview stays where it is.`)
        return
      }
    }
    setMark(path)
    try {
      const data = await postWorkflow({ previewMark: path })
      if (data && 'previewMark' in data) setMark(data.previewMark ?? null)
      publishWorkflowChanged()
    } catch { /* the next snapshot refresh reconciles */ }
  }
  function handleSelectNode(node: TreeNode) {
    if (node.isDir) return
    onSelect(node.path)
    if (previewMode === 'follow') void markFile(node.path)
  }
  const [focused, setFocused] = useState(active)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number, y: number, node: TreeNode } | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ node: TreeNode, under: number } | null>(null)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const tree = useMemo(() => {
    const built = sortTree(visibleTree(buildTree(files, dirs), showHidden), sort, mtimes)
    return query.trim() ? filterTree(built, query) : built
  }, [files, dirs, showHidden, sort, mtimes, query])
  const rows = useMemo(
    () => flattenVisible(tree, query.trim() ? new Set<string>() : collapsed),
    [tree, collapsed, query],
  )
  const matches = useMemo(() => countMatches(sortTree(visibleTree(buildTree(files, dirs), showHidden), sort, mtimes), query), [files, dirs, showHidden, sort, mtimes, query])
  const fullTree = useMemo(() => buildTree(files, dirs), [files, dirs])

  useEffect(() => { setFocused(active) }, [active])

  // Close the context menu on any outside interaction.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close) }
  }, [menu])

  const toggleDir = (path: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const expandDir = (path: string) => setCollapsed(prev => {
    if (!prev.has(path)) return prev
    const next = new Set(prev)
    next.delete(path)
    return next
  })

  const run = async (op: () => Promise<FsOpResult>) => {
    const r = await op()
    if (!r.ok) setNotice(r.error || 'Operation failed')
    else setNotice(null)
    return r
  }

  const startRename = (node: TreeNode) => {
    setEdit({ kind: 'rename', path: node.path })
    setEditValue(node.name)
    setEditError(null)
    setMenu(null)
  }
  const startCreate = (kind: 'create-file' | 'create-folder', dir: string) => {
    if (dir) expandDir(dir)
    setEdit({ kind, dir })
    setEditValue('')
    setEditError(null)
    setMenu(null)
  }

  const commitEdit = async () => {
    if (!edit) return
    const name = editValue
    if (edit.kind === 'rename') {
      const dir = parentPath(edit.path)
      const siblings = siblingNames(fullTree, dir)
      siblings.delete(baseName(edit.path))
      const err = validateEntryName(name, siblings)
      if (err) { setEditError(err); return }
      const to = (dir ? dir + '/' : '/') + name.trim()
      if (to !== edit.path) {
        const r = await run(() => onRename(edit.path, to))
        if (!r.ok) { setEditError(r.error || 'Rename failed'); return }
      }
    } else {
      const dir = edit.kind === 'create-file' || edit.kind === 'create-folder' ? edit.dir : ''
      const err = validateEntryName(name, siblingNames(fullTree, dir))
      if (err) { setEditError(err); return }
      const target = (dir ? dir + '/' : '/') + name.trim()
      const r = await run(() => (edit.kind === 'create-file' ? onCreateFile(target) : onCreateFolder(target)))
      if (!r.ok) { setEditError(r.error || 'Create failed'); return }
    }
    setEdit(null)
  }

  const requestDelete = (node: TreeNode) => {
    setMenu(null)
    setConfirmDel({ node, under: entriesUnder(node) })
  }
  const doDelete = async () => {
    if (!confirmDel) return
    const { node, under } = confirmDel
    setConfirmDel(null)
    await run(() => onDelete(node.path, node.isDir && under > 0))
  }

  const dropOnto = async (targetDir: string) => {
    if (!dragPath) return
    const name = baseName(dragPath)
    if (parentPath(dragPath) === targetDir) return
    if (targetDir === dragPath || targetDir.startsWith(dragPath + '/')) {
      setNotice('A folder cannot be moved into itself')
      return
    }
    await run(() => onRename(dragPath, (targetDir ? targetDir + '/' : '/') + name))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return
    const idx = rows.findIndex(r => r.node.path === focused)
    const move = (d: number) => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, idx + d))]
      if (next) setFocused(next.node.path)
    }
    // Rebindable commands first (Settings → Keyboard Shortcuts), so a
    // user binding wins over the pane's structural navigation keys.
    if (matchShortcut(e.nativeEvent, effectiveCombo('fileRename', overrides))) {
      const row = rows[idx]
      if (row) { e.preventDefault(); startRename(row.node) }
      return
    }
    if (matchShortcut(e.nativeEvent, effectiveCombo('fileDelete', overrides))) {
      const row = rows[idx]
      if (row) { e.preventDefault(); requestDelete(row.node) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') {
      const row = rows[idx]
      if (row) { e.preventDefault(); row.node.isDir ? toggleDir(row.node.path) : handleSelectNode(row.node) }
    } else if (e.key === 'ArrowRight') {
      const row = rows[idx]
      if (row?.node.isDir) { e.preventDefault(); expandDir(row.node.path) }
    } else if (e.key === 'ArrowLeft') {
      const row = rows[idx]
      if (row?.node.isDir) { e.preventDefault(); setCollapsed(prev => new Set(prev).add(row.node.path)) }
    }
  }

  const editRowFor = (dir: string, depth: number) => {
    if (!edit || edit.kind === 'rename' || edit.dir !== dir) return null
    return (
      <div className="ft-row editing" style={{ paddingLeft: 8 + depth * 14 }}>
        <span className="ft-chev" />
        {edit.kind === 'create-file' ? <FileIcon size={13} /> : <Folder size={13} />}
        <input
          autoFocus
          className="ft-edit-input"
          value={editValue}
          onChange={e => { setEditValue(e.target.value); setEditError(null) }}
          onKeyDown={e => {
            if (e.key === 'Enter') void commitEdit()
            if (e.key === 'Escape') setEdit(null)
            e.stopPropagation()
          }}
          onBlur={() => { if (editValue.trim()) void commitEdit(); else setEdit(null) }}
          placeholder={edit.kind === 'create-file' ? 'file name' : 'folder name'}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ButtonGrid className="ft-toolbar">
        <select className="deck-select ft-sort" value={sort} onChange={e => setSort(e.target.value as SortMode)} title="Sort order" aria-label="Sort order">
          <option value="name">Name</option>
          <option value="type">Type</option>
          <option value="modified">Modified</option>
        </select>
        <div className="seg" role="group" aria-label="Preview selection">
          <button type="button" className={previewMode === 'marked' ? 'on' : ''} onClick={() => setPreviewMode('marked')} title="Preview selection: Marked — the preview only moves when you mark a file (eye button)">Marked</button>
          <button type="button" className={previewMode === 'follow' ? 'on' : ''} onClick={() => setPreviewMode('follow')} title="Preview selection: Follow — clicking a file previews it too">Follow</button>
        </div>
      </ButtonGrid>
      <div className="ft-filter">
        <Search size={12} className="ft-filter-icon" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter files"
          className="ft-filter-input"
          aria-label="Filter files"
        />
        {query && (
          <>
            <span className="ft-filter-count">{matches}</span>
            <button type="button" className="ft-filter-clear" onClick={() => setQuery('')} title="Clear filter"><X size={12} /></button>
          </>
        )}
      </div>

      <div
        ref={rootRef}
        className="ft-tree"
        tabIndex={0}
        role="tree"
        aria-label="Project files"
        onKeyDown={onKeyDown}
        onDragOver={e => { if (dragPath) { e.preventDefault(); setDragOver('') } }}
        onDrop={e => { e.preventDefault(); void dropOnto(''); setDragPath(null); setDragOver(null) }}
      >
        {editRowFor('', 0)}
        {rows.map(({ node, depth }) => {
          const Icon = node.isDir ? (collapsed.has(node.path) && !query ? Folder : FolderOpen) : fileIcon(node.name)
          const isActive = node.path === active
          const isFocused = node.path === focused
          if (edit?.kind === 'rename' && edit.path === node.path) {
            return (
              <div key={node.path} className="ft-row editing" style={{ paddingLeft: 8 + depth * 14 }}>
                <span className="ft-chev" />
                <Icon size={13} />
                <input
                  autoFocus
                  className="ft-edit-input"
                  value={editValue}
                  onChange={e => { setEditValue(e.target.value); setEditError(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void commitEdit()
                    if (e.key === 'Escape') setEdit(null)
                    e.stopPropagation()
                  }}
                  onBlur={() => { if (editValue.trim()) void commitEdit(); else setEdit(null) }}
                />
              </div>
            )
          }
          return (
            <React.Fragment key={node.path}>
              <div
                role="treeitem"
                aria-expanded={node.isDir ? !(collapsed.has(node.path) && !query) : undefined}
                className={`ft-row${isActive ? ' active' : ''}${isFocused ? ' focused' : ''}${dragOver === node.path ? ' drop' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                draggable
                onDragStart={e => { setDragPath(node.path); e.dataTransfer.effectAllowed = 'move' }}
                onDragEnd={() => { setDragPath(null); setDragOver(null) }}
                onDragOver={node.isDir ? e => { e.preventDefault(); e.stopPropagation(); setDragOver(node.path) } : undefined}
                onDrop={node.isDir ? e => { e.preventDefault(); e.stopPropagation(); void dropOnto(node.path); setDragPath(null); setDragOver(null) } : undefined}
                onClick={() => { setFocused(node.path); if (!node.isDir) handleSelectNode(node) }}
                onDoubleClick={() => { if (node.isDir) toggleDir(node.path) }}
                onContextMenu={e => { e.preventDefault(); setFocused(node.path); setMenu({ x: e.clientX, y: e.clientY, node }) }}
                title={node.path}
              >
                {node.isDir
                  ? <button type="button" className="ft-chev" onClick={e => { e.stopPropagation(); toggleDir(node.path) }} tabIndex={-1}>{(collapsed.has(node.path) && !query) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>
                  : <span className="ft-chev" />}
                <Icon size={13} className={node.isDir ? 'ft-icon dir' : 'ft-icon'} />
                <span className="ft-name">{node.name}</span>
                {!node.isDir && startPage && node.path === `/${startPage}` && (
                  <span className="ft-start-badge" title="Start page — the preview opens here (project.ai.json)">start</span>
                )}
                {!node.isDir && mark === node.path && (
                  <Eye size={11} className="ft-mark-icon" aria-label="Previewed file" />
                )}
                <span className="ft-actions">
                  {!node.isDir && mark !== node.path && (
                    <button type="button" className="ft-act" title="Preview this file" tabIndex={-1} onClick={e => { e.stopPropagation(); void markFile(node.path) }}><Eye size={11} /></button>
                  )}
                  <button type="button" className="ft-act" title="Rename (F2)" tabIndex={-1} onClick={e => { e.stopPropagation(); startRename(node) }}><Pencil size={11} /></button>
                  <button type="button" className="ft-act" title="Delete (Del)" tabIndex={-1} onClick={e => { e.stopPropagation(); requestDelete(node) }}><Trash size={11} /></button>
                </span>
              </div>
              {edit && edit.kind !== 'rename' && edit.dir === node.path && editRowFor(node.path, depth + 1)}
            </React.Fragment>
          )
        })}
        {files.length === 0 && (
          <div className="ft-empty">No files yet. Check the launcher connection, then create your first file.</div>
        )}
        {files.length > 0 && rows.length === 0 && (
          <div className="ft-empty">No files match the filter.</div>
        )}
        {editError && <div className="ft-edit-error">{editError}</div>}
      </div>

      <ButtonGrid className="ft-actionbar">
        <button type="button" className="deck-btn btn-icon ft-tool btn-func" onClick={() => startCreate('create-file', focused && findIsDir(fullTree, focused) ? focused : parentPath(focused || active))} title="New file (in the selected folder)"><FilePlus size={13} />New file</button>
        <button type="button" className="deck-btn btn-icon ft-tool btn-func" onClick={() => startCreate('create-folder', focused && findIsDir(fullTree, focused) ? focused : parentPath(focused || active))} title="New folder"><FolderPlus size={13} />New folder</button>
        <button type="button" className="deck-btn btn-icon ft-tool btn-func" onClick={onRefresh} title="Refresh the file list"><RefreshCw size={13} />Refresh</button>
        <button type="button" className="deck-btn btn-icon ft-tool btn-func" onClick={() => setCollapsed(new Set(allDirPaths(fullTree)))} title="Collapse all folders"><ChevronsDownUp size={13} />Collapse all</button>
        <button type="button" className={`deck-btn btn-icon ft-tool btn-func${showHidden ? ' on' : ''}`} onClick={() => setShowHidden(v => !v)} title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}>{showHidden ? <Eye size={13} /> : <EyeOff size={13} />}Dotfiles</button>
      </ButtonGrid>
      <div className="ft-footer">
        <span>{files.length} file{files.length === 1 ? '' : 's'} · {dirs.length} folder{dirs.length === 1 ? '' : 's'}</span>
        {notice && <span className="ft-notice" title={notice}>{notice}<button type="button" className="ft-filter-clear" onClick={() => setNotice(null)}><X size={11} /></button></span>}
      </div>

      {menu && (
        <div className="ft-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()}>
          {!menu.node.isDir && <button type="button" onClick={() => { onSelect(menu.node.path); setMenu(null) }}>Open</button>}
          {!menu.node.isDir && <button type="button" onClick={() => { void markFile(menu.node.path); setMenu(null) }}>Preview this file</button>}
          {!menu.node.isDir && onSetStartPage && /\.html?$/i.test(menu.node.path) && startPage !== menu.node.path.slice(1) && (
            <button type="button" onClick={() => { onSetStartPage(menu.node.path); setMenu(null) }}>Set as start page</button>
          )}
          <button type="button" onClick={() => startCreate('create-file', menu.node.isDir ? menu.node.path : parentPath(menu.node.path))}>New file here</button>
          <button type="button" onClick={() => startCreate('create-folder', menu.node.isDir ? menu.node.path : parentPath(menu.node.path))}>New folder here</button>
          {!menu.node.isDir && <button type="button" onClick={() => { void run(() => onDuplicate(menu.node.path)); setMenu(null) }}>Duplicate</button>}
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(menu.node.path); setMenu(null) }}>Copy path</button>
          <button type="button" onClick={() => startRename(menu.node)}>Rename</button>
          <button type="button" className="danger" onClick={() => requestDelete(menu.node)}>Delete</button>
        </div>
      )}

      {confirmDel && (
        <div className="ft-confirm-overlay" onClick={() => setConfirmDel(null)}>
          <div className="ft-confirm" onClick={e => e.stopPropagation()}>
            <div className="ft-confirm-title">Delete {confirmDel.node.path}?</div>
            <div className="ft-confirm-body">
              {confirmDel.node.isDir
                ? confirmDel.under > 0
                  ? `This folder contains ${confirmDel.under} entr${confirmDel.under === 1 ? 'y' : 'ies'} — all of them will be deleted. This cannot be undone.`
                  : 'This empty folder will be deleted.'
                : 'This file will be deleted. This cannot be undone.'}
            </div>
            <div className="ft-confirm-actions">
              <button type="button" className="deck-btn" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button type="button" className="deck-btn danger" onClick={() => void doDelete()}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function findIsDir(nodes: TreeNode[], path: string): boolean {
  for (const n of nodes) {
    if (n.path === path) return n.isDir
    if (n.isDir) { const hit = findIsDir(n.children, path); if (hit) return true }
  }
  return false
}
