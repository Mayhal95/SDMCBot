import {
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from 'discord.js';

import { hasFounderRole } from '../auth/founder.js';
import { getDatabase, type Actor } from '../database/google-sheets.js';
import type { MemberRecord, RankMapping } from '../database/schema.js';
import { createPanel, createPanelEdit, createPanelReply } from '../ui/panel.js';
import type { BotCommand } from './types.js';

const pageSize = 8;
const rosterButtonPrefix = 'roster:';

function isRosterManager(interaction: ChatInputCommandInteraction | ButtonInteraction): boolean {
  return hasFounderRole(interaction);
}

function activeRoster(members: MemberRecord[]): MemberRecord[] {
  return members
    .filter((member) => !['removed', 'retired'].includes(member.status.toLowerCase()))
    .sort(
      (left, right) =>
        (left.rank || 'zz').localeCompare(right.rank || 'zz') ||
        left.inGameName.localeCompare(right.inGameName),
    );
}

function rosterPageOptions(members: MemberRecord[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const pageMembers = members.slice(page * pageSize, page * pageSize + pageSize);

  return {
    title: 'SDMC Roster',
    description: `**${members.length}** active roster member${members.length === 1 ? '' : 's'} · Page ${page + 1} of ${pageCount}`,
    details: pageMembers.length
      ? pageMembers.map(
          (member) =>
            `**${escapeMarkdown(member.inGameName)}** · ${escapeMarkdown(member.rank || 'Unassigned')} · ${escapeMarkdown(member.status)}\n<@${member.discordUserId}> · \`${member.memberId}\``,
        )
      : ['The active roster is currently empty.'],
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${rosterButtonPrefix}page:${page - 1}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`${rosterButtonPrefix}page:${page + 1}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1),
    ],
  } as const;
}

interface RoleChange {
  member: MemberRecord;
  guildMember: GuildMember;
  addRoleId: string | undefined;
  removeRoleIds: string[];
}

interface SyncPlan {
  changes: RoleChange[];
  missingFromDiscord: number;
  unmappedRanks: string[];
}

async function buildSyncPlan(
  guild: Guild,
  members: MemberRecord[],
  mappings: RankMapping[],
): Promise<SyncPlan> {
  const roleByRank = new Map(
    mappings.map((mapping) => [mapping.rank.trim().toLowerCase(), mapping.discordRoleId]),
  );
  const managedRoleIds = new Set(mappings.map((mapping) => mapping.discordRoleId));
  const changes: RoleChange[] = [];
  const unmappedRanks = new Set<string>();
  let missingFromDiscord = 0;

  for (const member of members) {
    const guildMember = await guild.members
      .fetch({ user: member.discordUserId, force: true })
      .catch(() => null);
    if (!guildMember) {
      missingFromDiscord += 1;
      continue;
    }

    const isInactive = ['removed', 'retired'].includes(member.status.toLowerCase());
    const desiredRoleId = isInactive ? undefined : roleByRank.get(member.rank.trim().toLowerCase());
    if (!isInactive && member.rank && !desiredRoleId) unmappedRanks.add(member.rank);

    const removeRoleIds = guildMember.roles.cache
      .filter((role) => managedRoleIds.has(role.id) && role.id !== desiredRoleId)
      .map((role) => role.id);
    const addRoleId =
      desiredRoleId && !guildMember.roles.cache.has(desiredRoleId) ? desiredRoleId : undefined;

    if (addRoleId || removeRoleIds.length) {
      changes.push({ member, guildMember, addRoleId, removeRoleIds });
    }
  }

  return { changes, missingFromDiscord, unmappedRanks: [...unmappedRanks].sort() };
}

async function viewRoster(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const members = activeRoster(await getDatabase().listMembers());
  await interaction.editReply(createPanelEdit(rosterPageOptions(members, 0)));
}

async function previewRosterSync(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isRosterManager(interaction) || !interaction.guild) {
    await interaction.reply(
      createPanelReply({
        title: 'Founder Role Required',
        description:
          'Only members with the configured **Founder** role can synchronize the roster.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = getDatabase();
  const [members, mappings] = await Promise.all([
    database.listMembers(),
    database.listRankMappings(),
  ]);

  if (!mappings.length) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Rank Mapping Required',
        description:
          'Add ranks and their Discord Role IDs to the **Ranks** sheet before synchronizing roles.',
        tone: 'warning',
      }),
    );
    return;
  }

  const plan = await buildSyncPlan(interaction.guild, members, mappings);
  const details = [
    `**Role changes:** ${plan.changes.length}`,
    `**Members not in Discord:** ${plan.missingFromDiscord}`,
    `**Ranks without a role mapping:** ${plan.unmappedRanks.length || 0}`,
  ];
  if (plan.unmappedRanks.length) {
    details.push(
      `Unmapped: ${plan.unmappedRanks
        .map((rank) => escapeMarkdown(rank))
        .join(', ')
        .slice(0, 800)}`,
    );
  }

  await interaction.editReply(
    createPanelEdit({
      title: 'Roster Sync Preview',
      description:
        'This only manages roles listed in the **Ranks** sheet. Unrelated Discord roles will remain untouched.',
      details,
      buttons: [
        new ButtonBuilder()
          .setCustomId(`${rosterButtonPrefix}sync:${interaction.user.id}`)
          .setLabel('Confirm Sync')
          .setStyle(ButtonStyle.Success)
          .setDisabled(plan.changes.length === 0),
      ],
    }),
  );
}

export const rosterCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('View and synchronize the SDMC roster.')
    .addSubcommand((subcommand) =>
      subcommand.setName('view').setDescription('View the active SDMC roster.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('sync')
        .setDescription('Preview and synchronize configured rank roles with the roster.'),
    ),

  async execute(interaction) {
    return interaction.options.getSubcommand() === 'view'
      ? viewRoster(interaction)
      : previewRosterSync(interaction);
  },
};

export function isRosterButton(customId: string): boolean {
  return customId.startsWith(rosterButtonPrefix);
}

export async function handleRosterButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, value] = interaction.customId.split(':');

  if (action === 'page') {
    const members = activeRoster(await getDatabase().listMembers());
    const page = Number(value ?? 0);
    await interaction.update({
      components: [createPanel(rosterPageOptions(members, Number.isFinite(page) ? page : 0))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (action !== 'sync' || !interaction.guild || value !== interaction.user.id) {
    await interaction.reply(
      createPanelReply({
        title: 'Confirmation Not Available',
        description: 'Only the staff member who requested this preview can confirm it.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  if (!isRosterManager(interaction)) {
    await interaction.reply(
      createPanelReply({
        title: 'Founder Role Required',
        description: 'You no longer have the configured **Founder** role.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  await interaction.deferUpdate();
  const database = getDatabase();
  const [members, mappings] = await Promise.all([
    database.listMembers(),
    database.listRankMappings(),
  ]);
  const plan = await buildSyncPlan(interaction.guild, members, mappings);
  let updated = 0;
  let failed = 0;

  for (const change of plan.changes) {
    try {
      if (change.removeRoleIds.length) {
        await change.guildMember.roles.remove(change.removeRoleIds, 'SDMC roster synchronization');
      }
      if (change.addRoleId) {
        await change.guildMember.roles.add(change.addRoleId, 'SDMC roster synchronization');
      }
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  const actor: Actor = {
    discordId: interaction.user.id,
    username: interaction.user.username,
  };
  await database.recordRosterSync(actor, updated);

  await interaction.editReply(
    createPanelEdit({
      title: 'Roster Sync Complete',
      description: 'Configured SDMC rank roles have been synchronized with the spreadsheet.',
      details: [
        `**Members updated:** ${updated}`,
        `**Updates that failed:** ${failed}`,
        `**Members not in Discord:** ${plan.missingFromDiscord}`,
      ],
      tone: failed ? 'warning' : 'success',
    }),
  );
}
