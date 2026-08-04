import { Link } from 'react-router-dom'
import AnimatedNumber from './AnimatedNumber'
import { useWallet } from '../lib/wallet'

// Credits balance as a pill. The top bar itself is transparent, so the pill
// carries its own surface: a soft shadow in light mode, borderless in dark.
export default function CreditsPill() {
  const { balance } = useWallet()

  return (
    <Link
      to="/plans"
      title="Credit balance — click to top up"
      className="focusable inline-flex items-center gap-2 rounded-full bg-surface py-1 pl-1.5 pr-3.5 text-sm shadow-sm transition-colors hover:text-primary dark:shadow-none"
    >
      {/* thin violet ring with a small bolt inside */}
      <span className="relative grid h-7 w-7 place-items-center rounded-full">
        <svg viewBox="0 0 28 28" className="absolute h-7 w-7" fill="none">
          <circle cx="14" cy="14" r="12" stroke="rgb(var(--c-brand-500))" strokeWidth="1.5" />
        </svg>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand" fill="currentColor">
          <path d="M13 2 4.5 13.2c-.3.4 0 1 .5 1H10l-1.2 7.2c-.1.6.7 1 1.1.5L19.5 10.8c.3-.4 0-1-.5-1H14l1-6.9c.1-.6-.7-1-1-.5z" />
        </svg>
      </span>
      <AnimatedNumber value={balance} className="font-medium text-primary" />
      <span className="text-xs text-muted">credits</span>
    </Link>
  )
}
