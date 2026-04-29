/**
 * TDD tests for MediaHandler - WeChat CDN media processing.
 */

import { describe, test, expect } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { MediaHandler } from "../../src/bridge/media-handler";
import type { iLinkClient } from "../../src/wechat/ilink-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock iLinkClient for testing. */
function createMockClient(): iLinkClient {
  return {
    getUploadUrl: async () => ({
      upload_url: "https://cdn.example.com/upload",
      download_url: "https://cdn.example.com/download/test.png",
    }),
  } as unknown as iLinkClient;
}

/** AES-128-ECB encrypt with PKCS7 padding (for test vectors). */
function aesEcbEncrypt(plain: Buffer, key: Buffer): Buffer {
  // Node.js crypto auto-pads with PKCS7 by default
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

// ---------------------------------------------------------------------------
// decryptMedia
// ---------------------------------------------------------------------------

describe("MediaHandler.decryptMedia", () => {
  const handler = new MediaHandler(createMockClient());

  test("decrypts image with base64-of-raw-key format", () => {
    // Create a known plaintext
    const plaintext = Buffer.from("Hello WeChat CDN!", "utf8");

    // Image key: base64 of raw 16 bytes
    const rawKey = Buffer.from("0123456789abcdef", "utf8"); // 16 bytes
    const aesKeyBase64 = rawKey.toString("base64");

    // Encrypt with known key
    const encrypted = aesEcbEncrypt(plaintext, rawKey);

    // Decrypt should return original
    const decrypted = handler.decryptMedia(encrypted, aesKeyBase64, "image");
    expect(decrypted).toEqual(plaintext);
  });

  test("decrypts file with base64-of-hex-key format", () => {
    const plaintext = Buffer.from("WeChat file content here", "utf8");

    // File key: base64 of hex string of 16 bytes
    const rawKey = randomBytes(16);
    const hexString = rawKey.toString("hex"); // 32 hex chars
    const aesKeyBase64 = Buffer.from(hexString, "utf8").toString("base64");

    // Encrypt with known key
    const encrypted = aesEcbEncrypt(plaintext, rawKey);

    // Decrypt should return original
    const decrypted = handler.decryptMedia(encrypted, aesKeyBase64, "file");
    expect(decrypted).toEqual(plaintext);
  });

  test("throws on invalid image key length", () => {
    const encrypted = Buffer.alloc(32, 0);
    const badKey = Buffer.from("short", "utf8").toString("base64"); // not 16 bytes

    expect(() =>
      handler.decryptMedia(encrypted, badKey, "image"),
    ).toThrow(/Invalid image AES key length/);
  });

  test("throws on invalid file key length (bad hex)", () => {
    const encrypted = Buffer.alloc(32, 0);
    // base64 of a hex string that decodes to wrong length
    const badHex = "abcd"; // only 2 bytes when decoded from hex
    const badKey = Buffer.from(badHex, "utf8").toString("base64");

    expect(() =>
      handler.decryptMedia(encrypted, badKey, "file"),
    ).toThrow(/Invalid file AES key length/);
  });
});

// ---------------------------------------------------------------------------
// encryptMedia
// ---------------------------------------------------------------------------

describe("MediaHandler.encryptMedia", () => {
  const handler = new MediaHandler(createMockClient());

  test("encrypts and returns base64 key", () => {
    const plaintext = Buffer.from("Some data to encrypt", "utf8");
    const result = handler.encryptMedia(plaintext);

    // Key should be 16 bytes when decoded from base64
    const key = Buffer.from(result.key, "base64");
    expect(key.length).toBe(16);

    // Encrypted buffer should be non-empty and aligned to block size
    expect(result.encrypted.length).toBeGreaterThan(0);
    expect(result.encrypted.length % 16).toBe(0);
  });

  test("encrypt/decrypt roundtrip with image key format", () => {
    const plaintext = Buffer.from("Roundtrip test data!", "utf8");
    const result = handler.encryptMedia(plaintext);

    // The key from encryptMedia is base64 of raw 16 bytes (image format)
    const decrypted = handler.decryptMedia(
      result.encrypted,
      result.key,
      "image",
    );
    expect(decrypted).toEqual(plaintext);
  });

  test("encrypt/decrypt roundtrip with empty-ish data", () => {
    const plaintext = Buffer.from("A", "utf8"); // 1 byte → needs 15 bytes padding
    const result = handler.encryptMedia(plaintext);
    const decrypted = handler.decryptMedia(
      result.encrypted,
      result.key,
      "image",
    );
    expect(decrypted).toEqual(plaintext);
  });

  test("encrypt/decrypt roundtrip with block-aligned data", () => {
    // Exactly 16 bytes → needs full block of padding
    const plaintext = Buffer.alloc(16, 0x42);
    const result = handler.encryptMedia(plaintext);
    const decrypted = handler.decryptMedia(
      result.encrypted,
      result.key,
      "image",
    );
    expect(decrypted).toEqual(plaintext);
  });
});

// ---------------------------------------------------------------------------
// PKCS7 padding (tested indirectly via encrypt/decrypt, but let's verify edge cases)
// ---------------------------------------------------------------------------

describe("PKCS7 padding behavior", () => {
  const handler = new MediaHandler(createMockClient());

  test("handles data shorter than block size", () => {
    // 5 bytes of data → 11 bytes of padding → 16 bytes encrypted
    const plaintext = Buffer.from("hello", "utf8");
    const result = handler.encryptMedia(plaintext);
    expect(result.encrypted.length).toBe(16); // 1 block

    const decrypted = handler.decryptMedia(
      result.encrypted,
      result.key,
      "image",
    );
    expect(decrypted).toEqual(plaintext);
  });

  test("handles data exactly one block", () => {
    // 16 bytes → adds full 16-byte padding block → 32 bytes encrypted
    const plaintext = Buffer.from("0123456789abcdef", "utf8"); // 16 bytes
    const result = handler.encryptMedia(plaintext);
    expect(result.encrypted.length).toBe(32); // 2 blocks (data + padding block)

    const decrypted = handler.decryptMedia(
      result.encrypted,
      result.key,
      "image",
    );
    expect(decrypted).toEqual(plaintext);
  });

  test("handles data larger than one block", () => {
    // 20 bytes → 12 bytes padding → 32 bytes encrypted
    const plaintext = Buffer.from("0123456789abcdef0123", "utf8"); // 20 bytes
    const result = handler.encryptMedia(plaintext);
    expect(result.encrypted.length).toBe(32); // 2 blocks

    const decrypted = handler.decryptMedia(
      result.encrypted,
      result.key,
      "image",
    );
    expect(decrypted).toEqual(plaintext);
  });
});

// ---------------------------------------------------------------------------
// convertToToolPart
// ---------------------------------------------------------------------------

describe("MediaHandler.convertToToolPart", () => {
  const handler = new MediaHandler(createMockClient());

  test("returns TextMessagePart for text mime type", () => {
    const buffer = Buffer.from("Hello world", "utf8");
    const part = handler.convertToToolPart(buffer, "note.txt", "text/plain");

    expect(part.type).toBe("text");
    if (part.type === "text") {
      expect(part.text).toBe("Hello world");
    }
  });

  test("returns FileMessagePart for image mime type", () => {
    const buffer = Buffer.from("fake image data", "utf8");
    const part = handler.convertToToolPart(
      buffer,
      "photo.png",
      "image/png",
    );

    expect(part.type).toBe("file");
    if (part.type === "file") {
      expect(part.mime).toBe("image/png");
      expect(part.filename).toBe("photo.png");
      expect(part.url).toContain("data:image/png;base64,");
    }
  });

  test("returns FileMessagePart for application mime type", () => {
    const buffer = Buffer.from("binary data", "utf8");
    const part = handler.convertToToolPart(
      buffer,
      "doc.pdf",
      "application/pdf",
    );

    expect(part.type).toBe("file");
    if (part.type === "file") {
      expect(part.mime).toBe("application/pdf");
      expect(part.filename).toBe("doc.pdf");
    }
  });

  test("returns FileMessagePart for audio mime type", () => {
    const buffer = Buffer.from("audio data", "utf8");
    const part = handler.convertToToolPart(
      buffer,
      "voice.mp3",
      "audio/mpeg",
    );

    expect(part.type).toBe("file");
    if (part.type === "file") {
      expect(part.mime).toBe("audio/mpeg");
      expect(part.filename).toBe("voice.mp3");
    }
  });
});

// ---------------------------------------------------------------------------
// downloadFromCDN (mocked fetch)
// ---------------------------------------------------------------------------

describe("MediaHandler.downloadFromCDN", () => {
  test("downloads and returns buffer from CDN URL", async () => {
    const testData = Buffer.from("cdn-encrypted-data", "utf8");
    const mockFetch = async (url: string) => {
      expect(url).toBe("https://novac2c.cdn.weixin.qq.com/c2c/test");
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => testData.buffer.slice(testData.byteOffset, testData.byteOffset + testData.byteLength),
      };
    };

    // Replace global fetch temporarily
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      const handler = new MediaHandler(createMockClient());
      const result = await handler.downloadFromCDN(
        "https://novac2c.cdn.weixin.qq.com/c2c/test",
      );
      expect(result).toEqual(testData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws on HTTP error", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      const handler = new MediaHandler(createMockClient());
      await expect(
        handler.downloadFromCDN("https://example.com/notfound"),
      ).rejects.toThrow(/Failed to download from CDN/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});