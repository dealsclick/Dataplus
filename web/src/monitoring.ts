import * as Sentry from '@sentry/react'

// Public ingestion key, not an authentication token. Override at build time when needed.
const dsn = import.meta.env.VITE_SENTRY_DSN
  ?? 'https://2e00a5ab9886fa644ae6cb2c122e1237@o4512097160396800.ingest.us.sentry.io/4512097167474688'
const enabled = import.meta.env.VITE_SENTRY_ENABLED === 'true'
  || (import.meta.env.PROD && import.meta.env.VITE_SENTRY_ENABLED !== 'false')

if (enabled && dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    // Omit the option unless overridden so the SDK uses the plugin-injected release.
    ...(import.meta.env.VITE_SENTRY_RELEASE ? { release: import.meta.env.VITE_SENTRY_RELEASE } : {}),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    // Error reporting only; no replay, tracing, logs, or UI/console breadcrumbs.
    enableLogs: false,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      delete event.user
      if (event.request) {
        const url = event.request.url?.split(/[?#]/, 1)[0]
        event.request = url ? { url } : undefined
      }
      return event
    },
  })
}

// React 19 reports rendering errors through root callbacks instead of rethrowing them.
export const reactErrorHandler = Sentry.reactErrorHandler((error) => {
  console.error(error)
})
