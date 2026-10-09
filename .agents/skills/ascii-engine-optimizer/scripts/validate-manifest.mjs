import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function readInput(input) {
  if (input !== '-') return readFile(path.resolve(input), 'utf8')
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function fail(message) {
  console.error(`INVALID: ${message}`)
  process.exitCode = 1
}

const input = process.argv[2]
if (!input) {
  fail('usage: node scripts/validate-manifest.mjs <manifest.json|->')
} else {
  let manifest
  try {
    manifest = JSON.parse(await readInput(input))
  } catch (error) {
    fail(`cannot read JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (manifest) {
    const fixtures = Array.isArray(manifest.fixtures) ? manifest.fixtures : []
    if (typeof manifest.dataset_version !== 'string' || !manifest.dataset_version.trim()) {
      fail('dataset_version must be a non-empty string')
    }
    if (fixtures.length === 0) fail('fixtures must be a non-empty array')

    const ids = new Set()
    const sourceSplits = new Map()
    const splitCounts = { train: 0, dev: 0, holdout: 0 }
    for (const [index, fixture] of fixtures.entries()) {
      const at = `fixtures[${index}]`
      if (!fixture || typeof fixture !== 'object') {
        fail(`${at} must be an object`)
        continue
      }
      if (typeof fixture.id !== 'string' || !fixture.id) fail(`${at}.id is required`)
      else if (ids.has(fixture.id)) fail(`${at}.id duplicates ${fixture.id}`)
      else ids.add(fixture.id)

      if (typeof fixture.source_id !== 'string' || !fixture.source_id) {
        fail(`${at}.source_id is required`)
      }
      if (!Object.hasOwn(splitCounts, fixture.split)) {
        fail(`${at}.split must be train, dev, or holdout`)
      } else {
        splitCounts[fixture.split] += 1
        const previous = sourceSplits.get(fixture.source_id)
        if (previous && previous !== fixture.split) {
          fail(`source_id ${fixture.source_id} crosses ${previous}/${fixture.split}`)
        }
        sourceSplits.set(fixture.source_id, fixture.split)
      }
      if (typeof fixture.path !== 'string' || !fixture.path) fail(`${at}.path is required`)
      if (typeof fixture.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fixture.sha256)) {
        fail(`${at}.sha256 must be 64 lowercase hex characters`)
      }
      if (typeof fixture.license !== 'string' || !fixture.license) fail(`${at}.license is required`)
    }

    if (!process.exitCode) {
      console.log(JSON.stringify({
        valid: true,
        dataset_version: manifest.dataset_version,
        fixtures: fixtures.length,
        sources: sourceSplits.size,
        splits: splitCounts,
      }, null, 2))
    }
  }
}
