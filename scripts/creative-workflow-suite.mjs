import { spawn } from 'node:child_process'

// Requires two dev servers and a preview of the current production build.
// Core runs first because the production UI imports its portable project fixture.
async function run(script, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/' + script], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.on('error', reject)
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${script} failed: ${signal || code}`)),
    )
  })
}

for (const channel of ['msedge', 'chrome']) {
  const env = { ASTRA_BROWSER_CHANNEL: channel, ASTRA_CREATIVE_MOBILE: '0' }
  await run('creative-core-contract.mjs', env)
  await run('creative-workflow-ui.mjs', env)
  await run('creative-smoke-contract.mjs', env)
}
await run('creative-workflow-ui.mjs', {
  ASTRA_BROWSER_CHANNEL: 'msedge',
  ASTRA_CREATIVE_MOBILE: '1',
})
await run('creative-smoke-dev.mjs', {})
