---
name: astra-web-validation
description: Validate Astra Vue/TypeScript behavior changes using its existing contracts and browser workflows. Use for frontend implementation, regression debugging, or stage acceptance in astra-web; not for documentation-only edits or backend-only work.
---

# Astra frontend validation

Locate `astra-web` from the working directory, then read its `AGENTS.md`. Run commands from that repository. The workspace parent contains two independent repositories.

Choose checks for the changed behavior; do not run the entire contract catalog by default:

- Product code: `npm run type-check`, `npx eslint <changed-files>` (without `--fix`), `npm run build`, and the relevant existing contract found in `package.json` or `scripts/`.
- Identity changes: `scripts/auth-http-contract.mjs`, `auth-session-contract.mjs`, `auth-identity-contract.mjs`, and `auth-identity-ui.mjs` cover different layers. Inspect their environment inputs before running them; identity Store contracts need a Vite dev server, UI checks use the applicable production preview.
- Local workflow/import changes: existing `test:workflow-package-core`, `test:workflow-package-ui`, and `test:creative-ui` scripts. Inspect output settings to avoid overwriting earlier evidence.
- Purchased signature/workflow changes: read `docs/plans/purchased-workflow-2026-10-09.md`. The backend-owned fixture starts `scripts/purchased-workflow-live.mjs`; never supply invented tokens or call this standalone against a shared database. Fixture payment is mock and auth/me is simulated503 in this baseline.
- Actual auth-to-purchase/workflow changes: read `docs/plans/auth-commerce-2026-10-10.md` and the linked runtime contract. The backend-owned `AuthCommerceIntegrationTest` starts `scripts/auth-commerce-live.mjs` with real password login and auth/me, explicit order/payment consent, private bytes/import and reset/foreign-owner checks. Transport uses real gateway responses; only its owned external merchant ledger is mock. Prepare the current production preview, do not fabricate tokens or run the script against shared services.

For exploratory browser debugging read the installed `playwright` skill, then use the Windows adapter:

```powershell
./scripts/agent-playwright.ps1 -Session astra-debug -CliArgs @('open','http://127.0.0.1:4210','--browser','msedge')
./scripts/agent-playwright.ps1 -Session astra-debug -CliArgs @('snapshot')
```

Use fresh snapshot refs for interactions. The adapter pins the CLI version, uses `npx.cmd` on Windows, and supports a named isolated session. Set output paths under `output/playwright/`; raw artifacts remain local, curated stage evidence goes in a new `docs/validation/<date>/<stage>/` directory. Close only the session you own. The CLI is a debugging tool; retain existing project Playwright contracts for regressions.

Do not restart existing servers merely because a request times out. Check the requested port and process ownership first. For visuals, inspect captured images; evaluate the relevant desktop/mobile, light/dark, touch and reduced-motion behavior. For Studio motion read the linked effect standard and preserve protected homepage defaults.

Record actual checks and limits; browser automation against mock APIs does not establish real auth, payment or deployment readiness. Follow the repository's stage commit/push rules.
