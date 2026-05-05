# SiteForge Smoke Test

Run after every commit.

1. Start the app through `npm run dev` or a built static bundle. Opening raw source `index.html` with `file://` should show the boot fallback message, not the app.
2. Clear localStorage and IndexedDB, then reload.
3. Confirm onboarding shows `Try the demo` and `Set up my company`.
4. Complete real onboarding as Project Manager with one project and one client.
5. Confirm URL is `#/site/<id>/dash` and no blank page appears.
6. Switch roles: Director, Project Manager, Contract Admin, Supervisor, Worker, Client, Subcontractor.
7. Create one task, one problem, one RFI, one diary entry, and one ClientFlow approval.
8. Refresh and confirm records persist.
9. Open Settings, change company name, refresh, and confirm sidebar updates.
10. Open ClientFlow, submit an approval for PM review, approve as PM, approve as CA, confirm portal link uses `#/approve/<token>`.
11. Open Settings -> Data Management and confirm export, import, clear data, and emergency offline-cache reset buttons are visible.
