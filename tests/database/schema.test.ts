import { describe, expect, it } from 'vitest';

import {
  CHURCH_ATTENDANCE_HEADERS,
  CHURCH_ATTENDANCE_STATUSES,
  CHURCH_MEETING_HEADERS,
  DUES_PAYMENT_HEADERS,
  SHEETS,
  TREASURY_FUNDS,
  TREASURY_TRANSACTION_HEADERS,
  TREASURY_TRANSACTION_TYPES,
} from '../../src/database/schema.js';

describe('church database schema', () => {
  it('uses dedicated meeting and attendance tabs', () => {
    expect(SHEETS.churchMeetings).toBe('Church Meetings');
    expect(SHEETS.churchAttendance).toBe('Church Attendance');
  });

  it('links attendance rows back to a meeting and member identity', () => {
    expect(CHURCH_MEETING_HEADERS).toContain('Meeting ID');
    expect(CHURCH_MEETING_HEADERS).toContain('Attendee Count');
    expect(CHURCH_ATTENDANCE_HEADERS).toEqual(
      expect.arrayContaining([
        'Meeting ID',
        'Discord User ID',
        'Member ID',
        'In-Game Name',
        'Rank',
        'Attendance Status',
      ]),
    );
  });

  it('supports staff attendance corrections', () => {
    expect(CHURCH_ATTENDANCE_STATUSES).toEqual(['Present', 'Absent', 'Excused', 'Late']);
  });
});

describe('treasury database schema', () => {
  it('uses separate immutable transaction and dues-payment tabs', () => {
    expect(SHEETS.treasuryTransactions).toBe('Treasury Transactions');
    expect(SHEETS.duesPayments).toBe('Dues Payments');
    expect(TREASURY_TRANSACTION_HEADERS).toContain('Transaction ID');
    expect(TREASURY_TRANSACTION_HEADERS).toContain('Related Member ID');
    expect(DUES_PAYMENT_HEADERS).toContain('Transaction ID');
    expect(DUES_PAYMENT_HEADERS).toContain('Period');
  });

  it('tracks both fund types and both transaction directions', () => {
    expect(TREASURY_FUNDS).toEqual(['Money', 'Dirty Money']);
    expect(TREASURY_TRANSACTION_TYPES).toEqual(['Income', 'Expense']);
  });
});
