import { SlashCommandBuilder } from 'discord.js';

import { createPanelReply } from '../ui/panel.js';
import type { BotCommand } from './types.js';

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot and Discord connection status.'),

  async execute(interaction) {
    const roundTrip = Date.now() - interaction.createdTimestamp;
    const websocket = interaction.client.ws.ping;

    await interaction.reply(
      createPanelReply({
        title: 'Systems Online',
        description: 'The SDMC bot is connected and responding normally.',
        details: [`Response time: **${roundTrip} ms**`, `Discord gateway: **${websocket} ms**`],
        ephemeral: true,
        tone: 'success',
      }),
    );
  },
};
