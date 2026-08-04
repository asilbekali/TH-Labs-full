import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'
import { WalletProvider } from './lib/wallet.tsx'
import { WorksProvider } from './lib/works.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <WalletProvider>
          <WorksProvider>
            <App />
          </WorksProvider>
        </WalletProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
