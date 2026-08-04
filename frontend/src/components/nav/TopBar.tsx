import AccountMenu from '../AccountMenu'
import CreditsPill from '../CreditsPill'

/**
 * Fully transparent top bar (§6) — no border, fill, blur, or solid-on-scroll.
 * Right-aligned only: the credits pill, then the avatar (which is the sign-in
 * affordance when signed out).
 */
export default function TopBar({ onSignIn }: { onSignIn: () => void }) {
  return (
    <header className="flex items-center justify-end gap-3">
      <CreditsPill />
      <AccountMenu variant="bar" onSignIn={onSignIn} />
    </header>
  )
}
