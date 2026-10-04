// A dub's thumbnail: a frame of the actual video, with a deterministic gradient
// behind it.
//
// It used to be the gradient alone, everywhere — because the pipeline writes no
// poster image. So every list of real dubs (My Works, Recent dubs on Home, the
// Studio's strip) looked like a list of coloured rectangles, and nothing on
// screen told you which video was which.
//
// The fix needs no poster and no backend change: a muted `<video>` with a `#t=`
// media fragment makes the browser decode exactly that one frame and paint it,
// which is a thumbnail. It also works retroactively for every dub already in
// the library.
//
// Why it is layered rather than conditional:
//
//   - `preload="metadata"` fetches headers and that one frame, not the file. A
//     grid of these costs kilobytes each, not megabytes.
//   - The gradient stays underneath as the loading state AND the fallback, so a
//     still-processing job, a failed one, a media URL that no longer resolves
//     and a codec the browser will not decode all degrade to exactly what these
//     pages showed before, instead of to an empty box.
//   - `onError` hides the video for good, so a broken URL does not retry on
//     every re-render.
//
// The dubbed output is preferred over the source: it is the thing the user made
// and came back to look at. A job still running has neither, and gets the
// gradient until it does.
//
// This component owns no box of its own — it fills its parent, which must be
// `relative` and sized by the page. The three call sites want three different
// shapes (16:9 card, 10×14 strip, 12×16 row) and all of them want the same
// picture.
import { useState } from 'react'
import { mediaUrl } from '../lib/api'
import { gradientFor } from '../lib/thumb'

/** The subset of a Work this needs. Kept structural so Studio's own row type fits. */
export interface ThumbWork {
  id: string
  outputUrl: string | null
  sourceUrl?: string | null
  status?: string
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
  const [broken, setBroken] = useState(false)
  const failed = work.status === 'failed'
  // Dubbed first, source as the stand-in while a job is mid-pipeline.
  const frame = mediaUrl(work.outputUrl) ?? mediaUrl(work.sourceUrl ?? null)
  // `#t=1` asks for the frame one second in. Not 0: the first frame of a video
  // is very often black or a fade-in, which is indistinguishable from a broken
  // thumbnail. One second in there is a picture.
  const src = frame ? `${frame}#t=1` : null

  return (
    <>
      <span
        className={`thumb-grad absolute inset-0 ${failed ? 'grayscale' : ''} ${
          rounded ? 'rounded-lg' : ''
        }`}
        style={{ backgroundImage: gradientFor(work.id) }}
      />
      {src && !broken && (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          // No controls and no autoplay: this is an image that happens to be a
          // video element. aria-hidden because the control around it already
          // carries the label, and tabIndex -1 so it never takes focus.
          aria-hidden
          tabIndex={-1}
          onError={() => setBroken(true)}
          className={`absolute inset-0 h-full w-full object-cover ${
            failed ? 'grayscale' : ''
          } ${rounded ? 'rounded-lg' : ''} ${className}`}
        />
      )}
    </>
  )
}
