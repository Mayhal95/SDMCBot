import {
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type Message,
} from 'discord.js';

import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { createPanel, createPanelReply } from '../ui/panel.js';
import type { BotCommand } from './types.js';

type VoteChoice = 'yes' | 'no' | 'abstain';

interface VoteState {
  id: string;
  question: string;
  context: string;
  createdById: string;
  endsAt: number;
  votes: Map<string, VoteChoice>;
  message: Message;
  closed: boolean;
}

const votes = new Map<string, VoteState>();
const votePrefix = 'vote:cast:';

function tally(state: VoteState): Record<VoteChoice, number> {
  const result: Record<VoteChoice, number> = { yes: 0, no: 0, abstain: 0 };
  for (const choice of state.votes.values()) result[choice] += 1;
  return result;
}

function progressBar(value: number, total: number): string {
  const filled = total ? Math.round((value / total) * 12) : 0;
  return `${'▰'.repeat(filled)}${'▱'.repeat(12 - filled)}`;
}

export function voteOutcome(yes: number, no: number, abstain: number): string {
  const total = yes + no + abstain;
  if (!total) return 'No Result — no ballots were cast';
  if (yes === total) return 'Unanimous Approval';
  if (no === total) return 'Unanimous Rejection';
  if (yes > no) return 'Vote Passed';
  if (no > yes) return 'Vote Rejected';
  return 'Tie Vote';
}

function votePanel(state: VoteState) {
  const counts = tally(state);
  const total = state.votes.size;
  const details = state.closed
    ? [
        `## ${voteOutcome(counts.yes, counts.no, counts.abstain)}`,
        `**Yes — ${counts.yes}**\n${progressBar(counts.yes, total)} ${total ? Math.round((counts.yes / total) * 100) : 0}%`,
        `**No — ${counts.no}**\n${progressBar(counts.no, total)} ${total ? Math.round((counts.no / total) * 100) : 0}%`,
        `**Abstain — ${counts.abstain}**\n${progressBar(counts.abstain, total)} ${total ? Math.round((counts.abstain / total) * 100) : 0}%`,
        `**Total ballots:** ${total}`,
      ]
    : [
        ...(state.context ? [`**Context:** ${escapeMarkdown(state.context)}`] : []),
        `**Time remaining:** <t:${state.endsAt}:R>`,
        `**Ballots cast:** ${total}`,
        'Results remain hidden until the vote closes.',
      ];
  return {
    title: state.closed ? 'Vote Closed' : 'Official SDMC Vote',
    description: escapeMarkdown(state.question),
    details,
    tone: state.closed ? ('success' as const) : ('default' as const),
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${votePrefix}${state.id}:yes`)
        .setLabel('Vote Yes')
        .setStyle(ButtonStyle.Success)
        .setDisabled(state.closed),
      new ButtonBuilder()
        .setCustomId(`${votePrefix}${state.id}:no`)
        .setLabel('Vote No')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(state.closed),
      new ButtonBuilder()
        .setCustomId(`${votePrefix}${state.id}:abstain`)
        .setLabel('Abstain')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.closed),
    ],
    footer: `Vote called by <@${state.createdById}> • ${state.closed ? 'Final result' : 'One ballot per member; changing a vote is allowed'}`,
  };
}

async function closeVote(id: string): Promise<void> {
  const state = votes.get(id);
  if (!state || state.closed) return;
  state.closed = true;
  await state.message
    .edit({
      components: [createPanel(votePanel(state))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    })
    .catch((error: unknown) =>
      logger.error({ error, voteId: id }, 'Failed to publish vote result'),
    );
  setTimeout(() => votes.delete(id), 60_000).unref();
}

export const voteCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Open a timed SDMC vote.')
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('The exact question members are voting on.')
        .setMaxLength(250)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('duration')
        .setDescription('How long voting remains open.')
        .setRequired(true)
        .addChoices({ name: '15 seconds', value: 15 }, { name: '30 seconds', value: 30 }, { name: '1 Hour', value: 3600 }, { name: '24 Hours', value: 86400 }),
    )
    .addStringOption((option) =>
      option
        .setName('context')
        .setDescription('Optional background information for voters.')
        .setMaxLength(700),
    ),

  async execute(interaction) {
    const channel = await interaction.client.channels.fetch(env.SDMC_VOTES_CHANNEL_ID);
    if (!channel?.isSendable()) {
      throw new Error('The configured voting channel cannot receive messages.');
    }
    const duration = interaction.options.getInteger('duration', true);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const state: VoteState = {
      id,
      question: interaction.options.getString('question', true),
      context: interaction.options.getString('context') ?? '',
      createdById: interaction.user.id,
      endsAt: Math.floor(Date.now() / 1000) + duration,
      votes: new Map(),
      message: null as unknown as Message,
      closed: false,
    };
    const message = await channel.send({
      components: [createPanel(votePanel(state))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    state.message = message;
    votes.set(id, state);
    setTimeout(() => void closeVote(id), duration * 1000).unref();
    await interaction.reply(
      createPanelReply({
        title: 'Vote Opened',
        description: `Voting is open for **${duration} seconds**.`,
        details: [`[Go to the official vote](${message.url})`],
        ephemeral: true,
        tone: 'success',
      }),
    );
  },
};

export function isVoteButton(customId: string): boolean {
  return customId.startsWith(votePrefix);
}

export async function handleVoteButton(interaction: ButtonInteraction): Promise<void> {
  const [, , id, rawChoice] = interaction.customId.split(':');
  const choice = rawChoice as VoteChoice;
  const state = id ? votes.get(id) : undefined;
  if (
    !state ||
    state.closed ||
    Date.now() >= state.endsAt * 1000 ||
    !['yes', 'no', 'abstain'].includes(choice)
  ) {
    await interaction.reply(
      createPanelReply({
        title: 'Voting Closed',
        description: 'This vote is no longer accepting ballots.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    if (state && !state.closed) await closeVote(state.id);
    return;
  }
  const previous = state.votes.get(interaction.user.id);
  state.votes.set(interaction.user.id, choice);
  await interaction.reply(
    createPanelReply({
      title: 'Ballot Recorded',
      description: `Your vote is recorded as **${choice === 'yes' ? 'Yes' : choice === 'no' ? 'No' : 'Abstain'}**${previous ? ' and replaced your previous ballot' : ''}.`,
      ephemeral: true,
      tone: 'success',
    }),
  );
  await state.message.edit({
    components: [createPanel(votePanel(state))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}
