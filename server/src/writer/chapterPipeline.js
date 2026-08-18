import {
  generateChapter,
  checkConsistency,
  hasConsistencyIssues,
  repairChapterConsistency,
  updateGlobalSummary,
  updateCharacterState,
} from '../writer/generator.js';

/**
 * 单章完整 pipeline：生成 → 一致性（可选）→ Step4 定稿（可选）
 * @param {object} body - 与 step3-chapter 相同字段 + stages
 * @param {(event: object) => void} [onProgress]
 */
export async function runChapterPipeline(body, onProgress) {
  const {
    stages = {},
    humanizeStrength = 0.7,
    globalSummary = '',
    characterState = '',
    setting = '',
    ...chapterOpts
  } = body || {};

  const doConsistency = stages.consistency !== false;
  const doFinalize = stages.finalize !== false;
  const doQualityRepair = stages.qualityRepair !== false;

  // 首章/无前文时跳过一致性审校（没有前文可比，审校只会空转）
  const hasContext =
    String(globalSummary || '').trim().length > 0 || String(characterState || '').trim().length > 0;
  const consistencyEnabled = doConsistency && hasContext;

  onProgress?.({ stage: 'generate', percent: 15, message: '生成正文中…' });

  const generated = await generateChapter(
    { ...chapterOpts, globalSummary, characterState },
    humanizeStrength,
    { qualityRepair: doQualityRepair }
  );

  let chapterText = generated.content || '';
  let summary = globalSummary;
  let characters = characterState;
  let consistencyReview = '';
  let consistencyRepair = null;

  if (generated.quality?.shortChapter) {
    return {
      ok: false,
      error: `章节偏短：${generated.quality.shortChapterWarning || '未达目标字数'}`,
      content: chapterText,
      quality: generated.quality,
      messages: generated.exchange || [],
    };
  }

  if (consistencyEnabled) {
    onProgress?.({ stage: 'consistency', percent: 55, message: '一致性校验中…' });
    consistencyReview = await checkConsistency(chapterText, summary, characters);
    if (hasConsistencyIssues(consistencyReview)) {
      onProgress?.({ stage: 'consistency-repair', percent: 65, message: '按审校结果修稿中…' });
      consistencyRepair = await repairChapterConsistency({
        chapterText,
        globalSummary: summary,
        characterState: characters,
        reviewText: consistencyReview,
      });
      if (consistencyRepair.changed && consistencyRepair.content) {
        chapterText = consistencyRepair.content;
      }
      if (!consistencyRepair.ok) {
        // 修复后仍有"矛盾"：常见原因是状态卡未与正文同步（如正文已改、状态卡还是旧值）。
        // 先刷新角色状态与摘要，再复审一次；仍失败才算真的过不去。
        onProgress?.({ stage: 'consistency-refresh', percent: 72, message: '刷新角色状态后复审…' });
        try {
          const refreshedChars = await updateCharacterState(chapterText, characters, String(setting || '').slice(0, 2500));
          characters = refreshedChars || characters;
          const refreshedSummary = await updateGlobalSummary(chapterText, summary);
          summary = refreshedSummary || summary;
          const reReview = await checkConsistency(chapterText, summary, characters);
          if (!hasConsistencyIssues(reReview)) {
            consistencyReview = reReview;
            consistencyRepair = { ...consistencyRepair, ok: true, refreshedState: true };
          } else {
            return {
              ok: false,
              error: consistencyRepair.review || consistencyRepair.initialReview || '一致性审校未通过',
              content: chapterText,
              quality: generated.quality,
              consistencyReview,
              consistencyRepair,
              messages: generated.exchange || [],
            };
          }
        } catch (e) {
          return {
            ok: false,
            error: consistencyRepair.review || consistencyRepair.initialReview || '一致性审校未通过',
            content: chapterText,
            quality: generated.quality,
            consistencyReview,
            consistencyRepair,
            messages: generated.exchange || [],
          };
        }
      }
      consistencyReview = consistencyRepair.review || consistencyReview;
    }
  }

  if (doFinalize) {
    onProgress?.({ stage: 'finalize', percent: 85, message: 'Step4 定稿回写中…' });
    const [nextSummary, nextCharacters] = await Promise.all([
      updateGlobalSummary(chapterText, summary),
      updateCharacterState(chapterText, characters, String(setting || '').slice(0, 2500)),
    ]);
    summary = nextSummary;
    characters = nextCharacters;
  }

  onProgress?.({ stage: 'done', percent: 100, message: '完成' });

  return {
    ok: true,
    content: chapterText,
    summary,
    characterState: characters,
    quality: generated.quality,
    consistencyReview,
    consistencyRepair,
    messages: generated.exchange || [],
  };
}
