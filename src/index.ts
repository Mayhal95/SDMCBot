import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';

import { hasFounderRole } from './auth/founder.js';
import {
  handleChurchButton,
  handleChurchModal,
  handleChurchUserSelect,
  isChurchButton,
  isChurchModal,
  isChurchUserSelect,
} from './commands/church.js';
import { commands } from './commands/index.js';
import {
  handleMemberButton,
  handleMemberModal,
  handleMemberSelect,
  isMemberButton,
  isMemberModal,
  isMemberSelect,
} from './commands/member.js';
import { handleRosterButton, isRosterButton } from './commands/roster.js';
import { handleVoteButton, isVoteButton } from './commands/vote.js';
import { env } from './config/env.js';
import { DatabaseConfigurationError, DatabaseSchemaError } from './database/errors.js';
import { logger } from './logger.js';
import { createPanel, createPanelEdit, createPanelReply } from './ui/panel.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: {
    activities: [{ name: 'over the Sacred Disciples', type: ActivityType.Watching }],
    status: 'online',
  },
});

client.once(Events.ClientReady, (readyClient) => {
  logger.info(
    {
      guildCount: readyClient.guilds.cache.size,
      tag: readyClient.user.tag,
    },
    'SDMC bot is ready',
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const isPublicVote = interaction.isButton() && isVoteButton(interaction.customId);
    const isTreasurerCommand =
      interaction.isChatInputCommand() && interaction.commandName === 'treasurer';
    const requiresFounder =
      interaction.isChatInputCommand() ||
      interaction.isModalSubmit() ||
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isUserSelectMenu();
    if (requiresFounder && !isPublicVote && !isTreasurerCommand && !hasFounderRole(interaction)) {
      if (interaction.isRepliable()) {
        await interaction.reply(
          createPanelReply({
            title: 'Founder Role Required',
            description: `Only members with the <@&${env.SDMC_FOUNDER_ROLE_ID}> role can use SDMC Bot commands and controls.`,
            ephemeral: true,
            tone: 'warning',
          }),
        );
      }
      logger.warn(
        { interactionType: interaction.type, userId: interaction.user.id },
        'Blocked non-Founder interaction',
      );
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        logger.warn({ commandName: interaction.commandName }, 'Received an unknown command');
        return;
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isModalSubmit() && isMemberModal(interaction.customId)) {
      logger.debug(
        { customId: interaction.customId, userId: interaction.user.id },
        'Handling member modal submission',
      );
      await handleMemberModal(interaction);
      logger.debug(
        { customId: interaction.customId, userId: interaction.user.id },
        'Completed member modal submission',
      );
      return;
    }

    if (interaction.isModalSubmit() && isChurchModal(interaction.customId)) {
      await handleChurchModal(interaction);
      return;
    }

    if (interaction.isButton() && isMemberButton(interaction.customId)) {
      await handleMemberButton(interaction);
      return;
    }

    if (interaction.isButton() && isChurchButton(interaction.customId)) {
      await handleChurchButton(interaction);
      return;
    }

    if (interaction.isButton() && isVoteButton(interaction.customId)) {
      await handleVoteButton(interaction);
      return;
    }

    if (interaction.isUserSelectMenu() && isChurchUserSelect(interaction.customId)) {
      await handleChurchUserSelect(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && isMemberSelect(interaction.customId)) {
      logger.debug(
        { customId: interaction.customId, userId: interaction.user.id, values: interaction.values },
        'Handling member editor selection',
      );
      await handleMemberSelect(interaction);
      logger.debug(
        { customId: interaction.customId, userId: interaction.user.id },
        'Completed member editor selection',
      );
      return;
    }

    if (interaction.isButton() && isRosterButton(interaction.customId)) {
      await handleRosterButton(interaction);
    }
  } catch (error) {
    logger.error(
      {
        interactionId: interaction.id,
        interactionType: interaction.type,
        error,
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
      'Command execution failed',
    );

    if (!interaction.isRepliable()) return;

    const databaseError =
      error instanceof DatabaseConfigurationError || error instanceof DatabaseSchemaError;
    const panelOptions = {
      title: databaseError ? 'Database Setup Required' : 'Something Went Wrong',
      description: databaseError
        ? error.message
        : 'The request could not be completed. Please try again in a moment.',
      tone: databaseError ? ('warning' as const) : ('danger' as const),
    };
    const errorReply = {
      components: [createPanel(panelOptions)],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] as const },
    };

    if (interaction.deferred) {
      await interaction.editReply(createPanelEdit(panelOptions)).catch((replyError: unknown) => {
        logger.error({ error: replyError }, 'Failed to edit deferred interaction error reply');
      });
    } else if (interaction.replied) {
      await interaction.followUp(errorReply).catch((replyError: unknown) => {
        logger.error({ error: replyError }, 'Failed to send command error follow-up');
      });
    } else {
      await interaction.reply(errorReply).catch((replyError: unknown) => {
        logger.error({ error: replyError }, 'Failed to send command error reply');
      });
    }
  }
});

client.on(Events.Error, (error) => {
  logger.error({ error }, 'Discord client error');
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'Shutting down SDMC bot');
  await client.destroy();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (error) => {
  logger.fatal({ error }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception');
  process.exitCode = 1;
});

try {
  await client.login(env.DISCORD_TOKEN);
} catch (error) {
  logger.fatal({ error }, 'Failed to log in to Discord');
  process.exitCode = 1;
}
