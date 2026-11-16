# Contributing

Keep core navigation local and avoid adding account, advertising or tracking requirements. Explain visible behavior and test the change with the relevant fixtures.

Translations are in `furagps/server/wwwroot/translations.js`. Each row has seven columns: SL, EN, DE, HR, IT, FR, ES. Preserve `{0}` parameters, leave place names intact and run `node furagps/tests/i18n.mjs`. The Android build exports the same catalog for native dialogs. New visible strings need catalog entries; use the DOM helpers for dynamic text and labels.

Test layout at phone and tablet sizes, in both orientations and with larger text. Browser scripts in `furagps/qa/` use the actual shipped assets. A browser result does not replace physical Android testing.

GPS readers must remain read-only and reject uncertain snapshots. Keep game routes separate from custom routing, clear stale routes and do not apply ETS2 Coach offsets to ATS. New executable adapters need exact validation and fixtures.

Use HTTP 28889 / UDP 28897 for isolated integration tests. Never run a synthetic test DLL on the real game telemetry port. The native test build has its own compile-time port.

Do not commit map files, game files, personal diagnostics, certificates, signing keys, generated builds or dependency folders. Include provenance and license information for third-party changes.
