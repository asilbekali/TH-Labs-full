export default function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id="logoG" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="0.5" stopColor="#d946ef" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="#0a0a12" />
        <g fill="url(#logoG)">
          <rect x="12" y="26" width="5" height="12" rx="2.5" />
          <rect x="21" y="18" width="5" height="28" rx="2.5" />
          <rect x="30" y="10" width="5" height="44" rx="2.5" />
          <rect x="39" y="20" width="5" height="24" rx="2.5" />
          <rect x="48" y="27" width="5" height="10" rx="2.5" />
        </g>
      </svg>
      <span className="text-lg font-semibold tracking-tight">
        TH<span className="gradient-text">·</span>Labs
      </span>
    </div>
  )
}
