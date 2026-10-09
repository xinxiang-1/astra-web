import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function readInput(input) {
  if (input !== '-') return readFile(path.resolve(input), 'utf8')
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/select-pareto.mjs <scores.json|->')
  process.exit(1)
}

const document = JSON.parse(await readInput(input))
const directions = document.directions
const candidates = document.candidates
if (!directions || typeof directions !== 'object' || Array.isArray(directions)) {
  throw new Error('directions must map score names to max or min')
}
if (!Array.isArray(candidates)) throw new Error('candidates must be an array')

const objectives = Object.entries(directions)
if (objectives.length === 0) throw new Error('at least one objective is required')
for (const [name, direction] of objectives) {
  if (direction !== 'max' && direction !== 'min') throw new Error(`${name} direction must be max or min`)
}

const eligible = candidates.filter((candidate) => {
  if (!candidate || candidate.eligible !== true || typeof candidate.id !== 'string') return false
  return objectives.every(([name]) => Number.isFinite(candidate.scores?.[name]))
})

function dominates(a, b) {
  let strictlyBetter = false
  for (const [name, direction] of objectives) {
    const av = a.scores[name]
    const bv = b.scores[name]
    const noWorse = direction === 'max' ? av >= bv : av <= bv
    const better = direction === 'max' ? av > bv : av < bv
    if (!noWorse) return false
    strictlyBetter ||= better
  }
  return strictlyBetter
}

const frontier = eligible.filter((candidate) =>
  !eligible.some((other) => other !== candidate && dominates(other, candidate)),
)

console.log(JSON.stringify({
  objectives: directions,
  eligible_count: eligible.length,
  frontier_count: frontier.length,
  frontier,
}, null, 2))
