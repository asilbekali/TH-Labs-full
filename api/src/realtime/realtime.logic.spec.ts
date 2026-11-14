import {
  allowance,
  toGoogleLanguage,
  tokenRequestBody,
  utcDayStart,
} from './realtime.logic';

describe('allowance', () => {
  it('grants a full session on a fresh day', () => {
    expect(allowance(0, 900, 300)).toEqual({
      ok: true,
      remainingSeconds: 900,
      grantSeconds: 300,
    });
  });

  it('grants only what is left of the day', () => {
    expect(allowance(800, 900, 300)).toEqual({
      ok: true,
      remainingSeconds: 100,
      grantSeconds: 100,
    });
  });

  it('refuses a session too short to be worth starting', () => {
    expect(allowance(880, 900, 300).ok).toBe(false);
  });

  it('refuses once the day is used up', () => {
    expect(allowance(900, 900, 300)).toEqual({
      ok: false,
      remainingSeconds: 0,
      grantSeconds: 0,
    });
    expect(allowance(1200, 900, 300).remainingSeconds).toBe(0);
  });
});

describe('utcDayStart', () => {
  it('is midnight UTC of the instant’s UTC day', () => {
    expect(utcDayStart(new Date('2026-11-14T23:30:00+05:00')).toISOString()).toBe(
      '2026-11-14T00:00:00.000Z',
    );
    expect(utcDayStart(new Date('2026-11-15T02:00:00+05:00')).toISOString()).toBe(
      '2026-11-14T00:00:00.000Z',
    );
  });
});

describe('toGoogleLanguage', () => {
  it('passes through codes Google shares with the app', () => {
    expect(toGoogleLanguage('uz')).toBe('uz');
    expect(toGoogleLanguage('ru')).toBe('ru');
  });

  it('maps codes Google spells differently', () => {
    expect(toGoogleLanguage('zh')).toBe('zh-Hans');
    expect(toGoogleLanguage('pt')).toBe('pt-BR');
  });

  it('refuses codes outside the catalog', () => {
    expect(toGoogleLanguage('xx')).toBeNull();
    expect(toGoogleLanguage('')).toBeNull();
  });
});

describe('tokenRequestBody', () => {
  const now = new Date('2026-11-14T10:00:00.000Z');
  const body = tokenRequestBody(now, 'gemini-x', 'uz', 300) as any;

  it('is single-use, short-lived and bounded by the granted seconds', () => {
    expect(body.uses).toBe(1);
    expect(body.newSessionExpireTime).toBe('2026-11-14T10:01:00.000Z');
    expect(body.expireTime).toBe('2026-11-14T10:05:30.000Z');
  });

  it('locks the model, target language and transcriptions', () => {
    expect(body.bidiGenerateContentSetup).toEqual({
      model: 'models/gemini-x',
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: { targetLanguageCode: 'uz' },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    });
  });
});
