import { describe, expect, it } from 'vitest';

import {
  buildBlockAnswer,
  collectSampleValues,
  splitHeaderBlocks,
  splitYearMonth,
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

  it('코드 칸이 비었어도 파트 행에 제목이 있으면 앞 문항에 붙지 않는다', () => {
    // 실무 파일 꼬리: IQ3 단답 뒤에 "비고"·"출처(2차자료)" 메타 열이 파트 행에만 적혀 있다.
    // 앞 문항에 흡수되면 IQ3 가 세 칸짜리 블록이 돼 단답 값을 만들지 못한다.
    const blocks = splitHeaderBlocks([
      ['PART I.', '비고', '출처(2차자료)'],
      ['IQ3.', '', ''],
      ['개선 및 건의사항', '', ''],
    ]);
    expect(blocks.map((b) => [b.code, b.columnIndexes])).toEqual([
      ['IQ3.', [0]],
      ['비고', [1]],
      ['출처(2차자료)', [2]],
    ]);
  });

  it('병합 없이 빈 칸으로만 이어진 코드 행도 블록이 된다 — 실무 파일의 기본 형태', () => {
    const blocks = splitHeaderBlocks([
      ['PART B.', '', '', ''],
      ['BQ1-1.', '', '', 'BQ2.'],
      ['기업명', '입사 시기', '고용 형태', ''],
    ]);
    expect(blocks.map((b) => [b.code, b.columnIndexes])).toEqual([
      ['BQ1-1.', [0, 1, 2]],
      ['BQ2.', [3]],
    ]);
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

  it('세부 라벨이 없는 복수응답 펼침은 열에 든 값으로 보기를 정한다', () => {
    // 2025 rawdata DQ5-2: 세부 라벨 행이 비어 있고 각 열의 값 자체가 보기 라벨이다.
    // 첫 열의 세부 라벨은 보기가 아니라 문항 설명이다 — 값 폴백이 이 열도 살려야 한다.
    const spread = splitHeaderBlocks([
      ['PART B.', '', ''],
      ['BQ3', '', ''],
      ['지원분야(복수응답)', '', ''],
    ]);
    const samples = collectSampleValues([
      ['', '멘토링', ''],
      ['자금', '', '공간'],
    ]);
    const s = suggestBlockMapping(spread, questions, samples)[0];
    expect(s?.questionId).toBe('q-check');
    expect(s?.slots).toEqual([
      { kind: 'checkbox-option', optionValue: 'fund' },
      { kind: 'checkbox-option', optionValue: 'mentor' },
      { kind: 'checkbox-option', optionValue: 'space' },
    ]);
  });

  it('표본은 오류 표식을 건너뛰고 최빈값을 쓴다', () => {
    // 실제 파일 DQ5-2 첫 열: 첫 행이 #REF! 라 첫 값을 쓰면 보기 배정이 빠진다.
    const samples = collectSampleValues([
      ['#REF!'],
      ['초기 창업 자금'],
      ['초기 창업 자금'],
      ['오타'],
    ]);
    expect(samples.get(0)).toBe('초기 창업 자금');
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

  it('엑셀 오류 표식은 값으로 보지 않는다 — 복수응답을 켜지도, 단답에 들어가지도 않는다', () => {
    expect(valueOf(checkboxQuestion, slotsFor('BQ3'), ['#REF!', '#N/A'])).toBeUndefined();
    expect(valueOf(textQuestion, slotsFor('BQ1'), ['#VALUE!'])).toBeUndefined();
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

describe('실제 2025 rawdata 형태 — 세부 라벨이 코드북 약칭인 한 칸 문항', () => {
  const 이직 = q({
    id: 'q-bq1',
    questionCode: 'BQ1',
    type: 'radio',
    title: '작년(2025년 8월) 조사 이후 1년 이내 이직 경험이 있습니까?',
    options: [
      { id: 'y', value: '1', label: '① 있다 (▶ ‘BQ1-1’로 이동)' },
      { id: 'n', value: '2', label: '② 없다 (▶ ‘업무분야 문항으로 이동’)' },
    ],
  });

  it('세부 라벨 "(1년 이내 이직경험)" 은 문항 내용 대조에 쓰지 않아 코드 일치만으로 자동 제안된다', () => {
    const blocks = splitHeaderBlocks([['PART B.'], ['BQ1.'], ['(1년 이내 이직경험)']]);
    const s = suggestBlockMapping(blocks, [이직])[0];
    expect(s?.verdict).toBe('auto');
    expect(s?.questionId).toBe('q-bq1');
    expect(blocks[0]?.labelSource).toBe('detail');
  });

  it('코드 칸에 붙은 라벨은 여전히 게이트를 탄다', () => {
    const blocks = splitHeaderBlocks([['PART B.'], ['BQ1. 완전히 다른 문항 제목'], ['']]);
    expect(blocks[0]?.labelSource).toBe('code');
    expect(suggestBlockMapping(blocks, [이직])[0]?.verdict).toBe('code-conflict');
  });

  it('서술형으로 재코딩된 2지 값도 끝말로 극을 정한다', () => {
    const 확인 = q({
      id: 'q-dq1',
      questionCode: 'DQ1',
      type: 'radio',
      title: '귀하가 창업한 기업명이 [ ] 맞습니까?',
      options: [
        { id: 'y', value: '1', label: '① 예 (▶ ‘DQ1-1’로 이동)' },
        { id: 'n', value: '2', label: '② 아니오 (▶ ‘DQ2’로 이동)' },
      ],
    });
    const slots = suggestBlockMapping(splitHeaderBlocks([['DQ1.'], ['']]), [확인])[0]!.slots;
    expect(buildBlockAnswer(확인, slots, ['창업 기업이 맞음']).value).toBe('1');
    expect(buildBlockAnswer(확인, slots, ['창업 기업이 아님']).value).toBe('2');
    expect(buildBlockAnswer(확인, slots, ['신규 창업 없음']).value).toBe('2');
    // 3지 이상 문항에는 동의어를 적용하지 않는다 — 극이 둘이 아니다.
    const 셋 = q({ ...확인, id: 'q3', options: [...(확인.options ?? []), { id: 'z', value: '3', label: '③ 모름' }] });
    expect(buildBlockAnswer(셋, slots, ['창업 기업이 맞음']).value).toBeUndefined();
  });

  it('원문자 번호와 라우팅 꼬리를 뗀 2026 보기에 2025 "있음/없음" 이 동의어로 붙는다', () => {
    const slots = suggestBlockMapping(splitHeaderBlocks([['BQ1.'], ['']]), [이직])[0]!.slots;
    expect(buildBlockAnswer(이직, slots, ['있음']).value).toBe('1');
    expect(buildBlockAnswer(이직, slots, ['없음']).value).toBe('2');
    expect(buildBlockAnswer(이직, slots, ['있다']).value).toBe('1');
  });
});

describe('라벨 표기 차이 흡수', () => {
  const 동기 = q({
    id: 'q-dq3',
    questionCode: 'DQ3',
    type: 'radio',
    title: '창업 동기',
    options: [
      { id: 'a', value: '3', label: '③ 경제·사회 발전에 이바지하기 위하여' },
      { id: 'b', value: '9', label: '⑨ 기타(직접 입력 :                           )' },
    ],
  });
  const 상태 = q({
    id: 'q-aq1',
    questionCode: 'AQ1',
    type: 'radio',
    title: '현재 상태',
    options: [
      { id: 'a', value: '1', label: '① 재학/휴학(고등학교/대학/대학원 재학 또는 휴학 중)' },
      { id: 'b', value: '3', label: '③ 취업' },
      { id: 'c', value: '10', label: '⑩ 기타(창업 준비 등 구체적으로 작성)' },
    ],
  });
  const slotsOf = (question: Question) =>
    suggestBlockMapping(splitHeaderBlocks([[question.questionCode ?? '']]), [question])[0]!.slots;

  it('가운뎃점 종류가 달라도 같은 보기다', () => {
    // 2025 값은 U+2027(‧), 2026 보기는 U+00B7(·)
    expect(buildBlockAnswer(동기, slotsOf(동기), ['경제‧사회 발전에 이바지하기 위하여']).value).toBe('3');
  });

  it('2025 "기타" 는 2026 "기타(직접 입력 : )" 에 접두로 붙는다', () => {
    expect(buildBlockAnswer(동기, slotsOf(동기), ['기타']).value).toBe('9');
  });

  it('괄호 설명이 붙은 보기에 설명 없는 값이 붙되, 원문 쪽 괄호는 삼키지 않는다', () => {
    expect(buildBlockAnswer(상태, slotsOf(상태), ['재학/휴학']).value).toBe('1');
    // "기타(AI연구 개발)" 은 기타 텍스트 보존 대상 — 여기서 ⑩ 기타로 뭉개지 않는다.
    expect(buildBlockAnswer(상태, slotsOf(상태), ['기타(AI연구 개발)']).value).toBeUndefined();
  });

  it('빈칸 표기와 export 잔재는 값으로 보지 않는다', () => {
    expect(buildBlockAnswer(textQuestion, slotsFor('BQ1'), ['[object Object]']).value).toBeUndefined();
    expect(buildBlockAnswer(textQuestion, slotsFor('BQ1'), ['--']).value).toBeUndefined();
    expect(buildBlockAnswer(textQuestion, slotsFor('BQ1'), ['.']).value).toBeUndefined();
  });

  function slotsFor(code: string) {
    return suggestBlockMapping(splitHeaderBlocks([[code]]), [textQuestion])[0]!.slots;
  }
});

describe('표 년월 칸 분해', () => {
  const 취업현황 = q({
    id: 'q-bq1-1',
    questionCode: 'BQ1_1',
    type: 'table',
    title: '귀하의 현재 취업 상태에 대해 몇 가지 질문드립니다.',
    tableColumns: [{ id: 'c0', label: '항목' }, { id: 'c1', label: '년' }, { id: 'c2', label: '월' }],
    tableRowsData: [
      {
        id: 'r-name',
        label: '기업명',
        cells: [
          { id: 'name-label', type: 'text', content: '기업명' },
          { id: 'name', type: 'input', content: '' },
          { id: 'name-blank', type: 'text', content: '' },
        ],
      },
      {
        id: 'r-date',
        label: '입사 시기',
        cells: [
          { id: 'date-label', type: 'text', content: '입사 시기' },
          { id: 'year', type: 'input', content: '' },
          { id: 'month', type: 'input', content: '' },
        ],
      },
    ],
  });

  it('splitYearMonth 가 두 자리 연도를 보정하고 월의 앞 0 을 뗀다', () => {
    expect(splitYearMonth('2025년 1월')).toEqual({ year: '2025', month: '1' });
    expect(splitYearMonth('25년 05월')).toEqual({ year: '2025', month: '5' });
    expect(splitYearMonth('2026년1월')).toEqual({ year: '2026', month: '1' });
    expect(splitYearMonth('정규직')).toBeNull();
  });

  it('"2025년 1월" 이 년 칸에 통째로 들어가지 않고 년·월 두 칸으로 나뉜다', () => {
    const blocks = splitHeaderBlocks([['PART B.', ''], ['BQ1-1.', ''], ['기업명', '입사 시기']]);
    const s = suggestBlockMapping(blocks, [취업현황])[0]!;
    expect(s.slots.map((x) => x.kind)).toEqual(['table-cell', 'table-cell']);
    expect(buildBlockAnswer(취업현황, s.slots, ['네이버', '2025년 1월']).value).toEqual({
      name: '네이버',
      year: '2025',
      month: '1',
    });
  });

  it('세부 라벨이 있는데 안 맞으면 순서로 덮지 않고 그 칸만 비운다', () => {
    // 2026 표에 없는 라벨 "메모" — 칸 수가 우연히 같아도 순서 폴백을 타면 안 된다.
    const blocks = splitHeaderBlocks([['PART B.', ''], ['BQ1-1.', ''], ['기업명', '메모']]);
    const s = suggestBlockMapping(blocks, [취업현황])[0]!;
    expect(s.slots[0]?.kind).toBe('table-cell');
    expect(s.slots[1]?.kind).toBe('unmatched');
  });
});
