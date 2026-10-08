/** 稳定错误码。跨层传递的错误必须携带可枚举 code，禁止用消息文本做逻辑判断。 */
export type SkinErrorCode =
  | 'SKIN_CONVERSATION_NOT_FOUND'
  | 'SKIN_CONVERSATION_NOT_ACTIVE'
  | 'SKIN_CONVERSATION_EXPIRED'
  | 'SKIN_ATTEMPTS_EXHAUSTED'
  | 'SKIN_CANDIDATE_NOT_FOUND'
  | 'SKIN_CANDIDATE_NOT_ACCESSIBLE'
  | 'SKIN_RESOURCE_NOT_FOUND'
  | 'SKIN_VALIDATION_FAILED'
  | 'SKIN_FINALIZATION_CONFLICT'
  | 'SKIN_CONFIG_INVALID'
  | 'SKIN_STORAGE_ERROR'
  | 'SKIN_INTERNAL';

export class SkinError extends Error {
  constructor(
    readonly code: SkinErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SkinError';
  }
}
