import { CreditWallet } from '@prisma/client';

import { CREDIT_PACK_SEED, packWallet } from './credit-packs';

describe('packWallet', () => {
  it('puts realtime_ packs in the real-time wallet', () => {
    expect(packWallet('realtime_10')).toBe(CreditWallet.REALTIME);
    expect(packWallet('realtime_custom')).toBe(CreditWallet.REALTIME);
  });

  it('puts every other pack in the AI-dubbing wallet', () => {
    expect(packWallet('pack_100')).toBe(CreditWallet.DUB);
    expect(packWallet('pack_realtime_10')).toBe(CreditWallet.DUB);
  });
});

describe('real-time packs', () => {
  it('grant exactly the minutes in their name, as seconds', () => {
    for (const minutes of [10, 30, 60]) {
      const pack = CREDIT_PACK_SEED.find(
        (p) => p.slug === `realtime_${minutes}`,
      );
      expect(pack?.credits).toBe(minutes * 60);
    }
  });

  it('cost 35¢ a minute, to the nearest cent', () => {
    for (const minutes of [10, 30, 60]) {
      const pack = CREDIT_PACK_SEED.find(
        (p) => p.slug === `realtime_${minutes}`,
      );
      expect(pack?.priceCents).toBe(Math.round(minutes * 35));
    }
  });
});
