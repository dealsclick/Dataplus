# DataPlus Warehouse for Android

DataPlus Warehouse 2 is a native Android scanner for receiving and warehouse audits. It uses the existing DataPlus APIs and shares the authenticated session with a restricted in-app DataPlus web fallback for complex workflows. The normal G47 barcode path is native and does not open the camera.

## Native application contract

- App name: DataPlus Warehouse
- Package name: `com.dataplus.warehouse`
- Version: `2.0.0` (`versionCode 2`)
- Minimum Android version: Android 7 / API 24
- Target: Android API 36; the warehouse G47 runs Android 14
- Server: `https://dataplusapp.duckdns.org`
- Scanner: keyboard-wedge/HID/IME output with Enter/CR suffix
- Network: required for lookups and writes; the app never claims an offline scan was saved
- Orientation: portrait

The installed package keeps the same application ID and signing certificate as version 1 so Android installs it as an update instead of a second app. Preserve and securely back up `android/warehouse/android.keystore`; future updates require that exact signing identity.

## Native workflow

The native app owns sign-in, active receiving/audit selection, warehouse bin selection, hardware-key capture, product lookup, SKU/title/UOM/case-pack review, quantity confirmation, saving, recent counts, and sound/haptic feedback. A barcode lookup never changes inventory. The app calls the scan mutation only after the operator confirms the quantity.

Unknown barcodes are not received automatically. The operator may skip them or open the full DataPlus workflow to research or create the product. Starting a new receipt/audit, camera scanning, and administrative tools also use the explicit web fallback. That WebView permits navigation only inside the DataPlus HTTPS origin; other links open in an external app. Camera permission is requested only if the operator chooses the web camera scanner.

The React mobile website remains an independent fallback. Native APK changes do not require changes under `web/src/`.

## Build and sign

The build uses JDK 17 and Android SDK API 36. The helper finds the existing Bubblewrap-managed JDK/SDK when `JAVA_HOME` and `ANDROID_HOME` are not already set.

```powershell
npm run android:build
```

Without signing variables, this creates:

`android/warehouse/app/build/outputs/apk/release/app-release-unsigned.apk`

To produce the update-ready signed APK, set the signing variables in the current shell. Do not save passwords in the repository.

```powershell
$env:WAREHOUSE_ANDROID_KEYSTORE_PASSWORD = "<keystore password>"
$env:WAREHOUSE_ANDROID_KEY_PASSWORD = "<key password, only if different>"
$env:WAREHOUSE_ANDROID_KEY_ALIAS = "datapluswarehouse"
npm run android:build
```

The signed output is `android/warehouse/app-release-signed.apk`. The build aligns, signs, and verifies the APK. `WAREHOUSE_ANDROID_KEYSTORE` may point to a securely stored keystore outside the repository.

## Publish the direct download

```powershell
npm run android:publish -- android/warehouse/app-release-signed.apk 2.0.0
```

Publishing validates the APK container, copies it to `release-assets/warehouse/dataplus-warehouse.apk`, and records its SHA-256 checksum. Authenticated warehouse users download it from the existing **Install Warehouse APK** option in the name menu. `GET /api/mobile/warehouse-apk/status` reports availability and `GET /api/mobile/warehouse-apk` serves the installer with the Android APK MIME type.

Production can instead use `WAREHOUSE_APK_FILE` and `WAREHOUSE_APK_VERSION`. Register the package and signing certificate in the Android Developer Console before developer-verification rules require it for these warehouse devices.

## Verification

Run the source and distribution checks before publishing:

```powershell
npm run test:warehouse-native
npm run test:warehouse-apk
git diff --check
```

On the G47:

1. Install version 2 over the existing DataPlus Warehouse app and confirm Android treats it as an update.
2. Sign in, close the app, reopen it, and confirm the session persists.
3. Open a test receipt and choose a bin.
4. Scan with both physical triggers. Confirm one trigger press opens one native confirmation sheet.
5. Verify SKU, title, UOM, case pack, bin, and quantity before tapping **Receive quantity**.
6. Confirm cancel makes no server change and confirm makes exactly one server change.
7. Disable Wi-Fi and confirm the red offline banner blocks the scan write.
8. Use **Camera & tools** and verify camera permission is requested only there.
9. Verify the saved count in the full React warehouse workspace.
