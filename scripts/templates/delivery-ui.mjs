import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export async function ready(page, mode) {
  await page.waitForFunction((mode) => {
    const canvas = document.querySelector('.ascii-scroll canvas')
    return (
      canvas?.width > 100 &&
      (!mode || canvas.dataset.mode === mode) &&
      !document.querySelector('.editor-package')?.disabled
    )
  }, mode)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
export async function openDetails(locator) {
  await locator.evaluate((element) => {
    for (let current = element; current; current = current.parentElement)
      if (current instanceof HTMLDetailsElement) current.open = true
  })
}
export async function setRange(page, label, value) {
  const input = page.locator('.field').filter({ hasText: label }).locator('input[type=range]')
  await openDetails(input)
  await setInput(input, value)
}
export async function setInput(input, value) {
  await input.evaluate((element, value) => {
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
export async function configure(page, recipe) {
  await page.locator('.six-modes button').filter({ hasText: recipe.modeLabel }).click()
  if (recipe.quality !== 'classic')
    await page.locator(`button[data-quality="${recipe.quality}"]`).click()
  await page.getByLabel('作品名称').fill(recipe.name)
  await setRange(page, '列宽采样', recipe.columns)
  await setInput(page.getByLabel('背景颜色', { exact: true }), recipe.background)
  await setInput(page.getByLabel('文字颜色', { exact: true }), recipe.ink)
  const invert = page.getByRole('button', { name: '反相', exact: true })
  if ((await invert.evaluate((button) => button.classList.contains('on'))) !== recipe.invert)
    await invert.click()
  if (recipe.phrase) {
    await page.locator('input[maxlength="64"]').fill(recipe.phrase)
    await openDetails(page.getByLabel('铺满整图', { exact: true }))
    await page.getByLabel('铺满整图', { exact: true }).check()
  }
  await page.locator('.calibrated-effects').evaluate((element) => {
    element.open = true
  })
  await page
    .getByRole('group', { name: '六模式微动' })
    .getByRole('button', { name: recipe.motionLabel, exact: true })
    .click()
  await page.getByRole('button', { name: recipe.hoverLabel, exact: true }).click()
  for (const [id, value] of [
    ['art-motion-speed', recipe.motionSpeed],
    ['art-motion-strength', recipe.motionStrength],
    ['art-hover-strength', recipe.hoverStrength],
    ['art-hover-radius', recipe.hoverRadius],
  ])
    await setInput(page.locator('#' + id), value)
  await ready(page, recipe.mode)
}
export async function download(page, action, destination) {
  await mkdir(path.dirname(destination), { recursive: true })
  const event = page.waitForEvent('download', { timeout: 120000 })
  // Keep action failures authoritative; also observe a pending event rejected during cleanup.
  void event.catch(() => {})
  await action()
  const file = await event
  assert.equal(await file.failure(), null)
  await file.saveAs(destination)
  return {
    path: destination,
    bytes: await readFile(destination),
    suggested: file.suggestedFilename(),
  }
}
export async function exportFile(page, label, destination) {
  return download(
    page,
    async () => {
      await page.locator('.editor-header-actions .art-button').click()
      await page.locator('.format-grid button').filter({ hasText: label }).click()
      if (label === 'PNG') await page.getByRole('button', { name: '1080 px', exact: true }).click()
      await page.getByRole('button', { name: '免费下载作品', exact: true }).click()
    },
    destination,
  ).finally(async () => {
    await page.keyboard.press('Escape')
  })
}
export function unpack(bytes) {
  assert.equal(bytes.subarray(0, 8).toString(), 'ASTRA01\n')
  const size = bytes.readUInt32LE(8),
    raw = bytes.subarray(44, 44 + size)
  assert.equal(hash(raw), bytes.subarray(12, 44).toString('hex'))
  const manifest = JSON.parse(raw)
  const source = bytes.subarray(44 + size, 44 + size + manifest.source.size)
  assert.equal(hash(source), manifest.source.sha256)
  const thumbnail = bytes.subarray(44 + size + source.length)
  assert.equal(thumbnail.length, manifest.thumbnail.size)
  assert.equal(hash(thumbnail), manifest.thumbnail.sha256)
  return { manifest, source }
}
export async function database(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('astra-art-projects', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('projects', { keyPath: 'id' })
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('projects'),
            query = tx.objectStore('projects').getAll()
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
          tx.oncomplete = async () => {
            db.close()
            try {
              resolve(
                await Promise.all(
                  query.result.map(async (project) => ({
                    id: project.id,
                    name: project.name,
                    settings: project.settings,
                    engineVersion: project.engineVersion,
                    sourceHash: [
                      ...new Uint8Array(
                        await crypto.subtle.digest('SHA-256', await project.source.arrayBuffer()),
                      ),
                    ]
                      .map((n) => n.toString(16).padStart(2, '0'))
                      .join(''),
                  })),
                ),
              )
            } catch (error) {
              reject(error)
            }
          }
        }
      }),
  )
}
