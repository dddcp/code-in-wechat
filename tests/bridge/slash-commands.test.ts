/**
 * TDD tests for slash command parser and executor.
 */

import { describe, test, expect } from 'vitest';
import {
  parseCommand,
  executeCommand,
  formatHelpText,
  COMMANDS,
} from '../../src/bridge/slash-commands';
import type { SlashCommand, CommandContext } from '../../src/bridge/slash-commands';

describe('parseCommand', () => {
  test('parses /new with no args', () => {
    const result = parseCommand('/new');
    expect(result).toEqual({
      name: 'new',
      args: '',
      rawText: '/new',
    } satisfies SlashCommand);
  });

  test('parses /new with title args', () => {
    const result = parseCommand('/new My Project');
    expect(result).toEqual({
      name: 'new',
      args: 'My Project',
      rawText: '/new My Project',
    } satisfies SlashCommand);
  });

  test('parses /reset with no args', () => {
    const result = parseCommand('/reset');
    expect(result).toEqual({
      name: 'reset',
      args: '',
      rawText: '/reset',
    } satisfies SlashCommand);
  });

  test('parses /switch with tool arg', () => {
    const result = parseCommand('/switch opencode');
    expect(result).toEqual({
      name: 'switch',
      args: 'opencode',
      rawText: '/switch opencode',
    } satisfies SlashCommand);
  });

  test('parses /help with no args', () => {
    const result = parseCommand('/help');
    expect(result).toEqual({
      name: 'help',
      args: '',
      rawText: '/help',
    } satisfies SlashCommand);
  });

  test('returns null for non-command messages', () => {
    const result = parseCommand('Hello world');
    expect(result).toBeNull();
  });

  test('parses unknown commands', () => {
    const result = parseCommand('/unknown');
    expect(result).toEqual({
      name: 'unknown',
      args: '',
      rawText: '/unknown',
    } satisfies SlashCommand);
  });

  test('is case insensitive for command names', () => {
    expect(parseCommand('/NEW')).toEqual({
      name: 'new',
      args: '',
      rawText: '/NEW',
    });

    expect(parseCommand('/Reset')).toEqual({
      name: 'reset',
      args: '',
      rawText: '/Reset',
    });
  });

  test('trims leading and trailing whitespace', () => {
    const result = parseCommand('  /new  My Title  ');
    expect(result).toEqual({
      name: 'new',
      args: 'My Title',
      rawText: '/new  My Title',
    });
  });
});

describe('formatHelpText', () => {
  test('returns non-empty string', () => {
    const help = formatHelpText();
    expect(help.length).toBeGreaterThan(0);
  });

  test('lists all known commands', () => {
    const help = formatHelpText();
    for (const name of Object.keys(COMMANDS)) {
      expect(help).toContain(`/${name}`);
    }
  });
});

describe('executeCommand', () => {
  const emptyContext: CommandContext = {};

  test('/new returns success', async () => {
    const result = await executeCommand(
      { name: 'new', args: '', rawText: '/new' },
      emptyContext,
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe('New conversation started');
  });

  test('/new with title returns success', async () => {
    const result = await executeCommand(
      { name: 'new', args: 'My Title', rawText: '/new My Title' },
      emptyContext,
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe('New conversation started');
  });

  test('/reset returns success', async () => {
    const result = await executeCommand(
      { name: 'reset', args: '', rawText: '/reset' },
      emptyContext,
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe('Session reset');
  });

  test('/switch returns coming soon stub', async () => {
    const result = await executeCommand(
      { name: 'switch', args: 'opencode', rawText: '/switch opencode' },
      emptyContext,
    );
    expect(result.success).toBe(false);
    expect(result.message).toBe('Tool switching coming soon');
  });

  test('/help returns success with help text', async () => {
    const result = await executeCommand(
      { name: 'help', args: '', rawText: '/help' },
      emptyContext,
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe(formatHelpText());
  });

  test('unknown command returns failure with help text', async () => {
    const result = await executeCommand(
      { name: 'unknown', args: '', rawText: '/unknown' },
      emptyContext,
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown command: /unknown');
    expect(result.message).toContain(formatHelpText());
  });
});
