export default function VideoCompare({
  sourceUrl,
  outputUrl,
  simulated,
  subtitlesUrl,
  subtitlesLang,
}: {
  sourceUrl?: string
  outputUrl?: string
  simulated: boolean
  /** A .vtt to show on the dubbed side, when the subtitles are not burned in. */
  subtitlesUrl?: string
  subtitlesLang?: string
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel label="Original" tone="neutral" url={sourceUrl} />
      <Panel
        label="Dubbed"
        tone="brand"
        url={outputUrl}
        badge={simulated ? 'simulation' : 'live'}
        subtitlesUrl={subtitlesUrl}
        subtitlesLang={subtitlesLang}
      />
    </div>
  )
}

function Panel({
  label,
  url,
  tone,
  badge,
  subtitlesUrl,
  subtitlesLang,
}: {
  label: string
  url?: string
  tone: 'neutral' | 'brand'
  badge?: string
  subtitlesUrl?: string
  subtitlesLang?: string
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
      <div className="aspect-video bg-black">
        {url ? (
          // crossOrigin: a <track> from the dubbing API's origin is only loaded
          // when the video is fetched in CORS mode.
          <video
            src={url}
            controls
            playsInline
            crossOrigin={subtitlesUrl ? 'anonymous' : undefined}
            className="h-full w-full object-contain"
            preload="metadata"
          >
            {subtitlesUrl && (
              <track kind="subtitles" src={subtitlesUrl} srcLang={subtitlesLang} label="Subtitles" default />
            )}
          </video>
        ) : (
          <div className="grid h-full place-items-center bg-sunken text-sm text-muted">no media</div>
        )}
      </div>
    </div>
  )
}
