# Manual Test Plan

## Director
- Boardroom renders on blank real data.
- Portfolio heatmap opens project context.
- Authority actions require confirmation and write audit entries.

## Project Manager
- Dashboard, ClientFlow, Problems, RFIs, Procurement, Diary, Reports load.
- ClientFlow internal review path completes.
- Problem -> RFI -> Variation chain links records bidirectionally.

## Contract Admin
- Contract Studio templates render.
- CA approval sends ClientFlow item to client.
- Document Control sees executed contract PDF blobs.

## Supervisor
- Tasks, Problems, Diary, Safety, Workforce, Passport load.
- Rain Day claim navigates to ClientFlow.

## Worker
- Worker mobile view fits 375px.
- Task completion and problem report actions persist.

## Client
- Portal route `#/approve/<token>` loads without internal navigation.
- Approve/sign produces confirmation and PDF download.

## Subcontractor
- Subcontractor portal shows own RFIs/tasks/docs only.
- No budget, internal commercial, or other subcontractor records are visible.
