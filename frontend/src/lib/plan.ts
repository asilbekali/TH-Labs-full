// What each plan shows in the Studio, in one place.
//
// The account API's plan table (api/src/payment/plan-features.ts) decides what
// a DUB may use — languages, qualities, voice modes. The tools that are not
// dubs at all are decided by the Studio's own API (backend/app/billing.py,
// require_tier), against the same tier:
//
//   Free        Dubbing · Text to speech
//   Pro         + Subtitles+ (subtitles burned in, plus .srt)
//   Studio Max  + Speech editor (fix a line, re-dub only that section)
//               + Video editor (voice an animation: speech, music, timeline)
//
// The server enforces all of it; this only decides what to show and lock.
import { useWallet, type PlanId } from './wallet'

export type Tool = 'dubbing' | 'tts' | 'subtitles' | 'speechEditor' | 'videoEditor' | 'realtime'

const ORDER: PlanId[] = ['free', 'pro', 'studio']

/** The cheapest plan that includes each tool. */
export const TOOL_PLAN: Record<Tool, PlanId> = {
  dubbing: 'free',
  tts: 'free',
  // Real-time dubbing is for everyone and paid in tokens, like a dub.
  realtime: 'free',
  subtitles: 'pro',
  speechEditor: 'studio',
  videoEditor: 'studio',
}

export const PLAN_LABEL: Record<PlanId, string> = { free: 'Free', pro: 'Pro', studio: 'Max' }

export const TOOL_INFO: Record<Tool, { name: string; blurb: string }> = {
  dubbing: { name: 'AI dubbing', blurb: 'Translate a video into 30+ languages in the speaker’s voice.' },
  tts: { name: 'Text to speech', blurb: 'Turn a script into natural speech.' },
  subtitles: { name: 'Subtitles+', blurb: 'Subtitles burned into the dub, plus an .srt file.' },
  speechEditor: {
    name: 'Speech editor',
    blurb: 'Fix a wrong word and re-dub only that line — not the whole video.',
  },
  videoEditor: {
    name: 'AI Voiceover',
    blurb: 'Voice an animation: type lines, cut and place speech, add music.',
  },
  realtime: { name: 'Real-time dubbing', blurb: 'Live translation of a stream or call.' },
}

export function planIncludes(plan: PlanId, tool: Tool): boolean {
  return ORDER.indexOf(plan) >= ORDER.indexOf(TOOL_PLAN[tool])
}

/** The signed-in account's plan and what it unlocks. */
export function usePlan() {
  const { plan, planInfo, loading } = useWallet()
  return {
    plan,
    name: planInfo.name,
    loading,
    has: (tool: Tool) => planIncludes(plan, tool),
    isMax: plan === 'studio',
  }
}
