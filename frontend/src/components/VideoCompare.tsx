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
      <div className="flex items-center justify-between border-b border-subtle px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium text-secondary">
          <span className={`h-2 w-2 rounded-full ${tone === 'brand' ? 'bg-brand' : 'bg-muted'}`} />
          {label}
        </span>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${badge === 'live' ? 'bg-success/15 text-success' : 'bg-warn/15 text-warn'}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="aspect-video bg-sunken">
        {url ? (
          <video src={url} controls className="h-full w-full" preload="metadata" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">no media</div>
        )}
      </div>
    </div>
  )
}
