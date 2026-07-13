export default function VideoCompare({
  sourceUrl,
  outputUrl,
  simulated,
}: {
  sourceUrl?: string
  outputUrl?: string
  simulated: boolean
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel label="Original" tone="neutral" url={sourceUrl} />
      <Panel label="Dubbed" tone="brand" url={outputUrl} badge={simulated ? 'simulation' : 'live'} />
    </div>
  )
}

function Panel({
  label,
  url,
  tone,
  badge,
}: {
  label: string
  url?: string
  tone: 'neutral' | 'brand'
  badge?: string
}) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium text-white/80">
          <span className={`h-2 w-2 rounded-full ${tone === 'brand' ? 'bg-violet-400' : 'bg-white/30'}`} />
          {label}
        </span>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${badge === 'live' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="aspect-video bg-black/60">
        {url ? (
          <video src={url} controls className="h-full w-full" preload="metadata" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-white/30">no media</div>
        )}
      </div>
    </div>
  )
}
