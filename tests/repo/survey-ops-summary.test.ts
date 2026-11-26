/**
 * `pnpm survey:summary` 의 요약 코어(scripts/survey-ops/summary-core.ts)와 `survey:vars --names`.
 *
 * 설문 구조를 문항당 한 줄로 편다 — 에이전트가 dump JSON 에 임시 스크립트를 쓰지 않게 하려는 도구라
 * 줄 모양이 곧 계약이다. 줄 모양을 바꾸면 이 테스트와 survey-ops 스킬의 설명을 같이 고친다.
 */
import { describe, expect, it } from 'vitest';

import { describeQuestion, summarizeStructure } from '../../scripts/survey-ops/summary-core';
import { formatVariableNames } from '../../scripts/survey-ops/variables';
import {
  a2,
  choiceTable,
  col,
  numberInput,
  numberTable,
  opt,
  question,
  row,
  text,
  when,
  type Loose,
} from '../helpers/survey-structure-fixtures';

const groups: Loose[] = [
  { id: 'g1', name: 'Ⅰ. 기업 일반 현황', order: 1 },
  { id: 'g2', name: 'Ⅱ. 사업 추진 현황', order: 2 },
];

const survey = () => [
  a2({ groupId: 'g1', title: '<p>A2. 귀사의 위치는?</p>' }),
  question({
    id: 'b2',
    type: 'checkbox',
    order: 2,
    groupId: 'g2',
    pageBreakBefore: true,
    title: 'B2. 제공 방식 (복수응답)',
    options: [opt(1, '판매'), opt(2, '기타', { allowTextInput: true })],
    displayCondition: when('a2', ['1', '3']),
  }),
  choiceTable(
    'a3',
    3,
    {},
    {
      groupId: 'g2',
      title: 'A3. 적용 산업',
      mobileTableDisplayMode: 'axis-cards',
      tableColumns: [
        col(1, { tag: 'a3', label: '적용 산업' }),
        col(2, { tag: 'a3', label: '공급(S)', displayCondition: when('a2', ['1', '3']) }),
      ],
    },
  ),
  numberTable('c1', 4, {
    groupId: 'g2',
    title: 'C1. 매출액',
    sumConstraints: [{ id: 'sc1', target: 0, cellIds: ['c1-i2'], operator: 'lte' }],
  }),
  question({
    id: 'd3',
    type: 'ranking',
    order: 5,
    groupId: 'g2',
    title: 'D3. 자금 조달',
    options: [opt(1, '자기 자금'), opt(2, '대출'), opt(3, '지원금')],
    rankingConfig: { inputMode: 'click', positions: 2, requireAllPositions: true },
  }),
];

describe('summarizeStructure — 문항당 한 줄', () => {
  it('머리 줄에 문항·그룹·쪽·변수 수를 적고, 그룹이 바뀌면 그룹 이름 줄을 낸다', () => {
    const lines = summarizeStructure({ questions: survey(), groups }, '시험 설문');
    expect(lines[0]).toMatch(/^시험 설문 — 문항 5 · 그룹 2 · 쪽 2 · 변수 \d+$/);
    expect(lines.filter((l) => l.startsWith('# '))).toEqual([
      '# Ⅰ. 기업 일반 현황',
      '# Ⅱ. 사업 추진 현황',
    ]);
  });

  it('줄 모양 — 쪽 · 코드 · 유형과 크기 · 필수 · 조건 · 변수 수 · 제목', () => {
    const lines = summarizeStructure({ questions: survey(), groups }, '시험 설문');
    const line = (code: string) => lines.find((l) => new RegExp(`^p\\d+ ${code}\\b`).test(l));
    expect(line('A2')).toBe('p1 A2     radio 보기3 · 필수 · 변수 1 — A2. 귀사의 위치는?');
    expect(line('B2')).toBe(
      'p2 B2     checkbox 보기2(기타) · 필수 · 조건 A2=1|3 · 변수 3 — B2. 제공 방식 (복수응답)',
    );
    expect(line('A3')).toBe(
      'p2 A3     table 3×2 · choice_opt3 · 그룹 chk01 · 모바일 axis-cards · 열조건 c02(A2) · 변수 3 — A3. 적용 산업',
    );
    expect(line('C1')).toBe('p2 C1     table 2×2 · 필수 · input2 · 제약 1 · 변수 2 — C1. 매출액');
    expect(line('D3')).toBe('p2 D3     ranking 보기3 2순위 · 필수 · 변수 2 — D3. 자금 조달');
  });

  it('--grep 은 문항코드로 거른다 — 머리 줄은 남는다', () => {
    const lines = summarizeStructure({ questions: survey(), groups }, '시험 설문', {
      grep: /^[AB]/,
    });
    expect(lines.filter((l) => /^p\d/.test(l)).map((l) => l.split(/\s+/)[1])).toEqual([
      'A2',
      'B2',
      'A3',
    ]);
    expect(lines[0]).toContain('문항 5');
  });

  it('꺼 둔 조건은 요약에 넣지 않고, 보기 칸을 보는 조건 값은 그 칸의 응답값으로 적는다', () => {
    const off = when('a2', ['2']);
    (off['conditions'] as Loose[])[0]!['enabled'] = false;
    const lines = summarizeStructure(
      {
        questions: [
          choiceTable('a3', 1),
          question({
            id: 'b1',
            type: 'radio',
            order: 2,
            options: [opt(1, '예'), opt(2, '아니오')],
            displayCondition: when('a3', ['a3-c2']),
          }),
          question({
            id: 'b2',
            type: 'radio',
            order: 3,
            options: [opt(1, '예'), opt(2, '아니오')],
            displayCondition: off,
          }),
        ],
      },
      '시험',
    );
    expect(lines.find((l) => l.includes(' B1 '))).toContain('조건 A3=#2');
    expect(lines.find((l) => l.includes(' B2 '))).not.toContain('조건');
  });
});

describe('리뷰에서 나온 자리 (2026-11-13 Codex)', () => {
  const yesNo = (id: string, order: number, extra: Loose = {}) =>
    question({ id, type: 'radio', order, options: [opt(1, '예'), opt(2, '아니오')], ...extra });

  it('NOT 묶음은 NOT(…) 으로 적는다 — 평가기는 「하나도 참이 아닐 때」 보인다', () => {
    const not = (values: string[][]): Loose => ({
      logicType: 'NOT',
      conditions: values.map((v) => (when('a2', v)['conditions'] as Loose[])[0]),
    });
    const lines = summarizeStructure(
      {
        questions: [
          a2(),
          yesNo('b1', 2, { displayCondition: not([['1']]) }),
          yesNo('b2', 3, { displayCondition: not([['1'], ['2']]) }),
        ],
      },
      '시험',
    );
    expect(lines.find((l) => l.includes(' B1 '))).toContain('조건 NOT(A2=1)');
    expect(lines.find((l) => l.includes(' B2 '))).toContain('조건 NOT(A2=1 OR A2=2)');
  });

  it('문항 순서와 쪽은 응답 화면과 같은 순서로 센다 — 그룹 순서가 문항 order 와 달라도', () => {
    const lines = summarizeStructure(
      {
        questions: [
          yesNo('q1', 1, { groupId: 'late' }),
          yesNo('q2', 2, { groupId: 'early', pageBreakBefore: true }),
          yesNo('q3', 3, { groupId: 'early-sub' }),
        ],
        groups: [
          { id: 'late', name: '뒤 그룹', order: 2 },
          { id: 'early', name: '앞 그룹', order: 1 },
          { id: 'early-sub', name: '하위', order: 1, parentGroupId: 'early' },
        ],
      },
      '시험',
    );
    // 화면 순서: 앞 그룹(q2, 하위 q3) → 뒤 그룹(q1). q2 가 전체 첫 문항이라 쪽 나눔 표시는 무시된다.
    expect(lines[0]).toContain('쪽 1');
    expect(lines.slice(1)).toEqual([
      '# 앞 그룹',
      expect.stringMatching(/^p1 Q2 /),
      '# 앞 그룹 › 하위',
      expect.stringMatching(/^p1 Q3 /),
      '# 뒤 그룹',
      expect.stringMatching(/^p1 Q1 /),
    ]);
  });

  it('빈 설문도 머리 줄은 낸다', () => {
    expect(summarizeStructure({ questions: [] }, '빈 설문')).toEqual([
      '빈 설문 — 문항 0 · 그룹 0 · 쪽 0 · 변수 0',
    ]);
  });

  it('열림 조건의 기대값이 다른 줄은 접지 않고, 같은 줄 안의 칸을 보는 같은 조건은 접는다', () => {
    const gatedRow = (n: number, gate: (controllerId: string) => Loose) =>
      row(n, [
        {
          id: `t-s${n}`,
          type: 'select',
          content: '',
          selectOptions: [
            { id: `t-s${n}-o1`, label: '가', value: '1', spssNumericCode: 1 },
            { id: `t-s${n}-o2`, label: '나', value: '2', spssNumericCode: 2 },
          ],
        },
        numberInput(`t-i${n}`, { enabledWhen: gate(`t-s${n}`) }),
      ]);
    const tableWith = (gates: Array<(id: string) => Loose>) =>
      question({
        id: 't1',
        type: 'table',
        order: 1,
        tableColumns: [col(1, { tag: 't1' }), col(2, { tag: 't1' })],
        tableRowsData: gates.map((g, i) => gatedRow(i + 1, g)),
      });
    const pick = (value: string) => (controllerCellId: string) => ({
      kind: 'option',
      controllerCellId,
      values: [value],
    });
    const rowLines = (q: ReturnType<typeof tableWith>) =>
      describeQuestion({ questions: [q] }, 'T1').filter((l) => /^r\d/.test(l));

    expect(rowLines(tableWith([pick('1'), pick('1')]))).toHaveLength(1);
    expect(rowLines(tableWith([pick('1'), pick('2')]))).toHaveLength(2);
  });
});

describe('describeQuestion — 문항 하나를 편다', () => {
  const questions = () => [
    a2(),
    choiceTable(
      'a3',
      2,
      { label: '공급(S)' },
      {
        title: 'A3. 적용 산업',
        tableColumns: [
          col(1, { tag: 'a3', label: '적용 산업' }),
          col(2, { tag: 'a3', label: '공급(S)', displayCondition: when('a2', ['1', '3']) }),
        ],
        sumConstraints: [
          {
            id: 'sc1',
            target: 1,
            cellIds: ['a3-c1'],
            operator: 'gte',
            aggregate: 'count',
            errorMessage: '하나 이상 체크해 주세요.',
            whenQuestion: when('a2', ['1']),
          },
        ],
      },
    ),
  ];

  it('열 · 보기 그룹 · 줄 · 검증을 낸다', () => {
    const lines = describeQuestion({ questions: questions() }, 'A3');
    expect(lines[0]).toMatch(/^A3 table 3×2 — A3\. 적용 산업$/);
    expect(lines).toContain('열: c01 적용 산업 | c02 공급(S) ←A2=1|3');
    expect(lines).toContain('그룹: chk01 checkbox 「공급(S)」');
    expect(lines).toContain(
      '제약: count ≥ 1 [r01c02] 적용 A2=1 「하나 이상 체크해 주세요.」',
    );
  });

  it('같은 모양이 이어지는 줄은 한 줄로 접는다', () => {
    const lines = describeQuestion({ questions: questions() }, 'A3');
    const rowLines = lines.filter((l) => /^r\d/.test(l));
    expect(rowLines).toEqual(['r01~r03 (3줄 같은 모양) 항목 1 | 글자 | 보기 chk01=1…3']);
  });

  it('칸의 필수 · 열림 조건 · 단위 · 계산 · 모바일 설정을 적는다', () => {
    const table = numberTable('c1', 1, {
      title: 'C1. 매출',
      tableRowsData: [
        row(1, [
          text('c1-t1', '매출'),
          numberInput('c1-i1', {
            content: '백만 원',
            required: true,
            numberFormat: { unit: 'million', unitSuffix: '원' },
            mobileLabel: '2024년 실적',
          }),
        ]),
        row(2, [
          text('c1-t2', '기타', { mobileDisplay: 'inline' }),
          numberInput('c1-i2', {
            enabledWhen: { kind: 'filled', controllerCellId: 'c1-i1' },
            requiredWhenEnabled: true,
          }),
        ]),
        row(3, [
          text('c1-t3', '합계'),
          { id: 'c1-calc', type: 'calc', content: '백만 원', formula: { kind: 'cell', cellId: 'c1-i1' } },
        ]),
      ],
    });
    const lines = describeQuestion({ questions: [table] }, 'C1');
    expect(lines).toContain('r01 매출 | 글자 | 입력(number) 필수 단위=million 모바일「2024년 실적」');
    expect(lines).toContain('r02 기타 | 글자(inline) | 입력(number) 열림←r01c02 열리면필수');
    expect(lines).toContain('r03 합계 | 글자 | 계산');
  });

  it('맨 앞 칸이 입력 칸인 줄은 행 라벨을 이름으로 쓴다 — 입력 칸의 글자는 단위일 수 있다', () => {
    const table = numberTable('f4', 1, {
      tableRowsData: [
        row(1, [numberInput('f4-i1'), text('f4-t1', '예시 글자')], { label: '경력별 인원' }),
      ],
    });
    expect(describeQuestion({ questions: [table] }, 'F4')).toContain(
      'r01 경력별 인원 | 입력(number) | 글자',
    );
  });

  it('없는 문항코드면 있는 코드를 알려 준다', () => {
    expect(() => describeQuestion({ questions: questions() }, 'Z9')).toThrow(/A2, A3/);
  });
});

describe('formatVariableNames — survey:vars --names', () => {
  it('문항별 한 줄에 변수 이름만 낸다', () => {
    const vars = [
      { name: 'A2', questionId: 'q1', label: '위치' },
      { name: 'B2_opt01', questionId: 'q2', label: '판매' },
      { name: 'B2_opt02', questionId: 'q2', label: '기타' },
      { name: 'B2_opt02_text', questionId: 'q2', label: '기타 상세' },
    ];
    const codes = new Map([
      ['q1', 'A2'],
      ['q2', 'B2'],
    ]);
    expect(formatVariableNames(vars, codes)).toEqual([
      'A2: A2',
      'B2: B2_opt01 B2_opt02 B2_opt02_text',
    ]);
  });

  it('문항코드가 없는 문항은 문항 id 앞머리로 묶는다', () => {
    const vars = [{ name: 'V1', questionId: 'abcdef12-3456', label: '' }];
    expect(formatVariableNames(vars, new Map())).toEqual(['(abcdef12): V1']);
  });
});
