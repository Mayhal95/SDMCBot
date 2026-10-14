import type { BaseInteraction } from 'discord.js';

import { env } from '../config/env.js';

export function hasFounderRole(interaction: BaseInteraction): boolean {
  if (!interaction.inGuild() || !interaction.member) return false;

  const roles = interaction.member.roles;
  return Array.isArray(roles)
    ? roles.includes(env.SDMC_FOUNDER_ROLE_ID)
    : roles.cache.has(env.SDMC_FOUNDER_ROLE_ID);
}
