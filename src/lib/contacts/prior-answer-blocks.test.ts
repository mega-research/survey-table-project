import { describe, expect, it } from 'vitest';

import {
  buildBlockAnswer,
  splitHeaderBlocks,
  suggestBlockMapping,
} from './prior-answer-blocks';
import type { Question } from '@/types/survey';

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

/**
 * 지난 회차 rawdata 에서 잘라낸 소형 픽스처.
 * 파트 행 / 문항코드 행(가로 병합) / 세부 라벨 행 3단이다.
 */
const HEADER_ROWS: string[][] = [
  ['', '', 'Ⅰ. 창업 현황', '', '', 'Ⅱ. 지원 분야', '', 'Ⅲ. 창업 의향', ''],
  ['ID', 'BQ1', 'BQ2', '', '', 'BQ3', '', 'BQ4', ''],
  ['시스템ID', '기업명', '대표자', '업종', '매출액', '자금', '멘토링', '1순위', '2순위'],
];

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
  tableRowsData: [
    {
      id: 'r1',
      label: '대표자',
      cells: [
        { id: 'cell-r1c0', type: 'text', content: '대표자' },
        { id: 'cell-r1c1', type: 'input', content: '' },
      ],
    },
    {
      id: 'r2',
      label: '업종',
      cells: [
        { id: 'cell-r2c0', type: 'text', content: '업종' },
        { id: 'cell-r2c1', type: 'input', content: '' },
      ],
    },
    {
      id: 'r3',
      label: '매출액',
      cells: [
        { id: 'cell-r3c0', type: 'text', content: '매출액' },
        { id: 'cell-r3c1', type: 'input', content: '' },
      ],
    },
  ],
});

const checkboxQuestion = q({
  id: 'q-check',
  questionCode: 'BQ3',
  type: 'checkbox',
  title: '지원받은 분야',
  options: [
    { id: 'o1', value: 'fund', label: '자금' },
    { id: 'o2', value: 'mentor', label: '멘토링' },
    { id: 'o3', value: 'space', label: '공간' },
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

describe('splitHeaderBlocks', () => {
  it('가로 병합된 문항코드 행에서 컬럼 블록을 잘라낸다', () => {
    const blocks = splitHeaderBlocks(HEADER_ROWS);
    expect(blocks.map((b) => [b.code, b.columnIndexes])).toEqual([
      ['ID', [0]],
      ['BQ1', [1]],
      ['BQ2', [2, 3, 4]],
      ['BQ3', [5, 6]],
      ['BQ4', [7, 8]],
    ]);
  });

  it('세부 라벨과 파트를 블록에 실어준다', () => {
    const blocks = splitHeaderBlocks(HEADER_ROWS);
    const table = blocks.find((b) => b.code === 'BQ2');
    expect(table?.detailLabels).toEqual(['대표자', '업종', '매출액']);
    expect(table?.part).toBe('Ⅰ. 창업 현황');
  });

  it('병합 없이 코드가 칸마다 반복돼도 한 블록으로 본다', () => {
    const blocks = splitHeaderBlocks([
      ['', '', ''],
      ['BQ3', 'BQ3', 'BQ4'],
      ['자금', '멘토링', '1순위'],
    ]);
    expect(blocks.map((b) => [b.code, b.columnIndexes])).toEqual([
      ['BQ3', [0, 1]],
      ['BQ4', [2]],
    ]);
  });

  it('코드 행이 처음부터 비어 있으면 그 앞 칸은 블록이 되지 않는다', () => {
    const blocks = splitHeaderBlocks([
      ['', ''],
      ['', 'BQ1'],
      ['비고', '기업명'],
    ]);
    expect(blocks.map((b) => b.code)).toEqual(['BQ1']);
  });

  it('헤더 행이 3단이 아니어도 코드 행만 있으면 동작한다', () => {
    const blocks = splitHeaderBlocks([['BQ1', 'BQ2']]);
    expect(blocks.map((b) => [b.code, b.detailLabels])).toEqual([
      ['BQ1', ['']],
      ['BQ2', ['']],
    ]);
  });
});

describe('suggestBlockMapping', () => {
  const blocks = splitHeaderBlocks(HEADER_ROWS);

  it('단일 컬럼 문항은 한 칸짜리 블록으로 이어진다', () => {
    const s = suggestBlockMapping(blocks, questions).find((x) => x.block.code === 'BQ1');
    expect(s?.questionId).toBe('q-text');
    expect(s?.slots).toEqual([{ kind: 'single' }]);
  });

  it('세부 라벨이 표 문항의 행 라벨과 대조되어 칸 단위로 제안된다', () => {
    const s = suggestBlockMapping(blocks, questions).find((x) => x.block.code === 'BQ2');
    expect(s?.questionId).toBe('q-table');
    expect(s?.slots).toEqual([
      { kind: 'table-cell', cellId: 'cell-r1c1', cellType: 'input' },
      { kind: 'table-cell', cellId: 'cell-r2c1', cellType: 'input' },
      { kind: 'table-cell', cellId: 'cell-r3c1', cellType: 'input' },
    ]);
  });

  it('복수응답 펼침은 세부 라벨이 보기 라벨과 대조된다', () => {
    const s = suggestBlockMapping(blocks, questions).find((x) => x.block.code === 'BQ3');
    expect(s?.questionId).toBe('q-check');
    expect(s?.slots).toEqual([
      { kind: 'checkbox-option', optionValue: 'fund' },
      { kind: 'checkbox-option', optionValue: 'mentor' },
    ]);
  });

  it('순위 열은 세부 라벨의 순위 번호로 자리를 정한다', () => {
    const s = suggestBlockMapping(blocks, questions).find((x) => x.block.code === 'BQ4');
    expect(s?.questionId).toBe('q-rank');
    expect(s?.slots).toEqual([
      { kind: 'ranking-rank', rank: 1 },
      { kind: 'ranking-rank', rank: 2 },
    ]);
  });

  it('세부 라벨이 없으면 표 칸을 읽는 순서로 채운다', () => {
    const noLabels = splitHeaderBlocks([
      ['', '', ''],
      ['BQ2', '', ''],
      ['', '', ''],
    ]);
    const s = suggestBlockMapping(noLabels, questions)[0];
    expect(s?.slots).toEqual([
      { kind: 'table-cell', cellId: 'cell-r1c1', cellType: 'input' },
      { kind: 'table-cell', cellId: 'cell-r2c1', cellType: 'input' },
      { kind: 'table-cell', cellId: 'cell-r3c1', cellType: 'input' },
    ]);
  });

  it('맞는 문항이 없으면 미매핑으로 남는다', () => {
    const s = suggestBlockMapping(splitHeaderBlocks([['ZZ9'], ['ZZ9'], ['']]), questions)[0];
    expect(s?.questionId).toBeNull();
  });
});

describe('buildBlockAnswer', () => {
  const blocks = splitHeaderBlocks(HEADER_ROWS);
  const suggestions = suggestBlockMapping(blocks, questions);
  const slotsFor = (code: string) => suggestions.find((s) => s.block.code === code)!.slots;
  const valueOf = (question: Question, slots: ReturnType<typeof slotsFor>, cells: string[]) =>
    buildBlockAnswer(question, slots, cells).value;

  it('표 문항의 칸들이 한 값 묶음으로 모인다', () => {
    expect(
      valueOf(tableQuestion, slotsFor('BQ2'), ['홍길동', '제조업', '1200']),
    ).toEqual({
      'cell-r1c1': '홍길동',
      'cell-r2c1': '제조업',
      'cell-r3c1': '1200',
    });
  });

  it('블록 안에 빈 칸이 있어도 나머지 칸이 정상 저장된다', () => {
    expect(valueOf(tableQuestion, slotsFor('BQ2'), ['홍길동', '', '1200'])).toEqual({
      'cell-r1c1': '홍길동',
      'cell-r3c1': '1200',
    });
  });

  it('복수응답 펼침에서 선택된 항목들이 한 배열로 모인다', () => {
    expect(valueOf(checkboxQuestion, slotsFor('BQ3'), ['1', ''])).toEqual(['fund']);
    expect(valueOf(checkboxQuestion, slotsFor('BQ3'), ['1', '1'])).toEqual([
      'fund',
      'mentor',
    ]);
  });

  it('비선택 표기는 선택으로 보지 않는다', () => {
    expect(valueOf(checkboxQuestion, slotsFor('BQ3'), ['0', '아니오'])).toBeUndefined();
  });

  it('순위 열이 순위 값으로 모인다', () => {
    expect(valueOf(rankingQuestion, slotsFor('BQ4'), ['수익', '자율성'])).toEqual([
      { rank: 1, optionValue: 'money' },
      { rank: 2, optionValue: 'freedom' },
    ]);
  });

  it('순위 칸이 비면 그 순위만 빠진다', () => {
    expect(valueOf(rankingQuestion, slotsFor('BQ4'), ['', '자율성'])).toEqual([
      { rank: 2, optionValue: 'freedom' },
    ]);
  });

  it('선택지에 없는 순위 값은 담지 않는다', () => {
    expect(valueOf(rankingQuestion, slotsFor('BQ4'), ['없는보기', ''])).toBeUndefined();
  });

  it('값이 하나도 없으면 아무것도 만들지 않는다', () => {
    expect(valueOf(tableQuestion, slotsFor('BQ2'), ['', '', ''])).toBeUndefined();
  });
});

describe('매핑 안전장치 — 코드·라벨 4분면', () => {
  const 만족도 = q({ id: 'q-sat', questionCode: 'BQ7', type: 'radio', title: '창업 지원 만족도' });
  const 창업의향 = q({ id: 'q-intent', questionCode: 'BQ8', type: 'radio', title: '창업 의향' });
  const safety = [만족도, 창업의향];

  function verdictFor(codeText: string, detail = '') {
    const blocks = splitHeaderBlocks([[codeText], [detail]]);
    return suggestBlockMapping(blocks, safety)[0];
  }

  it('코드가 같고 라벨이 유사하면 자동 제안한다', () => {
    const s = verdictFor('BQ7. 창업 지원 만족도');
    expect(s?.questionId).toBe('q-sat');
    expect(s?.verdict).toBe('auto');
  });

  it('코드가 같고 문항 내용이 다르면 매핑하지 않고 경고한다', () => {
    // 지난 회차에 파트가 재편되며 코드가 밀린 실제 사례 — BQ7 자리에 창업의향이 들어왔다.
    const s = verdictFor('BQ7. 창업 의향이 있으십니까');
    expect(s?.questionId).toBeNull();
    expect(s?.verdict).toBe('code-conflict');
    expect(s?.conflictQuestionId).toBe('q-sat');
  });

  it('코드가 다르고 문항 내용이 같으면 후보로 제안하며 확인이 필요하다고 표시한다', () => {
    const s = verdictFor('ZZ9. 창업 지원 만족도');
    expect(s?.questionId).toBe('q-sat');
    expect(s?.verdict).toBe('label-candidate');
  });

  it('코드도 라벨도 맞지 않으면 미매핑이다', () => {
    const s = verdictFor('ZZ9. 전혀 다른 문항');
    expect(s?.questionId).toBeNull();
    expect(s?.verdict).toBe('unmapped');
  });

  it('대조할 문항 내용이 없으면 코드 일치만으로 자동 제안한다', () => {
    // 라벨이 없는 파일에서 코드 일치를 경고로 뒤집으면 매핑이 전부 막힌다.
    const s = verdictFor('BQ7');
    expect(s?.questionId).toBe('q-sat');
    expect(s?.verdict).toBe('auto');
  });
});

describe('확정된 값 대응(alias) 재사용', () => {
  const 지원필요 = q({
    id: 'q-need',
    questionCode: 'BQ9',
    type: 'radio',
    title: '창업지원 필요여부',
    options: [
      { id: 'o1', value: 'very', label: '매우 필요' },
      { id: 'o2', value: 'some', label: '어느 정도 필요' },
    ],
  });

  const blocks = splitHeaderBlocks([['BQ9'], ['']]);
  const slots = suggestBlockMapping(blocks, [지원필요])[0]!.slots;

  it('선택지 라벨이 바뀐 값도 확정 대응이 있으면 들어간다', () => {
    // 지난 회차 "다소 필요" → 올해 "어느 정도 필요" 로 라벨만 바뀐 실제 사례.
    expect(buildBlockAnswer(지원필요, slots, ['다소 필요']).value).toBeUndefined();
    expect(
      buildBlockAnswer(지원필요, slots, ['다소 필요'], { '다소 필요': 'some' }).value,
    ).toBe('some');
  });

  it('확정 대응이 선택지에 없는 값을 가리키면 무시한다', () => {
    expect(
      buildBlockAnswer(지원필요, slots, ['다소 필요'], { '다소 필요': '없는값' }).value,
    ).toBeUndefined();
  });
});
