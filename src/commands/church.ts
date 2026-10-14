import {
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';

import { env } from '../config/env.js';
import { getDatabase } from '../database/google-sheets.js';
import { createPanel, createPanelEdit, createPanelReply } from '../ui/panel.js';
import type { BotCommand } from './types.js';

interface ChurchTopic {
  speaker: string;
  title: string;
  reason: string;
  submittedById: string;
}

interface ChurchDraft {
  attendance: Set<string>;
  topics: ChurchTopic[];
}

const drafts = new Map<string, ChurchDraft>();
const churchPrefix = 'church:';

function draftFor(guildId: string): ChurchDraft {
  const existing = drafts.get(guildId);
  if (existing) return existing;
  const draft: ChurchDraft = { attendance: new Set(), topics: [] };
  drafts.set(guildId, draft);
  return draft;
}

function textLabel(options: {
  customId: string;
  label: string;
  description: string;
  style?: TextInputStyle;
  maxLength: number;
  required?: boolean;
  value?: string;
}): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(options.customId)
    .setStyle(options.style ?? TextInputStyle.Short)
    .setMaxLength(options.maxLength)
    .setRequired(options.required ?? true);
  if (options.value) input.setValue(options.value);
  return new LabelBuilder()
    .setLabel(options.label)
    .setDescription(options.description)
    .setTextInputComponent(input);
}

function churchConsole(guildId: string, requesterId: string) {
  const draft = draftFor(guildId);
  const attendees = [...draft.attendance].map((id) => `<@${id}>`).join(', ');
  return {
    title: 'Church Meeting Console',
    description:
      'Prepare the in-city meeting here. Select attendance, submit agenda topics, then publish the final minutes when church is over.',
    details: [
      `**Attendance recorded:** ${draft.attendance.size}${attendees ? ` · ${attendees}` : ''}`,
      `**Discussion topics:** ${draft.topics.length}`,
      'Publishing minutes closes and clears this meeting draft.',
    ],
    userSelectMenus: [
      new UserSelectMenuBuilder()
        .setCustomId(`${churchPrefix}attendance:${requesterId}`)
        .setPlaceholder('Select everyone who attended church')
        .setMinValues(1)
        .setMaxValues(25)
        .setDefaultUsers([...draft.attendance]),
    ],
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${churchPrefix}topic:${requesterId}`)
        .setLabel('Add Discussion Topic')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${churchPrefix}minutes:${requesterId}`)
        .setLabel('Publish Final Minutes')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${churchPrefix}clear:${requesterId}`)
        .setLabel('Clear Draft')
        .setStyle(ButtonStyle.Danger),
    ],
  } as const;
}

function requesterFrom(customId: string): string | undefined {
  return customId.split(':')[2];
}

async function denyWrongRequester(
  interaction: ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction,
): Promise<void> {
  await interaction.reply(
    createPanelReply({
      title: 'Church Console Unavailable',
      description: 'Only the Founder who opened this console can use its controls.',
      ephemeral: true,
      tone: 'warning',
    }),
  );
}

function safeDetails(lines: string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const remaining = 3600 - length;
    if (remaining <= 20) break;
    const value = line.length <= remaining ? line : `${line.slice(0, remaining - 1)}…`;
    kept.push(value);
    length += value.length + 3;
  }
  return kept;
}

function easternDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get('year')}-${value.get('month')}-${value.get('day')}`;
}

async function fetchSendableChannel(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  channelId: string,
) {
  const channel = await interaction.client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Configured channel ${channelId} cannot receive messages.`);
  }
  return channel;
}

export const churchCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('church')
    .setDescription('Open the SDMC church meeting console.'),

  async execute(interaction) {
    if (!interaction.guildId) return;
    await interaction.reply(
      createPanelReply({
        ...churchConsole(interaction.guildId, interaction.user.id),
        ephemeral: true,
      }),
    );
  },
};

export function isChurchButton(customId: string): boolean {
  return (
    customId.startsWith(`${churchPrefix}topic:`) ||
    customId.startsWith(`${churchPrefix}minutes:`) ||
    customId.startsWith(`${churchPrefix}clear:`)
  );
}

export function isChurchModal(customId: string): boolean {
  return (
    customId.startsWith(`${churchPrefix}topic-modal:`) ||
    customId.startsWith(`${churchPrefix}minutes-modal:`)
  );
}

export function isChurchUserSelect(customId: string): boolean {
  return customId.startsWith(`${churchPrefix}attendance:`);
}

export async function handleChurchUserSelect(
  interaction: UserSelectMenuInteraction,
): Promise<void> {
  if (!interaction.guildId || requesterFrom(interaction.customId) !== interaction.user.id) {
    return denyWrongRequester(interaction);
  }
  const draft = draftFor(interaction.guildId);
  draft.attendance = new Set(interaction.values);
  await interaction.update(
    createPanelEdit(churchConsole(interaction.guildId, interaction.user.id)),
  );
}

export async function handleChurchButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guildId || requesterFrom(interaction.customId) !== interaction.user.id) {
    return denyWrongRequester(interaction);
  }
  const action = interaction.customId.split(':')[1];
  if (action === 'clear') {
    drafts.set(interaction.guildId, { attendance: new Set(), topics: [] });
    await interaction.update(
      createPanelEdit(churchConsole(interaction.guildId, interaction.user.id)),
    );
    return;
  }

  if (action === 'topic') {
    const modal = new ModalBuilder()
      .setCustomId(`${churchPrefix}topic-modal:${interaction.user.id}`)
      .setTitle('Add Church Discussion Topic')
      .addLabelComponents(
        textLabel({
          customId: 'speaker',
          label: 'Person bringing up the topic',
          description: 'Use their in-city or Discord name.',
          maxLength: 80,
        }),
        textLabel({
          customId: 'topic',
          label: 'Topic of discussion',
          description: 'A clear, brief agenda title.',
          maxLength: 150,
        }),
        textLabel({
          customId: 'reason',
          label: 'Why this needs discussion',
          description: 'Brief context for church.',
          style: TextInputStyle.Paragraph,
          maxLength: 700,
        }),
      );
    await interaction.showModal(modal);
    return;
  }

  const draft = draftFor(interaction.guildId);
  if (!draft.attendance.size) {
    await interaction.reply(
      createPanelReply({
        title: 'Attendance Required',
        description: 'Select the members who attended before publishing the final minutes.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
  const modal = new ModalBuilder()
    .setCustomId(`${churchPrefix}minutes-modal:${interaction.user.id}`)
    .setTitle('Publish Church Minutes')
    .addLabelComponents(
      textLabel({
        customId: 'title',
        label: 'Meeting title',
        description: 'Used for the archive post and discussion thread.',
        value: `Church Meeting — ${date}`,
        maxLength: 100,
      }),
      textLabel({
        customId: 'summary',
        label: 'Meeting summary',
        description: 'A short overview of the meeting.',
        style: TextInputStyle.Paragraph,
        maxLength: 500,
      }),
      textLabel({
        customId: 'minutes',
        label: 'Church meeting minutes',
        description: 'Decisions, discussion notes, and important details.',
        style: TextInputStyle.Paragraph,
        maxLength: 1600,
      }),
      textLabel({
        customId: 'actions',
        label: 'Actions and follow-ups',
        description: 'Optional assignments or next steps.',
        style: TextInputStyle.Paragraph,
        maxLength: 500,
        required: false,
      }),
    );
  await interaction.showModal(modal);
}

export async function handleChurchModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guildId || requesterFrom(interaction.customId) !== interaction.user.id) {
    return denyWrongRequester(interaction);
  }
  const action = interaction.customId.split(':')[1];
  const draft = draftFor(interaction.guildId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (action === 'topic-modal') {
    const topic: ChurchTopic = {
      speaker: interaction.fields.getTextInputValue('speaker').trim(),
      title: interaction.fields.getTextInputValue('topic').trim(),
      reason: interaction.fields.getTextInputValue('reason').trim(),
      submittedById: interaction.user.id,
    };
    const channel = await fetchSendableChannel(interaction, env.SDMC_CHURCH_TOPICS_CHANNEL_ID);
    const message = await channel.send({
      components: [
        createPanel({
          title: 'Church Discussion Topic',
          description: escapeMarkdown(topic.title),
          details: [
            `**Brought forward by:** ${escapeMarkdown(topic.speaker)}`,
            `**Reason for discussion:** ${escapeMarkdown(topic.reason)}`,
            `**Recorded by:** <@${topic.submittedById}>`,
          ],
        }),
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    draft.topics.push(topic);
    await interaction.editReply(
      createPanelEdit({
        title: 'Topic Added',
        description: `**${escapeMarkdown(topic.title)}** was added to the church agenda.`,
        details: [`[View topic in the discussion channel](${message.url})`],
        tone: 'success',
      }),
    );
    return;
  }

  const title = interaction.fields.getTextInputValue('title').trim();
  const summary = interaction.fields.getTextInputValue('summary').trim();
  const minutes = interaction.fields.getTextInputValue('minutes').trim();
  const actions = interaction.fields.getTextInputValue('actions').trim();
  const attendeeText = [...draft.attendance].map((id) => `<@${id}>`).join(', ');
  const topicLines = draft.topics.length
    ? draft.topics
        .slice(0, 10)
        .map(
          (topic, index) =>
            `${index + 1}. **${escapeMarkdown(topic.title)}** — ${escapeMarkdown(topic.speaker)}`,
        )
    : ['No agenda topics were recorded through the bot.'];
  const details = safeDetails([
    `### Attendance (${draft.attendance.size})\n${attendeeText}`,
    `### Topics Discussed\n${topicLines.join('\n')}`,
    `### Summary\n${escapeMarkdown(summary)}`,
    `### Meeting Minutes\n${escapeMarkdown(minutes)}`,
    ...(actions ? [`### Actions & Follow-ups\n${escapeMarkdown(actions)}`] : []),
    `**Minutes recorded by:** <@${interaction.user.id}>`,
  ]);
  const channel = await fetchSendableChannel(interaction, env.SDMC_CHURCH_MINUTES_CHANNEL_ID);
  const message = await channel.send({
    components: [
      createPanel({ title, description: 'Official SDMC church meeting record', details }),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
  const thread = await message.startThread({
    name: `Discussion — ${title}`.slice(0, 100),
    reason: 'Automatic discussion thread for SDMC church minutes',
  });
  const presentMembers = await Promise.all(
    [...draft.attendance].map(async (discordUserId) => {
      const user = await interaction.client.users.fetch(discordUserId).catch(() => null);
      return { discordUserId, discordUsername: user?.username ?? 'Unknown' };
    }),
  );
  const meeting = await getDatabase().recordChurchMeeting({
    meetingDate: easternDate(),
    title,
    topicCount: draft.topics.length,
    summary,
    minutes,
    actions,
    discordMessageId: message.id,
    discordMessageUrl: message.url,
    threadId: thread.id,
    threadUrl: thread.url,
    presentMembers,
    actor: { discordId: interaction.user.id, username: interaction.user.username },
  });
  drafts.delete(interaction.guildId);
  await interaction.editReply(
    createPanelEdit({
      title: 'Church Minutes Published',
      description:
        'The final meeting record is posted, its discussion thread is open, and attendance was saved to Google Sheets.',
      details: [
        `**Meeting ID:** \`${meeting.meetingId}\``,
        `**Attendance recorded:** ${meeting.attendeeCount} present`,
        `[View meeting minutes](${message.url})`,
        `[Open discussion thread](${thread.url})`,
      ],
      tone: 'success',
    }),
  );
}
