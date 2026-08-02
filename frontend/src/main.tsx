import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { SessionProvider } from './lib/SessionProvider'

// SessionProvider sits above the router: it consumes the ?code= handoff param
// on mount and strips it from the URL, and must do so before any route reads
// or rewrites the address bar.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
)
