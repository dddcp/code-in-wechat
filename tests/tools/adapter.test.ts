import { describe, test, expect } from 'vitest';
import type { ToolAdapter } from '@/tools/adapter';

describe('ToolAdapter interface shape', () => {
  test('ToolAdapter has all required methods', () => {
    // Verify the interface has the expected shape by checking
    // that a conforming object satisfies it
    const adapter: ToolAdapter = {
      name: 'test',
      async initialize() {},
      async createSession(title?: string) {
        return { id: '1', title, status: 'idle', createdAt: 0, updatedAt: 0 };
      },
      async sendMessage(sessionId: string, content: string) {
        return { id: 'm1', sessionId, text: content, parts: [] };
      },
      async streamResponse(sessionId: string, onChunk: (chunk: any) => void) {
        onChunk({ type: 'text', text: 'hello' });
      },
      async abortSession(sessionId: string) {},
      async getSessionInfo(sessionId: string) {
        return { id: sessionId, status: 'idle', createdAt: 0, updatedAt: 0 };
      },
      async dispose() {},
    };

    expect(adapter.name).toBe('test');
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.createSession).toBe('function');
    expect(typeof adapter.sendMessage).toBe('function');
    expect(typeof adapter.streamResponse).toBe('function');
    expect(typeof adapter.abortSession).toBe('function');
    expect(typeof adapter.getSessionInfo).toBe('function');
    expect(typeof adapter.dispose).toBe('function');
  });

  test('ToolAdapter createSession accepts optional title', () => {
    const adapter: ToolAdapter = {
      name: 'test',
      async initialize() {},
      async createSession(title?: string) {
        return { id: '1', title, status: 'idle' as const, createdAt: 0, updatedAt: 0 };
      },
      async sendMessage() { return { id: '', sessionId: '', text: '', parts: [] }; },
      async streamResponse() {},
      async abortSession() {},
      async getSessionInfo() { return { id: '', status: 'idle', createdAt: 0, updatedAt: 0 }; },
      async dispose() {},
    };

    // Should be callable without title
    expect(adapter.createSession()).toBeDefined();
    // Should be callable with title
    expect(adapter.createSession('My Session')).toBeDefined();
  });

  test('ToolAdapter sendMessage accepts optional parts', () => {
    const adapter: ToolAdapter = {
      name: 'test',
      async initialize() {},
      async createSession() { return { id: '', status: 'idle', createdAt: 0, updatedAt: 0 }; },
      async sendMessage(sessionId: string, content: string, parts?: any[]) {
        return { id: '', sessionId, text: content, parts: parts ?? [] };
      },
      async streamResponse() {},
      async abortSession() {},
      async getSessionInfo() { return { id: '', status: 'idle', createdAt: 0, updatedAt: 0 }; },
      async dispose() {},
    };

    // Should be callable without parts
    expect(adapter.sendMessage('s1', 'hello')).toBeDefined();
    // Should be callable with parts
    expect(adapter.sendMessage('s1', 'hello', [{ type: 'text', text: 'extra' }])).toBeDefined();
  });

  test('ToolAdapter streamResponse calls onChunk callback', async () => {
    const chunks: any[] = [];
    const adapter: ToolAdapter = {
      name: 'test',
      async initialize() {},
      async createSession() { return { id: '', status: 'idle', createdAt: 0, updatedAt: 0 }; },
      async sendMessage() { return { id: '', sessionId: '', text: '', parts: [] }; },
      async streamResponse(sessionId: string, onChunk: (chunk: any) => void) {
        onChunk({ type: 'text', text: 'hello' });
        onChunk({ type: 'done' });
      },
      async abortSession() {},
      async getSessionInfo() { return { id: '', status: 'idle', createdAt: 0, updatedAt: 0 }; },
      async dispose() {},
    };

    await adapter.streamResponse('s1', (chunk) => chunks.push(chunk));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', text: 'hello' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });
});