# SiteForge Workflow Tests

## ClientFlow Internal Approval
1. Create a blank ClientFlow approval.
2. Click `Submit for Review`.
3. Expected: status becomes `awaiting-pm`, timeline records PM review request.
4. Switch to Project Manager and click `PM Approve`.
5. Expected: status becomes `awaiting-ca`.
6. Switch to Contract Admin and click `CA Approve + Send`.
7. Expected: status becomes `awaiting-client`, delivery queues populate, portal URL uses `#/approve/<token>`.
8. Open portal, sign, then return to Document Control.
9. Expected: signed contract PDF blob is archived and variation register status is signed.

## Problem To RFI To Variation
1. Create a problem with cost and time impact.
2. Open the problem detail and click `-> RFI`.
3. Expected: RFI opens and has a linked problem record.
4. Open the RFI and click `Convert to Variation`.
5. Expected: variation opens and both RFI and variation reference each other.
6. Send variation to ClientFlow and complete approval.

## Diary Rain Day
1. Create a diary entry with `Rain Event` checked.
2. Click `Claim Rain Day`.
3. Expected: app navigates to ClientFlow with the new Rain Day approval selected.
4. Submit for review, PM approve, CA approve, then client sign.

## Procurement EOT
1. Create a procurement item.
2. Move it to delayed.
3. Click `Draft EOT`.
4. Expected: ClientFlow opens an Extension of Time approval linked to the procurement item and any linked tasks/phases.

## Site Passport Scan
1. Create or open a passport.
2. Run Test Scan.
3. Expected: granted or denied result displays, audit and presence events update.
