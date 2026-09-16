import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const authToken = process.env.SENTRY_AUTH_TOKEN
  const project = process.env.SENTRY_PROJECT || 'dataplus'
  const uploadSourceMaps = command === 'build' && Boolean(authToken)

  return {
    build: {
      sourcemap: uploadSourceMaps ? 'hidden' : false,
    },
    plugins: [
      react(),
      tailwindcss(),
      ...(uploadSourceMaps ? [sentryVitePlugin({
        org: process.env.SENTRY_ORG || 'buysupply',
        project,
        authToken,
        telemetry: false,
        release: { name: process.env.VITE_SENTRY_RELEASE || process.env.SENTRY_RELEASE },
        sourcemaps: {
          assets: './dist/**',
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
      })] : []),
    ],
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:4173',
        '/auth': 'http://127.0.0.1:4173',
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
