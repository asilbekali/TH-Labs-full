// The dub as a chain, left to right.
//
// It is the same component idle and live, which is the point: before a run it
// shows the route the clip is about to take — including the stages your options
// have switched off — and during the run the identical chain fills in. Nothing
// re-arranges when you press start, so there is no moment of "where did my
// diagram go?".
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

export type FlowState = 'idle' | 'running' | 'done' | 'failed' | 'skipped'

export interface FlowNode {
  key: string
  label: string
  sub?: string
  state: FlowState
}

// Keyed by pipeline stage key, so the idle preview and the live job draw the
// same glyph for the same stage.
const ICONS: Record<string, ReactNode> = {
  asr: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />,
  nmt: <path d="M4 5h7M7 4v1c0 4-2 7-4 8m1-4c1 3 3 5 5 6M13 20l4-9 4 9M14.5 17h5" />,
  tts: <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />,
  lipsync: <path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />,
  separation: (
    <path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
  ),
  sync: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
}

const TONE: Record<FlowState, { tile: string; label: string }> = {
  idle: { tile: 'border-subtle bg-sunken text-muted', label: 'text-muted' },
  running: { tile: 'border-brand/50 bg-brand/12 text-brand', label: 'text-brand' },
  done: { tile: 'border-success/40 bg-success/12 text-success', label: 'text-primary' },
  failed: { tile: 'border-danger/50 bg-danger/12 text-danger', label: 'text-danger' },
  skipped: {
    tile: 'border-dashed border-subtle bg-transparent text-muted opacity-55',
    label: 'text-muted opacity-55',
  },
}

export default function PipelineFlow({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div className="no-scrollbar -mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex min-w-max items-start justify-center">
        {nodes.map((n, i) => (
          <Fragment key={n.key}>
            {i > 0 && <Connector from={nodes[i - 1]} to={n} />}
            <Node node={n} />
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function Node({ node }: { node: FlowNode }) {
  const tone = TONE[node.state]
  return (
    <div className="flex w-[74px] shrink-0 flex-col items-center text-center">
      <div className="relative grid h-12 w-12 place-items-center">
        {node.state === 'running' && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-control border border-brand/60"
            animate={{ scale: [1, 1.18, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <motion.span
          className={`grid h-12 w-12 place-items-center rounded-control border transition-colors duration-300 ${tone.tile}`}
          animate={node.state === 'running' ? { scale: [1, 1.05, 1] } : { scale: 1 }}
          transition={
            node.state === 'running'
              ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.2 }
          }
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICONS[node.key] ?? <circle cx="12" cy="12" r="4" />}
          </svg>
        </motion.span>
        {node.state === 'done' && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 24 }}
            className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-success text-white"
          >
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </motion.span>
        )}
      </div>
      <div className={`mt-2 font-mono text-[10px] font-medium leading-tight ${tone.label}`}>
        {node.label}
      </div>
      {node.sub && (
        <div className="mt-0.5 text-[10px] leading-tight text-muted opacity-80">{node.sub}</div>
      )}
    </div>
  )
}

/** The rail between two stages — filled once the left one is behind us. */
function Connector({ from, to }: { from: FlowNode; to: FlowNode }) {
  const filled = from.state === 'done' || from.state === 'skipped'
  const live = to.state === 'running'
  return (
    <div className="relative mt-6 h-[2px] w-8 shrink-0 overflow-hidden rounded-full bg-subtle sm:w-10">
      <motion.div
        initial={false}
        animate={{ scaleX: filled ? 1 : 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ originX: 0 }}
        className={`absolute inset-0 rounded-full ${from.state === 'skipped' ? 'bg-strong' : 'bg-success/70'}`}
      />
      {live && (
        <motion.div
          aria-hidden
          className="absolute inset-y-0 w-1/3 rounded-full bg-brand"
          animate={{ x: ['-120%', '340%'] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  )
}
