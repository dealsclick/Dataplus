# DataPlus Desktop Print Agent

The desktop print agent lets a user send an already-purchased fulfillment label packet from a phone or another DataPlus session to a warehouse printer. It does not purchase postage and does not replace browser printing or AirPrint.

## Pair a warehouse computer

1. Open **Fulfillment > Print stations** in DataPlus.
2. Select **Pair desktop**, enter a station name, and create a one-time code.
3. On the warehouse computer, open Windows PowerShell and run the one-line install command shown in the pairing dialog. The computer does not need the DataPlus project or Node.js.
4. The installer stores the agent under `%LOCALAPPDATA%\DataPlus\PrintAgent`, starts it in the background, and registers it to start when that Windows user signs in.
5. Select the default printer in **Fulfillment > Print stations** after the agent reports the desktop's installed printers.

The pairing code expires after 15 minutes and can be used once. The standalone Windows agent stores its token in `%LOCALAPPDATA%\DataPlus\PrintAgent\config.json`; DataPlus stores only its SHA-256 hash.

## Print from mobile

1. Purchase labels through the normal fulfillment workflow.
2. Open **Fulfillment > Print queue**.
3. Select **Send**, choose the station and printer, then select **Send to printer**.

The packet remains queued if the desktop is offline. The agent claims it after reconnecting and reports `queued`, `printing`, `printed`, or `failed` back to DataPlus. A failed packet can be sent again without buying labels again.

## Windows printing

For silent printing to a named printer, install SumatraPDF or set `SUMATRA_PDF_PATH` to `SumatraPDF.exe`. Without it, Windows uses the registered PDF application's print action and the computer's default printer. macOS and Linux use `lp`.

The installed agent log is available at:

```powershell
Get-Content "$env:LOCALAPPDATA\DataPlus\PrintAgent\agent.log" -Tail 50
```

## Operations and security

- Disable a lost or retired desktop in **Fulfillment > Print stations**.
- Agent endpoints require the bearer token issued during pairing and do not accept a browser session as a substitute.
- A claimed job has a two-minute lease. If the agent stops before acknowledging it, another poll from the same station can reclaim it.
- Label PDFs are generated from the existing durable print queue and are never exposed in the console snapshot.
