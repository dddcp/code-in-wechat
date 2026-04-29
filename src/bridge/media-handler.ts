/**
 * Media handler for WeChat CDN media processing.
 *
 * Handles AES-128-ECB encryption/decryption of media files
 * downloaded from or uploaded to the WeChat CDN.
 *
 * Key format difference (CRITICAL):
 *   - Image: aes_key = base64(raw 16 bytes) → decode base64 → raw key
 *   - File/Voice/Video: aes_key = base64(hex string of 16 bytes) → decode base64 → hex string → decode hex → raw key
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ToolMessagePart } from "@/types/tool";
import type { iLinkClient } from "@/wechat/ilink-client";

// ---------------------------------------------------------------------------
// PKCS7 padding helpers
// ---------------------------------------------------------------------------

const AES_BLOCK_SIZE = 16;

/** Apply PKCS7 padding to a buffer. */
function pkcs7Pad(data: Buffer): Buffer {
  const padLen = AES_BLOCK_SIZE - (data.length % AES_BLOCK_SIZE);
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, pad]);
}

/** Remove PKCS7 padding from a buffer. Throws if padding is invalid. */
function pkcs7Unpad(data: Buffer): Buffer {
  if (data.length === 0) {
    throw new Error("Cannot unpad empty buffer");
  }
  const padLen = data[data.length - 1];
  if (padLen === 0 || padLen > AES_BLOCK_SIZE) {
    throw new Error(`Invalid PKCS7 padding byte: ${padLen}`);
  }
  // Verify all padding bytes
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) {
      throw new Error("Invalid PKCS7 padding");
    }
  }
  return data.subarray(0, data.length - padLen);
}

// ---------------------------------------------------------------------------
// Key derivation helpers
// ---------------------------------------------------------------------------

/**
 * Derive the raw AES key from a base64-encoded aes_key string.
 *
 * Image keys: base64(raw 16 bytes) → decode base64 → raw key
 * File/Voice/Video keys: base64(hex string) → decode base64 → hex string → decode hex → raw key
 */
function deriveKey(aesKeyBase64: string, type: "image" | "file"): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");

  if (type === "image") {
    // Key is base64 of raw 16 bytes
    if (decoded.length !== 16) {
      throw new Error(
        `Invalid image AES key length: expected 16 bytes, got ${decoded.length}`,
      );
    }
    return decoded;
  }

  // File/Voice/Video: decoded base64 is a hex string
  const hexString = decoded.toString("utf8");
  const key = Buffer.from(hexString, "hex");
  if (key.length !== 16) {
    throw new Error(
      `Invalid file AES key length: expected 16 bytes, got ${key.length}`,
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// MediaHandler class
// ---------------------------------------------------------------------------

export class MediaHandler {
  private readonly client: iLinkClient;

  constructor(client: iLinkClient) {
    this.client = client;
  }

  // -----------------------------------------------------------------------
  // AES operations
  // -----------------------------------------------------------------------

  /**
   * Decrypt media buffer from WeChat CDN.
   *
   * @param encryptedBuffer - The encrypted media data
   * @param aesKeyBase64 - Base64-encoded AES key (format depends on type)
   * @param type - Media type: 'image' uses raw key format, 'file' uses hex key format
   * @returns Decrypted buffer with PKCS7 padding removed
   */
  decryptMedia(
    encryptedBuffer: Buffer,
    aesKeyBase64: string,
    type: "image" | "file",
  ): Buffer {
    const key = deriveKey(aesKeyBase64, type);
    const decipher = createDecipheriv("aes-128-ecb", key, null);
    // Node.js crypto auto-unpads PKCS7 by default
    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final(),
    ]);
    return decrypted;
  }

  /**
   * Encrypt media buffer for CDN upload.
   *
   * Generates a random 16-byte AES key, encrypts with AES-128-ECB + PKCS7 padding,
   * and returns both the encrypted buffer and the base64-encoded key.
   *
   * @param plainBuffer - The plaintext media data to encrypt
   * @returns Object with `encrypted` buffer and `key` (base64-encoded)
   */
  encryptMedia(plainBuffer: Buffer): {
    encrypted: Buffer;
    key: string;
  } {
    const key = randomBytes(16);
    const cipher = createCipheriv("aes-128-ecb", key, null);
    // Node.js crypto auto-pads with PKCS7 by default
    const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    return {
      encrypted,
      key: key.toString("base64"),
    };
  }

  // -----------------------------------------------------------------------
  // CDN operations
  // -----------------------------------------------------------------------

  /**
   * Download encrypted media from CDN.
   *
   * @param url - Full CDN URL to download from
   * @returns The encrypted media buffer
   */
  async downloadFromCDN(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download from CDN: HTTP ${response.status} ${response.statusText}`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Upload media to CDN via iLink getUploadUrl.
   *
   * @param file - The file buffer to upload
   * @param filename - Filename for the upload
   * @param type - MIME type of the file
   * @returns The CDN download URL for the uploaded file
   */
  async uploadToCDN(
    file: Buffer,
    filename: string,
    type: string,
  ): Promise<string> {
    // Encrypt the file first
    const { encrypted, key } = this.encryptMedia(file);

    // Get upload URL from iLink
    const uploadResponse = await this.client.getUploadUrl({
      file_type: 4, // Default to file type
      file_size: encrypted.length,
      aes_key: key,
      base_info: { channel_version: "1.0.0" },
    });

    // Upload the encrypted file to the CDN URL
    const uploadUrl = uploadResponse.upload_url;
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": type },
      body: encrypted,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to upload to CDN: HTTP ${response.status} ${response.statusText}`,
      );
    }

    return uploadResponse.download_url;
  }

  // -----------------------------------------------------------------------
  // Conversion helpers
  // -----------------------------------------------------------------------

  /**
   * Convert a decrypted media buffer to an OpenCode-compatible ToolMessagePart.
   *
   * @param buffer - The decrypted media buffer
   * @param filename - Original filename
   * @param mimeType - MIME type of the media
   * @returns A ToolMessagePart suitable for sending to the tool adapter
   */
  convertToToolPart(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): ToolMessagePart {
    // For text-based types, return a TextMessagePart
    if (mimeType.startsWith("text/")) {
      return {
        type: "text",
        text: buffer.toString("utf8"),
      };
    }

    // For all other types, return a FileMessagePart with data URL
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return {
      type: "file",
      mime: mimeType,
      url: dataUrl,
      filename,
    };
  }
}