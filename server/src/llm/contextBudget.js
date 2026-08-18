/**
 * 统一上下文字段预算（服务端与前端 buildChapterOptions 应对齐）
 * DeepSeek V4：1M 上下文；写章保守使用 512K 输入预算
 */
export const FIELD_CAPS = {
  novelSetting: 8000,
  novelSettingShort: 3000,
  previousVolumeSummary: 8000,
  invalidContent: 10000,
  chapterText: 12000,
  chapterTextShort: 6000,
  summary: 16000,
  characterState: 8000,
  initialCharacterDynamics: 2500,
  globalSummary: 16000,
  previousExcerpt: 4000,
  outlineWindow: 6000,
};
