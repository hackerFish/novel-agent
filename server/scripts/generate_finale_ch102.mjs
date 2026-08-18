/**
 * 为《摆烂天道漏洞》生成第102章完结篇
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDirectory, getChapterInfo } from '../src/writer/directoryParser.js';
import { runChapterPipeline } from '../src/writer/chapterPipeline.js';
import { saveChapterFile, migrateDraftedChaptersToFiles } from '../src/storage/chapterStorage.js';
import { LINZHAO_VOICE_CARD } from '../src/writer/voiceCard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOK_ID = 'book_1776755092330_7y6hab';
const BOOK_PATH = path.join(__dirname, '..', '.t-book-books', `${BOOK_ID}.json`);
const CHAPTER = 102;

function loadProject() {
  return JSON.parse(fs.readFileSync(BOOK_PATH, 'utf8'));
}

function saveProject(project) {
  project.draftedChapters = migrateDraftedChaptersToFiles(BOOK_ID, project.draftedChapters);
  fs.writeFileSync(BOOK_PATH, JSON.stringify(project, null, 2), 'utf8');
}

async function main() {
  const project = loadProject();
  const parsed = parseDirectory(project.directory || '');
  const info = getChapterInfo(parsed, CHAPTER);
  const prevPath = path.join(__dirname, '..', '.t-book-books', 'chapters', BOOK_ID, `${CHAPTER - 1}.txt`);
  const previousExcerpt = fs.readFileSync(prevPath, 'utf8').slice(-2500);

  const body = {
    chapterNumber: CHAPTER,
    title: '函谷关真意，摆烂补天',
    chapterRole: '全书大结局',
    chapterPurpose: '收束天道直播、系统漏洞与函谷关主线，给出完结感',
    chapterSummary:
      '林照抵达石阶尽头，以无垢之身承接函谷关真意；系统清除指令失效；他摆烂式关停强卷直播，世界回归可自己选择慢或卷；沈知夏等人见证信号回归。',
    novelSetting: (project.setting || '').slice(0, 4000),
    globalSummary: (project.globalSummary || '').slice(-8000),
    previousExcerpt,
    characterState: project.characterState ? String(project.characterState).slice(-4000) : undefined,
    outlineWindow: parsed
      .filter((c) => c.number >= 98 && c.number <= 102)
      .map((c) => `第${c.number}章 ${c.title}：${c.summary || c.purpose || ''}`)
      .join('\n'),
    wordNumber: project.wordPerChapter || 2200,
    topic: project.topic || '',
    voiceCard: project.voiceCard || LINZHAO_VOICE_CARD,
    userGuidance: `【全书完结章·第102章·最后一章】
紧接第101章：林照沿石阶下行，掌心有陈玄礼血字焦痕，系统发出「清除非注册单位」警告，通道内无直播信号。
要求：
1. 这是番茄连载完结章，读者已读到101章，本章必须给出完整结局，禁止再吊大悬念或暗示第三卷。
2. 林照以「无垢之人」（未被天道评级污染）承接函谷关真意；摆烂不是废，而是拒绝被系统定义。
3. 系统/天道直播的强卷机制被关停或改写——不必血战，可用规则反杀、漏洞修补、陈玄礼残念点化等方式。
4. 收束线：石门/地下通道、竹简与道德经、青铜门威胁可侧面化解或冻结；沈知夏、周烈、陈老饼至少一处侧面呼应（如直播恢复、私信能通、集市人醒来等）。
5. 林照口吻：短句、嘴硬、懒，结尾可落日常（吃面/睡觉/说「关我什么事」类），但要有情感落点。
6. 章末明确完结感，可写「全文完」或等价收束，2200字以上。
7. 不要写章节标题行，不要作者有话说。`,
    stages: { consistency: false, finalize: true, qualityRepair: true },
  };

  console.log(`生成第 ${CHAPTER} 章完结篇…`);
  const result = await runChapterPipeline({ ...body, humanizeStrength: 0.65 }, (ev) => {
    if (ev.percent >= 50) console.log(`  ${ev.message || ev.stage}`);
  });

  if (!result.ok) {
    console.error('失败:', result.error);
    process.exit(1);
  }

  saveChapterFile(BOOK_ID, CHAPTER, result.content);
  project.globalSummary = result.summary ?? project.globalSummary;
  project.characterState = result.characterState ?? project.characterState;
  project.lastGeneratedChapter = CHAPTER;
  project.numChapters = 102;
  saveProject(project);

  const chars = result.content.replace(/\s/g, '').length;
  console.log(`完成：${chars} 字，已写入 chapters/${BOOK_ID}/${CHAPTER}.txt`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
