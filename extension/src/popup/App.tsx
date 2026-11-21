import logo from '../../assets/logo.png'
import { AUTH_KEY } from '../lib/messages'
import type { StoredAuth } from '../lib/auth'
import { DubView } from './DubView'
import { LoginView } from './LoginView'
import { useStored } from './useStored'

export function App() {
  const auth = useStored<StoredAuth>('local', AUTH_KEY)
  return (
    <div className="shell">
      <div className="glow" aria-hidden />
      <header className="header">
        <img src={logo} alt="" className="logo" />
        <div>
          <div className="brand">TH-Labs</div>
          <div className="brand-sub">Real-time dubbing</div>
        </div>
      </header>
      <main className="main">
        {auth === undefined ? null : auth ? <DubView user={auth.user} /> : <LoginView />}
      </main>
      <footer className="footer">th-labs.uz</footer>
    </div>
  )
}
