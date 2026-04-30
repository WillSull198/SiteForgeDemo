# Buildxact Connector

SiteForge treats Buildxact as the cost-side source of truth. This connector keeps SiteForge in the operations lane:

- Pull projects, clients, suppliers, cost codes, schedule milestones, and existing variations for context.
- Push only operational outcomes back: client-signed variations/EOTs, signed contract packs, and approval timeline notes.
- Buildxact wins cost fields until a SiteForge approval is fully signed. SiteForge wins approval state, signatures, evidence, and audit.

`client.js` is the only file that needs replacing when live Buildxact credentials are available. The rest of the app talks to `sync.js` and `mapping.js`, which already produce stable SiteForge resource shapes and idempotent push payloads.

Backend handoff notes:

- Store remote IDs on every imported record as `buildxactId`.
- Use `approval.id` as the idempotency key for variation upserts.
- Attach `contractPack.executedPdfBlobId` as evidence once blob replication exists.
- Keep read-only mode available for builders who want to trial SiteForge before granting write access.
