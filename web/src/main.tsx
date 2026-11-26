import { reactErrorHandler } from './monitoring'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import './color-vision.css'
import './premium-ui.css'
import App from './App.tsx'
import LoteriaApp from './features/loteria/LoteriaApp.tsx'

const RootApp = window.location.pathname === '/loteria' || window.location.pathname.startsWith('/loteria/')
  ? LoteriaApp
  : App

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler,
  onCaughtError: reactErrorHandler,
  onRecoverableError: reactErrorHandler,
}).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="dataplus-theme">
      <RootApp />
    </ThemeProvider>
  </StrictMode>,
)
