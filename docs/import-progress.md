# Import Monitoring

Jobs > Imports (`/jobs?tab=imports`) shows paginated import runs, search, counts, current window, status, last progress, and reported errors. Orders has a compact active-import indicator. Links open the existing job detail for worker output, skip/result CSVs, error artifacts, retry, and stop. Only artifacts actually produced by the importer are downloadable; missing skip breakdowns are not fabricated.

The read-only `/api/import-jobs/progress` endpoint uses the existing Jobs view permission. It reads compact PostgreSQL job metadata and never contacts marketplaces, modifies a job, or restarts a worker. The UI polls every 15 seconds while visible, without overlapping requests, and reports stale/failing reads. Imports remain paginated rather than capped to a fixed overall total.

Percentages have an explicit basis:
- Completed imports: 100%, including warnings only when the completion phase is recorded.
- Temu historical windows: estimated completed **date-range coverage**, calculated from the current window's start and the run's fixed date bounds. The current window is not counted as complete. This advances as windows complete, not smoothly per order. It is not an order percentage or time estimate. Window splitting remains safe because the importer visits ranges chronologically.
- Known totals: scanned rows divided by the worker's reported row target. This target may represent a configured batch rather than the entire channel history.
- Otherwise: worker-reported progress when available, or Unknown. Missing totals never imply zero remaining orders.

Running/failed/stopped work is capped below 100%. The end bound for legacy Temu runs is their persisted start time, not the current time; this estimate does not drift while the operator watches. A missing start bound or incremental-sync cursor produces Unknown rather than a guessed percentage. No active import implementation or payload is changed by this release.

Test: `node --test --test-isolation=none scripts/test-import-progress.cjs`.
