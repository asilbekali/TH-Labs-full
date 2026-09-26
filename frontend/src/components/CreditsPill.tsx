import { Link } from 'react-router-dom'
import AnimatedNumber from './AnimatedNumber'
import { useWallet } from '../lib/wallet'

// Credit balance as a hairline pill in the top bar. It is a link to /plans
// because "how many do I have left" and "give me more" are the same thought.
export default function CreditsPill() {
  const { balance } = useWallet()

  return (
    <Link
      to="/plans"
      title="Credit balance — click to top up"
      className="focusable inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface py-1.5 pl-2.5 pr-3 text-sm transition-colors hover:border-strong"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-primary" fill="currentColor" aria-hidden>
        <path d="M13 2 4.5 13.2c-.3.4 0 1 .5 1H10l-1.2 7.2c-.1.6.7 1 1.1.5L19.5 10.8c.3-.4 0-1-.5-1H14l1-6.9c.1-.6-.7-1-1-.5z" />
      </svg>
      <AnimatedNumber value={balance} className="font-medium text-primary" />
      <span className="text-xs text-muted">credits</span>
    </Link>
  )
}
