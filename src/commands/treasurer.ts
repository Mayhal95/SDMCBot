import {
  escapeMarkdown,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { hasFounderRole } from '../auth/founder.js';
import { getDatabase, type Actor } from '../database/google-sheets.js';
import type {
  DuesReport,
  TreasuryFund,
  TreasuryTransaction,
  TreasuryTransactionType,
} from '../database/schema.js';
import { createPanelEdit, createPanelReply } from '../ui/panel.js';
import type { BotCommand } from './types.js';

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function actorFrom(interaction: ChatInputCommandInteraction): Actor {
  return { discordId: interaction.user.id, username: interaction.user.username };
}

function currentPeriod(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}

function requestedPeriod(interaction: ChatInputCommandInteraction): string | null {
  const period = interaction.options.getString('period')?.trim() || currentPeriod();
  return periodPattern.test(period) ? period : null;
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function displayDate(value: string): string {
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? 'Unknown date' : `<t:${Math.floor(milliseconds / 1000)}:d>`;
}

function transactionLine(transaction: TreasuryTransaction): string {
  const sign = transaction.type === 'Income' ? '+' : '−';
  const member = transaction.relatedInGameName
    ? ` · ${escapeMarkdown(transaction.relatedInGameName)}`
    : '';
  return `**${sign}${money(transaction.amount)}** ${escapeMarkdown(transaction.fund)} · ${escapeMarkdown(transaction.category)}${member}\n${displayDate(transaction.timestamp)} · ${escapeMarkdown(transaction.description).slice(0, 180)}`;
}

function limitedNames(names: string[], maximum = 15): string {
  if (!names.length) return 'None';
  const visible = names.slice(0, maximum).map((name) => escapeMarkdown(name));
  const remaining = names.length - visible.length;
  return `${visible.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}`;
}

export async function hasTreasuryAccess(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (hasFounderRole(interaction)) return true;
  if (!interaction.inGuild() || !interaction.member) return false;

  const treasurerRoleIds = (await getDatabase().listRankMappings())
    .filter((mapping) => mapping.rank.toLowerCase() === 'treasurer')
    .map((mapping) => mapping.discordRoleId);
  const roles = interaction.member.roles;
  return Array.isArray(roles)
    ? treasurerRoleIds.some((roleId) => roles.includes(roleId))
    : treasurerRoleIds.some((roleId) => roles.cache.has(roleId));
}

async function denyTreasuryAccess(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply(
    createPanelReply({
      title: 'Treasury Access Required',
      description:
        'Only Founders and members with the active Discord role mapped to **Treasurer** can use this command.',
      ephemeral: true,
      tone: 'warning',
    }),
  );
}

async function showOverview(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = getDatabase();
  const period = currentPeriod();
  const [summary, dues] = await Promise.all([
    database.getTreasurySummary(),
    database.getDuesReport(period),
  ]);

  await interaction.editReply(
    createPanelEdit({
      title: 'SDMC Treasury Overview',
      description: 'Current balances calculated from the complete income and expense ledger.',
      details: [
        `**Money balance:** ${money(summary.funds.Money.balance)} · ${money(summary.funds.Money.income)} gained · ${money(summary.funds.Money.expenses)} spent`,
        `**Dirty Money balance:** ${money(summary.funds['Dirty Money'].balance)} · ${money(summary.funds['Dirty Money'].income)} gained · ${money(summary.funds['Dirty Money'].expenses)} spent`,
        `**${period} dues:** ${dues.paid.length} paid · ${dues.unpaid.length} unpaid · ${money(dues.totalCollected)} collected`,
        `**Ledger:** ${summary.transactionCount} total transaction${summary.transactionCount === 1 ? '' : 's'}`,
        ...(summary.recent.length
          ? ['**Latest activity**', ...summary.recent.slice(0, 3).map(transactionLine)]
          : ['No treasury activity has been recorded yet.']),
      ],
    }),
  );
}

async function recordTransaction(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = getDatabase();
  const target = interaction.options.getUser('member');
  const member = target
    ? ((await database.findMemberByDiscordId(target.id)) ?? undefined)
    : undefined;
  if (target && !member) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Member Not Found',
        description: 'Register that Discord user before linking a transaction to them.',
        tone: 'warning',
      }),
    );
    return;
  }

  const transaction = await database.recordTreasuryTransaction({
    type: interaction.options.getString('action', true) as TreasuryTransactionType,
    fund: interaction.options.getString('fund', true) as TreasuryFund,
    amount: interaction.options.getNumber('amount', true),
    category: interaction.options.getString('category', true).trim(),
    description: interaction.options.getString('description', true).trim(),
    member,
    actor: actorFrom(interaction),
  });

  await interaction.editReply(
    createPanelEdit({
      title: 'Transaction Recorded',
      description: 'The treasury ledger and calculated balance have been updated.',
      details: [
        `**Type:** ${transaction.type === 'Income' ? 'Money gained' : 'Money spent'}`,
        `**Fund:** ${transaction.fund}`,
        `**Amount:** ${money(transaction.amount)}`,
        `**Category:** ${escapeMarkdown(transaction.category)}`,
        `**Description:** ${escapeMarkdown(transaction.description)}`,
        ...(member ? [`**Related member:** ${escapeMarkdown(member.inGameName)}`] : []),
        `**Transaction ID:** \`${transaction.transactionId}\``,
      ],
      tone: 'success',
    }),
  );
}

async function showLedger(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fund = interaction.options.getString('fund') as TreasuryFund | null;
  const limit = interaction.options.getInteger('limit') ?? 10;
  const transactions = (await getDatabase().listTreasuryTransactions())
    .filter((transaction) => !fund || transaction.fund === fund)
    .slice(0, limit);

  await interaction.editReply(
    createPanelEdit({
      title: 'Treasury Ledger',
      description: fund ? `Latest ${fund} activity.` : 'Latest activity across both funds.',
      details: transactions.length
        ? transactions.map(transactionLine)
        : ['No matching treasury transactions were found.'],
    }),
  );
}

async function recordDues(interaction: ChatInputCommandInteraction): Promise<void> {
  const period = requestedPeriod(interaction);
  if (!period) {
    await interaction.reply(
      createPanelReply({
        title: 'Invalid Dues Period',
        description: 'Enter the dues period as `YYYY-MM`, for example `2026-10`.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const database = getDatabase();
  const target = interaction.options.getUser('member', true);
  const member = await database.findMemberByDiscordId(target.id);
  if (!member) {
    await interaction.editReply(
      createPanelEdit({
        title: 'Member Not Found',
        description: 'Register that Discord user before recording their dues.',
        tone: 'warning',
      }),
    );
    return;
  }

  const payment = await database.recordDuesPayment({
    period,
    amount: interaction.options.getNumber('amount', true),
    fund: (interaction.options.getString('fund') ?? 'Money') as TreasuryFund,
    notes: interaction.options.getString('note')?.trim() ?? '',
    member,
    actor: actorFrom(interaction),
  });

  await interaction.editReply(
    createPanelEdit({
      title: 'Club Dues Recorded',
      description: 'The payment was saved and automatically added to treasury income.',
      details: [
        `**Member:** ${escapeMarkdown(member.inGameName)} · <@${member.discordUserId}>`,
        `**Period:** ${payment.period}`,
        `**Amount:** ${money(payment.amount)} ${payment.fund}`,
        ...(payment.notes ? [`**Notes:** ${escapeMarkdown(payment.notes)}`] : []),
        `**Payment ID:** \`${payment.paymentId}\``,
        `**Linked transaction:** \`${payment.transactionId}\``,
      ],
      tone: 'success',
    }),
  );
}

function duesReportDetails(report: DuesReport): string[] {
  return [
    `**Collected:** ${money(report.totalCollected)} across ${report.paymentCount} payment${report.paymentCount === 1 ? '' : 's'}`,
    `**Paid members (${report.paid.length}):** ${limitedNames(
      report.paid.map(
        (entry) =>
          `${entry.member.inGameName} (${money(entry.amountPaid)}${entry.paymentCount > 1 ? ` / ${entry.paymentCount} payments` : ''})`,
      ),
    )}`,
    `**No payment recorded (${report.unpaid.length}):** ${limitedNames(
      report.unpaid.map((member) => member.inGameName),
    )}`,
  ];
}

async function showDuesReport(interaction: ChatInputCommandInteraction): Promise<void> {
  const period = requestedPeriod(interaction);
  if (!period) {
    await interaction.reply(
      createPanelReply({
        title: 'Invalid Dues Period',
        description: 'Enter the dues period as `YYYY-MM`, for example `2026-10`.',
        ephemeral: true,
        tone: 'warning',
      }),
    );
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const report = await getDatabase().getDuesReport(period);
  await interaction.editReply(
    createPanelEdit({
      title: `${period} Club Dues`,
      description:
        'Payment status for every active roster member. Multiple payments are combined automatically.',
      details: duesReportDetails(report),
    }),
  );
}

export const treasurerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('treasurer')
    .setDescription('Manage SDMC funds, transactions, and club dues.')
    .addSubcommand((subcommand) =>
      subcommand.setName('overview').setDescription('View current balances and dues totals.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('transaction')
        .setDescription('Record money gained or spent.')
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('Whether funds were gained or spent.')
            .setRequired(true)
            .addChoices(
              { name: 'Money gained', value: 'Income' },
              { name: 'Money spent', value: 'Expense' },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('fund')
            .setDescription('Which club fund changed.')
            .setRequired(true)
            .addChoices(
              { name: 'Money', value: 'Money' },
              { name: 'Dirty Money', value: 'Dirty Money' },
            ),
        )
        .addNumberOption((option) =>
          option
            .setName('amount')
            .setDescription('Amount gained or spent.')
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription('Examples: Club Sale, Supplies, Property, or Event.')
            .setRequired(true)
            .setMaxLength(60),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('A clear reason for the transaction.')
            .setRequired(true)
            .setMaxLength(300),
        )
        .addUserOption((option) =>
          option.setName('member').setDescription('Optional member connected to the transaction.'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ledger')
        .setDescription('View recent treasury activity.')
        .addStringOption((option) =>
          option
            .setName('fund')
            .setDescription('Optionally show only one fund.')
            .addChoices(
              { name: 'Money', value: 'Money' },
              { name: 'Dirty Money', value: 'Dirty Money' },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName('limit')
            .setDescription('Number of recent entries to show.')
            .addChoices(
              { name: '5 entries', value: 5 },
              { name: '10 entries', value: 10 },
              { name: '20 entries', value: 20 },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dues')
        .setDescription('Record a member club-dues payment.')
        .addUserOption((option) =>
          option.setName('member').setDescription('Member who paid dues.').setRequired(true),
        )
        .addNumberOption((option) =>
          option
            .setName('amount')
            .setDescription('Amount the member paid.')
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((option) =>
          option
            .setName('fund')
            .setDescription('Fund receiving the payment; defaults to Money.')
            .addChoices(
              { name: 'Money', value: 'Money' },
              { name: 'Dirty Money', value: 'Dirty Money' },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('period')
            .setDescription('Dues month as YYYY-MM; defaults to the current month.')
            .setMinLength(7)
            .setMaxLength(7),
        )
        .addStringOption((option) =>
          option.setName('note').setDescription('Optional payment note.').setMaxLength(200),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dues-report')
        .setDescription('See who has and has not paid for a dues period.')
        .addStringOption((option) =>
          option
            .setName('period')
            .setDescription('Dues month as YYYY-MM; defaults to the current month.')
            .setMinLength(7)
            .setMaxLength(7),
        ),
    ),

  async execute(interaction) {
    if (!(await hasTreasuryAccess(interaction))) return denyTreasuryAccess(interaction);

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'overview') return showOverview(interaction);
    if (subcommand === 'transaction') return recordTransaction(interaction);
    if (subcommand === 'ledger') return showLedger(interaction);
    if (subcommand === 'dues') return recordDues(interaction);
    return showDuesReport(interaction);
  },
};
