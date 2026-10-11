// A dub's thumbnail: a real frame of the video, shown as an image.
//
// The pipeline writes no poster, so the first time a dub is shown this captures
// one frame into a small JPEG (lib/poster.ts) and saves it on the work record.
// The record syncs to the account, so from then on every page and every device
// paints an `<img>` straight away — no video download, no decode.
//
// Before this, each card was a muted `<video #t=1 preload=metadata>`. That was
// slow on a full library, and Safari paints no frame for preload=metadata at
// all, so cards there were just coloured gradients. The video element is kept
// only as a last resort for a dub whose frame cannot be captured.
//
// Layers, bottom up:
//   - The deterministic gradient: the loading state, and the fallback for a
//     running or failed job or a media URL that no longer resolves.
//   - The live `<video>` frame, only when capture failed.
//   - The captured image.
//
// The dubbed output is preferred over the source: it is the thing the user
// made. A running job's frame comes from its source and is not saved, because
// the output will replace it.
//
// This component owns no box of its own — it fills its parent, which must be
// `relative` and sized by the page. The three call sites want three different
// shapes (16:9 card, 10×14 strip, 12×16 row) and all of them want the same
// picture.
import { useEffect, useState } from 'react'
import { mediaUrl } from '../lib/api'
import { capturePoster } from '../lib/poster'
import { gradientFor } from '../lib/thumb'
import { useWorks } from '../lib/works'

/** The subset of a Work this needs. Kept structural so Studio's own row type fits. */
export interface ThumbWork {
  id: string
  outputUrl: string | null
  sourceUrl?: string | null
  status?: string
  thumbnail?: string | null
}

export default function WorkThumb({
  work,
  rounded,
  className = '',
}: {
  work: ThumbWork
  /** Round the video's own corners, for a parent that cannot clip. */
  rounded?: boolean
  className?: string
}) {
  const { updateWork } = useWorks()
  const [captured, setCaptured] = useState<string | null>(null)
  const [captureFailed, setCaptureFailed] = useState(false)
  const [videoBroken, setVideoBroken] = useState(false)
  const failed = work.status === 'failed'
  const output = mediaUrl(work.outputUrl)
  // Dubbed first, source as the stand-in while a job is mid-pipeline.
  const frame = output ?? mediaUrl(work.sourceUrl ?? null)
  const image = work.thumbnail || captured

  useEffect(() => {
    if (work.thumbnail || !frame) return
    let cancelled = false
    setCaptureFailed(false)
    void capturePoster(frame).then((poster) => {
      if (cancelled) return
      if (!poster) return setCaptureFailed(true)
      setCaptured(poster)
      // Saved only from the finished dub, so it never has to be redone.
      if (output && frame === output) updateWork(work.id, { thumbnail: poster })
    })
    return () => {
      cancelled = true
    }
  }, [work.id, work.thumbnail, frame, output, updateWork])

  const round = rounded ? 'rounded-lg' : ''
  const gray = failed ? 'grayscale' : ''

  return (
    <>
      <span
        className={`thumb-grad absolute inset-0 ${gray} ${round}`}
        style={{ backgroundImage: gradientFor(work.id) }}
      />
      {image ? (
        <img
          src={image}
          alt=""
          aria-hidden
          decoding="async"
          draggable={false}
          className={`absolute inset-0 h-full w-full object-cover ${gray} ${round} ${className}`}
        />
      ) : (
        captureFailed &&
        frame &&
        !videoBroken && (
          <video
            // `#t=1` asks for the frame one second in. Not 0: the first frame
            // of a video is very often black or a fade-in.
            src={`${frame}#t=1`}
            muted
            playsInline
            preload="metadata"
            // No controls and no autoplay: this is an image that happens to be
            // a video element. aria-hidden because the control around it
            // already carries the label, and tabIndex -1 so it never takes focus.
            aria-hidden
            tabIndex={-1}
            onError={() => setVideoBroken(true)}
            className={`absolute inset-0 h-full w-full object-cover ${gray} ${round} ${className}`}
          />
        )
      )}
    </>
  )
}
