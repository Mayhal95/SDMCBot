import { describe, expect, it } from 'vitest';

import { churchCommand } from '../../src/commands/church.js';
import { memberCommand } from '../../src/commands/member.js';
import { rosterCommand } from '../../src/commands/roster.js';
import { treasurerCommand } from '../../src/commands/treasurer.js';
import type { BotCommand } from '../../src/commands/types.js';
import { voteCommand, voteOutcome } from '../../src/commands/vote.js';

function subcommandNames(command: BotCommand): string[] {
  return command.data.toJSON().options?.map((option) => option.name) ?? [];
}

describe('management command definitions', () => {
  it('registers every requested member subcommand', () => {
    expect(subcommandNames(memberCommand)).toEqual(['register', 'view', 'edit', 'notes']);
  });

  it('registers roster view and sync subcommands', () => {
    expect(subcommandNames(rosterCommand)).toEqual(['view', 'sync']);
  });

  it('requires a Discord user for member registration', () => {
    const register = memberCommand.data
      .toJSON()
      .options?.find((option) => option.name === 'register');

    expect(register).toMatchObject({
      name: 'register',
      options: [{ name: 'member', required: true }],
    });
  });

  it('offers edit and removal actions for an existing member', () => {
    const edit = memberCommand.data.toJSON().options?.find((option) => option.name === 'edit');

    expect(edit).toMatchObject({
      name: 'edit',
      options: [
        { name: 'member', required: true },
        {
          name: 'action',
          choices: [
            { name: 'Edit profile', value: 'edit' },
            { name: 'Remove member', value: 'remove' },
          ],
        },
      ],
    });
  });

  it('registers the church console command', () => {
    expect(churchCommand.data.toJSON()).toMatchObject({ name: 'church', options: [] });
  });

  it('registers the complete treasurer workflow', () => {
    expect(subcommandNames(treasurerCommand)).toEqual([
      'overview',
      'transaction',
      'ledger',
      'dues',
      'dues-report',
    ]);
  });

  it('requires the essential transaction fields', () => {
    const transaction = treasurerCommand.data
      .toJSON()
      .options?.find((option) => option.name === 'transaction');
    expect(transaction).toMatchObject({
      options: [
        { name: 'action', required: true },
        { name: 'fund', required: true },
        { name: 'amount', required: true },
        { name: 'category', required: true },
        { name: 'description', required: true },
        { name: 'member' },
      ],
    });
  });

  it('limits votes to the supported 15 and 30 second durations', () => {
    const duration = voteCommand.data
      .toJSON()
      .options?.find((option) => option.name === 'duration');
    expect(duration).toMatchObject({
      required: true,
      choices: [
        { name: '15 seconds', value: 15 },
        { name: '30 seconds', value: 30 },
      ],
    });
  });

  it('describes unanimous and split vote outcomes', () => {
    expect(voteOutcome(4, 0, 0)).toBe('Unanimous Approval');
    expect(voteOutcome(0, 3, 0)).toBe('Unanimous Rejection');
    expect(voteOutcome(3, 2, 1)).toBe('Vote Passed');
    expect(voteOutcome(2, 2, 0)).toBe('Tie Vote');
  });
});
