import { Link } from 'react-router-dom'
import AnimatedNumber from './AnimatedNumber'
import { useWallet } from '../lib/wallet'

// Credit balance as a pill in the phone's top bar. It is a link to /plans
// because "how many do I have left" and "give me more" are the same thought.
export default function CreditsPill() {
  const { balance } = useWallet()

  return (
    <Link
      to="/plans"
      title="Token balance — tap to top up"
      aria-label={`${balance.toLocaleString()} tokens — top up`}
      className="bar-btn focusable px-4"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
      <AnimatedNumber value={balance} className="num text-base" />
    </Link>
  )
}
