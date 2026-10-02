import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'

const source = await readFile('src/lib/art-engine/canvas.ts', 'utf8')
const ast = ts.createSourceFile('canvas.ts', source, ts.ScriptTarget.Latest, true)
const declarations = []
function visit(node) {
  if (
    (ts.isFunctionDeclaration(node) &&
      ['sampleStudioAmbient', 'sampleCinematic'].includes(node.name?.text)) ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((d) => d.name.getText(ast) === 'motionSmooth'))
  )
    declarations.push(node.getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)
assert.equal(declarations.length, 3)
const code = ts.transpileModule(declarations.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const factory = new Function(
  'frame',
  'const ambientNative=new Float32Array(4);' + code + ';return sampleCinematic;',
)
const out = path.resolve(
  process.env.ASTRA_MATERIAL_SURFACE_OUTPUT || `test-results/material-surface-${Date.now()}`,
)
await mkdir(out, { recursive: false })
const report = {
  passed: false,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  cases: [],
  checks: 0,
}
try {
  for (const aspect of [0.5, 0.8, 1.3, 2.3]) {
    const sampler = factory({ width: aspect * 960, height: 960 })
    const signal = new Float32Array(6)
    const position = (motion, x, y, time) => {
      sampler(motion, x, y, time, 1, signal)
      return [x + signal[0], y + signal[1]]
    }
    for (const motion of ['breathe', 'wave', 'current', 'caustics']) {
      let minJacobian = Infinity,
        maxOffset = 0
      for (const time of [0.2, 0.5, 1.1, 1.8, 2.6, 3.5, 4.9, 5.8])
        for (let iy = 1; iy < 20; iy++)
          for (let ix = 1; ix < 20; ix++) {
            const x = ix / 20,
              y = iy / 20,
              h = 0.001
            const left = position(motion, x - h, y, time)
            const right = position(motion, x + h, y, time)
            const top = position(motion, x, y - h, time)
            const bottom = position(motion, x, y + h, time)
            const xx = (right[0] - left[0]) / (2 * h)
            const xy = (bottom[0] - top[0]) / (2 * h)
            const yx = (right[1] - left[1]) / (2 * h)
            const yy = (bottom[1] - top[1]) / (2 * h)
            const determinant = xx * yy - xy * yx
            assert(
              determinant > 0.25,
              `${aspect}/${motion}/${time}: surface must not fold over or reverse locally (${determinant})`,
            )
            minJacobian = Math.min(minJacobian, determinant)
            sampler(motion, x, y, time, 1, signal)
            maxOffset = Math.max(maxOffset, Math.hypot(signal[0] * aspect, signal[1]))
            report.checks++
          }
      report.cases.push({ aspect, motion, minJacobian, maxOffset })
    }
  }
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(`PASS ${report.checks} independent surface-orientation checks: ${out}`)
