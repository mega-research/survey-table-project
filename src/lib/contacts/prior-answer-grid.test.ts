import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { previewExcelGrid } from './excel-parser';
import {
  buildBlockAnswer,
  splitHeaderBlocks,
  suggestBlockMapping,
} from './prior-answer-blocks';
import { buildPriorAnswerRecords } from './prior-answer-import';
import type { Question } from '@/types/survey';

/**
 * 지난 회차 rawdata 에서 잘라낸 소형 픽스처로 3단 병합 헤더를 고정한다.
 * 손으로 만든 문자열 격자가 아니라 실제 가로 병합이 든 .xlsx 다 — 병합 종속 칸 판정과
 * 컬럼 폭 산정이 이 파일에서만 검증된다.
 */
const FIXTURE = readFileSync(
  join(process.cwd(), 'tests/fixtures/prior-answers/three-row-header-mini.xlsx'),
);

function q(overrides: Record<string, unknown>): Question {
  return {
    id: 'q',
    title: '문항',
    required: false,
    order: 1,
    type: 'text',
    ...overrides,
  } as unknown as Question;
}

const textQuestion = q({ id: 'q-text', questionCode: 'BQ1', title: '창업 기업명' });
const tableQuestion = q({
  id: 'q-table',
  questionCode: 'BQ2',
  type: 'table',
  title: '창업 기업 현황',
  tableColumns: [
    { id: 'c0', label: '항목' },
    { id: 'c1', label: '값' },
  ],
  tableRowsData: ['대표자', '업종', '매출액'].map((label, idx) => ({
    id: `r${idx}`,
    label,
    cells: [
      { id: `cell-r${idx}c0`, type: 'text', content: label },
      { id: `cell-r${idx}c1`, type: 'input', content: '' },
    ],
  })),
});
const checkboxQuestion = q({
  id: 'q-check',
  questionCode: 'BQ3',
  type: 'checkbox',
  title: '지원받은 분야',
  options: [
    { id: 'o1', value: 'fund', label: '자금' },
    { id: 'o2', value: 'mentor', label: '멘토링' },
  ],
});
const rankingQuestion = q({
  id: 'q-rank',
  questionCode: 'BQ4',
  type: 'ranking',
  title: '창업 의향 이유',
  options: [
    { id: 'o1', value: 'money', label: '수익' },
    { id: 'o2', value: 'freedom', label: '자율성' },
  ],
});
const questions = [textQuestion, tableQuestion, checkboxQuestion, rankingQuestion];

async function loadGrid() {
  const preview = await previewExcelGrid(FIXTURE, {
    sheetName: 'rawdata',
    headerRowCount: 3,
    maxRows: 5,
  });
  const full = await previewExcelGrid(FIXTURE, {
    sheetName: 'rawdata',
    headerRowCount: 3,
  });
  return { preview, rows: full.rows };
}

describe('3단 병합 헤더 rawdata 픽스처', () => {
  it('통계표 시트가 섞여 있어도 rawdata 시트를 짚을 수 있다', async () => {
    const { preview } = await loadGrid();
    expect(preview.sheetNames).toEqual(['통계표', 'rawdata']);
  });

  it('병합 종속 칸은 빈 문자열로 읽고 병합 여부를 함께 낸다', async () => {
    const { preview } = await loadGrid();
    expect(preview.headerRows[1]).toEqual([
      'ID', '비고', 'BQ2', '', '', 'BQ1', 'BQ3', '', 'BQ4', '',
    ]);
    // 코드 없는 메타 열(비고)은 병합이 아니다 — 앞 블록에 흡수되면 안 된다.
    expect(preview.codeRowMerged).toEqual([
      false, false, false, true, true, false, false, true, false, true,
    ]);
  });

  it('문항별 컬럼 블록이 올바르게 잘린다', async () => {
    const { preview } = await loadGrid();
    const blocks = splitHeaderBlocks(preview.headerRows, preview.codeRowMerged);
    expect(blocks.map((b) => [b.code, b.columnIndexes])).toEqual([
      ['ID', [0]],
      ['비고', [1]],
      ['BQ2', [2, 3, 4]],
      ['BQ1', [5]],
      ['BQ3', [6, 7]],
      ['BQ4', [8, 9]],
    ]);
  });

  it('표·복수응답·순위 블록이 한 번에 문항과 자리까지 배정된다', async () => {
    const { preview } = await loadGrid();
    const blocks = splitHeaderBlocks(preview.headerRows, preview.codeRowMerged);
    const suggestions = suggestBlockMapping(blocks, questions);
    expect(
      suggestions.map((s) => [s.block.code, s.questionId, s.slots.map((slot) => slot.kind)]),
    ).toEqual([
      ['ID', null, ['unmatched']],
      ['비고', null, ['unmatched']],
      ['BQ2', 'q-table', ['table-cell', 'table-cell', 'table-cell']],
      ['BQ1', 'q-text', ['single']],
      ['BQ3', 'q-check', ['checkbox-option', 'checkbox-option']],
      ['BQ4', 'q-rank', ['ranking-rank', 'ranking-rank']],
    ]);
  });

  it('블록 값이 문항별 저장 형태로 모인다', async () => {
    const { preview, rows } = await loadGrid();
    const blocks = splitHeaderBlocks(preview.headerRows, preview.codeRowMerged);
    const suggestions = suggestBlockMapping(blocks, questions);
    const questionById = new Map(questions.map((question) => [question.id, question]));

    const firstRow = rows[0]!;
    const answers = suggestions
      .filter((s) => s.questionId)
      .map((s) => [
        s.questionId,
        buildBlockAnswer(
          questionById.get(s.questionId!)!,
          s.slots,
          s.block.columnIndexes.map((col) => firstRow[col] ?? ''),
        ).value,
      ]);

    expect(Object.fromEntries(answers)).toEqual({
      'q-table': { 'cell-r0c1': '홍길동', 'cell-r1c1': '제조업', 'cell-r2c1': '1200' },
      'q-text': '메가리서치',
      'q-check': ['fund'],
      'q-rank': [
        { rank: 1, optionValue: 'money' },
        { rank: 2, optionValue: 'freedom' },
      ],
    });
  });

  it('블록 안에 빈 칸이 섞여도 나머지 칸이 정상 저장되고 대상별로 모인다', async () => {
    const { preview, rows } = await loadGrid();
    const blocks = splitHeaderBlocks(preview.headerRows, preview.codeRowMerged);
    const assignments = suggestBlockMapping(blocks, questions)
      .filter((s) => s.questionId !== null)
      .map((s) => ({ block: s.block, questionId: s.questionId as string, slots: s.slots }));

    const result = buildPriorAnswerRecords({
      rows,
      residColumnIndex: 0,
      assignments,
      questions,
    });

    // 08 은 앞 0 이 붙어 있어 7 과 같은 대상이 아니라 8 이다.
    expect(result.records.map((r) => r.resid)).toEqual(['7', '8']);
    const second = result.records[1]?.answers;
    // 업종이 비었지만 대표자·매출액은 그대로 들어간다.
    expect(second?.['q-table']).toEqual({ 'cell-r0c1': '김철수', 'cell-r2c1': '340' });
    // 자금은 0(비선택), 멘토링만 선택 / 1순위 칸이 비어 2순위만 남는다.
    expect(second?.['q-check']).toEqual(['mentor']);
    expect(second?.['q-rank']).toEqual([{ rank: 2, optionValue: 'money' }]);
  });
});

/**
 * 실제로 겪은 두 사고를 회귀로 고정한다.
 *
 * 1) 파트가 재편되며 문항코드가 한 칸 밀려, 지난 회차 만족도 값이 올해 창업의향 문항에
 *    꽂힐 뻔한 사례.
 * 2) 문항은 올바르게 매핑됐는데 선택지 다섯 중 둘의 라벨만 바뀌어 값의 절반이 조용히
 *    사라진 사례. 전부 실패하면 눈에 띄지만 절반은 경고에 묻힌다.
 */
describe('실제 사고 회귀', () => {
  const 만족도 = q({
    id: 'q-sat',
    questionCode: 'BQ7',
    type: 'radio',
    title: '창업 지원 만족도',
    options: [
      { id: 's1', value: 'high', label: '만족' },
      { id: 's2', value: 'low', label: '불만족' },
    ],
  });
  const 창업의향 = q({ id: 'q-intent', questionCode: 'BQ8', type: 'radio', title: '창업 의향' });

  it('코드가 밀린 문항은 자동 매핑되지 않고 무엇과 충돌했는지 알려준다', () => {
    // 지난 회차 파일의 BQ7 자리에 창업의향 문항이 들어와 있다.
    const blocks = splitHeaderBlocks([['BQ7. 창업 의향이 있으십니까'], ['']]);
    const [s] = suggestBlockMapping(blocks, [만족도, 창업의향]);
    expect(s?.questionId).toBeNull();
    expect(s?.verdict).toBe('code-conflict');
    expect(s?.conflictQuestionId).toBe('q-sat');
  });

  const 지원필요 = q({
    id: 'q-need',
    questionCode: 'BQ9',
    type: 'radio',
    title: '창업지원 필요여부',
    options: [
      { id: 'n1', value: 'very', label: '매우 필요' },
      { id: 'n2', value: 'some', label: '어느 정도 필요' },
      { id: 'n3', value: 'none', label: '필요 없음' },
    ],
  });

  function needImport(rows: string[][], aliases?: Record<string, Record<string, string>>) {
    const blocks = splitHeaderBlocks([['ID', 'BQ9'], ['시스템ID', '']]);
    const assignments = suggestBlockMapping(blocks, [지원필요])
      .filter((s) => s.questionId !== null)
      .map((s) => ({ block: s.block, questionId: s.questionId as string, slots: s.slots }));
    return buildPriorAnswerRecords({
      rows,
      residColumnIndex: 0,
      assignments,
      questions: [지원필요],
      ...(aliases ? { valueAliases: aliases } : {}),
    });
  }

  it('선택지 라벨이 일부만 바뀌면 실패율로 드러난다 — 절반의 성공이 묻히지 않는다', () => {
    const result = needImport([
      ['1', '매우 필요'],
      ['2', '다소 필요'],
      ['3', '다소 필요'],
      ['4', '필요 없음'],
    ]);
    // 값이 들어간 대상은 둘뿐이다.
    expect(result.records.map((r) => r.resid)).toEqual(['1', '4']);
    expect(result.optionMismatches).toEqual([
      {
        questionId: 'q-need',
        total: 4,
        unmatched: 2,
        rate: 0.5,
        values: [{ value: '다소 필요', count: 2 }],
      },
    ]);
  });

  it('안 맞은 값을 선택지에 이어주면 다시 올릴 때 그 값이 들어간다', () => {
    const result = needImport(
      [
        ['1', '매우 필요'],
        ['2', '다소 필요'],
      ],
      { 'q-need': { '다소 필요': 'some' } },
    );
    expect(result.records).toEqual([
      { resid: '1', answers: { 'q-need': 'very' } },
      { resid: '2', answers: { 'q-need': 'some' } },
    ]);
    expect(result.optionMismatches).toEqual([]);
  });
});
