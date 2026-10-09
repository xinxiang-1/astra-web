import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const base = process.env.ASTRA_DEV_URL || 'http://localhost:5173'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const out = process.env.ASTRA_CONTRACT_OUTPUT || `test-results/workflow-package-core-${channel}`
await mkdir(out, { recursive: true })
const fixture = (
  await readFile('docs/validation/2026-10-09/creative-workflow/source.astra-signature')
).toString('base64')
const browser = await chromium.launch({ channel, headless: true })
const report = { browser: browser.version(), cases: [], errors: [] }
try {
  const source = await browser.newContext(),
    page = await source.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  const prepared = await page.evaluate(async (fixture) => {
    const api = await import('/src/lib/art-projects.ts')
    const sig = await import('/src/lib/signature-portrait/project.ts')
    const wf = await import('/src/lib/creative-workflow-package.ts')
    const { signatureArtProject } = await import('/src/lib/signature-art-workflow.ts')
    const { exportSignaturePng } = await import('/src/lib/signature-portrait/png-export.ts')
    const { signatureProjectThumbnail } = await import('/src/lib/signature-project-thumbnail.ts')
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const { renderSignaturePortrait } = await import('/src/lib/signature-portrait/index.ts')
    const cases = [],
      check = (v, label) => {
        if (!v) throw new Error(label)
      }
    const canonical = (value) =>
      JSON.stringify(value, (_key, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
          : v,
      )
    const hex = (bytes) =>
      Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
    const hash = async (blob) =>
      hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
    const base64 = (blob) =>
      new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.readAsDataURL(blob)
      })
    const initial = await sig.readSignatureProject(
      new Blob([Uint8Array.from(atob(fixture), (c) => c.charCodeAt(0))]),
    )
    let fontStamps = []
    try {
      fontStamps = await generateHandwritingVariants('李云舟', {
        count: 8,
        maxSide: 96,
        seed: 42,
        font: 'mashanzheng',
      })
      const rendered = await renderSignaturePortrait(
        initial.project.portrait,
        320,
        256,
        fontStamps,
        initial.project.options,
      )
      const scene = {
        ...initial.project,
        stamps: fontStamps,
        placements: rendered.placements,
        portraitName: '工作流工程样本',
      }
      const file = await sig.createSignatureProject(scene)
      const png = await exportSignaturePng(scene, { longEdge: 128 })
      const thumb = await signatureProjectThumbnail(png)
      const project = signatureArtProject(
        new File([png], 'workflow.png', { type: 'image/png' }),
        thumb,
        scene.portraitName,
        '#f5f3ef',
        'hologram',
      )
      const pair = await api.saveSignatureDerivative(
        {
          file,
          name: scene.portraitName,
          thumbnail: thumb,
          engineVersion: sig.SIGNATURE_PROJECT_ENGINE,
        },
        project,
        'hologram',
      )
      const original = await api.getSignatureProject(pair.signature.id)
      const packet = await wf.createCreativeWorkflowPackage(original, pair.project)
      const parsed = await wf.readCreativeWorkflowPackage(packet)
      try {
        check((await hash(parsed.signatureFile)) === (await hash(file)), 'signature bytes changed')
        check((await hash(parsed.project.source)) === (await hash(png)), 'derivative bytes changed')
        check(
          canonical(parsed.signature.placements) === canonical(scene.placements),
          'signature placements changed',
        )
        check(
          parsed.signature.stamps.every((s) => s.source.font === 'mashanzheng'),
          'font recipes lost',
        )
        check(
          canonical(parsed.project.settings) === canonical(pair.project.settings),
          'settings changed',
        )
        cases.push('complete-editable-original-and-derivative-roundtrip')
        const next = await wf.readCreativeWorkflowPackage(
          await wf.createCreativeWorkflowPackage(original, pair.project),
        )
        try {
          check(next.workflowKey === parsed.workflowKey, 'export date created a new version')
        } finally {
          next.dispose()
        }
        cases.push('reexport-clock-and-local-ids-do-not-create-new-version')
      } finally {
        parsed.dispose()
      }
      const unwrap = async (blob, magic) => {
        const offset = new TextEncoder().encode(magic).length
        const headerSize = offset + 4 + 32
        const header = new Uint8Array(await blob.slice(0, headerSize).arrayBuffer())
        const length = new DataView(header.buffer).getUint32(offset, true)
        const manifest = JSON.parse(await blob.slice(headerSize, headerSize + length).text())
        return { manifest, payload: blob.slice(headerSize + length) }
      }
      const wrap = async (manifest, payload, magic = 'ASTRAWF01\n') => {
        const encoded = new TextEncoder().encode(magic),
          json = new Blob([JSON.stringify(manifest)])
        const header = new Uint8Array(encoded.length + 4 + 32)
        header.set(encoded)
        new DataView(header.buffer).setUint32(encoded.length, json.size, true)
        header.set(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await json.arrayBuffer())),
          encoded.length + 4,
        )
        return new Blob([header, json, payload])
      }
      const { manifest, payload } = await unwrap(packet, 'ASTRAWF01\n')
      const rejected = async (blob, pattern, label) => {
        let denied = false
        try {
          const result = await wf.readCreativeWorkflowPackage(blob)
          result.dispose()
        } catch (e) {
          denied = pattern.test(e.message)
        }
        check(denied, label)
        cases.push(label)
      }
      const changedBytes = new Uint8Array(await packet.arrayBuffer())
      changedBytes[changedBytes.length - 1] ^= 1
      await rejected(
        new Blob([changedBytes]),
        /校验失败/,
        'corrupt-asset-rejected-before-persistence',
      )
      await rejected(
        new Blob([packet, 'extra']),
        /额外数据/,
        'appended-and-truncated-payload-rejected',
      )
      await rejected(packet.slice(0, packet.size - 1), /不完整/, 'truncated-payload-rejected')
      await rejected(
        await wrap({ ...manifest, version: 2 }, payload),
        /版本/,
        'future-workflow-version-rejected',
      )
      await rejected(
        await wrap({ ...manifest, signature: { ...manifest.signature, size: 0 } }, payload),
        /素材信息/,
        'invalid-and-oversized-declared-assets-rejected',
      )
      await rejected(
        await wrap(
          { ...manifest, signature: { ...manifest.signature, size: 194 * 1024 * 1024 } },
          payload,
        ),
        /素材信息/,
        'oversized-declared-assets-rejected',
      )
      await rejected(
        await wrap(
          { ...manifest, origin: { ...manifest.origin, sha256: '0'.repeat(64) } },
          payload,
        ),
        /原作关系/,
        'mismatched-original-hash-rejected',
      )
      await rejected(
        await wrap(
          { ...manifest, origin: { ...manifest.origin, projectId: '../escape' } },
          payload,
        ),
        /来源/,
        'invalid-provenance-id-rejected',
      )
      const nested = await unwrap(file, 'ASIG01\n')
      nested.manifest.fontLicenses.mashanzheng.licenseText = 'removed license'
      const badSignature = await wrap(nested.manifest, nested.payload, 'ASIG01\n')
      const badHash = await hash(badSignature)
      await rejected(
        await wrap(
          {
            ...manifest,
            signature: { ...manifest.signature, size: badSignature.size, sha256: badHash },
            origin: { ...manifest.origin, sha256: badHash },
          },
          new Blob([badSignature, payload.slice(manifest.signature.size)]),
        ),
        /许可/,
        'nested-font-license-tampering-rejected',
      )
      const art = await unwrap(payload.slice(manifest.signature.size), 'ASTRA01\n')
      art.manifest.engine.version = 'unsupported-future-engine'
      const badArt = await wrap(art.manifest, art.payload, 'ASTRA01\n')
      const urls = new Set(),
        nativeCreate = URL.createObjectURL,
        nativeRevoke = URL.revokeObjectURL
      try {
        URL.createObjectURL = function (...args) {
          const url = nativeCreate.apply(this, args)
          urls.add(url)
          return url
        }
        URL.revokeObjectURL = function (url) {
          urls.delete(url)
          nativeRevoke.call(this, url)
        }
        await rejected(
          await wrap(
            {
              ...manifest,
              characters: { ...manifest.characters, size: badArt.size, sha256: await hash(badArt) },
            },
            new Blob([file, badArt]),
          ),
          /对应版本/,
          'nested-engine-rejection-disposes-original-assets',
        )
        check(urls.size === 0, 'failed nested read leaked object urls')
      } finally {
        URL.createObjectURL = nativeCreate
        URL.revokeObjectURL = nativeRevoke
      }
      const cancellation = new AbortController()
      cancellation.abort()
      let cancelled = false
      try {
        await wf.readCreativeWorkflowPackage(packet, cancellation.signal)
      } catch (e) {
        cancelled = e.name === 'AbortError'
      }
      check(cancelled, 'pre-aborted reader did not stop')
      cases.push('cancelled-reader-does-not-persist')
      return {
        cases,
        packet: await base64(packet),
        signature: await base64(file),
        settings: pair.project.settings,
        placements: scene.placements,
        font: 'mashanzheng',
      }
    } finally {
      initial.dispose()
      for (const stamp of fontStamps) stamp.canvas.width = stamp.canvas.height = 1
    }
  }, fixture)
  report.cases.push(...prepared.cases)
  await writeFile(out + '/source.astra-signature', Buffer.from(prepared.signature, 'base64'))
  await writeFile(out + '/source.astra-workflow', Buffer.from(prepared.packet, 'base64'))
  await writeFile(
    out + '/expected.json',
    JSON.stringify({
      settings: prepared.settings,
      placements: prepared.placements,
      font: prepared.font,
    }) + '\n',
  )
  await source.close()
  const target = await browser.newContext(),
    restore = await target.newPage()
  restore.on('pageerror', (e) => report.errors.push(e.message))
  await restore.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  // Load actual application modules while online; file assets and persistence below work offline.
  await restore.evaluate(async () => {
    await import('/src/lib/creative-workflow-package.ts')
    await import('/src/lib/art-projects.ts')
    await import('/src/lib/signature-portrait/png-export.ts')
    await import('/src/lib/signature-project-thumbnail.ts')
  })
  await target.setOffline(true)
  report.cases.push(
    ...(await restore.evaluate(async (packet) => {
      const wf = await import('/src/lib/creative-workflow-package.ts'),
        api = await import('/src/lib/art-projects.ts')
      const { exportSignaturePng } = await import('/src/lib/signature-portrait/png-export.ts')
      const { signatureProjectThumbnail } = await import('/src/lib/signature-project-thumbnail.ts')
      const sig = await import('/src/lib/signature-portrait/project.ts')
      const cases = [],
        check = (v, label) => {
          if (!v) throw new Error(label)
        }
      const parsed = await wf.readCreativeWorkflowPackage(
        new Blob([Uint8Array.from(atob(packet), (c) => c.charCodeAt(0))]),
      )
      const rawCounts = async () => {
        const db = await new Promise((resolve) => {
          const request = indexedDB.open('astra-art-projects')
          request.onsuccess = () => resolve(request.result)
        })
        try {
          return await Promise.all(
            ['projects', 'signature-projects', 'creative-index'].map(
              (name) =>
                new Promise((resolve) => {
                  const r = db.transaction(name).objectStore(name).count()
                  r.onsuccess = () => resolve(r.result)
                }),
            ),
          )
        } finally {
          db.close()
        }
      }
      try {
        const input = {
          file: parsed.signatureFile,
          name: parsed.project.origin.name,
          thumbnail: await signatureProjectThumbnail(
            await exportSignaturePng(parsed.signature, { longEdge: 128 }),
          ),
          engineVersion: sig.SIGNATURE_PROJECT_ENGINE,
        }
        const nativePut = IDBObjectStore.prototype.put
        let denied = false
        try {
          IDBObjectStore.prototype.put = function (value, ...args) {
            if (this.name === 'projects')
              throw new DOMException('Controlled quota failure', 'QuotaExceededError')
            return nativePut.call(this, value, ...args)
          }
          try {
            await api.importCreativeWorkflow(input, parsed.project, parsed.workflowKey)
          } catch {
            denied = true
          }
        } finally {
          IDBObjectStore.prototype.put = nativePut
        }
        check(
          denied && JSON.stringify(await rawCounts()) === '[0,0,0]',
          'failed import left raw records',
        )
        cases.push('quota-failure-rolls-back-all-three-stores')
        const controller = new AbortController()
        denied = false
        try {
          IDBObjectStore.prototype.put = function (value, ...args) {
            const request = nativePut.call(this, value, ...args)
            if (this.name === 'signature-projects') controller.abort()
            return request
          }
          try {
            await api.importCreativeWorkflow(
              input,
              parsed.project,
              parsed.workflowKey,
              controller.signal,
            )
          } catch {
            denied = true
          }
        } finally {
          IDBObjectStore.prototype.put = nativePut
        }
        check(denied && JSON.stringify(await rawCounts()) === '[0,0,0]', 'cancel left raw records')
        cases.push('native-cancellation-rolls-back-all-three-stores')
        const concurrent = await Promise.all(
          Array.from({ length: 4 }, () =>
            api.importCreativeWorkflow(input, parsed.project, parsed.workflowKey),
          ),
        )
        const first = concurrent[0]
        check(
          concurrent.every(
            (p) => p.project.id === first.project.id && p.signature.id === first.signature.id,
          ),
          'concurrent import duplicates',
        )
        check(JSON.stringify(await rawCounts()) === '[1,1,2]', 'fresh import counts')
        check(
          first.project.origin.projectId === first.signature.id,
          'portable local origin not mapped',
        )
        check(
          (await api.getSignatureProject(first.signature.id)).file.size ===
            parsed.signatureFile.size,
          'original lost',
        )
        cases.push('fresh-browser-offline-atomic-import-and-concurrent-deduplication')
        const edited = {
          ...first.project,
          name: '我的后续改动',
          settings: { ...first.project.settings, contrast: 0.45 },
        }
        await api.saveArtProject(edited)
        const second = await api.importCreativeWorkflow(input, parsed.project, parsed.workflowKey)
        check(
          second.project.id !== first.project.id && !second.reused,
          'edited project overwritten',
        )
        check(
          (await api.getArtProject(first.project.id)).name === edited.name,
          'edited version lost',
        )
        check(
          second.project.settings.contrast === parsed.project.settings.contrast,
          'backup settings not restored',
        )
        check(
          (await api.importCreativeWorkflow(input, parsed.project, parsed.workflowKey)).project
            .id === second.project.id,
          'restored backup duplicated',
        )
        cases.push('edited-local-copy-kept-and-backup-restored-as-separate-version')
        await api.saveArtProject({ ...second.project })
        check(
          (await api.importCreativeWorkflow(input, parsed.project, parsed.workflowKey)).project
            .id === second.project.id,
          'unchanged editor save lost deduplication',
        )
        cases.push('unchanged-save-retains-import-receipt')
        await api.deleteCreativeProject(first.signature.id)
        const repaired = await api.importCreativeWorkflow(input, parsed.project, parsed.workflowKey)
        check(
          repaired.project.id === second.project.id &&
            repaired.project.origin.projectId === repaired.signature.id,
          'deleted original was not repaired',
        )
        check(
          JSON.stringify(await rawCounts()) === '[2,1,3]',
          'original repair duplicated derivative',
        )
        cases.push('deleted-original-restored-without-duplicating-unchanged-derivative')
      } finally {
        parsed.dispose()
      }
      return cases
    }, prepared.packet)),
  )
  await target.close()
  for (const scenario of ['collision', 'matching-original']) {
    const isolated = await browser.newContext(),
      isolatedPage = await isolated.newPage()
    isolatedPage.on('pageerror', (e) => report.errors.push(e.message))
    await isolatedPage.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
    report.cases.push(
      await isolatedPage.evaluate(
        async ({ packet, scenario }) => {
          const wf = await import('/src/lib/creative-workflow-package.ts'),
            api = await import('/src/lib/art-projects.ts')
          const { exportSignaturePng } = await import('/src/lib/signature-portrait/png-export.ts')
          const { signatureProjectThumbnail } =
            await import('/src/lib/signature-project-thumbnail.ts')
          const parsed = await wf.readCreativeWorkflowPackage(
            new Blob([Uint8Array.from(atob(packet), (c) => c.charCodeAt(0))]),
          )
          try {
            const input = {
              file: parsed.signatureFile,
              name: parsed.project.origin.name,
              thumbnail: await signatureProjectThumbnail(
                await exportSignaturePng(parsed.signature, { longEdge: 128 }),
              ),
              engineVersion: 'signature-1',
            }
            if (scenario === 'collision') {
              const occupied = {
                ...parsed.project,
                id: parsed.project.origin.projectId,
                name: '不可覆盖的本地作品',
                origin: undefined,
              }
              await api.saveArtProject(occupied)
              const saved = await api.importCreativeWorkflow(
                input,
                parsed.project,
                parsed.workflowKey,
              )
              if (
                saved.signature.id === occupied.id ||
                saved.project.origin.projectId !== saved.signature.id ||
                (await api.getArtProject(occupied.id)).name !== occupied.name
              )
                throw new Error('Portable id collision overwrote local work')
              return 'portable-id-collision-preserves-unrelated-local-work'
            }
            const original = await api.saveSignatureProject(input)
            const saved = await api.importCreativeWorkflow(
              input,
              parsed.project,
              parsed.workflowKey,
            )
            if (
              original.id === parsed.project.origin.projectId ||
              saved.signature.id !== original.id ||
              saved.project.origin.projectId !== original.id ||
              (await api.listCreativeProjects()).length !== 2
            )
              throw new Error('Equivalent local original was not reused')
            return 'equivalent-existing-original-reused-and-references-remapped'
          } finally {
            parsed.dispose()
          }
        },
        { packet: prepared.packet, scenario },
      ),
    )
    await isolated.close()
  }
  assert.deepEqual(report.errors, [])
  assert.equal(report.cases.length, 21)
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
