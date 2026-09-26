// Docs (07).
//
// Three tabs, because they answer three different questions and mixing them is
// how a docs page stops being read:
//
//   Using TH-Labs — what the product does and how a dub actually runs.
//   API           — where the programmatic surface stands. It is NOT ready, so
//                   this tab says so and does not list endpoints. The two
//                   public, stable reads are named because they genuinely are
//                   public and stable; nothing else is.
//   Policy        — the terms that matter, including who is responsible for
//                   what gets dubbed here. That answer is: the person who
//                   uploaded it.
//
// Nothing on this page is generated. If an endpoint is described here it is
// because it is callable today.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Page from '../components/Page'
import { EASE_ENTRANCE } from '../lib/motion'

type TabId = 'product' | 'api' | 'policy'

const TABS: { id: TabId; label: string }[] = [
  { id: 'product', label: 'Using TH-Labs' },
  { id: 'api', label: 'API' },
  { id: 'policy', label: 'Policy' },
]

export default function Docs() {
  const [tab, setTab] = useState<TabId>('product')

  return (
    <Page className="space-y-6">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight text-primary">Docs</h1>
        <p className="mt-1.5 text-[15px] text-secondary">
          How TH-Labs works, where the API stands, and the rules you agree to by dubbing
          here.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1 border-b border-subtle pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
            className="seg focusable"
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: EASE_ENTRANCE }}
        >
          {tab === 'product' && <ProductDocs />}
          {tab === 'api' && <ApiDocs />}
          {tab === 'policy' && <PolicyDocs />}
        </motion.div>
      </AnimatePresence>
    </Page>
  )
}

/* ── Using TH-Labs ──────────────────────────────────────────────────────── */

function ProductDocs() {
  return (
    <div className="space-y-6">
      <Article title="What TH-Labs does">
        <p>
          TH-Labs re-voices a video or an audio file in another language while keeping the
          original speaker's voice. It is not a subtitle tool and it is not a
          text-to-speech reader: the output is the same person, saying the same thing, in
          a language they did not record.
        </p>
        <p>
          The product leads with the Turkic family — Uzbek, Turkish, Kazakh, Azerbaijani —
          which is why those languages are grouped first on the dashboard. Everything else
          the catalog returns works the same way.
        </p>
      </Article>

      <Article title="How a dub runs">
        <p>
          Every dub goes through five stages, and the dashboard's Pipeline section shows
          which engine is loaded for each one right now:
        </p>
        <ol className="ml-5 list-decimal space-y-1.5">
          <li>
            <Term>Transcribe</Term> — the source audio becomes timed text.
          </li>
          <li>
            <Term>Translate</Term> — that text becomes the target language.
          </li>
          <li>
            <Term>Voice</Term> — the translation is spoken back in the original speaker's
            voice.
          </li>
          <li>
            <Term>Align</Term> — the new audio is fitted to the original timing.
          </li>
          <li>
            <Term>Mux</Term> — audio and video are recombined into the file you download.
          </li>
        </ol>
        <p>
          A stage marked <Term>sim</Term> rather than <Term>live</Term> means no model is
          loaded for it on this deployment and that step is being simulated. The Studio
          says so on the run card before you spend anything.
        </p>
      </Article>

      <Article title="Sources, credits and quality">
        <p>
          A dub starts from an uploaded file or a public video link — the server fetches
          the link itself, so it has to be reachable without a login. One source per run:
          picking a file drops a pasted link and the other way round.
        </p>
        <p>
          Quality is <Term>Fast</Term>, <Term>Balanced</Term> or <Term>Studio</Term>, and
          it sets the credit cost per minute. The Studio prices the run before you start
          it and will not begin one your balance cannot cover. Finished dubs are kept
          under <Link className="underline decoration-subtle underline-offset-4 hover:decoration-strong" to="/works">My works</Link>.
        </p>
      </Article>
    </div>
  )
}

/* ── API ────────────────────────────────────────────────────────────────── */

function ApiDocs() {
  return (
    <div className="space-y-6">
      <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-4">
        <span className="icon-tile grid h-10 w-10 shrink-0 bg-warn/12 text-warn">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v5M12 16.5h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </span>
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-secondary">
          <span className="font-medium text-primary">The dubbing API is not open yet.</span>{' '}
          There are no API keys, no per-key quotas, and no promise that the job payload
          looks the same after our next deploy. Please don't build an integration against
          what you can observe in the browser — it will break.
        </p>
        <Link to="/developers" className="btn-primary focusable shrink-0 px-4 py-2.5 text-sm">
          Get notified
        </Link>
      </div>

      <Article title="What is public today">
        <p>
          Two reads are public, stable, and safe to call without credentials. They are the
          only two.
        </p>
        <ul className="space-y-2.5">
          <li className="card p-4">
            <code className="font-code text-sm text-primary">GET /v1/languages</code>
            <p className="mt-1.5 text-sm text-secondary">
              The target-language catalog — the same list the Studio's picker reads. Each
              entry carries a code, an English name, a native name and a flag.
            </p>
          </li>
          <li className="card p-4">
            <code className="font-code text-sm text-primary">GET /v1/health</code>
            <p className="mt-1.5 text-sm text-secondary">
              Whether the pipeline is reachable and which of the five stages have a real
              engine loaded. Worth polling before you queue work; it is what the
              dashboard's Pipeline section renders.
            </p>
          </li>
        </ul>
      </Article>

      <Article title="What is not">
        <p>
          Everything under <code className="font-code text-primary">/v1/payments</code>,{' '}
          <code className="font-code text-primary">/v1/feedback</code> and{' '}
          <code className="font-code text-primary">/api/jobs</code> requires a browser
          session. They are the app talking to itself, not a machine API, and they change
          without notice.
        </p>
        <p>
          The full Swagger reference at <code className="font-code text-primary">/docs</code>{' '}
          on the API host is an internal development aid. It documents what exists today,
          not what we are committing to.
        </p>
      </Article>

      <Article title="When it opens">
        <p>Three things have to land first, and none of them is cosmetic:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <Term>API keys</Term> — machine credentials you can scope and rotate. Today
            every call is authenticated with a short-lived token minted for a browser.
          </li>
          <li>
            <Term>Quotas</Term> — a dub occupies a GPU for minutes. Until per-key limits
            exist, one script could take the pipeline down for everyone.
          </li>
          <li>
            <Term>A frozen payload</Term> — we will not ask anyone to build on a response
            shape that is still moving.
          </li>
        </ul>
      </Article>
    </div>
  )
}

/* ── Policy ─────────────────────────────────────────────────────────────── */

function PolicyDocs() {
  return (
    <div className="space-y-6">
      {/* The disclaimer is the first thing on the tab and it is the loudest
          thing on the page, because it is the one term that changes what
          someone should do before they upload rather than after. */}
      <section className="rounded-[var(--radius-card)] border border-warn/35 bg-warn/[0.07] p-5">
        <div className="flex items-start gap-3">
          <span className="icon-tile mt-0.5 grid h-8 w-8 shrink-0 bg-warn/15 text-warn">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4.5M12 17h.01M10.3 4.3 3.4 16a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-[1.05rem] font-semibold tracking-tight text-primary">
              You are responsible for what you dub
            </h2>
            <div className="mt-2.5 space-y-2.5 text-sm leading-relaxed text-secondary">
              <p>
                <span className="font-medium text-primary">
                  TH-Labs is not responsible for any video, podcast, recording or other
                  material dubbed through this service.
                </span>{' '}
                Responsibility rests entirely with the account that submitted it.
              </p>
              <p>
                By uploading a file or pasting a link you confirm that you own the
                material or have the rights to use it, including the right to reproduce
                the voice of every person heard in it. TH-Labs does not verify this and
                cannot.
              </p>
              <p>
                You are responsible for how the result is used and published, and for any
                claim that follows from it — copyright, likeness and voice rights,
                defamation, impersonation, or local law wherever you publish.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Article title="What you must not dub here">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Anyone's voice used to impersonate them — to deceive, to defraud, or to put
            words in their mouth they did not say.
          </li>
          <li>Material you do not hold the rights to.</li>
          <li>
            Content that is illegal where you are or where you publish it, including
            sexual material involving minors and incitement to violence.
          </li>
          <li>
            Election, medical or financial claims presented as coming from a real person
            who never made them.
          </li>
        </ul>
        <p>
          Accounts used for any of the above are closed, and remaining credits are not
          refunded.
        </p>
      </Article>

      <Article title="Your files">
        <p>
          Source files and finished dubs are stored so you can download them from{' '}
          <Link className="underline decoration-subtle underline-offset-4 hover:decoration-strong" to="/works">My works</Link>. They belong to you. We use
          them to run and debug your dub and for nothing else — they are not training
          data, and they are not shown to anyone outside the team.
        </p>
        <p>
          Deleting a dub removes it from your library. Ask us and we will delete the
          underlying files too.
        </p>
      </Article>

      <Article title="Credits and billing">
        <p>
          Credits are consumed per minute of source material at the quality you choose,
          and the price is shown before a run starts. A run that fails on our side is not
          charged.
        </p>
        <p>
          Plans renew until cancelled; cancelling stops the next renewal and leaves the
          current period intact. Granted credits do not convert to money and are not
          refundable once spent.
        </p>
      </Article>

      <Article title="No warranty">
        <p>
          The service is provided as it is. Machine transcription, translation and voice
          synthesis all make mistakes, and a dub can be wrong in ways that matter — a
          mistranslated number, a changed meaning, a voice that lands oddly. Check the
          output before you publish it. TH-Labs is not liable for any loss arising from
          using a dub.
        </p>
      </Article>

      <p className="text-sm text-muted">
        Questions about any of this: send them through the Feedback button in the top bar,
        or from the box at the bottom of the{' '}
        <Link className="underline decoration-subtle underline-offset-4 hover:decoration-strong" to="/">dashboard</Link>.
      </p>
    </div>
  )
}

/* ── Blocks ─────────────────────────────────────────────────────────────── */

function Article({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[1.05rem] font-semibold tracking-tight text-primary">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-secondary">{children}</div>
    </section>
  )
}

function Term({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-primary">{children}</span>
}
