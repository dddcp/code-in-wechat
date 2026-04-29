import { describe, test, expect } from 'vitest';

import {
  MessageType,
  MessageState,
  WeChatMessageItemType,
  LoginStatus,
  type WeChatMessage,
  type WeChatTextItem,
  type WeChatImageItem,
  type WeChatFileItem,
  type WeChatVoiceItem,
  type WeChatVideoItem,
  type WeChatLoginStatus,
  type iLinkConfig,
  type WeChatSendMessageParams,
} from '../../src/types/wechat';

import {
  BridgeEventType,
  type BridgeEvent,
  type SlashCommand,
  type BridgeStreamChunk,
  type CommandContext,
  type CommandResult,
} from '../../src/types/bridge';

import {
  ToolMessageRole,
  ToolMessagePartType,
  type ToolMessage,
  type ToolMessagePartLegacy,
  type ToolResponse,
  type ToolSession,
  type ToolAdapter,
  type StreamChunk,
  type TextMessagePart,
  type FileMessagePart,
  ToolAdapterError,
} from '../../src/types/tool';

import {
  type AppConfig,
  type iLinkConfig as ILinkAppConfig,
  type OpenCodeConfig,
  type ServerConfig,
  type LoggingConfig,
} from '../../src/types/config';

import type {
  iLinkConfig as BarrelILinkConfig,
  ILinkAppConfig as BarrelILinkAppConfig,
} from '../../src/types';

describe('WeChat types', () => {
  test('WeChatMessage shape', () => {
    const msg: WeChatMessage = {
      from_user_id: 'u1',
      to_user_id: 'u2',
      message_type: MessageType.USER,
      message_state: MessageState.NEW,
      context_token: 'tok-123',
      item_list: [],
    };

    expect(msg.message_type).toBe(1);
    expect(msg.message_state).toBe(0);
  });

  test('WeChatTextItem shape', () => {
    const item: WeChatTextItem = {
      type: WeChatMessageItemType.TEXT,
      text: 'hello',
    };

    expect(item.type).toBe(1);
  });

  test('WeChatImageItem shape', () => {
    const item: WeChatImageItem = {
      type: WeChatMessageItemType.IMAGE,
      image_url: 'https://example.com/img.png',
    };

    expect(item.type).toBe(2);
  });

  test('WeChatVoiceItem shape', () => {
    const item: WeChatVoiceItem = {
      type: WeChatMessageItemType.VOICE,
      voice_url: 'https://example.com/voice.mp3',
      duration: 5000,
    };

    expect(item.type).toBe(3);
  });

  test('WeChatFileItem shape', () => {
    const item: WeChatFileItem = {
      type: WeChatMessageItemType.FILE,
      file_url: 'https://example.com/doc.pdf',
      file_name: 'doc.pdf',
    };

    expect(item.type).toBe(4);
  });

  test('WeChatVideoItem shape', () => {
    const item: WeChatVideoItem = {
      type: WeChatMessageItemType.VIDEO,
      video_url: 'https://example.com/video.mp4',
    };

    expect(item.type).toBe(5);
  });

  test('WeChatLoginStatus shape', () => {
    const status: WeChatLoginStatus = {
      qrcode: 'qr-data',
      status: LoginStatus.WAIT,
    };

    expect(status.status).toBe('wait');
  });

  test('iLinkConfig shape', () => {
    const cfg: iLinkConfig = {
      base_url: 'https://api.ilink.com',
      bot_token: 'secret',
    };

    expect(cfg.base_url).toBe('https://api.ilink.com');
  });

  test('WeChatSendMessageParams shape', () => {
    const params: WeChatSendMessageParams = {
      to_user_id: 'u2',
      context_token: 'tok-456',
      item_list: [
        { type: WeChatMessageItemType.TEXT, text: 'hi' } satisfies WeChatTextItem,
      ],
    };

    expect(params.client_id).toBeUndefined();
  });
});

describe('Bridge types', () => {
  test('BridgeEvent shape', () => {
    const evt: BridgeEvent = {
      type: BridgeEventType.MESSAGE,
      payload: { foo: 'bar' },
      source: 'wechat',
      timestamp: Date.now(),
    };

    expect(evt.type).toBe('message');
  });

  test('SlashCommand shape', () => {
    const cmd: SlashCommand = {
      name: 'help',
      args: ['--all'],
      raw_text: '/help --all',
    };

    expect(cmd.name).toBe('help');
  });

  test('BridgeStreamChunk shape', () => {
    const chunk: BridgeStreamChunk = {
      text: 'hello',
      is_final: false,
      session_id: 'sess-1',
    };

    expect(chunk.is_final).toBe(false);
  });

  test('CommandContext shape', () => {
    const ctx: CommandContext = {
      sessionId: 'sess-1',
      currentTool: 'opencode',
      sessionManager: {},
      toolAdapters: {},
    };

    expect(ctx.currentTool).toBe('opencode');
  });

  test('CommandResult shape', () => {
    const res: CommandResult = {
      success: true,
      message: 'Done',
      newState: { foo: 1 },
    };

    expect(res.success).toBe(true);
  });
});

describe('Tool types', () => {
  test('ToolMessage shape', () => {
    const msg: ToolMessage = {
      role: ToolMessageRole.USER,
      content: 'hello',
      parts: [],
    };

    expect(msg.role).toBe('user');
  });

  test('ToolMessagePart text shape', () => {
    const part: ToolMessagePartLegacy = {
      type: ToolMessagePartType.TEXT,
      text: 'hello',
    };

    expect(part.type).toBe('text');
  });

  test('ToolMessagePart image shape', () => {
    const part: ToolMessagePartLegacy = {
      type: ToolMessagePartType.IMAGE,
      image_url: 'https://example.com/img.png',
    };

    expect(part.type).toBe('image');
  });

  test('TextMessagePart shape', () => {
    const part: TextMessagePart = {
      type: 'text',
      text: 'hello',
    };

    expect(part.type).toBe('text');
    expect(part.text).toBe('hello');
  });

  test('FileMessagePart shape', () => {
    const part: FileMessagePart = {
      type: 'file',
      mime: 'image/png',
      url: 'https://example.com/img.png',
    };

    expect(part.type).toBe('file');
    expect(part.mime).toBe('image/png');
  });

  test('ToolResponse shape', () => {
    const res: ToolResponse = {
      id: 'msg-1',
      sessionId: 'sess-1',
      text: 'response',
      parts: [],
    };

    expect(res.sessionId).toBe('sess-1');
  });

  test('ToolResponse with tokens', () => {
    const res: ToolResponse = {
      id: 'msg-1',
      sessionId: 'sess-1',
      text: 'response',
      parts: [{ type: 'text', text: 'response' }],
      tokens: { input: 100, output: 50 },
    };

    expect(res.tokens?.input).toBe(100);
  });

  test('ToolSession shape', () => {
    const sess: ToolSession = {
      id: 'sess-1',
      title: 'My Session',
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(sess.status).toBe('idle');
  });

  test('ToolSession without title', () => {
    const sess: ToolSession = {
      id: 'sess-1',
      status: 'busy',
      createdAt: 0,
      updatedAt: 0,
    };

    expect(sess.title).toBeUndefined();
  });

  test('StreamChunk shape', () => {
    const chunk: StreamChunk = {
      type: 'text',
      text: 'hello',
    };

    expect(chunk.type).toBe('text');
  });

  test('StreamChunk done shape', () => {
    const chunk: StreamChunk = {
      type: 'done',
    };

    expect(chunk.type).toBe('done');
  });

  test('StreamChunk error shape', () => {
    const chunk: StreamChunk = {
      type: 'error',
      error: 'Something went wrong',
    };

    expect(chunk.error).toBe('Something went wrong');
  });

  test('ToolAdapterError', () => {
    const err = new ToolAdapterError('test error', 'TEST_CODE');
    expect(err.name).toBe('ToolAdapterError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test error');
  });

  test('ToolAdapter interface is satisfiable', () => {
    const adapter: ToolAdapter = {
      name: 'mock',
      initialize: async () => {},
      createSession: async () => ({
        id: 's1',
        status: 'idle' as const,
        createdAt: 0,
        updatedAt: 0,
      }),
      sendMessage: async () => ({
        id: 'm1',
        sessionId: 's1',
        text: '',
        parts: [],
      }),
      streamResponse: async (_sessionId: string, _onChunk: (chunk: StreamChunk) => void) => {},
      abortSession: async () => {},
      getSessionInfo: async () => ({
        id: 's1',
        status: 'idle' as const,
        createdAt: 0,
        updatedAt: 0,
      }),
      dispose: async () => {},
    };

    expect(adapter.name).toBe('mock');
  });
});

describe('Config types', () => {
  test('AppConfig shape', () => {
    const cfg: AppConfig = {
      ilink: {
        base_url: 'https://api.ilink.com',
        bot_token_path: '/etc/token',
      },
      opencode: {
        port: 3000,
        hostname: 'localhost',
        model: 'gpt-4',
      },
      server: {
        port: 8080,
        host: '0.0.0.0',
      },
      logging: {
        level: 'info',
      },
    };

    expect(cfg.ilink.base_url).toBe('https://api.ilink.com');
  });

  test('barrel export resolves both iLinkConfig variants', () => {
    const runtime: BarrelILinkConfig = {
      base_url: 'https://api.ilink.com',
      bot_token: 'tok',
    };

    const app: BarrelILinkAppConfig = {
      base_url: 'https://api.ilink.com',
      bot_token_path: '/etc/token',
    };

    expect(runtime.bot_token).toBe('tok');
    expect(app.bot_token_path).toBe('/etc/token');
  });
});
