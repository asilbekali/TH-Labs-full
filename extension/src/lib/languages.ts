import type { Language } from './messages'

// The codes POST /v1/realtime/session accepts (api/src/realtime/realtime.logic.ts
// CATALOG). Used as the fallback list when GET /v1/languages cannot be reached.
export const LIVE_LANGUAGES: Language[] = [
  ['en', 'English'], ['uz', 'Uzbek'], ['ru', 'Russian'], ['es', 'Spanish'],
  ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ar', 'Arabic'],
  ['fa', 'Persian'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ur', 'Urdu'],
  ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['vi', 'Vietnamese'],
  ['id', 'Indonesian'], ['th', 'Thai'], ['uk', 'Ukrainian'], ['kk', 'Kazakh'],
  ['az', 'Azerbaijani'], ['sv', 'Swedish'], ['cs', 'Czech'], ['el', 'Greek'],
  ['he', 'Hebrew'], ['ro', 'Romanian'], ['hu', 'Hungarian'], ['fi', 'Finnish'],
].map(([code, name]) => ({ code, name }))
