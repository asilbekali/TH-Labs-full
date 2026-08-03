// Mock template gallery + resumable-job data for the Home launchpad (01).
// Purely client-side sample content — no external image or network requests.
// Thumbnails are deterministic CSS gradients derived from each id (see
// gradientFor), so the same template always renders the same artwork.

export type TemplateCategory =
  | 'Podcast'
  | 'Course'
  | 'Shorts'
  | 'Interview'
  | 'Ad'
  | 'Livestream'

export interface Template {
  id: string
  title: string
  category: TemplateCategory
  sourceLang: string
  targetLang: string
  duration: number // seconds
  tags: string[]
}

// 12 templates — two per category, realistic titles, durations 0:31 → 12:34.
export const TEMPLATES: Template[] = [
  { id: 'pod-tech-weekly', title: 'Tech Weekly roundtable', category: 'Podcast', sourceLang: 'en', targetLang: 'es', duration: 754, tags: ['multi-speaker', 'dialogue'] },
  { id: 'pod-mindful-mornings', title: 'Mindful mornings, ep. 12', category: 'Podcast', sourceLang: 'en', targetLang: 'de', duration: 623, tags: ['narration', 'calm'] },
  { id: 'course-intro-ml', title: 'Intro to machine learning', category: 'Course', sourceLang: 'en', targetLang: 'fr', duration: 512, tags: ['lecture', 'technical'] },
  { id: 'course-watercolor-3', title: 'Watercolor basics, lesson 3', category: 'Course', sourceLang: 'en', targetLang: 'pt', duration: 388, tags: ['tutorial', 'creative'] },
  { id: 'short-launch-teaser', title: 'Product launch teaser', category: 'Shorts', sourceLang: 'en', targetLang: 'ja', duration: 31, tags: ['vertical', 'hook'] },
  { id: 'short-60s-recipe', title: 'Recipe in 60 seconds', category: 'Shorts', sourceLang: 'en', targetLang: 'ko', duration: 58, tags: ['vertical', 'food'] },
  { id: 'itw-founder-fireside', title: 'Founder fireside chat', category: 'Interview', sourceLang: 'en', targetLang: 'es', duration: 428, tags: ['dialogue', 'business'] },
  { id: 'itw-athlete-postmatch', title: 'Athlete post-match', category: 'Interview', sourceLang: 'it', targetLang: 'en', duration: 176, tags: ['single-speaker', 'sport'] },
  { id: 'ad-saas-explainer', title: 'SaaS explainer spot', category: 'Ad', sourceLang: 'en', targetLang: 'de', duration: 47, tags: ['voiceover', 'promo'] },
  { id: 'ad-holiday-sale', title: 'Holiday sale promo', category: 'Ad', sourceLang: 'en', targetLang: 'fr', duration: 63, tags: ['voiceover', 'retail'] },
  { id: 'live-charity-stream', title: 'Charity gaming stream', category: 'Livestream', sourceLang: 'ru', targetLang: 'en', duration: 734, tags: ['live', 'gaming'] },
  { id: 'live-community-qa', title: 'Community live Q&A', category: 'Livestream', sourceLang: 'en', targetLang: 'zh', duration: 605, tags: ['live', 'q&a'] },
]

export interface ResumableJob {
  id: string
  title: string
  sourceLang: string
  targetLang: string
  stageLabel: string
  progress: number // 0..1
}

// In-progress dubs the user can resume. In production this would come from live
// job state; here it's a small sample so the "Continue" row is demonstrable.
export const RESUMABLE: ResumableJob[] = [
  { id: 'job-news-recap', title: 'Weekly news recap', sourceLang: 'en', targetLang: 'es', stageLabel: 'Cloning voice', progress: 0.62 },
  { id: 'job-course-mod4', title: 'Course module 4', sourceLang: 'en', targetLang: 'fr', stageLabel: 'Translating', progress: 0.34 },
]

const CATEGORIES: TemplateCategory[] = ['Podcast', 'Course', 'Shorts', 'Interview', 'Ad', 'Livestream']
export const TEMPLATE_FILTERS = ['All', ...CATEGORIES] as const

// Brand-family hues (violet → indigo → magenta → blue → cyan) so every
// generated thumbnail stays on-palette.
const HUES = [258, 272, 292, 235, 200, 189]

function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Deterministic two-stop gradient for a template/job id. `background-size` is
// set to 200% by the consumer so the angle/position can animate on hover.
export function gradientFor(id: string): string {
  const h = hash(id)
  const a = HUES[h % HUES.length]
  const b = HUES[(h >>> 5) % HUES.length]
  const angle = 115 + (h % 90)
  const hueB = a === b ? (b + 40) % 360 : b
  return `linear-gradient(${angle}deg, hsl(${a} 72% 60%), hsl(${hueB} 70% 44%))`
}
