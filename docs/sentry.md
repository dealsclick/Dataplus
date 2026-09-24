# Sentry browser error reporting

The current React app initializes `@sentry/react` in `web/src/monitoring.ts`, before
the App module loads. React 19 root callbacks capture rendering errors; the SDK
also captures unhandled browser errors and rejected promises. No backend API
changes are needed.

Production builds use the configured public project DSN by default, including
the existing Docker build. Local Vite development does not send events by default.
These optional Vite variables must be present **when building the frontend**
(or in `web/.env.local` during development):

| Variable | Purpose |
| --- | --- |
| `VITE_SENTRY_DSN` | Override the public ingestion DSN; an empty value disables initialization. |
| `VITE_SENTRY_ENABLED` | `false` disables reporting; `true` enables local verification. |
| `VITE_SENTRY_ENVIRONMENT` | Defaults to the Vite mode (`production` or `development`). |
| `VITE_SENTRY_RELEASE` | Optional release identifier, such as the deployed Git SHA. |

Runtime container variables do not change an already-built browser bundle.
Never put a Sentry auth token in a `VITE_*` variable or browser source code.

Automatic user information, cookies, HTTP headers/bodies, and URL query collection
are disabled. Breadcrumbs are dropped and event request metadata is reduced to a
URL without query or fragment. Session replay, tracing, and Sentry logs are not
enabled. Error messages and stack traces are still sent: do not put secrets or
customer records in thrown error messages.

## Verify after deployment

Open the new React app and execute this once in the browser developer console:

```js
setTimeout(() => { throw new Error('DataPlus Sentry browser verification') }, 0)
```

Confirm the event appears in the intended Sentry project's Issues view, with the
expected environment. For local testing, set `VITE_SENTRY_ENABLED=true` in
`web/.env.local` and restart Vite; remove that override after testing. The test
does not modify orders, products, or application records.

## Source-map uploads

The Vite plugin is configured for organization `buysupply` and project `dataplus`,
as identified by https://buysupply.sentry.io/settings/projects/dataplus/.
Uploads activate only when `SENTRY_AUTH_TOKEN` is present in the build process
environment. `SENTRY_PROJECT` can override the default project slug. Optionally
set `SENTRY_RELEASE` to the deployed Git SHA; `VITE_SENTRY_RELEASE` takes precedence
when both are provided. The plugin injects the release into the browser bundle.

Create an organization build token in Sentry's organization settings under
Auth Tokens and store it in the deployment secret store. Do not paste the token
into chat, commit it, or use a Docker build argument for it. The existing GitHub
connection does not provide this build credential automatically.

### GitHub Actions deployment

Save `SENTRY_AUTH_TOKEN` under the GitHub repository's Settings > Secrets and
variables > Actions > Repository secrets. The production workflow requires this
secret and passes it to the existing DigitalOcean SSH destination through encrypted
standard input, not command-line arguments or a saved token file. The remote shell
fetches the workflow's exact commit and fast-forwards only, preserving production
changes by refusing any divergent revision. For a manual deployment, select the
reviewed release branch in GitHub Actions.
The remote shell
selects `buysupply/dataplus`, uses the checked-out Git SHA as the release, and enables
the Sentry Compose override. Docker exposes the token only to the build via its
secret mount; it is not added to the application runtime or image.

Once these changes are committed and pushed, the existing `master` push or manual
deployment workflow will upload frontend source maps to that Sentry project.

For a direct frontend build, provide `SENTRY_AUTH_TOKEN` through the shell/CI
secret environment, then run `npm run web:build`.
Hidden source maps are generated, uploaded, and removed from `web/dist`.
Upload failures fail the build. Without a token, the normal build succeeds
without creating source maps; browser error reporting still works.

For the existing Docker deployment, the optional `docker-compose.sentry.yml`
passes the token as a BuildKit secret to the frontend build only. In the deployment
shell, supply the token through the secret environment and export the following
non-secret values before running the normal deployment script:

```sh
export SENTRY_PROJECT='dataplus'
export SENTRY_RELEASE="$(git rev-parse HEAD)"
export COMPOSE_FILE='docker-compose.yml:docker-compose.sentry.yml'
bash scripts/deploy-production.sh
```

Keep `COMPOSE_FILE` set for subsequent builds so the deployment script's build
and up commands both use the upload configuration. Do not put the token in the
root `.env`, which is also loaded into running application containers.

Source-map upload and event delivery must still be verified in Sentry after
credentials are configured. Backend/server and worker instrumentation remain
separate follow-up work.
