import { describe, expect, it } from 'vitest';

import {
  VALUE_FIT_CANDIDATE_MIN,
  VALUE_FIT_CONFLICT_BELOW,
  VALUE_FIT_MIN_SAMPLES,
  buildBlockAnswer,
  collectColumnValueCounts,
  collectSampleValues,
  resolveSlots,
  sampleFit,
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

describe('표 칸 세부 라벨 폴백', () => {
  // 2026 BQ1_1 표의 실제 모양 — 행마다 `값`·`값2` 두 칸이 있고 대부분 `값2` 는 숨김이며,
  // 년·월 행만 둘 다 보인다. 2025 rawdata 세부 라벨은 이 행 라벨과 정확히 같지 않다.
  const text = (id: string, content = '', isHidden = false) => ({ id, type: 'text', content, isHidden });
  const input = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'input', content: '', ...extra });
  const radio = (id: string, labels: string[], extra: Record<string, unknown> = {}) => ({
    id,
    type: 'radio',
    content: '',
    radioOptions: labels.map((label, i) => ({ id: `${id}-o${i + 1}`, value: String(i + 1), label })),
    ...extra,
  });
  const 취업현황 = q({
    id: 'q-bq1-1',
    questionCode: 'BQ1_1',
    type: 'table',
    title: '귀하의 현재 취업 상태에 대해 몇 가지 질문드립니다.',
    tableColumns: [{ id: 'c0', label: '라벨' }, { id: 'c1', label: '값' }, { id: 'c2', label: '값2' }],
    tableRowsData: [
      {
        id: 'r-name',
        label: '기업명',
        cells: [text('name-label', '기업명'), input('name'), input('name-2', { isHidden: true })],
      },
      {
        id: 'r-date',
        label: '입사 시기',
        cells: [
          text('date-label', '입사 시기'),
          input('year', { inputType: 'number', exportLabel: 'BQ1_1_입사 시기_년' }),
          input('month', { inputType: 'number', exportLabel: 'BQ1_1_입사 시기_월' }),
        ],
      },
      {
        id: 'r-field',
        label: '업무 분야 (중복응답)',
        cells: [
          text('field-label', '업무 분야'),
          radio('field', ['① IT/SW 관련 분야', '② 비 IT/SW 관련 분야']),
          radio('field-2', ['① IT/SW 관련 분야', '② 비 IT/SW 관련 분야'], { isHidden: true }),
        ],
      },
      {
        id: 'r-job-it',
        label: '담당 직무_① IT/SW 관련 세부분야',
        cells: [
          text('job-it-label', '담당 직무'),
          radio('job-it', [
            '① 정보기술 전략·계획(컨설팅, 기획, 제품기획, 분석 등)',
            '② 정보기술 개발(SW아키텍처, 응용SW, 임베디드SW, DB, N/W,보안, UX/UI, 시스템SW 엔지니어링 등)',
            '⑥ 기타',
          ]),
          radio('job-it-2', ['⑥ 기타'], { isHidden: true }),
        ],
      },
      {
        id: 'r-job-other',
        label: '담당 직무_② 비 IT/SW 관련 분야',
        cells: [text('job-other-label', '', true), input('job-other'), input('job-other-2', { isHidden: true })],
      },
      {
        id: 'r-title',
        label: '귀하의 직책',
        cells: [
          text('title-label', '귀하의 직책'),
          radio('title', ['① CEO', '② CTO', '③ 기타']),
          radio('title-2', ['① CEO', '② CTO', '③ 기타'], { isHidden: true }),
        ],
      },
      {
        id: 'r-item',
        label: '창업아이템 또는 제품명_값',
        cells: [
          input('item', { exportLabel: 'BQ1_1_창업아이템 또는 제품명' }),
          input('item-2', { isHidden: true }),
          input('item-3', { isHidden: true }),
        ],
      },
    ],
  });

  /** 세부 라벨 한 칸짜리 블록의 자리. */
  function slotFor(question: Question, label: string, sample = '') {
    const block = splitHeaderBlocks([['PART B.'], ['BQ1-1.'], [label]])[0]!;
    return resolveSlots(question, block, [sample])[0]!;
  }

  it('괄호 꼬리가 붙은 행 라벨에 줄기 일치로 붙는다 — "업무 분야" → "업무 분야 (중복응답)"', () => {
    expect(slotFor(취업현황, '업무 분야')).toEqual({ kind: 'table-cell', cellId: 'field', cellType: 'radio' });
  });

  it('선두 "귀하의" 를 뗀 줄기 일치 — "직책" → "귀하의 직책"', () => {
    expect(slotFor(취업현황, '직책')).toEqual({ kind: 'table-cell', cellId: 'title', cellType: 'radio' });
  });

  it('접두 일치 — "창업아이템" → "창업아이템 또는 제품명_값" 행의 첫 답 가능 칸', () => {
    // exportLabel 은 `BQ1_1_창업아이템…` 이라 접두가 아니다 — 행 라벨이 `_값` 꼬리를 달고라도 있어서 잡힌다.
    expect(slotFor(취업현황, '창업아이템')).toEqual({ kind: 'table-cell', cellId: 'item', cellType: 'input' });
  });

  it('바이그램 Dice 경계값 0.5 — "입사예정시기" → "입사 시기" 행의 첫 칸(년), 년월 값은 두 칸으로 나뉜다', () => {
    const slot = slotFor(취업현황, '입사예정시기');
    expect(slot).toEqual({ kind: 'table-cell', cellId: 'year', cellType: 'input' });
    expect(buildBlockAnswer(취업현황, [slot], ['2025년 7월']).value).toEqual({ year: '2025', month: '7' });
  });

  it('접두 후보가 두 행이면 표본값이 보기에 맞는 행을 고른다 — "담당 직무" + "정보기술 개발"', () => {
    // 2025 최빈값 "정보기술 개발" 은 radio 행의 "② 정보기술 개발(SW아키텍처, …)" 에 줄기로 맞고, input 행은 보기가 없다.
    expect(slotFor(취업현황, '담당 직무', '정보기술 개발')).toEqual({
      kind: 'table-cell',
      cellId: 'job-it',
      cellType: 'radio',
    });
  });

  it('표본값이 어느 후보 행의 보기에도 안 맞으면 첫 행을 집지 않고 사유를 남긴다', () => {
    const slot = slotFor(취업현황, '담당 직무', '영업');
    expect(slot.kind).toBe('unmatched');
    const reason = slot.kind === 'unmatched' ? (slot.reason ?? '') : '';
    expect(reason).toContain('담당 직무_① IT/SW 관련 세부분야');
    expect(reason).toContain('담당 직무_② 비 IT/SW 관련 분야');
    expect(reason).toContain('영업');
    // 마법사는 슬롯들을 ' / ' 로 잇는다 — 사유 안의 행 나열이 같은 구분자를 쓰면 한 줄에서
    // 후보 행과 슬롯 경계가 구분되지 않는다. 행 이름은 따옴표로 감싸고 쉼표로 잇는다.
    expect(reason).not.toContain(' / ');
    expect(reason).toContain('"담당 직무_① IT/SW 관련 세부분야", "담당 직무_② 비 IT/SW 관련 분야"');
  });

  it('한 행에서 라벨이 먼저 맞은 칸이 input 이어도 뒤 radio 칸의 보기에 표본값이 맞으면 그 행의 그 칸을 고른다', () => {
    // 행 점수는 그 행의 첫 후보 칸이 아니라 어느 후보 칸이든 보기에 맞으면 1 이다 — 첫 칸만 보면
    // "메모 input + 선택 radio" 가 나란한 행이 표본값이 보기에 맞아도 늘 0 점이라 미배정이 된다.
    const 메모와선택 = q({
      id: 'q-memo-radio',
      questionCode: 'BQ1_1',
      type: 'table',
      title: '담당 직무',
      tableColumns: [{ id: 'c0', label: '라벨' }, { id: 'c1', label: '메모' }, { id: 'c2', label: '값' }],
      tableRowsData: [
        {
          id: 'r-it',
          label: '담당 직무_① IT',
          cells: [text('it-label'), input('it-memo'), radio('it', ['① 개발', '② 기타'])],
        },
        { id: 'r-non', label: '담당 직무_② 비IT', cells: [text('non-label'), input('non-memo'), input('non')] },
      ],
    });
    expect(slotFor(메모와선택, '담당 직무', '개발')).toEqual({ kind: 'table-cell', cellId: 'it', cellType: 'radio' });
    // 표본값이 어느 보기에도 안 맞으면 여전히 미배정이다 — 첫 행을 집지 않는다.
    expect(slotFor(메모와선택, '담당 직무', '영업').kind).toBe('unmatched');
  });

  it('표본값이 두 후보 행의 보기에 모두 맞는 동률이면 미배정이다', () => {
    const 직무둘 = q({
      id: 'q-two',
      questionCode: 'BQ1_1',
      type: 'table',
      title: '담당 직무',
      tableColumns: [{ id: 'c0', label: '라벨' }, { id: 'c1', label: '값' }],
      tableRowsData: [
        { id: 'r-it', label: '담당 직무_① IT', cells: [text('it-label'), radio('it', ['① 개발', '② 기타'])] },
        { id: 'r-non', label: '담당 직무_② 비IT', cells: [text('non-label'), radio('non', ['① 영업', '② 기타'])] },
      ],
    });
    const slot = slotFor(직무둘, '담당 직무', '기타');
    expect(slot.kind).toBe('unmatched');
    expect(slot.kind === 'unmatched' ? slot.reason : '').toBe(
      '후보 2행("담당 직무_① IT", "담당 직무_② 비IT") — 표본값 "기타" 으로 못 가름',
    );
  });

  it('한 행에 이름 붙은 열이 여럿인 표에서는 행의 첫 칸이 아니라 라벨이 맞은 칸을 준다', () => {
    // 2026 EQ4_1: 행 하나에 "지원 받은 시기_년/월"·"지원 예정 시기_년/월"·"사업명(프로그램명)" 열이 나란하다.
    // 2025 "프로그램명" 은 Dice 로 사업명 열에만 맞는다 — 행이 유일하다고 그 행의 첫 칸(년)을 집으면 오배정이다.
    const 지원사업 = q({
      id: 'q-eq4-1',
      questionCode: 'EQ4_1',
      type: 'table',
      title: '귀하가 지원 받았거나 지원 받을 예정인 창업지원사업(프로그램)은 무엇입니까?',
      tableColumns: [
        { id: 'c0', label: '지원 받은 시기' },
        { id: 'c1', label: '지원 받은 시기_년' },
        { id: 'c2', label: '지원 받은 시기_월' },
        { id: 'c3', label: '사업명(프로그램명)_라벨' },
        { id: 'c4', label: '사업명(프로그램명)' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          label: '행 1',
          cells: [
            text('when-label', '지원 받은 시기'),
            input('when-year', { inputType: 'number' }),
            input('when-month', { inputType: 'number' }),
            text('program-label', '사업명(프로그램명)'),
            input('program'),
          ],
        },
      ],
    });
    const block = splitHeaderBlocks([['PART E.'], ['EQ4-1.'], ['프로그램명']])[0]!;
    expect(resolveSlots(지원사업, block, [''])[0]).toEqual({ kind: 'table-cell', cellId: 'program', cellType: 'input' });
  });

  it('어느 단계에도 안 걸리는 "메모" 는 사유 없이 미배정이다 — Dice 0 이라 ③ 도 잡지 않는다', () => {
    expect(slotFor(취업현황, '메모')).toStrictEqual({ kind: 'unmatched' });
  });

  it('한 글자 세부 라벨은 접두 일치로 붙지 않는다', () => {
    // "기" 는 "기업명" 의 접두지만, 한 글자를 허용하면 전 칸에 붙는다.
    expect(slotFor(취업현황, '기')).toStrictEqual({ kind: 'unmatched' });
  });

  it('BQ1-1 블록 전체 — "메모" 한 칸만 미배정으로 남고, 업무 분야 값은 값 대응이 있어야 들어간다', () => {
    const labels = ['기업명', '입사예정시기', '업무 분야', '담당 직무', '직책', '창업아이템', '메모'];
    const blank = labels.map(() => '');
    const blocks = splitHeaderBlocks([['PART B.', ...blank.slice(1)], ['BQ1-1.', ...blank.slice(1)], labels]);
    // 2025 실제 값이다 — 업무 분야는 "IT/SW관련"×1,130 / "비 IT/SW관련"×14 로, 2026 보기
    // "① IT/SW 관련 분야" 와 정확·줄기 어느 쪽으로도 맞지 않는다(드라이런 생성 0 / 실패 1,144).
    // 칸 배정은 이 티켓, 값 대응은 결정 원장대로 매핑 화면 몫이라 둘을 따로 단언한다.
    const samples = collectSampleValues([
      ['네이버', '2025년 7월', 'IT/SW관련', '정보기술 개발', 'CEO', '검색 앱', ''],
      ['카카오', '2024년 12월', 'IT/SW관련', '정보기술 개발', 'CTO', '', '재직 중'],
      ['쿠팡', '2025년 3월', '비 IT/SW관련', '영업', '기타', '물류 서비스', ''],
    ]);
    const s = suggestBlockMapping(blocks, [취업현황], samples)[0]!;
    expect(s.questionId).toBe('q-bq1-1');
    expect(s.slots).toEqual([
      { kind: 'table-cell', cellId: 'name', cellType: 'input' },
      { kind: 'table-cell', cellId: 'year', cellType: 'input' },
      { kind: 'table-cell', cellId: 'field', cellType: 'radio' },
      { kind: 'table-cell', cellId: 'job-it', cellType: 'radio' },
      { kind: 'table-cell', cellId: 'title', cellType: 'radio' },
      { kind: 'table-cell', cellId: 'item', cellType: 'input' },
      { kind: 'unmatched' },
    ]);
    const row = ['네이버', '2025년 7월', 'IT/SW관련', '정보기술 개발', 'CEO', '검색 앱', '재직 중'];
    // 값 대응 없이는 업무 분야 칸이 비고 원본 값이 실패 목록에 남는다.
    const bare = buildBlockAnswer(취업현황, s.slots, row);
    expect(bare.value).toEqual({
      name: '네이버',
      year: '2025',
      month: '7',
      'job-it': '2',
      title: '1',
      item: '검색 앱',
    });
    expect(bare.unmatchedValues).toEqual(['IT/SW관련']);
    // 값 대응을 이어주면 같은 칸에 들어간다.
    expect(buildBlockAnswer(취업현황, s.slots, row, { 'IT/SW관련': '1' }).value).toEqual({
      name: '네이버',
      year: '2025',
      month: '7',
      field: '1',
      'job-it': '2',
      title: '1',
      item: '검색 앱',
    });
  });
});

describe('collectColumnValueCounts', () => {
  it('열별 값 분포를 건수 내림차순으로 내고 첫 항목이 collectSampleValues 의 최빈값과 같다', () => {
    const rows = [['#REF!', 'a'], ['도움됨', ''], ['보통', 'b'], ['도움됨', '--'], ['', 'a']];
    const counts = collectColumnValueCounts(rows);
    expect(counts.get(0)).toEqual([
      { value: '도움됨', count: 2 },
      { value: '보통', count: 1 },
    ]);
    expect(counts.get(1)).toEqual([
      { value: 'a', count: 2 },
      { value: 'b', count: 1 },
    ]);
    expect(collectSampleValues(rows).get(0)).toBe('도움됨');
    expect(collectSampleValues(rows).get(1)).toBe('a');
  });

  it('열당 distinct 값은 200개까지만 보존한다', () => {
    const rows = Array.from({ length: 250 }, (_, i) => [`값${i}`]);
    expect(collectColumnValueCounts(rows).get(0)).toHaveLength(200);
  });
});

describe('값 기반 오매핑 방지', () => {
  const 창업의향 = q({
    id: 'q-intent',
    questionCode: 'HQ1',
    type: 'radio',
    title: 'HQ1. 귀하는 향후 창업하실 의향이 있으신가요?',
    options: [
      { id: 'y', value: '1', label: '① 예' },
      { id: 'n', value: '2', label: '② 아니오' },
    ],
  });
  const 도움도 = q({
    id: 'q-help',
    questionCode: 'ZZ7',
    type: 'radio',
    title: 'ZZ7. 과정이 도움이 되었습니까?',
    options: [
      { id: 'a', value: '1', label: '① 매우 도움됨' },
      { id: 'b', value: '2', label: '② 도움됨' },
      { id: 'c', value: '3', label: '③ 보통' },
      { id: 'd', value: '4', label: '④ 도움되지 않음' },
    ],
  });
  const 진로계획 = q({
    id: 'q-aq1-1',
    questionCode: 'AQ1_1',
    type: 'radio',
    title: 'AQ1-1. 귀하의 졸업 후 진로 계획은 어떻게 되십니까?',
    options: [
      { id: 'a', value: '1', label: '① 진학' },
      { id: 'b', value: '2', label: '② 취업' },
      { id: 'c', value: '3', label: '③ 창업' },
      { id: 'd', value: '4', label: '④ 프리랜서' },
      { id: 'e', value: '5', label: '⑤ 기타' },
    ],
  });
  const 진학예정 = q({
    id: 'q-aq1-2',
    questionCode: 'AQ1_2',
    type: 'radio',
    title: 'AQ1-2. 귀하의 진학 예정은 어떻게 되십니까?',
    options: [
      { id: 'a', value: '1', label: '① 학사' },
      { id: 'b', value: '2', label: '② 석사' },
      { id: 'c', value: '3', label: '③ 박사' },
      { id: 'd', value: '4', label: '④ 기타' },
    ],
  });

  /** 한 열짜리 데이터 — 값 목록을 행으로 편다. */
  const column = (values: string[]) => values.map((value) => [value]);
  const repeat = (value: string, n: number) => Array.from({ length: n }, () => value);
  const 도움됨12 = column([...repeat('매우 도움됨', 7), ...repeat('도움됨', 4), '보통']);

  function suggest(
    headerRows: string[][],
    questions: Question[],
    rows: string[][],
    valueAliases?: Record<string, Record<string, string>>,
  ) {
    const blocks = splitHeaderBlocks(headerRows);
    return suggestBlockMapping(blocks, questions, collectSampleValues(rows), {
      valueCountsByColumn: collectColumnValueCounts(rows),
      ...(valueAliases ? { valueAliases } : {}),
    });
  }

  it('상수 — 표본 3건 미만은 판정하지 않고, 5% 미만이면 충돌, 80% 이상이면 후보다', () => {
    expect(VALUE_FIT_MIN_SAMPLES).toBe(3);
    expect(VALUE_FIT_CONFLICT_BELOW).toBe(0.05);
    expect(VALUE_FIT_CANDIDATE_MIN).toBe(0.8);
  });

  it('코드가 같아도 값이 그 문항의 보기와 하나도 안 맞으면 value-conflict 로 멈춘다', () => {
    // 2025 HQ1.(과정 도움도)이 2026 HQ1(창업 의향)에 코드만 보고 auto 로 붙어 180/180 실패한 사고.
    const [s] = suggest([['HQ1.'], ['(과정 도움도)']], [창업의향], 도움됨12);
    expect(s?.verdict).toBe('value-conflict');
    expect(s?.questionId).toBeNull();
    expect(s?.matchedBy).toBeNull();
    expect(s?.conflictQuestionId).toBe('q-intent');
    expect(s?.verdictReason).toContain('12건');
    expect(s?.verdictReason).toContain('0건');
    expect(s?.verdictReason).toContain('창업하실 의향');
    expect(s?.slots).toEqual([{ kind: 'unmatched' }]);
  });

  it('같은 상황에서 값이 맞는 다른 문항이 하나면 그것을 후보로 제안하고 코드 문항은 충돌로 남긴다', () => {
    const [s] = suggest([['HQ1.'], ['(과정 도움도)']], [창업의향, 도움도], 도움됨12);
    expect(s?.verdict).toBe('label-candidate');
    expect(s?.matchedBy).toBe('value');
    expect(s?.questionId).toBe('q-help');
    expect(s?.conflictQuestionId).toBe('q-intent');
    expect(s?.verdictReason).toContain('12건');
    expect(s?.slots).toEqual([{ kind: 'single' }]);
  });

  it('AQ1-1/AQ1-2 처럼 코드가 서로 바뀐 두 블록은 각각 값이 맞는 반대 문항으로 제안된다', () => {
    // 첫 블록이 AQ1_2 를 가져가도 코드 문항 AQ1_1 은 taken 에 넣지 않아 둘째 블록이 제안받는다.
    const headerRows = [['AQ1-1.', 'AQ1-2.'], ['(진학계획)', '(진로계획)']];
    const rows = [
      ...Array.from({ length: 6 }, () => ['학사', '취업']),
      ...Array.from({ length: 3 }, () => ['석사', '진학']),
      ...Array.from({ length: 3 }, () => ['박사', '창업']),
    ];
    const [first, second] = suggest(headerRows, [진로계획, 진학예정], rows);
    expect(first?.verdict).toBe('label-candidate');
    expect(first?.matchedBy).toBe('value');
    expect(first?.questionId).toBe('q-aq1-2');
    expect(first?.conflictQuestionId).toBe('q-aq1-1');
    expect(second?.verdict).toBe('label-candidate');
    expect(second?.matchedBy).toBe('value');
    expect(second?.questionId).toBe('q-aq1-1');
    expect(second?.conflictQuestionId).toBeUndefined();
    expect(second?.verdictReason).toContain('12건');
  });

  it('코드가 없는 2지 블록에 값이 맞는 문항이 여럿이면 제목 유사도가 유일하게 높은 것을 제안한다', () => {
    // 2025 IQ1.(있음/없음, 라벨 "창업의향")은 2지 문항 넷과 전부 100% 다 — 제목으로 HQ1 을 가른다.
    const 동의 = q({
      id: 'q-consent',
      questionCode: 'SQ0',
      type: 'radio',
      title: 'SQ0. 개인정보 수집에 동의하십니까?',
      options: [
        { id: 'y', value: '1', label: '① 예' },
        { id: 'n', value: '2', label: '② 아니오' },
      ],
    });
    const rows = column([...repeat('있음', 8), ...repeat('없음', 4)]);
    const [s] = suggest([['IQ1.'], ['창업의향']], [동의, 창업의향], rows);
    expect(s?.verdict).toBe('label-candidate');
    expect(s?.matchedBy).toBe('value');
    expect(s?.questionId).toBe('q-intent');
    expect(s?.conflictQuestionId).toBeUndefined();
    expect(s?.verdictReason).toContain('12건');
  });

  it('후보가 여럿인데 제목으로 못 가르면 제안하지 않고 사유에 후보 목록을 남긴다', () => {
    const 동의1 = q({ ...창업의향, id: 'q-s0', questionCode: 'SQ0', title: '동의 여부' });
    const 동의2 = q({ ...창업의향, id: 'q-s1', questionCode: 'SQ1', title: '참여 여부' });
    const rows = column([...repeat('있음', 8), ...repeat('없음', 4)]);
    const [s] = suggest([['IQ1.'], ['']], [동의1, 동의2], rows);
    expect(s?.verdict).toBe('unmapped');
    expect(s?.questionId).toBeNull();
    expect(s?.verdictReason).toContain('SQ0');
    expect(s?.verdictReason).toContain('SQ1');
    expect(s?.verdictReason).toContain('2개');
  });

  it('문항코드 꼴이 아닌 메타 열은 값이 맞아도 후보 검색 대상이 아니다 — 뒤의 코드 블록이 그 문항을 제안받는다', () => {
    // 2025 파일 앞머리의 "2024년 조사 결과 / 현재상태" 열(취업·창업·재학…)이 AQ1_1 보기에 80% 맞아
    // AQ1_1 을 선점하면, 코드가 바뀐 AQ1-2. 블록이 AQ1_1 을 제안받지 못한다.
    const headerRows = [['현재상태', 'AQ1-2.'], ['', '(졸업 후 진로계획)']];
    const rows = [
      ...Array.from({ length: 6 }, () => ['취업', '취업']),
      ...Array.from({ length: 3 }, () => ['창업', '진학']),
      ...Array.from({ length: 3 }, () => ['진학', '창업']),
    ];
    const [meta, coded] = suggest(headerRows, [진로계획, 진학예정], rows);
    expect(meta?.verdict).toBe('unmapped');
    expect(meta?.questionId).toBeNull();
    expect(meta?.verdictReason).toBeUndefined();
    expect(coded?.verdict).toBe('label-candidate');
    expect(coded?.matchedBy).toBe('value');
    expect(coded?.questionId).toBe('q-aq1-1');
  });

  it('코드 일치 문항의 적합도가 5% 이상이면 auto 그대로다 — 절반 실패는 미리보기 실패율이 맡는다', () => {
    const rows = column([...repeat('도움됨', 10), '예', '아니오']);
    const [s] = suggest([['HQ1.'], ['']], [창업의향, 도움도], rows);
    expect(s?.verdict).toBe('auto');
    expect(s?.questionId).toBe('q-intent');
    expect(s?.verdictReason).toBeUndefined();
  });

  it('표본이 3건 미만이면 판정을 바꾸지 않는다', () => {
    const [s] = suggest([['HQ1.'], ['']], [창업의향, 도움도], column(['도움됨', '보통']));
    expect(s?.verdict).toBe('auto');
    expect(s?.questionId).toBe('q-intent');
  });

  it('자유입력 문항은 값이 무엇이든 auto 다', () => {
    const 단답 = q({ id: 'q-free', questionCode: 'HQ1', type: 'text', title: '자유 의견' });
    const [s] = suggest([['HQ1.'], ['']], [단답, 도움도], 도움됨12);
    expect(s?.verdict).toBe('auto');
    expect(s?.questionId).toBe('q-free');
  });

  describe('표 블록', () => {
    const 현황 = q({
      id: 'q-dq2',
      questionCode: 'DQ2',
      type: 'table',
      title: '창업 기업 현황',
      tableColumns: [{ id: 'c0', label: '항목' }, { id: 'c1', label: '값' }],
      tableRowsData: [
        {
          id: 'r-field',
          label: '업종',
          cells: [
            { id: 'field-label', type: 'text', content: '업종' },
            {
              id: 'field',
              type: 'radio',
              content: '',
              radioOptions: [
                { id: 'f1', value: '1', label: '① IT/SW' },
                { id: 'f2', value: '2', label: '② 비 IT/SW' },
              ],
            },
          ],
        },
        {
          id: 'r-name',
          label: '기업명',
          cells: [
            { id: 'name-label', type: 'text', content: '기업명' },
            { id: 'name', type: 'input', content: '' },
          ],
        },
      ],
    });

    it('선택 칸의 절반이 실패해도 auto 다', () => {
      const rows = [
        ...Array.from({ length: 6 }, () => ['IT/SW', '네이버']),
        ...Array.from({ length: 6 }, () => ['경기도', '카카오']),
      ];
      const [s] = suggest([['DQ2.', ''], ['업종', '기업명']], [현황], rows);
      expect(s?.verdict).toBe('auto');
      expect(s?.slots.map((slot) => slot.kind)).toEqual(['table-cell', 'table-cell']);
    });

    it('선택 칸이 전부 실패하면 value-conflict 다', () => {
      const rows = Array.from({ length: 12 }, () => ['경기도', '카카오']);
      const [s] = suggest([['DQ2.', ''], ['업종', '기업명']], [현황], rows);
      expect(s?.verdict).toBe('value-conflict');
      expect(s?.conflictQuestionId).toBe('q-dq2');
      expect(s?.verdictReason).toContain('12건');
    });

    it('input 칸만 있는 표는 판정 대상이 아니다', () => {
      const rows = Array.from({ length: 12 }, () => ['카카오']);
      const [s] = suggest([['DQ2.'], ['기업명']], [현황], rows);
      expect(s?.verdict).toBe('auto');
    });
  });

  describe('복수응답 펼침', () => {
    it('슬롯이 전부 미배정인데 표본이 있으면 value-conflict 다', () => {
      const rows = Array.from({ length: 4 }, () => ['가', '나', '다']);
      const [s] = suggest([['BQ3', '', ''], ['', '', '']], [checkboxQuestion], rows);
      expect(s?.verdict).toBe('value-conflict');
      expect(s?.conflictQuestionId).toBe('q-check');
      expect(s?.verdictReason).toContain('3건');
    });

    it('슬롯이 잡히면 auto 다', () => {
      const rows = Array.from({ length: 4 }, () => ['자금', '멘토링', '공간']);
      const [s] = suggest([['BQ3', '', ''], ['', '', '']], [checkboxQuestion], rows);
      expect(s?.verdict).toBe('auto');
    });
  });

  it('확정된 값 대응으로 맞춘 값은 적합도에 들어간다', () => {
    const [bare] = suggest([['HQ1.'], ['']], [창업의향], 도움됨12);
    expect(bare?.verdict).toBe('value-conflict');
    const [aliased] = suggest([['HQ1.'], ['']], [창업의향], 도움됨12, {
      'q-intent': { '매우 도움됨': '1' },
    });
    expect(aliased?.verdict).toBe('auto');
    expect(aliased?.questionId).toBe('q-intent');
  });

  it('sampleFit — single 슬롯이 없는 radio 블록과 3건 미만 표본은 null 이다', () => {
    const block = splitHeaderBlocks([['HQ1.', '', ''], ['', '', '']])[0]!;
    const options = { valueCountsByColumn: collectColumnValueCounts(Array.from({ length: 5 }, () => ['예', '예', '예'])) };
    expect(sampleFit(창업의향, block, resolveSlots(창업의향, block), options)).toBeNull();
    const one = splitHeaderBlocks([['HQ1.'], ['']])[0]!;
    expect(sampleFit(창업의향, one, [{ kind: 'single' }], { valueCountsByColumn: collectColumnValueCounts([['예'], ['예']]) })).toBeNull();
    expect(sampleFit(창업의향, one, [{ kind: 'single' }], { valueCountsByColumn: collectColumnValueCounts([['예'], ['예'], ['보통']]) })).toEqual({
      matched: 2,
      total: 3,
    });
  });
});
