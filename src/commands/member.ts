import {
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { hasFounderRole } from '../auth/founder.js';
import { getDatabase, type Actor } from '../database/google-sheets.js';
import {
  MEMBER_STATUSES,
  NOTE_CATEGORIES,
  type MemberRecord,
  type RankMapping,
  type ChurchAttendanceSummary,
} from '../database/schema.js';
import { createPanelEdit, createPanelReply } from '../ui/panel.js';
import type { BotCommand } from './types.js';

const modalIds = {
  register: 'member:register:',
  edit: 'member:edit:',
  name: 'member:name:',
  note: 'member:note:',
} as const;
const noRankValue = '__no_rank__';
const editableMemberStatuses = MEMBER_STATUSES.filter((status) => status !== 'Removed');

function isMemberManager(
  interaction:
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction,
): boolean {
  return hasFounderRole(interaction);
}

async function denyStaffAction(
  interaction:
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction,
): Promise<void> {
  await interaction.reply(
    createPanelReply({
      title: 'Founder Role Required',
      description: 'Only members with the configured **Founder** role can use SDMC Bot.',
      ephemeral: true,
      tone: 'warning',
    }),
  );
}

function actorFrom(
  interaction:
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction,
): Actor {
  return { discordId: interaction.user.id, username: interaction.user.username };
}

function modalFieldValue(interaction: ModalSubmitInteraction, customId: string): string {
  const field = interaction.fields.getField(customId);
  if ('values' in field) {
    const values: unknown = field.values;
    if (Array.isArray(values)) {
      const firstValue: unknown = values[0];
      return typeof firstValue === 'string' ? firstValue.trim() : '';
    }
  }
  if ('value' in field && typeof field.value === 'string') return field.value.trim();
  return '';
}

function displayDate(value: string): string {
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds)
    ? escapeMarkdown(value || 'Unknown')
    : `<t:${Math.floor(milliseconds / 1000)}:D>`;
}

function memberDetails(member: MemberRecord): string[] {
  return [
    `**In-game name:** ${escapeMarkdown(member.inGameName)}`,
    `**Discord:** <@${member.discordUserId}>`,
    `**Rank:** ${escapeMarkdown(member.rank || 'Unassigned')}`,
    `**Status:** ${escapeMarkdown(member.status || 'Unknown')}`,
    `**Joined SDMC:** ${displayDate(member.clubJoinDate)}`,
    `**Discord server joined:** ${displayDate(member.discordServerJoinedAt)}`,
    `**Member ID:** \`${member.memberId}\``,
  ];
}

function churchAttendanceDetails(summary: ChurchAttendanceSummary): string[] {
  if (!summary.total) return ['**Church attendance:** No meetings recorded yet'];
  const rate = summary.attendanceRate === null ? 'Not yet rated' : `${summary.attendanceRate}%`;
  const latest = summary.recent[0];
  return [
    `**Church attendance:** ${rate} · ${summary.attended} of ${summary.counted} counted meetings`,
    `**Attendance record:** ${summary.present} present · ${summary.late} late · ${summary.absent} absent · ${summary.excused} excused`,
    ...(latest
      ? [`**Latest church:** ${displayDate(latest.meetingDate)} · ${escapeMarkdown(latest.status)}`]
      : []),
  ];
}

async function synchronizeMemberRankRoles(
  interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
  targetId: string,
  mappings: RankMapping[],
  selectedMapping: RankMapping | undefined,
): Promise<{ failed: boolean; message: string }> {
  if (!interaction.guild) {
    return {
      failed: true,
      message: '**Discord roles:** Not updated because the server was unavailable.',
    };
  }

  const guildMember = await interaction.guild.members
    .fetch({ user: targetId, force: true })
    .catch(() => null);
  if (!guildMember) {
    return {
      failed: true,
      message: '**Discord roles:** Not updated because the member is no longer in the server.',
    };
  }

  const managedRoleIds = new Set(mappings.map((mapping) => mapping.discordRoleId));
  const desiredRoleId = selectedMapping?.discordRoleId;
  const removeRoleIds = guildMember.roles.cache
    .filter((role) => managedRoleIds.has(role.id) && role.id !== desiredRoleId)
    .map((role) => role.id);
  const shouldAddRole = desiredRoleId && !guildMember.roles.cache.has(desiredRoleId);
  let failed = false;
  let removed = 0;
  let added = 0;

  if (removeRoleIds.length) {
    await guildMember.roles
      .remove(removeRoleIds, 'SDMC member rank updated')
      .then(() => {
        removed = removeRoleIds.length;
      })
      .catch(() => {
        failed = true;
      });
  }
  if (shouldAddRole) {
    await guildMember.roles
      .add(desiredRoleId, 'SDMC member rank updated')
      .then(() => {
        added = 1;
      })
      .catch(() => {
        failed = true;
      });
  }

  if (failed) {
    return {
      failed: true,
      message:
        '**Discord roles:** The database was updated, but one or more role changes failed. Check the bot’s Manage Roles permission and role position.',
    };
  }

  return {
    failed: false,
    message: `**Discord roles:** ${removed} removed · ${added} added${selectedMapping ? ` · ${escapeMarkdown(selectedMapping.rank)} selected` : ' · no rank selected'}`,
  };
}

function activeRankMenuMappings(mappings: RankMapping[]): RankMapping[] {
  return [...mappings]
    .sort((left, right) => right.level - left.level || left.rank.localeCompare(right.rank))
    .filter(
      (mapping, index, allMappings) =>
        allMappings.findIndex(
          (candidate) => candidate.rank.toLowerCase() === mapping.rank.toLowerCase(),
        ) === index,
    )
    .slice(0, 24);
}

function memberEditPanel(
  member: MemberRecord,
  mappings: RankMapping[],
  requesterId: string,
  roleMessage?: string,
  warning = false,
) {
  const menuMappings = activeRankMenuMappings(mappings);
  const currentRankIsMapped = menuMappings.some(
    (mapping) => mapping.rank.toLowerCase() === member.rank.toLowerCase(),
  );
  const rankSelect = new StringSelectMenuBuilder()
    .setCustomId(`member:rank:${member.discordUserId}:${requesterId}`)
    .setPlaceholder('Select a rank or remove mapped rank roles')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('No rank — remove club roles')
        .setDescription('Clears every Discord role mapped in the Ranks sheet.')
        .setValue(noRankValue)
        .setDefault(!member.rank || !currentRankIsMapped),
      ...menuMappings.map((mapping) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(mapping.rank)
          .setDescription(`Apply the mapped ${mapping.rank} Discord role.`)
          .setValue(mapping.rank)
          .setDefault(mapping.rank.toLowerCase() === member.rank.toLowerCase()),
      ),
    );
  const statusSelect = new StringSelectMenuBuilder()
    .setCustomId(`member:status:${member.discordUserId}:${requesterId}`)
    .setPlaceholder('Select member status')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      editableMemberStatuses.map((status) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(status)
          .setValue(status)
          .setDefault(status.toLowerCase() === member.status.toLowerCase()),
      ),
    );

  return {
    title: `Manage ${member.inGameName}`,
    description:
      'Rank and status selections save immediately. Rank changes automatically replace mapped Discord roles.',
    details: roleMessage ? [...memberDetails(member), roleMessage] : memberDetails(member),
    selectMenus: [rankSelect, statusSelect],
    buttons: [
      new ButtonBuilder()
        .setCustomId(`member:name:${member.discordUserId}:${requesterId}`)
        .setLabel('Edit In-Game Name')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`member:remove:${member.discordUserId}:${requesterId}`)
        .setLabel('Permanently Remove Member')
        .setStyle(ButtonStyle.Danger),
    ],
    tone: warning ? ('warning' as const) : ('default' as const),
  };
}

function textLabel(options: {
  customId: string;
  label: string;
  description: string;
  required?: boolean;
  value?: string;
  maxLength?: number;
}): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(options.customId)
    .setStyle(TextInputStyle.Short)
    .setRequired(options.required ?? true)
    .setMaxLength(options.maxLength ?? 100);

  if (options.value) input.setValue(options.value.slice(0, options.maxLength ?? 100));

  return new LabelBuilder()
    .setLabel(options.label)
    .setDescription(options.description)
    .setTextInputComponent(input);
}

async function registerMember(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isMemberManager(interaction)) return denyStaffAction(interaction);

  const target = interaction.options.getUser('member', true);
  if (target.bot) {
    await interaction.reply(
      createPanelReply({
        title: 'Invalid Member',
        description: 'Bot accounts cannot be registered as SDMC members.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${modalIds.register}${target.id}`)
    .setTitle('Register SDMC Member')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Registering **${escapeMarkdown(target.username)}**. Their Discord ID and join dates will be recorded automatically.`,
      ),
    )
    .addLabelComponents(
      textLabel({
        customId: 'in_game_name',
        label: 'In-game name',
        description: 'Their exact NoKey FiveM character name.',
        maxLength: 80,
      }),
      textLabel({
        customId: 'rank',
        label: 'Current rank',
        description: 'Optional until the Ranks tab is configured.',
        required: false,
        maxLength: 60,
      }),
    );

  await interaction.showModal(modal);
}

async function viewMember(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('member') ?? interaction.user;
  if (target.id !== interaction.user.id && !isMemberManager(interaction)) {
    return denyStaffAction(interaction);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = getDatabase();
  const member = await database.findMemberByDiscordId(target.id);

  if (!member) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Member Not Found',
        description: `${escapeMarkdown(target.username)} is not registered in the SDMC roster.`,
        tone: 'warning',
      }),
    );
    return;
  }

  const attendance = await database.getChurchAttendanceSummary(target.id);
  await interaction.editReply(
    createPanelEdit({
      title: member.inGameName,
      description: 'SDMC member profile',
      details: [...memberDetails(member), ...churchAttendanceDetails(attendance)],
    }),
  );
}

async function editMember(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isMemberManager(interaction)) return denyStaffAction(interaction);

  const target = interaction.options.getUser('member', true);
  const action = interaction.options.getString('action') ?? 'edit';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = getDatabase();
  const [member, rankMappings] = await Promise.all([
    database.findMemberByDiscordId(target.id),
    action === 'edit' ? database.listRankMappings() : Promise.resolve([]),
  ]);
  if (!member) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Member Not Found',
        description: 'Register this Discord user before editing their member profile.',
        tone: 'warning',
      }),
    );
    return;
  }

  if (action === 'remove') {
    await interaction.editReply(
      createPanelEdit({
        title: 'Confirm Permanent Removal',
        description: `Permanently remove **${escapeMarkdown(member.inGameName)}** from the SDMC database?`,
        details: [
          'Their member row and all private member notes will be deleted.',
          'Configured SDMC rank roles will be removed from their Discord account.',
          'A minimal removal event will remain in the Audit Log.',
          '**This action cannot be undone.**',
        ],
        buttons: [
          new ButtonBuilder()
            .setCustomId(`member:remove:${target.id}:${interaction.user.id}`)
            .setLabel('Remove Member')
            .setStyle(ButtonStyle.Danger),
        ],
        tone: 'danger',
      }),
    );
    return;
  }

  await interaction.editReply(
    createPanelEdit(memberEditPanel(member, rankMappings, interaction.user.id)),
  );
}

async function memberNotes(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isMemberManager(interaction)) return denyStaffAction(interaction);

  const target = interaction.options.getUser('member', true);
  const action = interaction.options.getString('action', true);
  const member = await getDatabase().findMemberByDiscordId(target.id);

  if (!member) {
    await interaction.reply(
      createPanelReply({
        title: 'Member Not Found',
        description: 'Register this Discord user before managing their notes.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  if (action === 'add') {
    const categorySelect = new StringSelectMenuBuilder()
      .setCustomId('category')
      .setRequired(true)
      .addOptions(
        NOTE_CATEGORIES.map((category) =>
          new StringSelectMenuOptionBuilder().setLabel(category).setValue(category),
        ),
      );

    const modal = new ModalBuilder()
      .setCustomId(`${modalIds.note}${target.id}`)
      .setTitle('Add Private Member Note')
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `Adding a staff-only note for **${escapeMarkdown(member.inGameName)}**.`,
        ),
      )
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Category')
          .setDescription('Choose the note category.')
          .setStringSelectMenuComponent(categorySelect),
        new LabelBuilder()
          .setLabel('Note')
          .setDescription('Keep it factual, relevant, and professional.')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('note')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000),
          ),
      );

    await interaction.showModal(modal);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const notes = (await getDatabase().listNotes(member.memberId)).slice(0, 5);
  const details = notes.length
    ? notes.map(
        (note) =>
          `**${escapeMarkdown(note.category)}** · ${displayDate(note.createdAt)} · ${escapeMarkdown(note.authorUsername)}\n${escapeMarkdown(note.note).slice(0, 700)}`,
      )
    : ['No staff notes have been recorded for this member.'];

  await interaction.editReply(
    createPanelEdit({
      title: `${member.inGameName} — Staff Notes`,
      description: 'Showing the five most recent private notes.',
      details,
    }),
  );
}

export const memberCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('Manage SDMC member records.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('register')
        .setDescription('Register a Discord user as an SDMC member.')
        .addUserOption((option) =>
          option.setName('member').setDescription('Discord user to register.').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View an SDMC member profile.')
        .addUserOption((option) =>
          option.setName('member').setDescription('Member to view; defaults to yourself.'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('edit')
        .setDescription('Edit or remove an existing SDMC member profile.')
        .addUserOption((option) =>
          option.setName('member').setDescription('Member to edit.').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('Choose whether to edit or remove this member.')
            .addChoices(
              { name: 'Edit profile', value: 'edit' },
              { name: 'Remove member', value: 'remove' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('notes')
        .setDescription('View or add private staff notes for a member.')
        .addUserOption((option) =>
          option
            .setName('member')
            .setDescription('Member whose notes to manage.')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('Whether to view or add a note.')
            .setRequired(true)
            .addChoices({ name: 'View notes', value: 'view' }, { name: 'Add note', value: 'add' }),
        ),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'register') return registerMember(interaction);
    if (subcommand === 'view') return viewMember(interaction);
    if (subcommand === 'edit') return editMember(interaction);
    return memberNotes(interaction);
  },
};

export function isMemberModal(customId: string): boolean {
  return Object.values(modalIds).some((prefix) => customId.startsWith(prefix));
}

export function isMemberButton(customId: string): boolean {
  return customId.startsWith('member:remove:') || customId.startsWith('member:name:');
}

export async function handleMemberButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, targetId, requesterId] = interaction.customId.split(':');
  if (
    !['name', 'remove'].includes(action ?? '') ||
    !targetId ||
    requesterId !== interaction.user.id
  ) {
    await interaction.reply(
      createPanelReply({
        title: 'Confirmation Not Available',
        description: 'Only the staff member who requested this removal can confirm it.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  if (!isMemberManager(interaction)) return denyStaffAction(interaction);

  if (action === 'name') {
    const member = await getDatabase().findMemberByDiscordId(targetId);
    if (!member) {
      await interaction.reply(
        createPanelReply({
          title: 'Member Not Found',
          description: 'This member is no longer present in the roster.',
          ephemeral: true,
          tone: 'warning',
        }),
      );
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`member:name:${targetId}:${requesterId}`)
      .setTitle('Edit In-Game Name')
      .addLabelComponents(
        textLabel({
          customId: 'in_game_name',
          label: 'In-game name',
          description: 'Their exact NoKey FiveM character name.',
          value: member.inGameName,
          maxLength: 80,
        }),
      );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();
  const database = getDatabase();
  const member = await database.findMemberByDiscordId(targetId);

  if (!member) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Member Not Found',
        description: 'This member is no longer present in the roster.',
        tone: 'warning',
      }),
    );
    return;
  }

  const mappings = await database.listRankMappings();
  const guildMember = await interaction.guild?.members
    .fetch({ user: targetId, force: true })
    .catch(() => null);
  const mappedRoleIds = mappings
    .map((mapping) => mapping.discordRoleId)
    .filter((roleId) => guildMember?.roles.cache.has(roleId));
  let roleCleanupFailed = false;
  if (guildMember && mappedRoleIds.length) {
    await guildMember.roles.remove(mappedRoleIds, 'SDMC member permanently removed').catch(() => {
      roleCleanupFailed = true;
    });
  }

  await database.removeMember(member, actorFrom(interaction));
  await interaction.editReply(
    createPanelEdit({
      title: 'Member Removed',
      description: `${escapeMarkdown(member.inGameName)} was permanently removed from the SDMC database.`,
      details: [
        'Their member row and private notes were deleted.',
        roleCleanupFailed
          ? 'The bot could not clear their configured rank roles; remove those roles manually.'
          : `**Configured rank roles removed:** ${mappedRoleIds.length}`,
        'A minimal removal event was retained in the Audit Log.',
      ],
      tone: roleCleanupFailed ? 'warning' : 'success',
    }),
  );
}

export function isMemberSelect(customId: string): boolean {
  return customId.startsWith('member:rank:') || customId.startsWith('member:status:');
}

export async function handleMemberSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, action, targetId, requesterId] = interaction.customId.split(':');
  if (
    !['rank', 'status'].includes(action ?? '') ||
    !targetId ||
    requesterId !== interaction.user.id
  ) {
    await interaction.reply(
      createPanelReply({
        title: 'Member Editor Not Available',
        description: 'Only the staff member who opened this editor can use its controls.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }
  if (!isMemberManager(interaction)) return denyStaffAction(interaction);

  await interaction.deferUpdate();
  const database = getDatabase();
  const [member, mappings] = await Promise.all([
    database.findMemberByDiscordId(targetId),
    database.listRankMappings(),
  ]);
  if (!member) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Member Not Found',
        description: 'This member is no longer present in the roster.',
        tone: 'warning',
      }),
    );
    return;
  }

  const selectedValue = interaction.values[0] ?? '';
  let rank = member.rank;
  let status = member.status;
  if (action === 'rank') {
    const selectedMapping = mappings.find(
      (mapping) => mapping.rank.toLowerCase() === selectedValue.toLowerCase(),
    );
    if (selectedValue !== noRankValue && !selectedMapping) {
      await interaction.editReply(
        createPanelEdit({
          title: 'Rank Mapping Changed',
          description: 'That rank is no longer active. Reopen `/member edit` and try again.',
          tone: 'warning',
        }),
      );
      return;
    }
    rank = selectedMapping?.rank ?? '';
  } else {
    const selectedStatus = editableMemberStatuses.find(
      (allowed) => allowed.toLowerCase() === selectedValue.toLowerCase(),
    );
    if (!selectedStatus) {
      await interaction.editReply(
        createPanelEdit({
          title: 'Invalid Status',
          description: `Use one of: ${editableMemberStatuses.join(', ')}.`,
          tone: 'warning',
        }),
      );
      return;
    }
    status = selectedStatus;
  }

  const updated = await database.updateMember(member, {
    inGameName: member.inGameName,
    rank,
    status,
    actor: actorFrom(interaction),
  });
  const selectedMapping = mappings.find(
    (mapping) => mapping.rank.toLowerCase() === updated.rank.toLowerCase(),
  );
  const roleResult = await synchronizeMemberRankRoles(
    interaction,
    targetId,
    mappings,
    updated.status === 'Retired' ? undefined : selectedMapping,
  );
  await interaction.editReply(
    createPanelEdit(
      memberEditPanel(
        updated,
        mappings,
        interaction.user.id,
        roleResult.message,
        roleResult.failed,
      ),
    ),
  );
}

export async function handleMemberModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isMemberManager(interaction)) return denyStaffAction(interaction);

  const [, action, targetId, requesterId] = interaction.customId.split(':');
  if (!targetId || !interaction.guild) return;
  if (requesterId && requesterId !== interaction.user.id) {
    await interaction.reply(
      createPanelReply({
        title: 'Member Editor Not Available',
        description: 'Only the staff member who opened this editor can submit it.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = getDatabase();
  const actor = actorFrom(interaction);

  if (action === 'register') {
    const [target, mappings] = await Promise.all([
      interaction.guild.members.fetch({ user: targetId, force: true }),
      database.listRankMappings(),
    ]);
    const enteredRank = interaction.fields.getTextInputValue('rank').trim();
    const selectedMapping = mappings.find(
      (mapping) => mapping.rank.toLowerCase() === enteredRank.toLowerCase(),
    );
    const now = new Date();
    const member = await database.registerMember({
      discordUserId: target.id,
      discordUsername: target.user.username,
      inGameName: interaction.fields.getTextInputValue('in_game_name').trim(),
      rank: selectedMapping?.rank ?? enteredRank,
      clubJoinDate: now.toISOString().slice(0, 10),
      discordServerJoinedAt: target.joinedAt?.toISOString() ?? '',
      actor,
    });
    const roleResult =
      enteredRank && !selectedMapping
        ? {
            failed: true,
            message:
              '**Discord roles:** No active rank mapping matched the entered rank. Update the member from `/member edit` to select a configured rank.',
          }
        : await synchronizeMemberRankRoles(interaction, targetId, mappings, selectedMapping);

    await interaction.editReply(
      createPanelEdit({
        title: 'Member Registered',
        description: `${escapeMarkdown(member.inGameName)} is now on the official SDMC roster.`,
        details: [...memberDetails(member), roleResult.message],
        tone: roleResult.failed ? 'warning' : 'success',
      }),
    );
    return;
  }

  const member = await database.findMemberByDiscordId(targetId);
  if (!member) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Member Not Found',
        description: 'This member is no longer present in the roster.',
        tone: 'warning',
      }),
    );
    return;
  }

  if (action === 'name') {
    const updated = await database.updateMember(member, {
      inGameName: interaction.fields.getTextInputValue('in_game_name').trim(),
      rank: member.rank,
      status: member.status,
      actor,
    });
    await interaction.editReply(
      createPanelEdit({
        title: 'In-Game Name Updated',
        description: `The member is now listed as **${escapeMarkdown(updated.inGameName)}**.`,
        details: memberDetails(updated),
        tone: 'success',
      }),
    );
    return;
  }

  if (action === 'edit') {
    const selectedRank = modalFieldValue(interaction, 'rank') || member.rank || noRankValue;
    const status = modalFieldValue(interaction, 'status') || member.status;
    const normalizedStatus = editableMemberStatuses.find(
      (allowed) => allowed.toLowerCase() === status.toLowerCase(),
    );
    if (!normalizedStatus) {
      await interaction.editReply(
        createPanelEdit({
          title: 'Invalid Status',
          description: `Use one of: ${editableMemberStatuses.join(', ')}.`,
          tone: 'warning',
        }),
      );
      return;
    }

    const mappings = await database.listRankMappings();
    const selectedMapping = mappings.find(
      (mapping) => mapping.rank.toLowerCase() === selectedRank.toLowerCase(),
    );
    if (selectedRank !== noRankValue && !selectedMapping) {
      await interaction.editReply(
        createPanelEdit({
          title: 'Rank Mapping Changed',
          description:
            'That rank is no longer active in the Ranks sheet. Reopen `/member edit` and choose another rank.',
          tone: 'warning',
        }),
      );
      return;
    }

    const rank = selectedMapping?.rank ?? '';
    const updated = await database.updateMember(member, {
      inGameName: interaction.fields.getTextInputValue('in_game_name').trim(),
      rank,
      status: normalizedStatus,
      actor,
    });

    const roleResult = await synchronizeMemberRankRoles(
      interaction,
      targetId,
      mappings,
      normalizedStatus === 'Retired' ? undefined : selectedMapping,
    );

    await interaction.editReply(
      createPanelEdit({
        title: 'Member Updated',
        description: `${escapeMarkdown(updated.inGameName)}'s roster record was updated.`,
        details: [...memberDetails(updated), roleResult.message],
        tone: roleResult.failed ? 'warning' : 'success',
      }),
    );
    return;
  }

  const [category] = interaction.fields.getStringSelectValues('category');
  const note = await database.addNote({
    member,
    category: category ?? 'General',
    note: interaction.fields.getTextInputValue('note').trim(),
    actor,
  });
  await interaction.editReply(
    createPanelEdit({
      title: 'Private Note Added',
      description: `A ${escapeMarkdown(note.category)} note was saved for ${escapeMarkdown(member.inGameName)}.`,
      tone: 'success',
    }),
  );
}
