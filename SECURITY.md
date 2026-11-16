# Security

Fura GPS is intended for a trusted local network. The phone-to-PC connection uses local HTTP, without account authentication. Do not expose the server through an internet port forward.

The Android connector accepts only numeric local IPv4 addresses. Its local setup WebView serves a fixed allowlist of bundled assets. The navigation WebView exposes only a validated language-preference bridge; connection and discovery actions are not exposed to the remote page.

LAN discovery uses UDP 28890. The PC replies to a fixed query from a local IPv4 address with its machine name, HTTP port and service version. It does not publish game paths or GPS positions through discovery.

The game adapter opens process memory only for reading, validates signatures/layout and never calls game functions. Report a suspected security issue privately to the repository maintainer before including exploit details in a public issue. Do not attach unredacted personal diagnostics.
