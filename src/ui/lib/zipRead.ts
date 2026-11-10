/**
 * A minimal read-only zip reader for the design import wizard:
 * just enough of the format to list and extract text entries —
 * stored (0) and deflate (8) members, read from the central
 * directory. No dependency; deflate goes through the platform
 * DecompressionStream. Anything it cannot read is skipped and
 * reported, never silently half-imported.
 */

export interface ZipEntryText { path: string, content: string }
export interface ZipReadResult { files: ZipEntryText[], skipped: string[] }

const TEXT_EXT = /\.(css|json|md|markdown|html?|txt|svg|xml)$/i

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw')
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream)).arrayBuffer()
  return new Uint8Array(buf)
}

export async function unzipTextFiles(buffer: ArrayBuffer): Promise<ZipReadResult> {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  // End of central directory: scan the tail for PK\x05\x06.
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('That file is not a zip archive.')
  const count = view.getUint16(eocd + 10, true)
  let off = view.getUint32(eocd + 16, true)
  const files: ZipEntryText[] = []
  const skipped: string[] = []
  const decoder = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) break
    const method = view.getUint16(off + 10, true)
    const compSize = view.getUint32(off + 20, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLen = view.getUint16(off + 32, true)
    const localOff = view.getUint32(off + 42, true)
    const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen))
    off += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || !TEXT_EXT.test(name)) { if (!name.endsWith('/')) skipped.push(name); continue }
    const lNameLen = view.getUint16(localOff + 26, true)
    const lExtraLen = view.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = bytes.subarray(dataStart, dataStart + compSize)
    try {
      const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null
      if (data === null) { skipped.push(name); continue }
      files.push({ path: name, content: decoder.decode(data) })
    } catch {
      skipped.push(name)
    }
  }
  return { files, skipped }
}
