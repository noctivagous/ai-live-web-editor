import Dexie, { Table } from 'dexie'
export interface ProjectFile { id?: number; path: string; content: string; updatedAt: number }
class EditorDB extends Dexie { files!: Table<ProjectFile>; constructor(){ super('AIEditorDB'); this.version(1).stores({ files: '++id, &path, updatedAt' }) } }
export const db = new EditorDB()
export async function seedIfEmpty(){ const count = await db.files.count(); if(count===0){ await db.files.bulkAdd([ { path: '/index.html', content: '<div id=app><h1>Hello from AI Editor</h1></div>', updatedAt: Date.now() }, { path: '/src/App.tsx', content: 'export default function App(){ return <h1>Edit me with AI</h1> }', updatedAt: Date.now() }, { path: '/styles.css', content: 'body{font-family:system-ui} h1{color:#6e56ff}', updatedAt: Date.now() } ]) } }
