# DataPlus Warehouse for Android

DataPlus Warehouse is a scan-first Android entry point for the React workspace at `/warehouse/mobile`. The G47 scanner is configured as a keyboard wedge with an Enter/CR suffix, so the Android package does not need a device-specific barcode SDK.

## Distribution

The first release is distributed directly from DataPlus. The signed release APK is published as a versioned deployment asset so every production container serves the same verified installer:

```powershell
npm run android:publish -- android/warehouse/app-release-signed.apk 1.0.0
```

This validates the APK container, copies it to `release-assets/warehouse/dataplus-warehouse.apk`, and writes release metadata including its SHA-256 checksum. `GET /api/mobile/warehouse-apk/status` reports availability to authenticated warehouse users. `GET /api/mobile/warehouse-apk` downloads the package with the Android APK MIME type. The user's name menu enables **Install Warehouse APK** when the package is published and otherwise shows a disabled availability message.

Production may instead set `WAREHOUSE_APK_FILE` to an absolute package path and `WAREHOUSE_APK_VERSION` to the displayed version. Never commit the signing key. Preserve and back it up securely: Android updates must use the same package name and signing certificate.

## Web application contract

- App name: DataPlus Warehouse
- Package name: `com.dataplus.warehouse`
- Minimum Android version: Android 7 / API 24 (the G47 is on Android 14)
- Start URL: `https://dataplusapp.duckdns.org/warehouse/mobile`
- Manifest: `https://dataplusapp.duckdns.org/warehouse.webmanifest`
- Orientation: portrait
- Network: required for operational writes; never claim an offline scan was saved
- Scanner: keyboard/keystroke/HID/IME output, no prefix, Enter/CR suffix

The manifest is added to the document only in warehouse mobile mode. API responses and authenticated warehouse records are not cached for offline use.

## Trusted Web Activity build

Use Google's Bubblewrap CLI. It can download the required JDK and Android command-line tools on first use. Android Studio is not required for this repository build.

```powershell
npm install
npm run android:build
npm run android:publish -- android/warehouse/app-release-signed.apk 1.0.0
```

The generated project is under `android/warehouse`. The release certificate fingerprint must match `web/public/.well-known/assetlinks.json` before the app can run without browser chrome. The ignored release keystore is `android/warehouse/android.keystore`; back it up securely because every future APK update must use the same key.

For direct distribution, register `com.dataplus.warehouse` and the release certificate in the [Android Developer Console](https://developer.android.com/developer-verification/guides/android-developer-console) before the global Android developer-verification rollout reaches the warehouse devices.

## G47 acceptance pass

1. Download the APK from the signed-in name menu and allow installation from the browser when Android prompts.
2. Confirm the launcher opens DataPlus Warehouse without an address bar.
3. Sign in and confirm the session persists after closing and reopening the app.
4. Scan a PO, product identifier, bin label, and return label using both physical triggers.
5. Confirm one physical scan creates one UI action, success/error feedback is visible, and the scanner field regains focus.
6. Disable Wi-Fi and confirm the red offline banner prevents the operator from assuming scans were saved.
7. Reconnect, finish a test receipt/audit, and verify the server-side record in the full React workspace.
