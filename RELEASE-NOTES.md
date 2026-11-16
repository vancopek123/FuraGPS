# Fura GPS 0.11.1 — First public beta

Turn your Android phone, tablet or browser into a local GPS screen for ETS2 and ATS.

- Smooth 3D/2D navigation, separate game maps, city search and custom routes.
- Experimental read-only in-game GPS following, including active-stage changes exposed by the game.
- **G-force comfort meter (beta):** cornering, acceleration and braking feedback with green, orange and red warnings, adjustable sensitivity and optional visibility.
- **ETS2 Coach DLC punctuality (beta):** Early / On time / Late with the difference in in-game minutes for the active stage. Supported game builds use live timetable data; fallback values are labelled ESTIMATE.
- Seven UI languages, metric/imperial units and optional instruments.
- A redesigned connection screen with LAN discovery, saved PC and manual IP/port.
- English installer filenames and complete English installation documentation.
- New screenshots for phone, tablet and desktop-browser layouts.

## Install

1. Extract **FuraGPS-Windows-0.11.1.zip**.
2. Run **Download-Maps.cmd** for missing maps.
3. Close the game and run **Install-Plugin.cmd**, then start **FuraGPS.exe** and the game.
4. Install **FuraGPS-Android-0.11.1.apk** on Android and connect both devices to the same LAN.
5. Use **Find my PC**, or enter the IP/port shown by the PC program. If Windows Firewall blocks the connection, **Allow-LAN.cmd** prepares private-LAN rules.

Existing 0.11 users can retain their map data and telemetry DLL. The APK keeps the previous official signing certificate. See **START-HERE.txt** and **UPGRADE-0.11.1.txt** in the Windows ZIP.

## Beta status

ATS maps, custom routes, SDK fixtures and installed executable signatures are checked. A real ATS drive, physical Android installation/discovery and device-specific FPS still need testing. The G-meter is an adjustable vehicle-acceleration estimate. Coach tools remain in beta development; the live timetable adapter is checked for ETS2 1.62.3.3, including a previous HaulMP stage, and rejects unsupported layouts.

External map files are not bundled. The downloader uses the original pinned upstream release; map-data rights remain separate from the MIT code license. No game archives, signing keys or personal diagnostics are distributed.

[Screenshots and full documentation](https://github.com/vancopek123/FuraGPS#screenshots)
