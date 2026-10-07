// What each plan is allowed to do in the Studio. The one table every gate
// reads: can-dub and commit-dub enforce it, GET /payments/plans and
// GET /payments/entitlements report it, and the Studio locks its controls off
// the same answer — so the pricing page, the UI and the charge cannot disagree.
//
// Credits decide HOW MUCH a user can dub. This decides WHAT KIND of dub.
//
//   Free        Turkic target languages, one voice mode, Fast/Balanced.
//   Pro         + every language, every voice mode, a custom reference voice,
//               keeping the background music & effects.
//   Studio Max  + lip sync and Studio quality. Everything.
//
// Enforcement reach. The dubbing pipeline (backend/) calls can-dub and
// commit-dub with the quality only, so `qualities` is enforced on every run no
// matter who calls. The other options are enforced whenever the caller sends
// them — the Studio's preflight always does.
import { PlanTier } from '@prisma/client';

export type Quality = 'fast' | 'balanced' | 'studio';
export type VoiceMode = 'both' | 'speaker' | 'native';

/** What a customer sees. The enum value STUDIO is stored data and stays. */
export const TIER_DISPLAY_NAME: Record<PlanTier, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  STUDIO: 'Studio Max',
};

/**
 * The Turkic languages the Free plan may dub INTO. Twelve, by design; a code
 * only becomes pickable once it is in the language catalog and the pipeline
 * can voice it — today that is uz, tr, kk and az. The rest unlock on their own
 * when they are added, with no change here.
 */
export const TURKIC_LANGUAGES = [
  'uz', // Uzbek
  'tr', // Turkish
  'kk', // Kazakh
  'az', // Azerbaijani
  'ky', // Kyrgyz
  'tk', // Turkmen
  'tt', // Tatar
  'ba', // Bashkir
  'ug', // Uyghur
  'crh', // Crimean Tatar
  'kaa', // Karakalpak
  'sah', // Sakha (Yakut)
];

export interface PlanFeatures {
  /** Qualities this plan may dub at. */
  qualities: Quality[];
  /** Target languages this plan may dub into, or 'all'. */
  targetLanguages: string[] | 'all';
  /** Voice modes this plan may pick (see the Studio's "Voice & mix"). */
  voiceModes: VoiceMode[];
  /** Dub in the voice of an uploaded reference clip. */
  referenceVoice: boolean;
  /** Keep music/ambience under the dub (Demucs separation). */
  keepBackground: boolean;
  /** Reshape the speaker's mouth to the new speech (Wav2Lip). */
  lipSync: boolean;
}

export const PLAN_FEATURES: Record<PlanTier, PlanFeatures> = {
  FREE: {
    qualities: ['fast', 'balanced'],
    targetLanguages: TURKIC_LANGUAGES,
    voiceModes: ['both'],
    referenceVoice: false,
    keepBackground: false,
    lipSync: false,
  },
  PRO: {
    qualities: ['fast', 'balanced'],
    targetLanguages: 'all',
    voiceModes: ['both', 'speaker', 'native'],
    referenceVoice: true,
    keepBackground: true,
    lipSync: false,
  },
  STUDIO: {
    qualities: ['fast', 'balanced', 'studio'],
    targetLanguages: 'all',
    voiceModes: ['both', 'speaker', 'native'],
    referenceVoice: true,
    keepBackground: true,
    lipSync: true,
  },
};

const TIER_ORDER: PlanTier[] = [PlanTier.FREE, PlanTier.PRO, PlanTier.STUDIO];

const FLAG_LABEL = {
  referenceVoice: 'Dubbing in a custom voice',
  keepBackground: 'Keeping the background music & effects',
  lipSync: 'Lip sync',
} as const;

const VOICE_MODE_LABEL: Record<VoiceMode, string> = {
  both: '"Their voice, spoken natively"',
  speaker: '"Their voice exactly"',
  native: '"A native speaker"',
};

export interface RequestedFeatures {
  quality: string;
  targetLang?: string;
  voiceMode?: string;
  /** Older callers send only this; false means the `native` voice mode. */
  voiceClone?: boolean;
  referenceVoice?: boolean;
  keepBackground?: boolean;
  lipSync?: boolean;
}

export interface FeatureRefusal {
  feature: string;
  requiredTier: PlanTier;
  message: string;
}

export function allowsLanguage(features: PlanFeatures, code: string): boolean {
  return (
    features.targetLanguages === 'all' ||
    features.targetLanguages.includes(code.trim().toLowerCase())
  );
}

/** Null when `tier` may run this dub, otherwise the first thing it is missing. */
export function checkFeatures(
  tier: PlanTier,
  req: RequestedFeatures,
): FeatureRefusal | null {
  const allowed = PLAN_FEATURES[tier];
  const refuse = (
    feature: string,
    ok: (f: PlanFeatures) => boolean,
    what: string,
    alternative = 'Upgrade to use it.',
  ): FeatureRefusal => {
    const required =
      TIER_ORDER.find((t) => ok(PLAN_FEATURES[t])) ?? PlanTier.STUDIO;
    return {
      feature,
      requiredTier: required,
      message: `${what} is part of the ${TIER_DISPLAY_NAME[required]} plan. ${alternative}`,
    };
  };

  const quality = req.quality as Quality;
  if (!allowed.qualities.includes(quality)) {
    return refuse(
      `quality:${quality}`,
      (f) => f.qualities.includes(quality),
      `${quality[0].toUpperCase()}${quality.slice(1)} quality`,
      `Upgrade, or pick ${allowed.qualities.join(' or ')}.`,
    );
  }

  if (req.targetLang && !allowsLanguage(allowed, req.targetLang)) {
    const code = req.targetLang.trim().toLowerCase();
    return refuse(
      `language:${code}`,
      (f) => allowsLanguage(f, code),
      `Dubbing into "${code}"`,
      'The Free plan dubs into Turkic languages — upgrade for every language.',
    );
  }

  const mode = (req.voiceMode ??
    (req.voiceClone === false ? 'native' : undefined)) as VoiceMode | undefined;
  if (mode && !allowed.voiceModes.includes(mode)) {
    return refuse(
      `voiceMode:${mode}`,
      (f) => f.voiceModes.includes(mode),
      `The ${VOICE_MODE_LABEL[mode] ?? mode} voice`,
    );
  }

  for (const key of Object.keys(FLAG_LABEL) as (keyof typeof FLAG_LABEL)[]) {
    if (req[key] === true && !allowed[key]) {
      return refuse(key, (f) => f[key], FLAG_LABEL[key]);
    }
  }
  return null;
}
