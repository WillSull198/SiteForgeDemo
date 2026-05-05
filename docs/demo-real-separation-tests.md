# SiteForge Demo / Real Separation Tests

Run these after any change touching onboarding, storage, files, integrations, or Data Management.

## Test 4.1 — Cold Start, Demo, Then Real
1. Clear localStorage and IndexedDB.
2. Reload through `npm run dev` or a built static bundle.
3. Click `Try the demo`.
4. Expected: demo loads, URL hash is valid, demo banner says real data is separate.
5. Click `Switch to my real account`.
6. Expected: real onboarding appears with no demo records visible.
7. Complete onboarding as Project Manager.
8. Expected: `siteforge-active-mode` is `real`, `siteforge-app-demo` exists, `siteforge-app-real` exists.
9. Open Settings -> Data Management.
10. Expected: separate `My data` and `Demo data` cards render.

## Test 4.2 — Mode Toggle Round Trip
1. From real mode, create one real task.
2. Settings -> Data Management -> `Switch to Demo`.
3. Create one demo variation.
4. Click banner `Switch to my real account`.
5. Expected: real task remains; demo variation is absent.
6. Switch back to demo.
7. Expected: demo variation remains; real task is absent.

## Test 4.3 — Defensive Lint
1. In real mode, inject a demo-tagged record into `siteforge-app-real`.
2. Reload.
3. Expected: record is removed from active records and appears under `state.quarantine`.
4. Expected console warning starts with `[SiteForge] Mode integrity lint:`.

## Test 4.4 — Real Org ID
1. Clear storage and complete real onboarding.
2. Inspect `state.org.id`.
3. Expected: UUID-like id, not `org-default`.

## Test 4.5 — Demo Timer Gate
1. In real mode, force `demo.mode = true` via dev tools.
2. Wait at least 60 seconds.
3. Expected: no demo toasts, notifications, or audit entries are created.

## Test 4.6 — External Adapter Demo Short-Circuit
1. Switch to demo.
2. Configure a valid Anthropic key.
3. Run Settings -> Integrations -> Test Connection.
4. Expected: result source is `skipped-demo`; no external Claude request is made.
5. Sign an approval in demo.
6. Expected: Buildxact queue item status is `skipped-demo`.
7. Switch to real and repeat.
8. Expected: real mode can call Claude and queues Buildxact payloads normally.

## Test 4.7 — Per-Mode Export / Import
1. From real mode, export `My data`.
2. Expected: filename starts `siteforge-real-export-`; `org.mode` is `real`; no records have `isDemo: true`.
3. From demo mode, export `Demo`.
4. Expected: filename starts `siteforge-demo-export-`; `org.mode` is `demo`; seeded entity records carry `isDemo: true`.
5. Try importing the demo file under `My data`.
6. Expected: import is rejected with a wrong-mode message.

## Test 4.8 — Legacy Migration
1. Clear new keys.
2. Write old key `siteforge-v6-enterprise-demo` with a minimal real-mode payload.
3. Reload.
4. Expected: app sets `siteforge-active-mode` to `real` and writes `siteforge-app-real`.
5. Repeat with `org.mode = "demo"`.
6. Expected: app sets active mode to `demo`, writes `siteforge-app-demo`, and tags entity records with `isDemo: true`.
