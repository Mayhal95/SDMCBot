export const SHEETS = {
  members: 'Members',
  ranks: 'Ranks',
  notes: 'Member Notes',
  audit: 'Audit Log',
  churchMeetings: 'Church Meetings',
  churchAttendance: 'Church Attendance',
  treasuryTransactions: 'Treasury Transactions',
  duesPayments: 'Dues Payments',
} as const;

export const MEMBER_HEADERS = [
  'Member ID',
  'Discord User ID',
  'Discord Username',
  'In-Game Name',
  'Rank',
  'Status',
  'Club Join Date',
  'Discord Server Joined At',
  'Registered At',
  'Registered By Discord ID',
  'Registered By Username',
  'Updated At',
  'Updated By Discord ID',
  'Updated By Username',
] as const;

export const RANK_HEADERS = ['Rank', 'Level', 'Discord Role ID', 'Active', 'Notes'] as const;

export const NOTE_HEADERS = [
  'Note ID',
  'Member ID',
  'Discord User ID',
  'Category',
  'Note',
  'Created At',
  'Author Discord ID',
  'Author Username',
] as const;

export const AUDIT_HEADERS = [
  'Event ID',
  'Timestamp',
  'Action',
  'Member ID',
  'Actor Discord ID',
  'Actor Username',
  'Field',
  'Previous Value',
  'New Value',
] as const;

export const CHURCH_MEETING_HEADERS = [
  'Meeting ID',
  'Meeting Date',
  'Meeting Title',
  'Attendee Count',
  'Topic Count',
  'Summary',
  'Minutes',
  'Actions / Follow-ups',
  'Discord Message ID',
  'Discord Message URL',
  'Thread ID',
  'Thread URL',
  'Published At',
  'Recorded By Discord ID',
  'Recorded By Username',
] as const;

export const CHURCH_ATTENDANCE_HEADERS = [
  'Attendance ID',
  'Meeting ID',
  'Meeting Date',
  'Discord User ID',
  'Discord Username',
  'Member ID',
  'In-Game Name',
  'Rank',
  'Roster Status',
  'Attendance Status',
  'Recorded At',
  'Recorded By Discord ID',
  'Recorded By Username',
] as const;

export const CHURCH_ATTENDANCE_STATUSES = ['Present', 'Absent', 'Excused', 'Late'] as const;

export const TREASURY_FUNDS = ['Money', 'Dirty Money'] as const;

export const TREASURY_TRANSACTION_TYPES = ['Income', 'Expense'] as const;

export const TREASURY_TRANSACTION_HEADERS = [
  'Transaction ID',
  'Timestamp',
  'Type',
  'Fund',
  'Amount',
  'Category',
  'Description',
  'Related Member ID',
  'Related Discord User ID',
  'Related In-Game Name',
  'Recorded By Discord ID',
  'Recorded By Username',
] as const;

export const DUES_PAYMENT_HEADERS = [
  'Payment ID',
  'Period',
  'Paid At',
  'Member ID',
  'Discord User ID',
  'Discord Username',
  'In-Game Name',
  'Amount',
  'Fund',
  'Notes',
  'Transaction ID',
  'Recorded By Discord ID',
  'Recorded By Username',
] as const;

export const MEMBER_STATUSES = [
  'Active',
  'Prospect',
  'Leave',
  'Suspended',
  'Retired',
  'Removed',
] as const;

export const NOTE_CATEGORIES = [
  'General',
  'Attendance',
  'Conduct',
  'Promotion',
  'Disciplinary',
] as const;

export interface MemberRecord {
  rowNumber: number;
  memberId: string;
  discordUserId: string;
  discordUsername: string;
  inGameName: string;
  rank: string;
  status: string;
  clubJoinDate: string;
  discordServerJoinedAt: string;
  registeredAt: string;
  registeredByDiscordId: string;
  registeredByUsername: string;
  updatedAt: string;
  updatedByDiscordId: string;
  updatedByUsername: string;
}

export interface MemberNote {
  noteId: string;
  memberId: string;
  discordUserId: string;
  category: string;
  note: string;
  createdAt: string;
  authorDiscordId: string;
  authorUsername: string;
}

export interface RankMapping {
  rank: string;
  level: number;
  discordRoleId: string;
  active: boolean;
  notes: string;
}

export interface ChurchMeetingRecord {
  meetingId: string;
  meetingDate: string;
  title: string;
  attendeeCount: number;
  topicCount: number;
  summary: string;
  minutes: string;
  actions: string;
  discordMessageId: string;
  discordMessageUrl: string;
  threadId: string;
  threadUrl: string;
  publishedAt: string;
  recordedByDiscordId: string;
  recordedByUsername: string;
}

export interface ChurchAttendanceRecord {
  meetingId: string;
  meetingDate: string;
  status: string;
}

export interface ChurchAttendanceSummary {
  total: number;
  counted: number;
  attended: number;
  present: number;
  absent: number;
  excused: number;
  late: number;
  attendanceRate: number | null;
  recent: ChurchAttendanceRecord[];
}

export type TreasuryFund = (typeof TREASURY_FUNDS)[number];
export type TreasuryTransactionType = (typeof TREASURY_TRANSACTION_TYPES)[number];

export interface TreasuryTransaction {
  transactionId: string;
  timestamp: string;
  type: TreasuryTransactionType;
  fund: TreasuryFund;
  amount: number;
  category: string;
  description: string;
  relatedMemberId: string;
  relatedDiscordUserId: string;
  relatedInGameName: string;
  recordedByDiscordId: string;
  recordedByUsername: string;
}

export interface TreasuryFundSummary {
  balance: number;
  income: number;
  expenses: number;
}

export interface TreasurySummary {
  funds: Record<TreasuryFund, TreasuryFundSummary>;
  recent: TreasuryTransaction[];
  transactionCount: number;
}

export interface DuesPayment {
  paymentId: string;
  period: string;
  paidAt: string;
  memberId: string;
  discordUserId: string;
  discordUsername: string;
  inGameName: string;
  amount: number;
  fund: TreasuryFund;
  notes: string;
  transactionId: string;
  recordedByDiscordId: string;
  recordedByUsername: string;
}

export interface DuesMemberSummary {
  member: MemberRecord;
  amountPaid: number;
  paymentCount: number;
}

export interface DuesReport {
  period: string;
  paid: DuesMemberSummary[];
  unpaid: MemberRecord[];
  totalCollected: number;
  paymentCount: number;
}
