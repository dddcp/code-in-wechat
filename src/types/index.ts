export * from './wechat';
export {
  BridgeEventType,
  type BridgeEvent,
  type SlashCommand,
  type BridgeStreamChunk,
  type StreamChunk as BridgeStreamChunkAlias,
  type CommandContext,
  type CommandResult,
} from './bridge';
export * from './tool';

// config.ts has `iLinkConfig` which conflicts with wechat.ts's `iLinkConfig`.
// We alias it so consumers can disambiguate at the barrel level.
export {
  type AppConfig,
  type iLinkConfig as ILinkAppConfig,
  type OpenCodeConfig,
  type ServerConfig,
  type LoggingConfig,
} from './config';
