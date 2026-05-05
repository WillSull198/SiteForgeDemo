# Regression Coverage

## 4ed4823 Targeted Fixes
- Anthropic browser-access header remains in `src/services/aiService.js`.
- AI plan search calls Claude when key exists and keyword fallback otherwise.
- Signed PDF blob storage remains in `persistExecutedPdf`.
- Template upload extracts clauses and opens review.
- Diary -> Variation creates ClientFlow approval.
- Blank ClientFlow approval path remains.
- Settings has Test Connection and Import.

## cab741b Onboarding Completion
- `finishRealOnboarding` resolves user, role, site, route, then writes hash.
- Hash listener rejects phantom site IDs.

## b10650f Render Safety
- Shell hooks are stable across onboarding handoff.
- Director Boardroom tolerates null `financialPulse`.
- Dashboard and Reports show visible setup states when project context is missing.

## This Pass
- Portal URLs now use hash routes.
- ClientFlow has PM and CA internal review gates plus Director override.
- Problem -> RFI and RFI -> Variation create durable linked records.
- Rain Day claim navigates to ClientFlow.
- Procurement EOT links affected tasks/phases where present.
- Service worker update/reset path exists.
