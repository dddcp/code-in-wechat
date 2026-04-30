/**
 * Slash command parser and executor.
 * Detects messages starting with "/" and routes them to handlers.
 */

import type { SwitchableAdapter } from '@/tools/switchable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashCommand {
  name: string;
  args: string;
  rawText: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  newState?: Record<string, unknown>;
}

export interface CommandContext {
  sessionId?: string;
  currentTool?: string;
  toolAdapter?: SwitchableAdapter;
}

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

export const COMMANDS: Record<string, string> = {
  new: 'Start a new conversation with optional title',
  reset: 'Reset the current session',
  switch: 'Switch to a different tool',
  help: 'Show available commands',
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  const firstSpaceIndex = withoutSlash.search(/\s/);

  let name: string;
  let args: string;

  if (firstSpaceIndex === -1) {
    name = withoutSlash;
    args = '';
  } else {
    name = withoutSlash.slice(0, firstSpaceIndex);
    args = withoutSlash.slice(firstSpaceIndex + 1).trim();
  }

  return {
    name: name.toLowerCase(),
    args,
    rawText: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Help formatter
// ---------------------------------------------------------------------------

export function formatHelpText(): string {
  const lines: string[] = ['Available commands:'];

  for (const [name, description] of Object.entries(COMMANDS)) {
    lines.push(`  /${name} - ${description}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeCommand(
  command: SlashCommand,
  _context: CommandContext,
): Promise<CommandResult> {
  switch (command.name) {
    case 'new': {
      return {
        success: true,
        message: 'New conversation started',
      };
    }

    case 'reset': {
      return {
        success: true,
        message: 'Session reset',
      };
    }

    case 'switch': {
      if (!_context.toolAdapter) {
        return {
          success: false,
          message: 'Tool switching is not available',
        };
      }

      const toolName = command.args.trim().toLowerCase();
      const adapter = _context.toolAdapter;

      // No argument: show current tool and available options
      if (!toolName) {
        const current = adapter.getCurrentTool();
        const available = adapter.getAvailableTools().join(', ');
        return {
          success: true,
          message: `当前工具: ${current}\n可用工具: ${available}\n用法: /switch <工具名>`,
        };
      }

      // Switch to specified tool
      const result = adapter.switchTo(toolName);
      return {
        success: result.success,
        message: result.message,
      };
    }

    case 'help': {
      return {
        success: true,
        message: formatHelpText(),
      };
    }

    default: {
      return {
        success: false,
        message: `Unknown command: /${command.name}\n\n${formatHelpText()}`,
      };
    }
  }
}
