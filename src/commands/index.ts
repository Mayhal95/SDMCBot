import { Collection } from 'discord.js';

import { aboutCommand } from './about.js';
import { churchCommand } from './church.js';
import { memberCommand } from './member.js';
import { pingCommand } from './ping.js';
import { rosterCommand } from './roster.js';
import { treasurerCommand } from './treasurer.js';
import { voteCommand } from './vote.js';
import type { BotCommand } from './types.js';

export const commands = new Collection<string, BotCommand>();

for (const command of [
  aboutCommand,
  churchCommand,
  memberCommand,
  pingCommand,
  rosterCommand,
  treasurerCommand,
  voteCommand,
]) {
  commands.set(command.data.name, command);
}
