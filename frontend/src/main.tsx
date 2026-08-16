import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/query.ts'
import { AuthProvider } from './lib/auth.tsx'
import { WalletProvider } from './lib/wallet.tsx'
import { WorksProvider } from './lib/works.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <WalletProvider>
            <WorksProvider>
              <App />
            </WorksProvider>
          </WalletProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
