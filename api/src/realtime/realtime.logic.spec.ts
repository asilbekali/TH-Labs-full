import {
  allowance,
  isUnlimited,
  paidGrant,
  toGoogleLanguage,
  tokenRequestBody,
} from './realtime.logic';

describe('isUnlimited', () => {
  const list = ' Tester@Example.com ,other@example.com,';
  it('matches listed emails regardless of case and spacing', () => {
    expect(isUnlimited('tester@example.com', list)).toBe(true);
    expect(isUnlimited('OTHER@example.com', list)).toBe(true);
  });
  it('matches nobody else, and nothing when the list is empty', () => {
    expect(isUnlimited('someone@example.com', list)).toBe(false);
    expect(isUnlimited(undefined, list)).toBe(false);
    expect(isUnlimited('', list)).toBe(false);
    expect(isUnlimited('tester@example.com', undefined)).toBe(false);
    expect(isUnlimited('tester@example.com', '')).toBe(false);
  });
});

describe('allowance', () => {
  it('grants a full session from an untouched trial', () => {
    expect(allowance(0, 600, 300)).toEqual({
      ok: true,
      remainingSeconds: 600,
      grantSeconds: 300,
    });
  });

  it('grants only what is left of the trial', () => {
    expect(allowance(500, 600, 300)).toEqual({
      ok: true,
      remainingSeconds: 100,
      grantSeconds: 100,
    });
  });

  it('refuses a session too short to be worth starting', () => {
    expect(allowance(580, 600, 300).ok).toBe(false);
  });

  it('refuses once the trial is used up', () => {
    expect(allowance(600, 600, 300)).toEqual({
      ok: false,
      remainingSeconds: 0,
      grantSeconds: 0,
    });
    expect(allowance(1200, 600, 300).remainingSeconds).toBe(0);
  });
});

describe('paidGrant', () => {
  it('takes a minute of the wallet for a minute of dubbing', () => {
    expect(paidGrant(3600, 60)).toEqual({
      ok: true,
      grantSeconds: 60,
      cost: 60,
    });
  });

  it('never grants more than a minute at a time', () => {
    expect(paidGrant(3600, 300).grantSeconds).toBe(60);
  });

  it('grants a short last session, down to 30 seconds', () => {
    expect(paidGrant(45, 60)).toEqual({ ok: true, grantSeconds: 45, cost: 45 });
    expect(paidGrant(30, 60).ok).toBe(true);
  });

  it('refuses under 30 seconds, and bad balances', () => {
    expect(paidGrant(29, 60)).toEqual({ ok: false, grantSeconds: 0, cost: 0 });
    expect(paidGrant(0, 60).ok).toBe(false);
    expect(paidGrant(-5, 60).ok).toBe(false);
    expect(paidGrant(Number.NaN, 60).ok).toBe(false);
  });

  it('spends a 60-minute pack in exactly 60 one-minute sessions', () => {
    let balance = 60 * 60;
    let sessions = 0;
    for (;;) {
      const g = paidGrant(balance, 60);
      if (!g.ok) break;
      balance -= g.cost;
      sessions++;
    }
    expect({ sessions, balance }).toEqual({ sessions: 60, balance: 0 });
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
  const body = tokenRequestBody(now, 'gemini-x', 'uz', 300);

  it('is single-use, short-lived and bounded by the granted seconds', () => {
    expect(body.uses).toBe(1);
    expect(body.newSessionExpireTime).toBe('2026-11-14T10:01:00.000Z');
    expect(body.expireTime).toBe('2026-11-14T10:05:15.000Z');
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
