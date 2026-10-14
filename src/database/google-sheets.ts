import { randomUUID } from 'node:crypto';

import { google, type sheets_v4 } from 'googleapis';

import { env } from '../config/env.js';
import { summarizeChurchAttendance } from './attendance.js';
import { DatabaseConfigurationError, DatabaseSchemaError } from './errors.js';
import {
  AUDIT_HEADERS,
  CHURCH_ATTENDANCE_HEADERS,
  CHURCH_MEETING_HEADERS,
  DUES_PAYMENT_HEADERS,
  MEMBER_HEADERS,
  NOTE_HEADERS,
  RANK_HEADERS,
  SHEETS,
  TREASURY_FUNDS,
  TREASURY_TRANSACTION_HEADERS,
  type MemberNote,
  type MemberRecord,
  type RankMapping,
  type ChurchMeetingRecord,
  type ChurchAttendanceSummary,
  type DuesPayment,
  type DuesReport,
  type TreasuryFund,
  type TreasurySummary,
  type TreasuryTransaction,
  type TreasuryTransactionType,
} from './schema.js';

export interface Actor {
  discordId: string;
  username: string;
}

export interface RegisterMemberInput {
  discordUserId: string;
  discordUsername: string;
  inGameName: string;
  rank: string;
  status?: string;
  clubJoinDate: string;
  discordServerJoinedAt: string;
  actor: Actor;
}

export interface UpdateMemberInput {
  inGameName: string;
  rank: string;
  status: string;
  actor: Actor;
}

export interface AddNoteInput {
  member: MemberRecord;
  category: string;
  note: string;
  actor: Actor;
}

export interface RecordChurchMeetingInput {
  meetingDate: string;
  title: string;
  topicCount: number;
  summary: string;
  minutes: string;
  actions: string;
  discordMessageId: string;
  discordMessageUrl: string;
  threadId: string;
  threadUrl: string;
  presentMembers: Array<{ discordUserId: string; discordUsername: string }>;
  actor: Actor;
}

export interface RecordTreasuryTransactionInput {
  type: TreasuryTransactionType;
  fund: TreasuryFund;
  amount: number;
  category: string;
  description: string;
  member?: MemberRecord | undefined;
  actor: Actor;
}

export interface RecordDuesPaymentInput {
  period: string;
  amount: number;
  fund: TreasuryFund;
  notes: string;
  member: MemberRecord;
  actor: Actor;
}

export function createSheetsClient(): sheets_v4.Sheets {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new DatabaseConfigurationError();
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(asString(value));
  return Number.isFinite(number) ? number : 0;
}

function createId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function memberToRow(member: Omit<MemberRecord, 'rowNumber'>): string[] {
  return [
    member.memberId,
    member.discordUserId,
    member.discordUsername,
    member.inGameName,
    member.rank,
    member.status,
    member.clubJoinDate,
    member.discordServerJoinedAt,
    member.registeredAt,
    member.registeredByDiscordId,
    member.registeredByUsername,
    member.updatedAt,
    member.updatedByDiscordId,
    member.updatedByUsername,
  ];
}

function rowToMember(row: unknown[], index: number): MemberRecord | null {
  const memberId = asString(row[0]);
  const discordUserId = asString(row[1]);
  if (!memberId || !discordUserId) return null;

  return {
    rowNumber: index + 2,
    memberId,
    discordUserId,
    discordUsername: asString(row[2]),
    inGameName: asString(row[3]),
    rank: asString(row[4]),
    status: asString(row[5]),
    clubJoinDate: asString(row[6]),
    discordServerJoinedAt: asString(row[7]),
    registeredAt: asString(row[8]),
    registeredByDiscordId: asString(row[9]),
    registeredByUsername: asString(row[10]),
    updatedAt: asString(row[11]),
    updatedByDiscordId: asString(row[12]),
    updatedByUsername: asString(row[13]),
  };
}

function rowToTreasuryTransaction(row: unknown[]): TreasuryTransaction | null {
  const transactionId = asString(row[0]);
  const type = asString(row[2]);
  const fund = asString(row[3]);
  if (
    !transactionId ||
    !['Income', 'Expense'].includes(type) ||
    !TREASURY_FUNDS.includes(fund as TreasuryFund)
  ) {
    return null;
  }

  return {
    transactionId,
    timestamp: asString(row[1]),
    type: type as TreasuryTransactionType,
    fund: fund as TreasuryFund,
    amount: asNumber(row[4]),
    category: asString(row[5]),
    description: asString(row[6]),
    relatedMemberId: asString(row[7]),
    relatedDiscordUserId: asString(row[8]),
    relatedInGameName: asString(row[9]),
    recordedByDiscordId: asString(row[10]),
    recordedByUsername: asString(row[11]),
  };
}

function treasuryTransactionToRow(
  transaction: TreasuryTransaction,
): Array<string | number | boolean> {
  return [
    transaction.transactionId,
    transaction.timestamp,
    transaction.type,
    transaction.fund,
    transaction.amount,
    transaction.category,
    transaction.description,
    transaction.relatedMemberId,
    transaction.relatedDiscordUserId,
    transaction.relatedInGameName,
    transaction.recordedByDiscordId,
    transaction.recordedByUsername,
  ];
}

function rowToDuesPayment(row: unknown[]): DuesPayment | null {
  const paymentId = asString(row[0]);
  const fund = asString(row[8]);
  if (!paymentId || !TREASURY_FUNDS.includes(fund as TreasuryFund)) return null;

  return {
    paymentId,
    period: asString(row[1]),
    paidAt: asString(row[2]),
    memberId: asString(row[3]),
    discordUserId: asString(row[4]),
    discordUsername: asString(row[5]),
    inGameName: asString(row[6]),
    amount: asNumber(row[7]),
    fund: fund as TreasuryFund,
    notes: asString(row[9]),
    transactionId: asString(row[10]),
    recordedByDiscordId: asString(row[11]),
    recordedByUsername: asString(row[12]),
  };
}

export class GoogleSheetsDatabase {
  private readonly sheets: sheets_v4.Sheets;
  private readonly spreadsheetId = env.GOOGLE_SPREADSHEET_ID;

  constructor() {
    this.sheets = createSheetsClient();
  }

  async listMembers(): Promise<MemberRecord[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${SHEETS.members}'!A2:N1000`,
    });

    return (response.data.values ?? [])
      .map((row, index) => rowToMember(row, index))
      .filter((member): member is MemberRecord => member !== null);
  }

  async findMemberByDiscordId(discordUserId: string): Promise<MemberRecord | null> {
    const members = await this.listMembers();
    return members.find((member) => member.discordUserId === discordUserId) ?? null;
  }

  async registerMember(input: RegisterMemberInput): Promise<MemberRecord> {
    const existing = await this.findMemberByDiscordId(input.discordUserId);
    if (existing) {
      throw new DatabaseSchemaError('That Discord user is already registered in the roster.');
    }

    const now = new Date().toISOString();
    const member: Omit<MemberRecord, 'rowNumber'> = {
      memberId: createId('SDMC'),
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      inGameName: input.inGameName,
      rank: input.rank,
      status: input.status ?? 'Active',
      clubJoinDate: input.clubJoinDate,
      discordServerJoinedAt: input.discordServerJoinedAt,
      registeredAt: now,
      registeredByDiscordId: input.actor.discordId,
      registeredByUsername: input.actor.username,
      updatedAt: now,
      updatedByDiscordId: input.actor.discordId,
      updatedByUsername: input.actor.username,
    };

    await this.appendRow(SHEETS.members, MEMBER_HEADERS.length, memberToRow(member));
    await this.appendAudit(
      'REGISTER_MEMBER',
      member.memberId,
      input.actor,
      '',
      '',
      input.inGameName,
    );

    const members = await this.listMembers();
    const saved = members.find((entry) => entry.memberId === member.memberId);
    if (!saved) throw new DatabaseSchemaError('The member row could not be verified after saving.');
    return saved;
  }

  async updateMember(member: MemberRecord, input: UpdateMemberInput): Promise<MemberRecord> {
    const now = new Date().toISOString();
    const updated: MemberRecord = {
      ...member,
      inGameName: input.inGameName,
      rank: input.rank,
      status: input.status,
      updatedAt: now,
      updatedByDiscordId: input.actor.discordId,
      updatedByUsername: input.actor.username,
    };

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `'${SHEETS.members}'!A${member.rowNumber}:N${member.rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [memberToRow(updated)] },
    });

    const changes: Array<[string, string, string]> = [
      ['In-Game Name', member.inGameName, updated.inGameName],
      ['Rank', member.rank, updated.rank],
      ['Status', member.status, updated.status],
    ];
    for (const [field, previousValue, newValue] of changes) {
      if (previousValue !== newValue) {
        await this.appendAudit(
          'EDIT_MEMBER',
          member.memberId,
          input.actor,
          field,
          previousValue,
          newValue,
        );
      }
    }

    return updated;
  }

  async removeMember(member: MemberRecord, actor: Actor): Promise<void> {
    const [metadata, memberRows, noteRows] = await Promise.all([
      this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets.properties(sheetId,title)',
      }),
      this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${SHEETS.members}'!A2:A1000`,
      }),
      this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${SHEETS.notes}'!A2:B1000`,
      }),
    ]);

    const sheetIds = new Map(
      (metadata.data.sheets ?? []).map((sheet) => [
        sheet.properties?.title ?? '',
        sheet.properties?.sheetId,
      ]),
    );
    const membersSheetId = sheetIds.get(SHEETS.members);
    const notesSheetId = sheetIds.get(SHEETS.notes);
    if (membersSheetId === undefined || notesSheetId === undefined) {
      throw new DatabaseSchemaError('The Members or Member Notes sheet could not be found.');
    }

    const memberRowIndex = (memberRows.data.values ?? []).findIndex(
      (row) => asString(row[0]) === member.memberId,
    );
    if (memberRowIndex < 0) {
      throw new DatabaseSchemaError('This member is no longer present in the roster.');
    }

    const noteRowIndexes = (noteRows.data.values ?? [])
      .map((row, index) => ({ memberId: asString(row[1]), index: index + 1 }))
      .filter((row) => row.memberId === member.memberId)
      .map((row) => row.index)
      .sort((left, right) => right - left);

    const requests: sheets_v4.Schema$Request[] = noteRowIndexes.map((startIndex) => ({
      deleteDimension: {
        range: {
          sheetId: notesSheetId,
          dimension: 'ROWS',
          startIndex,
          endIndex: startIndex + 1,
        },
      },
    }));
    requests.push({
      deleteDimension: {
        range: {
          sheetId: membersSheetId,
          dimension: 'ROWS',
          startIndex: memberRowIndex + 1,
          endIndex: memberRowIndex + 2,
        },
      },
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
    await this.appendAudit(
      'REMOVE_MEMBER',
      member.memberId,
      actor,
      'Member Record',
      'Present',
      'Deleted',
    );
  }

  async addNote(input: AddNoteInput): Promise<MemberNote> {
    const note: MemberNote = {
      noteId: createId('NOTE'),
      memberId: input.member.memberId,
      discordUserId: input.member.discordUserId,
      category: input.category,
      note: input.note,
      createdAt: new Date().toISOString(),
      authorDiscordId: input.actor.discordId,
      authorUsername: input.actor.username,
    };

    await this.appendRow(SHEETS.notes, NOTE_HEADERS.length, [
      note.noteId,
      note.memberId,
      note.discordUserId,
      note.category,
      note.note,
      note.createdAt,
      note.authorDiscordId,
      note.authorUsername,
    ]);
    await this.appendAudit('ADD_NOTE', note.memberId, input.actor, 'Note', '', note.category);
    return note;
  }

  async listNotes(memberId: string): Promise<MemberNote[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${SHEETS.notes}'!A2:H1000`,
    });

    return (response.data.values ?? [])
      .map((row): MemberNote => ({
        noteId: asString(row[0]),
        memberId: asString(row[1]),
        discordUserId: asString(row[2]),
        category: asString(row[3]),
        note: asString(row[4]),
        createdAt: asString(row[5]),
        authorDiscordId: asString(row[6]),
        authorUsername: asString(row[7]),
      }))
      .filter((note) => note.noteId && note.memberId === memberId)
      .reverse();
  }

  async listRankMappings(): Promise<RankMapping[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${SHEETS.ranks}'!A2:E250`,
    });

    return (response.data.values ?? [])
      .map((row): RankMapping => ({
        rank: asString(row[0]),
        level: Number(row[1] ?? 0),
        discordRoleId: asString(row[2]),
        active: ['true', 'yes', '1'].includes(asString(row[3]).toLowerCase()),
        notes: asString(row[4]),
      }))
      .filter((rank) => rank.rank && rank.discordRoleId && rank.active);
  }

  async getChurchAttendanceSummary(discordUserId: string): Promise<ChurchAttendanceSummary> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${SHEETS.churchAttendance}'!B2:J5000`,
    });
    const records = (response.data.values ?? [])
      .filter((row) => asString(row[2]) === discordUserId)
      .map((row) => ({
        meetingId: asString(row[0]),
        meetingDate: asString(row[1]),
        status: asString(row[8]),
      }))
      .filter((record) => record.meetingId && record.meetingDate && record.status);
    return summarizeChurchAttendance(records);
  }

  async recordRosterSync(actor: Actor, changedMembers: number): Promise<void> {
    await this.appendAudit(
      'SYNC_ROSTER',
      '',
      actor,
      'Discord Roles',
      '',
      `${changedMembers} member(s) synchronized`,
    );
  }

  async recordChurchMeeting(input: RecordChurchMeetingInput): Promise<ChurchMeetingRecord> {
    const publishedAt = new Date().toISOString();
    const meetingId = createId('CHURCH');
    const presentByDiscordId = new Map(
      input.presentMembers.map((member) => [member.discordUserId, member.discordUsername]),
    );
    const roster = await this.listMembers();
    const trackedRoster = roster.filter(
      (member) => !['removed', 'retired'].includes(member.status.toLowerCase()),
    );
    const rosterByDiscordId = new Map(
      trackedRoster.map((member) => [member.discordUserId, member]),
    );
    const trackedDiscordIds = new Set([
      ...trackedRoster.map((member) => member.discordUserId),
      ...presentByDiscordId.keys(),
    ]);
    const meeting: ChurchMeetingRecord = {
      meetingId,
      meetingDate: input.meetingDate,
      title: input.title,
      attendeeCount: presentByDiscordId.size,
      topicCount: input.topicCount,
      summary: input.summary,
      minutes: input.minutes,
      actions: input.actions,
      discordMessageId: input.discordMessageId,
      discordMessageUrl: input.discordMessageUrl,
      threadId: input.threadId,
      threadUrl: input.threadUrl,
      publishedAt,
      recordedByDiscordId: input.actor.discordId,
      recordedByUsername: input.actor.username,
    };

    await this.appendRow(SHEETS.churchMeetings, CHURCH_MEETING_HEADERS.length, [
      meeting.meetingId,
      meeting.meetingDate,
      meeting.title,
      meeting.attendeeCount,
      meeting.topicCount,
      meeting.summary,
      meeting.minutes,
      meeting.actions,
      meeting.discordMessageId,
      meeting.discordMessageUrl,
      meeting.threadId,
      meeting.threadUrl,
      meeting.publishedAt,
      meeting.recordedByDiscordId,
      meeting.recordedByUsername,
    ]);

    const attendanceRows = [...trackedDiscordIds].map((discordUserId) => {
      const member = rosterByDiscordId.get(discordUserId);
      const isPresent = presentByDiscordId.has(discordUserId);
      return [
        createId('ATTEND'),
        meetingId,
        input.meetingDate,
        discordUserId,
        presentByDiscordId.get(discordUserId) ?? member?.discordUsername ?? 'Unknown',
        member?.memberId ?? '',
        member?.inGameName ?? '',
        member?.rank ?? '',
        member?.status ?? 'Unregistered',
        isPresent ? 'Present' : 'Absent',
        publishedAt,
        input.actor.discordId,
        input.actor.username,
      ];
    });
    await this.appendRows(
      SHEETS.churchAttendance,
      CHURCH_ATTENDANCE_HEADERS.length,
      attendanceRows,
    );
    await this.appendAudit(
      'RECORD_CHURCH',
      meetingId,
      input.actor,
      'Attendance',
      '',
      `${meeting.attendeeCount} present / ${attendanceRows.length} tracked`,
    );
    return meeting;
  }

  async listTreasuryTransactions(): Promise<TreasuryTransaction[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${SHEETS.treasuryTransactions}'!A2:L10000`,
    });

    return (response.data.values ?? [])
      .map((row) => rowToTreasuryTransaction(row))
      .filter((transaction): transaction is TreasuryTransaction => transaction !== null)
      .reverse();
  }

  async recordTreasuryTransaction(
    input: RecordTreasuryTransactionInput,
  ): Promise<TreasuryTransaction> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new DatabaseSchemaError('Treasury amounts must be greater than zero.');
    }

    const transaction: TreasuryTransaction = {
      transactionId: createId('TXN'),
      timestamp: new Date().toISOString(),
      type: input.type,
      fund: input.fund,
      amount: input.amount,
      category: input.category,
      description: input.description,
      relatedMemberId: input.member?.memberId ?? '',
      relatedDiscordUserId: input.member?.discordUserId ?? '',
      relatedInGameName: input.member?.inGameName ?? '',
      recordedByDiscordId: input.actor.discordId,
      recordedByUsername: input.actor.username,
    };

    await this.appendRow(
      SHEETS.treasuryTransactions,
      TREASURY_TRANSACTION_HEADERS.length,
      treasuryTransactionToRow(transaction),
    );
    await this.appendAudit(
      'TREASURY_TRANSACTION',
      input.member?.memberId ?? '',
      input.actor,
      `${transaction.fund} ${transaction.type}`,
      '',
      `${transaction.amount}: ${transaction.category}`,
    );
    return transaction;
  }

  async getTreasurySummary(): Promise<TreasurySummary> {
    const transactions = await this.listTreasuryTransactions();
    const funds: TreasurySummary['funds'] = {
      Money: { balance: 0, income: 0, expenses: 0 },
      'Dirty Money': { balance: 0, income: 0, expenses: 0 },
    };

    for (const transaction of transactions) {
      const summary = funds[transaction.fund];
      if (transaction.type === 'Income') {
        summary.income += transaction.amount;
        summary.balance += transaction.amount;
      } else {
        summary.expenses += transaction.amount;
        summary.balance -= transaction.amount;
      }
    }

    return {
      funds,
      recent: transactions.slice(0, 5),
      transactionCount: transactions.length,
    };
  }

  async listDuesPayments(period?: string): Promise<DuesPayment[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${SHEETS.duesPayments}'!A2:M10000`,
    });
    return (response.data.values ?? [])
      .map((row) => rowToDuesPayment(row))
      .filter(
        (payment): payment is DuesPayment =>
          payment !== null && (!period || payment.period === period),
      )
      .reverse();
  }

  async recordDuesPayment(input: RecordDuesPaymentInput): Promise<DuesPayment> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new DatabaseSchemaError('Dues payments must be greater than zero.');
    }

    const paidAt = new Date().toISOString();
    const transaction: TreasuryTransaction = {
      transactionId: createId('TXN'),
      timestamp: paidAt,
      type: 'Income',
      fund: input.fund,
      amount: input.amount,
      category: 'Club Dues',
      description: `${input.period} dues — ${input.member.inGameName}`,
      relatedMemberId: input.member.memberId,
      relatedDiscordUserId: input.member.discordUserId,
      relatedInGameName: input.member.inGameName,
      recordedByDiscordId: input.actor.discordId,
      recordedByUsername: input.actor.username,
    };
    const payment: DuesPayment = {
      paymentId: createId('DUES'),
      period: input.period,
      paidAt,
      memberId: input.member.memberId,
      discordUserId: input.member.discordUserId,
      discordUsername: input.member.discordUsername,
      inGameName: input.member.inGameName,
      amount: input.amount,
      fund: input.fund,
      notes: input.notes,
      transactionId: transaction.transactionId,
      recordedByDiscordId: input.actor.discordId,
      recordedByUsername: input.actor.username,
    };

    const [transactionIds, paymentIds] = await Promise.all([
      this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${SHEETS.treasuryTransactions}'!A2:A10000`,
      }),
      this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${SHEETS.duesPayments}'!A2:A10000`,
      }),
    ]);
    const transactionRow = (transactionIds.data.values?.length ?? 0) + 2;
    const paymentRow = (paymentIds.data.values?.length ?? 0) + 2;

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {
            range: `'${SHEETS.treasuryTransactions}'!A${transactionRow}:L${transactionRow}`,
            values: [treasuryTransactionToRow(transaction)],
          },
          {
            range: `'${SHEETS.duesPayments}'!A${paymentRow}:M${paymentRow}`,
            values: [
              [
                payment.paymentId,
                payment.period,
                payment.paidAt,
                payment.memberId,
                payment.discordUserId,
                payment.discordUsername,
                payment.inGameName,
                payment.amount,
                payment.fund,
                payment.notes,
                payment.transactionId,
                payment.recordedByDiscordId,
                payment.recordedByUsername,
              ],
            ],
          },
        ],
      },
    });
    await this.appendAudit(
      'RECORD_DUES',
      input.member.memberId,
      input.actor,
      input.period,
      '',
      `${input.amount} ${input.fund}`,
    );
    return payment;
  }

  async getDuesReport(period: string): Promise<DuesReport> {
    const [members, payments] = await Promise.all([
      this.listMembers(),
      this.listDuesPayments(period),
    ]);
    const trackedMembers = members.filter(
      (member) => !['removed', 'retired'].includes(member.status.toLowerCase()),
    );
    const paymentsByDiscordId = new Map<string, DuesPayment[]>();
    for (const payment of payments) {
      const memberPayments = paymentsByDiscordId.get(payment.discordUserId) ?? [];
      memberPayments.push(payment);
      paymentsByDiscordId.set(payment.discordUserId, memberPayments);
    }

    const paid = trackedMembers
      .filter((member) => paymentsByDiscordId.has(member.discordUserId))
      .map((member) => {
        const memberPayments = paymentsByDiscordId.get(member.discordUserId) ?? [];
        return {
          member,
          amountPaid: memberPayments.reduce((total, payment) => total + payment.amount, 0),
          paymentCount: memberPayments.length,
        };
      })
      .sort((left, right) => left.member.inGameName.localeCompare(right.member.inGameName));
    const unpaid = trackedMembers
      .filter((member) => !paymentsByDiscordId.has(member.discordUserId))
      .sort((left, right) => left.inGameName.localeCompare(right.inGameName));

    return {
      period,
      paid,
      unpaid,
      totalCollected: payments.reduce((total, payment) => total + payment.amount, 0),
      paymentCount: payments.length,
    };
  }

  private async appendRow(
    sheetName: string,
    width: number,
    row: Array<string | number | boolean>,
  ): Promise<void> {
    await this.appendRows(sheetName, width, [row]);
  }

  private async appendRows(
    sheetName: string,
    width: number,
    rows: Array<Array<string | number | boolean>>,
  ): Promise<void> {
    if (!rows.length) return;
    const endColumn = String.fromCharCode(64 + width);
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `'${sheetName}'!A:${endColumn}`,
      valueInputOption: 'RAW',
      insertDataOption: 'OVERWRITE',
      requestBody: { values: rows },
    });
  }

  private async appendAudit(
    action: string,
    memberId: string,
    actor: Actor,
    field: string,
    previousValue: string,
    newValue: string,
  ): Promise<void> {
    await this.appendRow(SHEETS.audit, AUDIT_HEADERS.length, [
      createId('EVENT'),
      new Date().toISOString(),
      action,
      memberId,
      actor.discordId,
      actor.username,
      field,
      previousValue,
      newValue,
    ]);
  }
}

let database: GoogleSheetsDatabase | undefined;

export function getDatabase(): GoogleSheetsDatabase {
  database ??= new GoogleSheetsDatabase();
  return database;
}

export const DATABASE_HEADERS = {
  [SHEETS.members]: MEMBER_HEADERS,
  [SHEETS.ranks]: RANK_HEADERS,
  [SHEETS.notes]: NOTE_HEADERS,
  [SHEETS.audit]: AUDIT_HEADERS,
  [SHEETS.churchMeetings]: CHURCH_MEETING_HEADERS,
  [SHEETS.churchAttendance]: CHURCH_ATTENDANCE_HEADERS,
  [SHEETS.treasuryTransactions]: TREASURY_TRANSACTION_HEADERS,
  [SHEETS.duesPayments]: DUES_PAYMENT_HEADERS,
} as const;
