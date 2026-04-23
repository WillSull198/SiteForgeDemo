# SiteForge Enterprise v6

SiteForge is a React + Vite construction operations demo that links field activity, approvals, contracts, document intelligence, passport compliance, presence confidence, and portfolio reporting in a single-browser persisted prototype.

## Latest Repair Pass

- Main app state now mirrors to IndexedDB with localStorage as fallback, reducing storage failures as uploads/contracts/audit history grow.
- Portfolio now supports real project creation with client details, contract value/type, programme dates, budget starter lines, audit logging, notifications, and immediate site navigation.
- Settings now persists company branding, ABN/address/contact details, logo upload, Claude key, and Buildxact credentials.
- Diary entries can be converted directly into variation drafts with cost/time impact, reason, trade, priority, and selected contract template.
- Variations now carry the chosen template through ClientFlow; client approval auto-generates the populated contract and releases it for client e-signature.
- Client signature now archives an executed contract record into Document Control and queues the Buildxact-ready recovery trail.
- Document Control now includes PDF/image preview, AI-style plan search, and pinned plan annotations.
- AI Assistant drawer now supports chat through the configured Claude service, with a local SiteForge drafting fallback when no key is configured.

## Run

```bash
cd /Users/williamsullivan/Documents/Playground/siteforge
npm install
npm run dev
```

If `npm` is not available in your shell and you use `nvm`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 24
cd /Users/williamsullivan/Documents/Playground/siteforge
npm run dev
```

## Storage

- Primary demo storage key: `siteforge-v6-enterprise-demo`
- Storage version: `3`
- Legacy migration: `siteforge-v5-enterprise-demo` is migrated forward where possible
- Main state mirror: IndexedDB database `siteforge-enterprise-db`, object store `appState`
- File blobs: IndexedDB database `siteforge-files`, object store `blobs`

## Core Capabilities

- Role-tailored internal shell for Supervisor, Project Manager, Contract Admin, and Director
- External portal experiences for Client, Worker, and Subcontractor
- ClientFlow approvals with linked commercial recovery workflows
- Contract Studio with uploaded template parsing, merge token detection, draft generation, review, signature, and archive flow
- Document Intelligence with browser-side uploads, classification, parsed fields, plan revision supersede flow, and file metadata persistence
- Site Passport with QR check-in simulation, compliance gating, acknowledgement capture, passport file uploads, and ticket expiry tracking
- Presence verification with anomaly handling, payroll confidence, and disclosed privacy framing
- Teams action layer and Buildxact connector demo architecture with queue, sync history, retries, and payload previews
- Global search + command palette with entity navigation and role/command shortcuts
- Demo mode with simulated time, timed sweeps, scripted showcase flow, and toast events
- PDF export for contracts, audit views, invoices, and client-facing document moments

## Live Files

Edit only the live runtime files:

- `src/App.jsx`
- `src/main.jsx`
- `src/siteforge.css`
- `src/pages/*`
- `src/components/*`
- `src/services/*`
- `src/data/seedData.js`

Do not edit these inactive/legacy areas for the live app:

- `src/modules/*`
- `src/app/*`
- `src/services/integrations/*`

## Demo Tips

- Open internal workspace directly:
  - `http://localhost:5173/#/site/s1/dash`
- Use `Cmd/Ctrl+K` for search + commands
- Use `Cmd+.` to toggle Demo Mode
- Use `Cmd+Shift+D` for Demo Script Mode
- Use `?` for the shortcuts overlay

## Browser Notes

- The app is designed for modern Chrome, Safari, and Firefox.
- If IndexedDB is unavailable, document uploads fall back to in-memory blob storage for the current session.
- If persisted demo state becomes stale, reset from Admin or clear the storage key in browser devtools.
