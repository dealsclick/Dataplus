import { reactErrorHandler } from './monitoring'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler,
  onCaughtError: reactErrorHandler,
  onRecoverableError: reactErrorHandler,
}).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="dataplus-theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
)
