import logo from '../../assets/logo.png'
import { AUTH_KEY, DUB_KEY, type DubState } from '../lib/messages'
import type { StoredAuth } from '../lib/auth'
import { DubView } from './DubView'
import { ErrorBoundary } from './ErrorBoundary'
import { LoginView } from './LoginView'
import { useStored } from './useStored'

export function App() {
  const auth = useStored<StoredAuth>('local', AUTH_KEY)
  const live = useStored<DubState>('session', DUB_KEY)?.status === 'live'
  return (
    <div className={`shell ${live ? 'live' : ''}`}>
      <div className="ambient" aria-hidden>
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
      </div>
      <header className="header">
        <span className="glass logo-tile">
          <img src={logo} alt="" className="logo" />
        </span>
        <div>
          <div className="brand">TH-Labs</div>
          <div className="brand-sub">Real-time dubbing</div>
        </div>
      </header>
      <main className="main">
        <ErrorBoundary>
          {auth === undefined ? null : auth?.user ? <DubView user={auth.user} /> : <LoginView />}
        </ErrorBoundary>
      </main>
      <footer className="footer">
        <a href="https://th-labs.uz" target="_blank" rel="noreferrer">th-labs.uz</a>
      </footer>
    </div>
  )
}
