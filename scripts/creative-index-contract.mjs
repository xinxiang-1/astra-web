import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const base = process.env.ASTRA_DEV_URL || 'http://localhost:5173'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const out = process.env.ASTRA_CONTRACT_OUTPUT || `test-results/creative-index-${channel}`
await mkdir(out, { recursive: true })
const fixture = (
  await readFile('docs/validation/2026-10-09/creative-workflow/source.astra-signature')
).toString('base64')
const browser = await chromium.launch({ channel, headless: true })
const report = { browser: browser.version(), cases: [], errors: [] }
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  report.cases = await page.evaluate(async (fixture) => {
    const api = await import('/src/lib/art-projects.ts')
    const pack = await import('/src/lib/signature-portrait/project.ts')
    const { exportSignaturePng } = await import('/src/lib/signature-portrait/png-export.ts')
    const { signatureProjectThumbnail } = await import('/src/lib/signature-project-thumbnail.ts')
    const { signatureArtProject } = await import('/src/lib/signature-art-workflow.ts')
    const { createArtProjectPackage, readArtProjectPackage } =
      await import('/src/lib/art-project-package.ts')
    const check = (v, name) => {
        if (!v) throw new Error(name)
      },
      cases = []
    const open = (version) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('astra-art-projects', version)
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('projects'))
            r.result.createObjectStore('projects', { keyPath: 'id' })
        }
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    const file = new File(
      [Uint8Array.from(atob(fixture), (c) => c.charCodeAt(0))],
      'original.astra-signature',
    )
    const scene = await pack.readSignatureProject(file)
    try {
      const png = await exportSignaturePng(scene.project, { longEdge: 128 })
      const thumb = await signatureProjectThumbnail(png)
      const legacy = signatureArtProject(
        new File([png], 'legacy.png', { type: 'image/png' }),
        thumb,
        '旧项目',
        '#f5f3ef',
        'hologram',
      )
      const old = await open(1)
      await new Promise((resolve, reject) => {
        const tx = old.transaction('projects', 'readwrite')
        tx.objectStore('projects').put(legacy)
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error)
      })
      old.close()
      const list = await api.listCreativeProjects(),
        kept = await api.getArtProject(legacy.id)
      check(
        list.length === 1 && list[0].id === legacy.id && kept.source.name === 'legacy.png',
        'legacy metadata/source migration',
      )
      check((await kept.source.arrayBuffer()).byteLength === png.size, 'legacy source bytes')
      cases.push('version-one-migration-keeps-project-and-source')
      const input = {
        file,
        name: scene.project.portraitName,
        thumbnail: thumb,
        engineVersion: pack.SIGNATURE_PROJECT_ENGINE,
      }
      const saved = await api.saveSignatureProject(input)
      const firstOriginal = await api.getSignatureProject(saved.id)
      const concurrent = await Promise.all(
        Array.from({ length: 4 }, () => api.saveSignatureProject({ ...input, name: '重复领取不得覆盖名称' })),
      )
      check(
        concurrent.every((p) => p.id === saved.id) &&
          (await api.listCreativeProjects()).length === 2,
        'same snapshot duplicates',
      )
      const restored = await api.getSignatureProject(saved.id)
      check(
        restored.file.size === file.size && restored.signatureHash === saved.signatureHash &&
          restored.file.lastModified === firstOriginal.file.lastModified &&
          restored.updatedAt === firstOriginal.updatedAt && restored.name === firstOriginal.name &&
          restored.thumbnail === firstOriginal.thumbnail && concurrent.every((entry) => entry.updatedAt === saved.updatedAt),
        'signature bytes/hash lost',
      )
      cases.push('same-snapshot-and-concurrent-saves-preserve-original-and-metadata')
      const second = await pack.createSignatureProject({
        ...scene.project,
        portraitName: '签名第二版',
      })
      const secondSaved = await api.saveSignatureProject({
        ...input,
        file: second,
        name: '签名第二版',
      })
      check(
        secondSaved.id !== saved.id &&
          (await api.getSignatureProject(saved.id)).signatureHash === saved.signatureHash,
        'new snapshot overwrote old',
      )
      cases.push('new-version-keeps-old-signature')
      const NativeGetAll = IDBObjectStore.prototype.getAll
      try {
        IDBObjectStore.prototype.getAll = function (...args) {
          if (this.name !== 'creative-index') throw new Error('Payload read during list')
          return NativeGetAll.apply(this, args)
        }
        const metadata = await api.listCreativeProjects()
        check(
          metadata.every((p) => !('source' in p) && !('file' in p) && !('settings' in p)),
          'list contains payload',
        )
      } finally {
        IDBObjectStore.prototype.getAll = NativeGetAll
      }
      cases.push('normal-list-reads-only-lightweight-index')
      const derivative = { ...legacy, id: crypto.randomUUID(), name: '动态副本' }
      const pair = await api.saveSignatureDerivative(input, derivative, 'hologram')
      const derived = await api.getArtProject(derivative.id)
      check(
        pair.signature.id === saved.id &&
          derived.origin.projectId === saved.id &&
          derived.origin.sha256 === saved.signatureHash,
        'derivative origin',
      )
      const portable = await readArtProjectPackage(await createArtProjectPackage(derived))
      check(
        JSON.stringify(portable.project.origin) === JSON.stringify(derived.origin),
        'portable origin lost',
      )
      cases.push('atomic-origin-and-backward-compatible-package-roundtrip')
      const countBefore = (await api.listCreativeProjects()).length
      const failedFile = await pack.createSignatureProject({
        ...scene.project,
        portraitName: '存储失败候选',
      })
      const NativePut = IDBObjectStore.prototype.put
      let rejected = false
      try {
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (this.name === 'projects' && value.id === 'failed-derivative')
            throw new DOMException('Controlled quota failure', 'QuotaExceededError')
          return NativePut.call(this, value, ...args)
        }
        try {
          await api.saveSignatureDerivative(
            { ...input, file: failedFile, name: '存储失败候选' },
            { ...derivative, id: 'failed-derivative' },
            'hologram',
          )
        } catch {
          rejected = true
        }
      } finally {
        IDBObjectStore.prototype.put = NativePut
      }
      check(
        rejected &&
          (await api.listCreativeProjects()).length === countBefore &&
          !(await api.getArtProject('failed-derivative')),
        'quota partial commit',
      )
      cases.push('quota-failure-rolls-back-original-derivative-and-index')
      const controller = new AbortController()
      rejected = false
      try {
        IDBObjectStore.prototype.put = function (value, ...args) {
          const r = NativePut.call(this, value, ...args)
          if (this.name === 'signature-projects') controller.abort()
          return r
        }
        try {
          await api.saveSignatureProject(
            { ...input, file: failedFile, name: '取消候选' },
            controller.signal,
          )
        } catch {
          rejected = true
        }
      } finally {
        IDBObjectStore.prototype.put = NativePut
      }
      check(
        rejected && (await api.listCreativeProjects()).length === countBefore,
        'cancel partial commit',
      )
      cases.push('cancellation-aborts-persistent-write')
      const raw = await open(2)
      await new Promise((resolve, reject) => {
        const tx = raw.transaction('signature-projects', 'readwrite')
        tx.objectStore('signature-projects').put({
          ...restored,
          file: new File(['damaged'], 'damaged.astra-signature'),
        })
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error)
      })
      let corruptionRejected = false
      try {
        await api.getSignatureProject(saved.id)
      } catch (e) {
        corruptionRejected = /校验失败/.test(e.message)
      }
      check(corruptionRejected, 'corrupt signature silently opened')
      await new Promise((resolve, reject) => {
        const tx = raw.transaction('signature-projects', 'readwrite')
        tx.objectStore('signature-projects').put(restored)
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error)
      })
      raw.close()
      cases.push('corrupt-signature-rejected-without-changing-projects')
      await api.deleteCreativeProject(saved.id)
      check(
        !(await api.getSignatureProject(saved.id)) &&
          (await api.getArtProject(derivative.id)).origin.sha256 === saved.signatureHash,
        'original delete cascaded',
      )
      cases.push('original-delete-keeps-independent-derivative')
      // A future version must not make this build silently reset its database.
      const future = await open(3)
      future.close()
      let friendly = false
      try {
        await api.listCreativeProjects()
      } catch (e) {
        friendly = /版本已更新/.test(e.message)
      }
      const still = await open(3)
      const retained = await new Promise((resolve) => {
        const r = still.transaction('projects').objectStore('projects').get(derivative.id)
        r.onsuccess = () => resolve(r.result)
      })
      still.close()
      check(friendly && retained.origin.sha256 === saved.signatureHash, 'future version reset')
      cases.push('future-version-rejects-without-reset')
    } finally {
      scene.dispose()
    }
    return cases
  }, fixture)
  await context.close()
  const blocked = await browser.newContext(),
    blockedPage = await blocked.newPage()
  blockedPage.on('pageerror', (e) => report.errors.push(e.message))
  await blockedPage.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  const blockedResult = await blockedPage.evaluate(async () => {
    const api = await import('/src/lib/art-projects.ts')
    const old = await new Promise((resolve) => {
      const r = indexedDB.open('astra-art-projects', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' })
      r.onsuccess = () => resolve(r.result)
    })
    let rejected = false
    try {
      await api.listCreativeProjects()
    } catch (e) {
      rejected = /关闭其他/.test(e.message)
    }
    old.close()
    // This waits behind the rejected upgrade request; its late migration must be aborted.
    const inspected = await new Promise((resolve) => {
      const r = indexedDB.open('astra-art-projects')
      r.onsuccess = () => resolve(r.result)
    })
    const version = inspected.version
    inspected.close()
    const recovered = await api.listCreativeProjects()
    if (!rejected || version !== 1 || recovered.length !== 0)
      throw new Error('Blocked upgrade recovery failed')
    return 'blocked-upgrade-aborts-late-request-and-can-retry'
  })
  report.cases.push(blockedResult)
  await blocked.close()
  const upgrade = await browser.newContext()
  const upgradePage = await upgrade.newPage()
  upgradePage.on('pageerror', (e) => report.errors.push(e.message))
  await upgradePage.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  await upgradePage.evaluate(async () => {
    const api = await import('/src/lib/art-projects.ts')
    const nativeClose = IDBDatabase.prototype.close
    let retained
    let calls = 0
    try {
      // Delay the ordinary close to expose the live connection to a competing upgrade.
      IDBDatabase.prototype.close = function () {
        if (this.name === 'astra-art-projects' && this.version === 2) {
          retained = this
          if (++calls === 1) return
        }
        return nativeClose.call(this)
      }
      await api.listCreativeProjects()
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Live connection blocked upgrade')), 5000)
        const request = indexedDB.open('astra-art-projects', 3)
        request.onsuccess = () => {
          clearTimeout(timer)
          nativeClose.call(request.result)
          resolve()
        }
        request.onerror = () => {
          clearTimeout(timer)
          reject(request.error)
        }
      })
      if (calls !== 2) throw new Error('Versionchange handler did not close live connection')
    } finally {
      IDBDatabase.prototype.close = nativeClose
      if (retained) nativeClose.call(retained)
    }
  })
  report.cases.push('live-versionchange-closes-connection-for-competing-upgrade')
  await upgrade.close()
  assert.equal(report.cases.length, 12)
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
