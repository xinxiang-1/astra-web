import assert from 'node:assert/strict'
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { hash } from './delivery-ui.mjs'

export function safeRelativePath(value) {
  assert(
    typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value),
    'Invalid delivery path',
  )
  assert(
    value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Invalid path segment',
  )
  return value
}
export async function deliveryFiles(root, prefix = '') {
  const files = []
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = safeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name)
    const stat = await lstat(path.join(root, relative))
    assert(!stat.isSymbolicLink(), 'Delivery cannot contain symlinks')
    if (entry.isDirectory()) files.push(...(await deliveryFiles(root, relative)))
    else {
      assert(entry.isFile(), 'Unsupported delivery entry')
      files.push(relative)
    }
  }
  return files.sort()
}
export async function writeManifest(root, metadata) {
  const assets = []
  for (const relative of await deliveryFiles(root)) {
    assert(relative !== 'manifest.json', 'Refuse to overwrite an existing manifest')
    const bytes = await readFile(path.join(root, relative))
    assets.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) })
  }
  const manifest = {
    ...metadata,
    integrity: 'Assets exclude manifest.json itself; archive SHA256 is a separate companion file.',
    assets,
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
  })
  return manifest
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}
/** ZIP STORE, ordinary files only; checked independently with .NET ZipArchive in the delivery contract. */
export async function writeZip(root, destination) {
  const parts = [],
    central = []
  let offset = 0
  const paths = await deliveryFiles(root)
  assert(paths.length < 65535, 'ZIP64 is outside this sample contract')
  for (const relative of paths) {
    const name = Buffer.from(`${path.basename(root)}/${relative}`),
      bytes = await readFile(path.join(root, relative))
    assert(bytes.length < 0xffffffff && name.length <= 65535, 'ZIP entry too large')
    const crc = crc32(bytes),
      header = Buffer.alloc(30),
      index = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(((2026 - 1980) << 9) | (10 << 5) | 2, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(bytes.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(name.length, 26)
    index.writeUInt32LE(0x02014b50, 0)
    index.writeUInt16LE(20, 4)
    index.writeUInt16LE(20, 6)
    index.writeUInt16LE(0x800, 8)
    index.writeUInt16LE(header.readUInt16LE(12), 14)
    index.writeUInt32LE(crc, 16)
    index.writeUInt32LE(bytes.length, 20)
    index.writeUInt32LE(bytes.length, 24)
    index.writeUInt16LE(name.length, 28)
    index.writeUInt32LE(offset, 42)
    parts.push(header, name, bytes)
    central.push(index, name)
    offset += header.length + name.length + bytes.length
    assert(offset < 128 * 1024 * 1024, 'Sample package exceeds 128MiB')
  }
  const directory = Buffer.concat(central),
    footer = Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50, 0)
  footer.writeUInt16LE(paths.length, 8)
  footer.writeUInt16LE(paths.length, 10)
  footer.writeUInt32LE(directory.length, 12)
  footer.writeUInt32LE(offset, 16)
  const archive = Buffer.concat([...parts, directory, footer])
  await writeFile(destination, archive, { flag: 'wx' })
  await writeFile(destination + '.sha256', `${hash(archive)}  ${path.basename(destination)}\n`, {
    flag: 'wx',
  })
  return { bytes: archive.length, sha256: hash(archive), entries: paths.length }
}
