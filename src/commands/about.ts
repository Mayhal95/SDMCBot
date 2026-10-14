import { resolve } from 'node:path';

import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';

import { SDMC_THEME } from '../config/theme.js';
import { createPanelReply } from '../ui/panel.js';
import type { BotCommand } from './types.js';

const logoPath = resolve(process.cwd(), 'assets', 'branding', 'sdmc-logo.png');

export const aboutCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('Learn about the Sacred Disciples MC bot.'),

  async execute(interaction) {
    const reply = createPanelReply({
      title: SDMC_THEME.name,
      description:
        'Official club operations bot for Sacred Disciples Motorcycle Club in NoKey FiveM.',
      details: [
        'Built around a consistent, modern Components V2 interface.',
        'More club operations and member tools are coming next.',
      ],
      thumbnailUrl: `attachment://${SDMC_THEME.logoAttachmentName}`,
    });

    await interaction.reply({
      ...reply,
      files: [new AttachmentBuilder(logoPath).setName(SDMC_THEME.logoAttachmentName)],
    });
  },
};
