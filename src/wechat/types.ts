/**
 * iLink API types for WeChat ClawBot communication.
 *
 * These types mirror the iLink HTTP API request/response shapes.
 * message_type: 1=USER, 2=BOT
 * message_state: 0=NEW, 1=GENERATING, 2=FINISH
 */

// ---------------------------------------------------------------------------
// Shared enums / constants
// ---------------------------------------------------------------------------

export const MESSAGE_TYPE_USER = 1 as const;
export const MESSAGE_TYPE_BOT = 2 as const;

export const MESSAGE_STATE_NEW = 0 as const;
export const MESSAGE_STATE_GENERATING = 1 as const;
export const MESSAGE_STATE_FINISH = 2 as const;

// ---------------------------------------------------------------------------
// WeChat message item types
// ---------------------------------------------------------------------------

export enum WeChatItemType {
  Text = 1,
  Image = 2,
  Voice = 3,
  File = 4,
  Video = 5,
}

export interface WeChatTextItem {
  type: WeChatItemType.Text;
  /** Direct text property (legacy format) */
  text?: string;
  /** Nested text property (iLink API format) */
  text_item?: {
    text: string;
  };
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  button_item_list?: unknown[];
}

/**
 * Extract text content from a WeChatTextItem, supporting both formats:
 * - Direct `text` property (legacy)
 * - Nested `text_item.text` property (iLink API)
 */
export function extractTextFromItem(item: WeChatTextItem): string {
  if (item.text_item?.text) {
    return item.text_item.text;
  }
  return item.text ?? "";
}

export interface WeChatImageItem {
  type: WeChatItemType.Image;
  image_url: string;
  aes_key: string;
  image_size: number;
  image_width?: number;
  image_height?: number;
}

export interface WeChatFileItem {
  type: WeChatItemType.File;
  file_url: string;
  aes_key: string;
  file_size: number;
  file_name: string;
}

export interface WeChatVoiceItem {
  type: WeChatItemType.Voice;
  voice_url: string;
  aes_key: string;
  voice_size: number;
  voice_duration?: number;
}

export interface WeChatVideoItem {
  type: WeChatItemType.Video;
  video_url: string;
  aes_key: string;
  video_size: number;
  video_duration?: number;
}

export type WeChatMessageItem =
  | WeChatTextItem
  | WeChatImageItem
  | WeChatFileItem
  | WeChatVoiceItem
  | WeChatVideoItem;

// ---------------------------------------------------------------------------
// WeChat message (received from getUpdates)
// ---------------------------------------------------------------------------

export interface WeChatMessage {
  from_user_id: string;
  to_user_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  item_list: WeChatMessageItem[];
  client_id?: string;
  msg_id?: string;
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// iLink configuration
// ---------------------------------------------------------------------------

export interface iLinkConfig {
  base_url: string;
  bot_token: string;
}

// ---------------------------------------------------------------------------
// iLink base info (included in every POST body)
// ---------------------------------------------------------------------------

export interface iLinkBaseInfo {
  channel_version: "1.0.0";
}

// ---------------------------------------------------------------------------
// iLink request types
// ---------------------------------------------------------------------------

export interface iLinkGetUpdatesRequest {
  get_updates_buf: string;
  base_info: iLinkBaseInfo;
}

export interface iLinkMessage {
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  item_list: WeChatMessageItem[];
}

export interface iLinkSendMessageRequest {
  msg: iLinkMessage;
  base_info: iLinkBaseInfo;
}

export interface iLinkSendTypingRequest {
  ilink_user_id: string;
  typing_ticket: string;
  status: number;
  base_info: iLinkBaseInfo;
}

export interface iLinkGetConfigRequest {
  ilink_user_id: string;
  context_token: string;
  base_info: iLinkBaseInfo;
}

export interface iLinkGetUploadUrlRequest {
  file_type: number;
  file_size: number;
  aes_key: string;
  base_info: iLinkBaseInfo;
}

// ---------------------------------------------------------------------------
// iLink response types
// ---------------------------------------------------------------------------

export interface iLinkGetUpdatesResponse {
  ret: number;
  msgs: WeChatMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms: number;
}

export interface iLinkQRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface iLinkQRCodeStatusResponse {
  status: "wait" | "scaned" | "confirmed";
  bot_token?: string;
  baseurl?: string;
}

export interface iLinkGetConfigResponse {
  typing_ticket: string;
}

export interface iLinkGetUploadUrlResponse {
  upload_url: string;
  download_url: string;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class iLinkError extends Error {
  constructor(
    public readonly ret: number,
    message: string,
  ) {
    super(`iLink error (ret=${ret}): ${message}`);
    this.name = "iLinkError";
  }
}

export class SessionExpiredError extends iLinkError {
  constructor(message = "Session expired, please re-authenticate") {
    super(-14, message);
    this.name = "SessionExpiredError";
  }
}

export class NetworkError extends Error {
  constructor(
    public readonly cause: Error,
    message?: string,
  ) {
    super(message ?? `Network error: ${cause.message}`);
    this.name = "NetworkError";
  }
}

export class RateLimitError extends iLinkError {
  constructor(
    ret = -1,
    message = "Rate limit exceeded",
  ) {
    super(ret, message);
    this.name = "RateLimitError";
  }
}

export class iLinkAPIError extends iLinkError {
  constructor(
    ret: number,
    message: string,
  ) {
    super(ret, message);
    this.name = "iLinkAPIError";
  }
}