# SiteForge Operational Audit Notes

## Findings Fixed
- Path-style portal URLs were generated in `siteforgeStore.js`; new URLs now use `#/approve/<token>`.
- ClientFlow could send drafts directly to clients; PM/CA internal review actions now exist.
- Problems had a suggestion-only RFI path; persisted Problem -> RFI creation now exists.
- RFI -> Variation did not navigate after creation; it now navigates to the variation.
- Rain Day claim created an approval but did not take the user to ClientFlow; it now does.
- Toasts could repeat rapidly; duplicate title/body or event/entity toasts within two seconds are suppressed.
- Service worker had no user-facing update/reset path; update banner and emergency reset are now present.

## Known Remaining Manual Validation
- Full live-browser pass across every role.
- Export/import of IndexedDB blobs is still JSON-state-only and needs a backend/offline archive decision.
- Real email/SMS/Teams delivery remains queued-only until providers are connected.
- Presence WSA gate is implemented but needs a live date-bound test with uploaded notice.
