// The page a tool shows to an account whose plan does not include it.
//
// Not a redirect: someone who clicked "Video editor" should see what it is and
// what it would take, not be bounced to a pricing table without a word.
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import Page from './Page'
import { PLAN_LABEL, TOOL_INFO, TOOL_PLAN, type Tool } from '../lib/plan'

export default function UpgradeGate({
  tool,
  points,
  preview,
}: {
  tool: Tool
  /** What the tool does, as short bullet points. */
  points: string[]
  /** An illustration of the tool. */
  preview?: ReactNode
}) {
  const info = TOOL_INFO[tool]
  const plan = PLAN_LABEL[TOOL_PLAN[tool]]
  return (
    <Page className="mx-auto w-full max-w-3xl py-4 sm:py-8">
      <div className="card overflow-hidden">
        {preview && <div className="border-b border-subtle bg-sunken p-4 sm:p-6">{preview}</div>}
        <div className="p-5 sm:p-8">
          <span className="chip px-2.5 py-0.5 text-[11px] text-primary">Included in {plan}</span>
          <h1 className="mt-3 text-[clamp(1.5rem,4vw,2rem)] font-medium leading-tight text-primary">
            {info.name}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-secondary">{info.blurb}</p>
          <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-secondary">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/15 text-brand">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                </span>
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/plans" className="btn-primary focusable inline-flex h-11 items-center px-6 text-sm">
              Upgrade to {plan}
            </Link>
            <span className="text-[13px] text-muted">Your dubs and tokens carry over.</span>
          </div>
        </div>
      </div>
    </Page>
  )
}
