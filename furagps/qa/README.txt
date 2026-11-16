Layout QA (development only)

npm ci
node layout-overlap.mjs

Uses an isolated headless Google Chrome installation, without personal tabs or
profiles. Checks 12 CSS viewport sizes, compact/large text, closed/open details,
temporary notices and the APK-injected layout over the 0.8 HTML fixture.
All visible controls are hit-tested; cards are checked for intersections and
viewport overflow. Local screenshots are written to qa/screens.

For the actual 3D demo, start a separate test server (do not use the user's
game UDP port), e.g. HTTP 28889 / UDP 28897 / loopback only, then:
node demo-preview.mjs

The demo checks that the actual WebGL map renders, has no runtime JS errors and
keeps its vehicle focus inside the free area between cards. It saves screenshots
at phone and tablet sizes. These tests do not install an APK on a physical device.

Set FURAGPS_QA_LEGACY=1 to repeat the complete demo with the old 0.8 HTML/JS
and inject the APK's new layout after page load. The legacy fixtures are included.

node motion-preview.mjs
Runs against the same isolated server and feeds synthetic positions only into
its own browser page (no game UDP). Checks actual MapLibre render/overlay sync,
Wi-Fi batching, forward movement, quality at DPR 2, unchanged HUD mutations and
automatic/manual G visibility. This is not a physical-device FPS benchmark.
