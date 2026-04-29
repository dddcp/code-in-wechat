/**
 * WeChat / iLink message types
 * Matches the iLink API format exactly.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum MessageType {
  USER = 1,
  BOT = 2,
}

export enum MessageState {
  NEW = 0,
  GENERATING = 1,
  FINISH = 2,
}

export enum WeChatMessageItemType {
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5,
}

export enum LoginStatus {
  WAIT = 'wait',
  SCANNED = 'scanned',
  CONFIRMED = 'confirmed',
}

// ---------------------------------------------------------------------------
// Message items
// ---------------------------------------------------------------------------

export interface WeChatMessageItem {
  type: WeChatMessageItemType;
}

export interface WeChatTextItem extends WeChatMessageItem {
  type: WeChatMessageItemType.TEXT;
  text: string;
}

export interface WeChatImageItem extends WeChatMessageItem {
  type: WeChatMessageItemType.IMAGE;
  image_url: string;
}

export interface WeChatFileItem extends WeChatMessageItem {
  type: WeChatMessageItemType.FILE;
  file_url: string;
  file_name: string;
}

export interface WeChatVoiceItem extends WeChatMessageItem {
  type: WeChatMessageItemType.VOICE;
  voice_url: string;
  duration: number;
}

export interface WeChatVideoItem extends WeChatMessageItem {
  type: WeChatMessageItemType.VIDEO;
  video_url: string;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface WeChatMessage {
  from_user_id: string;
  to_user_id: string;
  message_type: MessageType;
  message_state: MessageState;
  context_token: string;
  item_list: WeChatMessageItem[];
}

export interface WeChatSendMessageParams {
  to_user_id: string;
  context_token: string;
  item_list: WeChatMessageItem[];
  client_id?: string;
}

// ---------------------------------------------------------------------------
// Login / config
// ---------------------------------------------------------------------------

export interface WeChatLoginStatus {
  qrcode: string;
  status: LoginStatus;
  bot_token?: string;
  baseurl?: string;
}

export interface iLinkConfig {
  base_url: string;
  bot_token: string;
}
