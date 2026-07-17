import { useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  motion,
  useScroll,
  useTransform,
  useMotionTemplate,
  useMotionValueEvent,
  useReducedMotion,
  type MotionValue,
} from 'framer-motion'
import VoiceShowcase from './VoiceShowcase'

const chips = ['Voice preserved', 'Background kept', '30+ languages', 'Optional lip sync']

// A staggered fade-up bound to a scroll window [a, b]. Under reduced motion it
// resolves to the final state immediately.
function useFade(p: MotionValue<number>, a: number, b: number, reduce: boolean) {
  const opacity = useTransform(p, [a, b], [reduce ? 1 : 0, 1])
  const y = useTransform(p, [a, b], [reduce ? 0 : 20, 0])
  return { opacity, y }
}

export default function ScrollHero() {
  const reduce = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  // Progress runs 0 → 1 across the section's 100vh of pinned scroll.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })

  // Headline: begins large and floated toward centre, settles into place.
  const titleY = useTransform(scrollYProgress, [0, 0.4], [reduce ? '0vh' : '18vh', '0vh'])
  const titleScale = useTransform(scrollYProgress, [0, 0.4], [reduce ? 1 : 1.14, 1])

  const eyebrow = useFade(scrollYProgress, 0.02, 0.16, reduce)
  const sub = useFade(scrollYProgress, 0.22, 0.4, reduce)
  const btns = useFade(scrollYProgress, 0.32, 0.5, reduce)
  const chipRow = useFade(scrollYProgress, 0.44, 0.6, reduce)

  // Showcase panel: fades + scales up, then a top-down wipe "draws" it in.
  const panelOpacity = useTransform(scrollYProgress, [0.42, 0.7], [reduce ? 1 : 0, 1])
  const panelScale = useTransform(scrollYProgress, [0.42, 0.7], [reduce ? 1 : 0.92, 1])
  const panelY = useTransform(scrollYProgress, [0.42, 0.7], [reduce ? 0 : 50, 0])
  const wipe = useTransform(scrollYProgress, [0.5, 0.82], [reduce ? 0 : 100, 0])
  const panelClip = useMotionTemplate`inset(0 0 ${wipe}% 0 round 1.25rem)`

  const hintOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0])

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    ;(window as unknown as Record<string, unknown>).__hero = {
      p: +v.toFixed(3),
      panelOp: +panelOpacity.get().toFixed(3),
      subOp: +sub.opacity.get().toFixed(3),
      wipe: +wipe.get().toFixed(1),
    }
  })

  return (
    <section ref={ref} className={reduce ? 'wrap pt-16 pb-12' : 'relative h-[200vh]'}>
      <div
        className={
          reduce ? '' : 'sticky top-0 flex h-[100svh] items-center overflow-hidden'
        }
      >
        <div className={reduce ? '' : 'wrap w-full'}>
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <motion.div
              style={{ opacity: eyebrow.opacity, y: eyebrow.y }}
              className="chip inline-flex items-center gap-2 px-3 py-1.5 text-xs text-white/70"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
              Cascaded ASR → NMT → TTS · voice preservation
            </motion.div>

            <motion.h1
              style={{ y: titleY, scale: titleScale }}
              className="mt-5 text-4xl font-bold leading-[1.04] tracking-tight sm:text-6xl"
            >
              Dub any video.
              <br />
              Keep the <span className="gradient-text">original voice.</span>
            </motion.h1>

            <motion.p
              style={{ opacity: sub.opacity, y: sub.y }}
              className="mt-5 max-w-xl text-lg leading-relaxed text-white/60"
            >
              TH-Labs translates spoken video into 30+ languages while preserving
              the speaker’s own voice, the original background, and the timing of
              the performance — with optional lip sync.
            </motion.p>

            <motion.div
              style={{ opacity: btns.opacity, y: btns.y }}
              className="mt-7 flex flex-wrap items-center justify-center gap-3"
            >
              <Link to="/studio" className="btn-primary px-7 py-3.5 text-sm">
                Try the Studio →
              </Link>
              <Link to="/research" className="btn-ghost px-6 py-3.5 text-sm">
                Read the research
              </Link>
            </motion.div>

            <motion.div
              style={{ opacity: chipRow.opacity, y: chipRow.y }}
              className="mt-6 flex flex-wrap justify-center gap-2"
            >
              {chips.map((c) => (
                <span key={c} className="chip px-3 py-1.5 text-xs text-white/60">
                  {c}
                </span>
              ))}
            </motion.div>

            <motion.div
              style={{
                opacity: panelOpacity,
                scale: panelScale,
                y: panelY,
                clipPath: panelClip,
                WebkitClipPath: panelClip,
              }}
              className="relative mt-9 w-full max-w-2xl"
            >
              <VoiceShowcase />
              <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-violet-600/20 blur-3xl" />
            </motion.div>
          </div>
        </div>

        {!reduce && (
          <motion.div
            style={{ opacity: hintOpacity }}
            className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-1.5 text-white/40"
          >
            <span className="text-[10px] uppercase tracking-[0.24em]">Scroll</span>
            <motion.svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </motion.svg>
          </motion.div>
        )}
      </div>
    </section>
  )
}
