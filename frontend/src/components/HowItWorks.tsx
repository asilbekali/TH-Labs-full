// "How it works" in three steps, for the tools a customer opens for the first
// time. Numbered, short, and each step may carry the action that does it, so
// the explanation is also the way in.
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { SQUARED } from '../lib/shape'

export interface Step {
  title: string
  body: string
  /** Optional button or link that does this step. */
  action?: ReactNode
}

const list = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 320, damping: 30 } },
}

export default function HowItWorks({
  steps,
  title = 'How it works',
  className = '',
}: {
  steps: Step[]
  title?: string
  className?: string
}) {
  return (
    <section aria-label={title} className={className} style={SQUARED}>
      <p className="eyebrow mb-2.5">{title}</p>
      <motion.ol
        variants={list}
        initial="hidden"
        animate="show"
        className="grid gap-2.5 sm:grid-cols-3"
      >
        {steps.map((s, i) => (
          <motion.li
            key={s.title}
            variants={item}
            className="flex flex-col gap-1.5 rounded-[14px] border border-subtle bg-raised p-4"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-brand/12 font-mono text-[13px] font-semibold text-brand">
                {i + 1}
              </span>
              <p className="text-sm font-medium text-primary">{s.title}</p>
            </div>
            <p className="text-[13px] leading-relaxed text-secondary">{s.body}</p>
            {s.action && <div className="mt-auto pt-1.5">{s.action}</div>}
          </motion.li>
        ))}
      </motion.ol>
    </section>
  )
}
