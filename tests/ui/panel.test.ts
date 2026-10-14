import { ComponentType, MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { SDMC_THEME } from '../../src/config/theme.js';
import { createPanel, createPanelReply } from '../../src/ui/panel.js';

describe('SDMC Components V2 panel', () => {
  it('uses the official SDMC accent and container structure', () => {
    const panel = createPanel({
      title: 'Test Panel',
      description: 'A test description.',
    }).toJSON();

    expect(panel.type).toBe(ComponentType.Container);
    expect(panel.accent_color).toBe(SDMC_THEME.colors.primary);
    expect(panel.components.length).toBeGreaterThanOrEqual(3);
  });

  it('always sets the Components V2 message flag', () => {
    const reply = createPanelReply({
      title: 'Test Panel',
      description: 'A test description.',
      ephemeral: true,
    });

    expect(Number(reply.flags) & MessageFlags.IsComponentsV2).toBe(MessageFlags.IsComponentsV2);
    expect(Number(reply.flags) & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
  });
});
