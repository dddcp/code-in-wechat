import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeAdapter, type OpenCodeConfig } from '@/tools/opencode';
import type { ToolSession, StreamChunk } from '@/types/tool';

// Mock the OpenCode SDK
const mockSessionCreate = vi.fn();
const mockSessionPrompt = vi.fn();
const mockSessionAbort = vi.fn();
const mockSessionGet = vi.fn();
const mockEventSubscribe = vi.fn();

const mockClient = {
  session: {
    create: mockSessionCreate,
    prompt: mockSessionPrompt,
    abort: mockSessionAbort,
    get: mockSessionGet,
  },
  event: {
    subscribe: mockEventSubscribe,
  },
};

const mockServerClose = vi.fn();
const mockServer = { url: 'http://localhost:4096', close: mockServerClose };

vi.mock('@opencode-ai/sdk', () => ({
  createOpencode: vi.fn(() =>
    Promise.resolve({ client: mockClient, server: mockServer }),
  ),
  createOpencodeClient: vi.fn(() => mockClient),
}));

// Import the mocked module after vi.mock setup
import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenCodeAdapter({ port: 4096, hostname: 'localhost' });
  });

  afterEach(async () => {
    // Ensure adapter is disposed after each test
    await adapter.dispose();
  });

  describe('initialize', () => {
    test('starts a new server when connectOnly is false', async () => {
      await adapter.initialize();

      expect(createOpencode).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 4096,
          hostname: 'localhost',
        }),
      );
      expect(adapter.name).toBe('opencode');
    });

    test('connects to existing server when connectOnly is true', async () => {
      const connectAdapter = new OpenCodeAdapter({
        port: 5000,
        connectOnly: true,
      });
      await connectAdapter.initialize();

      expect(createOpencodeClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://localhost:5000',
        }),
      );
      expect(createOpencode).not.toHaveBeenCalled();

      await connectAdapter.dispose();
    });

    test('does not re-initialize if already initialized', async () => {
      await adapter.initialize();
      await adapter.initialize();

      expect(createOpencode).toHaveBeenCalledTimes(1);
    });
  });

  describe('createSession', () => {
    test('creates a session and returns mapped ToolSession', async () => {
      const mockSessionData = {
        id: 'session-123',
        title: 'Test Session',
        time: { created: 1000, updated: 2000 },
        projectID: 'proj-1',
        directory: '/tmp',
        version: '1',
      };

      mockSessionCreate.mockResolvedValue({
        data: mockSessionData,
      });

      await adapter.initialize();
      const session = await adapter.createSession('Test Session');

      expect(mockSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { title: 'Test Session' },
        }),
      );
      expect(session).toEqual({
        id: 'session-123',
        title: 'Test Session',
        status: 'idle',
        createdAt: 1000,
        updatedAt: 2000,
      });
    });

    test('creates a session without title', async () => {
      const mockSessionData = {
        id: 'session-456',
        title: '',
        time: { created: 1000, updated: 2000 },
        projectID: 'proj-1',
        directory: '/tmp',
        version: '1',
      };

      mockSessionCreate.mockResolvedValue({
        data: mockSessionData,
      });

      await adapter.initialize();
      const session = await adapter.createSession();

      expect(session.id).toBe('session-456');
      expect(session.title).toBeUndefined();
    });

    test('throws if not initialized', async () => {
      await expect(adapter.createSession()).rejects.toThrow('not initialized');
    });
  });

  describe('sendMessage', () => {
    test('sends a text message and returns ToolResponse', async () => {
      const mockResponse = {
        data: {
          info: {
            id: 'msg-1',
            sessionID: 'session-123',
            tokens: { input: 100, output: 50 },
          },
          parts: [
            { id: 'p1', sessionID: 'session-123', messageID: 'msg-1', type: 'text', text: 'Hello response' },
          ],
        },
      };

      mockSessionPrompt.mockResolvedValue(mockResponse);

      await adapter.initialize();
      const response = await adapter.sendMessage('session-123', 'Hello');

      expect(mockSessionPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'session-123' },
          body: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({ type: 'text', text: 'Hello' }),
            ]),
          }),
        }),
      );
      expect(response).toEqual({
        id: 'msg-1',
        sessionId: 'session-123',
        text: 'Hello response',
        parts: [{ type: 'text', text: 'Hello response' }],
        tokens: { input: 100, output: 50 },
      });
    });

    test('sends message with file parts', async () => {
      const mockResponse = {
        data: {
          info: { id: 'msg-2', sessionID: 'session-123', tokens: { input: 10, output: 5 } },
          parts: [
            { id: 'p1', sessionID: 'session-123', messageID: 'msg-2', type: 'text', text: 'Got it' },
          ],
        },
      };

      mockSessionPrompt.mockResolvedValue(mockResponse);

      await adapter.initialize();
      const response = await adapter.sendMessage('session-123', 'Check this file', [
        { type: 'file', mime: 'image/png', url: 'https://example.com/img.png' },
      ]);

      expect(response.text).toBe('Got it');
      expect(mockSessionPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({ type: 'text', text: 'Check this file' }),
              expect.objectContaining({ type: 'file', mime: 'image/png', url: 'https://example.com/img.png' }),
            ]),
          }),
        }),
      );
    });

    test('throws if not initialized', async () => {
      await expect(adapter.sendMessage('s1', 'hello')).rejects.toThrow('not initialized');
    });
  });

  describe('streamResponse', () => {
    test('emits text chunks and resolves on session.idle', async () => {
      const chunks: StreamChunk[] = [];

      // Create an async generator that yields events
      async function* eventGenerator() {
        yield {
          type: 'message.part.updated',
          properties: {
            part: { id: 'p1', sessionID: 's1', messageID: 'm1', type: 'text', text: 'Hello ' },
            delta: 'Hello ',
          },
        };
        yield {
          type: 'message.part.updated',
          properties: {
            part: { id: 'p1', sessionID: 's1', messageID: 'm1', type: 'text', text: 'Hello world' },
            delta: 'world',
          },
        };
        yield {
          type: 'session.idle',
          properties: { sessionID: 's1' },
        };
      }

      mockEventSubscribe.mockResolvedValue({
        stream: eventGenerator(),
      });

      await adapter.initialize();
      await adapter.streamResponse('s1', (chunk) => chunks.push(chunk));

      expect(chunks).toEqual([
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
        { type: 'done' },
      ]);
    });

    test('emits tool_start and tool_end chunks', async () => {
      const chunks: StreamChunk[] = [];

      async function* eventGenerator() {
        yield {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1', sessionID: 's1', messageID: 'm1', type: 'tool',
              tool: 'bash', callID: 'c1',
              state: { status: 'running', input: {} },
            },
          },
        };
        yield {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'p1', sessionID: 's1', messageID: 'm1', type: 'tool',
              tool: 'bash', callID: 'c1',
              state: { status: 'completed', input: {}, output: 'done', title: 'Bash', metadata: {}, time: { start: 0, end: 1 } },
            },
          },
        };
        yield {
          type: 'session.idle',
          properties: { sessionID: 's1' },
        };
      }

      mockEventSubscribe.mockResolvedValue({
        stream: eventGenerator(),
      });

      await adapter.initialize();
      await adapter.streamResponse('s1', (chunk) => chunks.push(chunk));

      expect(chunks).toEqual([
        { type: 'tool_start', toolName: 'bash' },
        { type: 'tool_end', toolName: 'bash' },
        { type: 'done' },
      ]);
    });

    test('emits error chunk on session.error event', async () => {
      const chunks: StreamChunk[] = [];

      async function* eventGenerator() {
        yield {
          type: 'session.error',
          properties: {
            sessionID: 's1',
            error: { name: 'UnknownError', data: { message: 'Something went wrong' } },
          },
        };
      }

      mockEventSubscribe.mockResolvedValue({
        stream: eventGenerator(),
      });

      await adapter.initialize();
      await adapter.streamResponse('s1', (chunk) => chunks.push(chunk));

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('error');
      expect(chunks[0].error).toContain('Something went wrong');
    });

    test('handles stream errors gracefully', async () => {
      const chunks: StreamChunk[] = [];

      async function* eventGenerator() {
        yield {
          type: 'message.part.updated',
          properties: {
            part: { id: 'p1', sessionID: 's1', messageID: 'm1', type: 'text', text: 'partial' },
            delta: 'partial',
          },
        };
        throw new Error('Connection lost');
      }

      mockEventSubscribe.mockResolvedValue({
        stream: eventGenerator(),
      });

      await adapter.initialize();
      await adapter.streamResponse('s1', (chunk) => chunks.push(chunk));

      // Should have text chunk and error chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const errorChunk = chunks.find((c) => c.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk!.error).toContain('Connection lost');
    });
  });

  describe('abortSession', () => {
    test('calls session.abort with correct session ID', async () => {
      mockSessionAbort.mockResolvedValue({ data: true });

      await adapter.initialize();
      await adapter.abortSession('session-123');

      expect(mockSessionAbort).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'session-123' },
        }),
      );
    });

    test('throws if not initialized', async () => {
      await expect(adapter.abortSession('s1')).rejects.toThrow('not initialized');
    });
  });

  describe('getSessionInfo', () => {
    test('retrieves session info and maps it correctly', async () => {
      const mockSessionData = {
        id: 'session-abc',
        title: 'My Session',
        time: { created: 3000, updated: 4000 },
        projectID: 'proj-1',
        directory: '/tmp',
        version: '1',
      };

      mockSessionGet.mockResolvedValue({ data: mockSessionData });

      await adapter.initialize();
      const session = await adapter.getSessionInfo('session-abc');

      expect(mockSessionGet).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'session-abc' },
        }),
      );
      expect(session).toEqual({
        id: 'session-abc',
        title: 'My Session',
        status: 'idle',
        createdAt: 3000,
        updatedAt: 4000,
      });
    });

    test('throws if session not found', async () => {
      mockSessionGet.mockResolvedValue({ data: null });

      await adapter.initialize();
      await expect(adapter.getSessionInfo('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('dispose', () => {
    test('closes server if it was started', async () => {
      await adapter.initialize();
      await adapter.dispose();

      expect(mockServerClose).toHaveBeenCalled();
    });

    test('does not close server if connectOnly mode', async () => {
      const connectAdapter = new OpenCodeAdapter({ connectOnly: true, port: 5000 });
      await connectAdapter.initialize();
      await connectAdapter.dispose();

      expect(mockServerClose).not.toHaveBeenCalled();
    });

    test('allows re-initialization after dispose', async () => {
      await adapter.initialize();
      await adapter.dispose();

      // Should be able to initialize again
      await adapter.initialize();
      expect(createOpencode).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    test('throws descriptive error when SDK call fails', async () => {
      mockSessionCreate.mockRejectedValue(new Error('Network error'));

      await adapter.initialize();
      await expect(adapter.createSession('test')).rejects.toThrow('Network error');
    });

    test('throws when sendMessage returns no data', async () => {
      mockSessionPrompt.mockResolvedValue({ data: null });

      await adapter.initialize();
      await expect(adapter.sendMessage('s1', 'hello')).rejects.toThrow('no data returned');
    });
  });
});