// Mock library of finished/in-progress dubs for the "My works" page (03).
// Purely client-side sample content — no network or media requests. Thumbnails
// are deterministic CSS gradients derived from each id (gradientFor, reused
// from the templates mock so the whole app stays on one palette).
//
// createdAt values are generated relative to *now* at module load, not baked in,
// so the date-range filters (Last 7 days / 30 days / This year) always have a
// realistic spread no matter what the wall clock reads when the app runs.

export { gradientFor } from './templates'

export type WorkStatus = 'completed' | 'processing' | 'failed'

export interface WorkItem {
  id: string
  title: string
  sourceFile: string
  sourceLang: string
  targetLang: string
  duration: number // seconds
  createdAt: string // ISO
  status: WorkStatus
  progress?: number // 0–1, processing only
  stage?: string // processing only
  error?: string // failed only
  creditsSpent: number
  settings: { voiceClone: boolean; lipSync: boolean; keepBackground: boolean; quality: string }
}

// A finished-dub timestamp `days` (and `hours`) before now, as ISO.
const ago = (days: number, hours = 0): string =>
  new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString()

export const WORKS: WorkItem[] = [
  {
    id: 'wk-product-demo',
    title: 'Product demo walkthrough',
    sourceFile: 'product-demo-final.mp4',
    sourceLang: 'en',
    targetLang: 'es',
    duration: 134,
    createdAt: ago(1, 5),
    status: 'completed',
    creditsSpent: 10,
    settings: { voiceClone: true, lipSync: false, keepBackground: true, quality: 'balanced' },
  },
  {
    id: 'wk-design-podcast',
    title: 'Design Matters — ep. 47',
    sourceFile: 'design-matters-47.wav',
    sourceLang: 'en',
    targetLang: 'es',
    duration: 623,
    createdAt: ago(2, 3),
    status: 'completed',
    creditsSpent: 20,
    settings: { voiceClone: true, lipSync: false, keepBackground: true, quality: 'studio' },
  },
  {
    id: 'wk-algebra-lesson',
    title: 'Algebra basics · lesson 5',
    sourceFile: 'algebra-05.mp4',
    sourceLang: 'en',
    targetLang: 'uz',
    duration: 347,
    createdAt: ago(6, 8),
    status: 'completed',
    creditsSpent: 10,
    settings: { voiceClone: true, lipSync: true, keepBackground: false, quality: 'balanced' },
  },
  {
    id: 'wk-founder-interview',
    title: 'Founder interview · Q3',
    sourceFile: 'founder-q3-raw.mov',
    sourceLang: 'ru',
    targetLang: 'en',
    duration: 200,
    createdAt: ago(0, 1),
    status: 'processing',
    progress: 0.48,
    stage: 'Cloning voice',
    creditsSpent: 20,
    settings: { voiceClone: true, lipSync: true, keepBackground: true, quality: 'studio' },
  },
  {
    id: 'wk-summer-sale',
    title: 'Summer sale spot',
    sourceFile: 'summer-sale-30s.mp4',
    sourceLang: 'en',
    targetLang: 'es',
    duration: 47,
    createdAt: ago(14, 2),
    status: 'failed',
    error: 'Source audio too noisy to separate cleanly — try disabling background preservation.',
    creditsSpent: 5,
    settings: { voiceClone: false, lipSync: false, keepBackground: true, quality: 'fast' },
  },
  {
    id: 'wk-watercolor-tut',
    title: 'Watercolor tutorial',
    sourceFile: 'watercolor-basics.mp4',
    sourceLang: 'es',
    targetLang: 'en',
    duration: 432,
    createdAt: ago(19, 6),
    status: 'completed',
    creditsSpent: 10,
    settings: { voiceClone: true, lipSync: false, keepBackground: true, quality: 'balanced' },
  },
  {
    id: 'wk-annual-keynote',
    title: 'Annual keynote 2026',
    sourceFile: 'keynote-2026-stage.mp4',
    sourceLang: 'en',
    targetLang: 'es',
    duration: 725,
    createdAt: ago(54, 4),
    status: 'completed',
    creditsSpent: 20,
    settings: { voiceClone: true, lipSync: true, keepBackground: true, quality: 'studio' },
  },
  {
    id: 'wk-tashkent-vlog',
    title: 'Tashkent travel vlog',
    sourceFile: 'tashkent-vlog-cut.mp4',
    sourceLang: 'uz',
    targetLang: 'ru',
    duration: 278,
    createdAt: ago(170, 3),
    status: 'completed',
    creditsSpent: 10,
    settings: { voiceClone: true, lipSync: false, keepBackground: false, quality: 'balanced' },
  },
]
