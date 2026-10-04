import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_ATLAS_OUTPUT || `test-results/video-atlas-${Date.now()}`)
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const parityOnly = process.env.ASTRA_ATLAS_PARITY_ONLY === '1'
// Research only: synthesize a separate module, never modify the production renderer.
// R3 remains rejected because expressive mixed text is not pixel identical.
await mkdir(out, { recursive: true })
const baseline = execFileSync('git', ['show', 'c795d97:src/lib/art-engine/canvas.ts'], {
  encoding: 'utf8',
})
let candidate = baseline
function replaceOnce(before, after) {
  if (candidate.split(before).length !== 2)
    throw new Error(`Ambiguous patch: ${before.slice(0, 60)}`)
  candidate = candidate.replace(before, after)
}
replaceOnce('  experimentalTrail?: (', '  frameTileAtlas?: boolean\n  experimentalTrail?: (')
replaceOnce(
  '  function clearTiles() {',
  `  let colorAtlas: HTMLCanvasElement | null = null
  let paddedGlyphSource: ArtFrame['glyphs'] | null = null
  const paddedGlyphs = new Map<number, HTMLCanvasElement>()
  function paddedGlyph(index: number) {
    if (paddedGlyphSource !== frame.glyphs) {
      for (const tile of paddedGlyphs.values()) tile.width = tile.height = 1
      paddedGlyphs.clear()
      paddedGlyphSource = frame.glyphs
    }
    const existing = paddedGlyphs.get(index)
    if (existing) return existing
    const w = frame.cellWidth, h = frame.cellHeight
    const extended = canvas(w + 2, h + 2), ec = extended.getContext('2d')!
    const source = frame.glyphs[index]!.tile
    ec.drawImage(source, 1, 1)
    ec.drawImage(source, 0, 0, w, 1, 1, 0, w, 1)
    ec.drawImage(source, 0, h - 1, w, 1, 1, h + 1, w, 1)
    ec.drawImage(source, 0, 0, 1, h, 0, 1, 1, h)
    ec.drawImage(source, w - 1, 0, 1, h, w + 1, 1, 1, h)
    ec.drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1)
    ec.drawImage(source, w - 1, 0, 1, 1, w + 1, 0, 1, 1)
    ec.drawImage(source, 0, h - 1, 1, 1, 0, h + 1, 1, 1)
    ec.drawImage(source, w - 1, h - 1, 1, 1, w + 1, h + 1, 1, 1)
    paddedGlyphs.set(index, extended)
    return extended
  }
  function colorBatch(destination: CanvasRenderingContext2D) {
    const padding = 1, limit = 512
    const tw = frame.cellWidth + padding * 2, th = frame.cellHeight + padding * 2
    const columns = Math.max(1, Math.floor(1024 / tw))
    const width = 1024, height = 2 ** Math.ceil(Math.log2(Math.ceil(limit / columns) * th))
    colorAtlas ??= canvas(width, height)
    if (colorAtlas.width !== width || colorAtlas.height !== height) {
      colorAtlas.width = width
      colorAtlas.height = height
    }
    const atlas = colorAtlas, ac = atlas.getContext('2d')!
    const slots = new Map<string, number>()
    const commands: { slot: number; x: number; y: number; w: number; h: number; alpha: number }[] = []
    ac.globalAlpha = 1
    ac.globalCompositeOperation = 'source-over'
    ac.clearRect(0, 0, width, height)
    const flush = () => {
      for (const command of commands) {
        destination.globalAlpha = command.alpha
        const sx = (command.slot % columns) * tw + padding
        const sy = Math.floor(command.slot / columns) * th + padding
        destination.drawImage(atlas, sx, sy, frame.cellWidth, frame.cellHeight,
          command.x, command.y, command.w, command.h)
      }
      commands.length = 0
      slots.clear()
      ac.clearRect(0, 0, width, height)
    }
    return {
      draw(index: number, color: string, x: number, y: number, w: number, h: number, alpha: number) {
        const key = index + ':' + color
        let slot = slots.get(key)
        if (slot === undefined) {
          if (slots.size === limit) flush()
          slot = slots.size
          slots.set(key, slot)
          const sx = (slot % columns) * tw + padding, sy = Math.floor(slot / columns) * th + padding
          ac.save()
          ac.beginPath()
          ac.rect(sx - padding, sy - padding, tw, th)
          ac.clip()
          ac.globalCompositeOperation = 'source-over'
          ac.drawImage(paddedGlyph(index), sx - padding, sy - padding)
          ac.globalCompositeOperation = 'source-in'
          ac.fillStyle = color
          ac.fillRect(sx - padding, sy - padding, tw, th)
          ac.restore()
        }
        commands.push({ slot, x, y, w, h, alpha })
        if (commands.length >= limit * 4) flush()
      },
      flush,
    }
  }

  function clearTiles() {`,
)
replaceOnce(
  "      const time = options.time ?? 0,\n        motion = options.motion ?? 'none'\n      for (let y = 0; y < frame.rows; y++)",
  `      const time = options.time ?? 0,
        motion = options.motion ?? 'none'
      const batch = prototype.frameTileAtlas && (frame.settings.colored || frame.settings.mode === 'color')
        ? colorBatch(ctx) : null
      for (let y = 0; y < frame.rows; y++)`,
)
replaceOnce(
  `          ctx.drawImage(
            tile(index, color),
            x * cw + dx + (cw - dw) * 0.5,
            y * ch + dy + (ch - dh) * 0.5,
            dw,
            dh,
          )`,
  `          const px = x * cw + dx + (cw - dw) * 0.5
          const py = y * ch + dy + (ch - dh) * 0.5
          if (batch) batch.draw(index, color, px, py, dw, dh, ctx.globalAlpha)
          else ctx.drawImage(tile(index, color), px, py, dw, dh)`,
)
replaceOnce(
  '      ctx.globalAlpha = 1\n      if (ctx !== outputCtx)',
  '      batch?.flush()\n      ctx.globalAlpha = 1\n      if (ctx !== outputCtx)',
)
replaceOnce(
  '      clearTiles()\n      prefixes.clear()',
  '      clearTiles()\n      if (colorAtlas) { colorAtlas.width = colorAtlas.height = 1; colorAtlas = null }\n      for (const tile of paddedGlyphs.values()) tile.width = tile.height = 1\n      paddedGlyphs.clear()\n      paddedGlyphSource = null\n      prefixes.clear()',
)
replaceOnce(
  '        entries: tinted.size,',
  '        atlasBytes: colorAtlas ? colorAtlas.width * colorAtlas.height * 4 : 0,\n        entries: tinted.size,',
)
await writeFile(path.join(out, 'baseline-canvas.ts'), baseline)
await writeFile(path.join(out, 'candidate-canvas.ts'), candidate)
if (process.env.ASTRA_ATLAS_BUILD_ONLY === '1') {
  console.log(
    JSON.stringify({ out, candidateSha256: createHash('sha256').update(candidate).digest('hex') }),
  )
  process.exit(0)
}
const moduleBase = '/' + path.relative(process.cwd(), out).split(path.sep).join('/')
const browser = await chromium.launch({ channel, headless: true })
const report = {
  browser: browser.version(),
  channel,
  parityOnly,
  edgeExtension: true,
  powerOfTwoSurface: true,
  scope:
    'Isolated OffscreenCanvas draw parity; no live Worker playback or cross-device certification. Rejected candidate, not a production optimization.',
  baselineCommit: 'c795d97d7b03aedfef5ae24710c0f0910002e7a4',
  baselineSha256: createHash('sha256').update(baseline).digest('hex'),
  candidateSha256: createHash('sha256').update(candidate).digest('hex'),
  errors: [],
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/ascii-art')
  page.on('console', (message) => {
    if (message.text().startsWith('atlas-progress:')) console.log(message.text())
  })
  const result = await page.evaluate(
    async ({ moduleBase, parityOnly }) => {
      const { createCanvasArtRenderer: original } = await import(moduleBase + '/baseline-canvas.ts')
      const { createCanvasArtRenderer: batched } = await import(moduleBase + '/candidate-canvas.ts')
      const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
      const gradient = document.createElement('canvas')
      gradient.width = 400
      gradient.height = 280
      const gc = gradient.getContext('2d'),
        g = gc.createLinearGradient(0, 0, 400, 280)
      g.addColorStop(0, '#114488')
      g.addColorStop(1, '#ef8833')
      gc.fillStyle = g
      gc.fillRect(0, 0, 400, 280)
      const portrait = await createImageBitmap(
        await (await fetch('/artwork/porcelain-study-v1.png')).blob(),
      )
      const cases = [],
        performanceResults = []
      const create = () => {
        const target = new OffscreenCanvas(1, 1)
        target.getContext('2d', { willReadFrequently: false })
        return target
      }
      const hooks = {
        createSurface: () => new OffscreenCanvas(1, 1),
        maxTileEntries: 64,
        frameTileAtlas: true,
      }
      const optionsFor = (style, transparent) => ({
        longEdge: 900,
        time: 1.2,
        hoverTime: 1.2,
        transparent,
        motion: style === 'breathe' ? 'breathe' : 'none',
        hover: style === 'rift' ? 'rift' : 'light',
        effectProfile: style === 'rift' ? 'expressive' : 'classic',
        pointer: style === 'rift' ? { x: 0.5, y: 0.5, strength: 0.8, active: true } : undefined,
        pointerSamples:
          style === 'rift'
            ? [
                { x: 0.4, y: 0.4, time: 1100, active: true },
                { x: 0.5, y: 0.5, time: 1200, active: true },
              ]
            : [],
      })
      for (const [sourceName, source] of [
        ['gradient', gradient],
        ['portrait', portrait],
      ]) {
        for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
          const frame = prepareArtFrame(source, source.width, source.height, {
            mode,
            columns: 120,
            colored: true,
            phrase: '山川与星河 ASTRA',
          })
          for (const style of ['static', 'breathe', 'rift']) {
            for (const transparent of [false, true]) {
              const targetA = create(),
                targetB = create()
              const a = original(targetA, { ...hooks, frameTileAtlas: false }),
                b = batched(targetB, hooks)
              try {
                const opts = optionsFor(style, transparent)
                a.render(frame, opts)
                b.render(frame, opts)
                const pa = targetA
                  .getContext('2d')
                  .getImageData(0, 0, targetA.width, targetA.height).data
                const pb = targetB
                  .getContext('2d')
                  .getImageData(0, 0, targetB.width, targetB.height).data
                let changed = 0,
                  maxDelta = 0
                for (let i = 0; i < pa.length; i++)
                  if (pa[i] !== pb[i]) {
                    changed++
                    maxDelta = Math.max(maxDelta, Math.abs(pa[i] - pb[i]))
                  }
                cases.push({
                  sourceName,
                  mode,
                  style,
                  transparent,
                  changed,
                  maxDelta,
                  atlasBytes: b.cacheStats.atlasBytes,
                })
              } finally {
                a.destroy()
                b.destroy()
              }
            }
          }
        }
        console.log('atlas-progress: parity source ' + sourceName + ' complete')
      }
      for (const columns of parityOnly || cases.some((c) => c.changed) ? [] : [180, 360]) {
        for (const mode of ['color', 'phrase', 'halftone']) {
          const frame = prepareArtFrame(portrait, portrait.width, portrait.height, {
            mode,
            columns,
            colored: true,
            phrase: '山川与星河 ASTRA',
          })
          const targetA = create(),
            targetB = create()
          const a = original(targetA, { ...hooks, frameTileAtlas: false }),
            b = batched(targetB, hooks)
          const timings = { original: [], batched: [] }
          try {
            for (let i = 0; i < 12; i++) {
              const order =
                i % 2
                  ? [
                      ['batched', b, targetB],
                      ['original', a, targetA],
                    ]
                  : [
                      ['original', a, targetA],
                      ['batched', b, targetB],
                    ]
              for (const [name, renderer, target] of order) {
                const start = performance.now()
                renderer.render({ ...frame }, { longEdge: 900 })
                target.getContext('2d').getImageData(0, 0, 1, 1)
                if (i >= 2) timings[name].push(performance.now() - start)
                await new Promise((r) => setTimeout(r, 0))
              }
            }
            const stats = (values) => {
              const s = [...values].sort((x, y) => x - y)
              return {
                p50: s[Math.floor(s.length * 0.5)],
                p95: s[Math.floor(s.length * 0.95)],
                max: s.at(-1),
              }
            }
            performanceResults.push({
              columns,
              mode,
              timings,
              original: stats(timings.original),
              batched: stats(timings.batched),
              atlasBytes: b.cacheStats.atlasBytes,
            })
            console.log('atlas-progress: performance ' + columns + ' ' + mode + ' complete')
          } finally {
            a.destroy()
            b.destroy()
          }
        }
      }
      portrait.close()
      return { cases, performanceResults }
    },
    { moduleBase, parityOnly },
  )
  Object.assign(report, result)
  report.parityPassed = result.cases.every((c) => !c.changed)
} catch (e) {
  report.failure = e.stack
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(
    JSON.stringify(
      {
        out,
        ...report,
        cases: report.cases?.filter((c) => c.changed),
        performanceResults: report.performanceResults?.map(({ timings, ...c }) => c),
      },
      null,
      2,
    ),
  )
}
if (report.failure || report.errors.length || !report.parityPassed) process.exitCode = 1
