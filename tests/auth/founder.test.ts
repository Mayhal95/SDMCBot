import { describe, expect, it } from 'vitest';

import { hasFounderRole } from '../../src/auth/founder.js';
import { env } from '../../src/config/env.js';

describe('Founder role authorization', () => {
  it('accepts the Founder role from a raw Discord interaction member', () => {
    const interaction = {
      inGuild: () => true,
      member: { roles: [env.SDMC_FOUNDER_ROLE_ID] },
    };

    expect(hasFounderRole(interaction as never)).toBe(true);
  });

  it('accepts the Founder role from a cached guild member', () => {
    const interaction = {
      inGuild: () => true,
      member: { roles: { cache: new Map([[env.SDMC_FOUNDER_ROLE_ID, {}]]) } },
    };

    expect(hasFounderRole(interaction as never)).toBe(true);
  });

  it('rejects members without the Founder role', () => {
    const interaction = {
      inGuild: () => true,
      member: { roles: [] },
    };

    expect(hasFounderRole(interaction as never)).toBe(false);
  });
});
