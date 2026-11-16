# Publishing a release

Release publishing is **manual**. Ordinary pushes run source checks and do not publish a release.

1. Review the version, English documentation and `RELEASE-NOTES.md`.
2. Build/sign the Android APK privately. Place the approved APK and its SHA-256 in `distribution/android/`. Never commit the signing key or passwords.
3. In this repository, open **Actions → Build and publish public beta → Run workflow** and select **main**.
4. Review the run. It checks the source, builds/tests the SDK plugin, builds Windows, verifies the prebuilt APK hash and stages the packages.
5. The explicitly started run publishes Windows, APK, screenshots and checksums as a public beta only after staging/upload succeeds.

The manually invoked release job receives repository-content write access for that run to create the release. It uses GitHub's short-lived job token, not a personal access token or a committed secret. No future push automatically invokes this publisher.
