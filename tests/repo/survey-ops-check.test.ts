/**
 * `pnpm survey:check` 의 점검 코어(scripts/survey-ops/check-core.ts).
 *
 * 설문 구조(조립 산출물 또는 DB 저장본)를 읽어 오류(내보내기·응답이 깨진다)와 알림(조립 규칙과 다르다)을
 * 낸다. 점검마다 「걸린다 / 안 걸린다」 한 쌍을 둔다 — 거짓 오류는 조립을 막고, 놓친 오류는 운영에서 터진다.
 * scripts/ 는 tsc 대상이 아니라서 이 import 가 앱 함수 이름이 바뀐 것을 먼저 드러낸다.
 */
import { describe, expect, it } from 'vitest';

import {
  checkSurveyStructure,
  formatCheckReport,
  parseCheckArgs,
  type CheckFinding,
  type RawQuestion,
} from '../../scripts/survey-ops/check-core';

type Loose = Record<string, unknown>;

const opt = (n: number, label: string, extra: Loose = {}): Loose => ({
  id: `o${n}-${label}`,
  label,
  value: String(n),
  spssNumericCode: n,
  ...extra,
});

function question(partial: Loose & { id: string; type: string; order: number }): RawQuestion {
  return {
    surveyId: 'survey-1',
    title: `${partial.id} 제목`,
    required: true,
    questionCode: partial.id.toUpperCase(),
    ...partial,
  } as unknown as RawQuestion;
}

/** 응답자 유형 — 뒤 문항이 조건으로 본다 */
const a2 = (extra: Loose = {}) =>
  question({
    id: 'a2',
    type: 'radio',
    order: 1,
    options: [opt(1, '공급'), opt(2, '활용'), opt(3, '겸업')],
    ...extra,
  });

const when = (sourceQuestionId: string, requiredValues: string[], extra: Loose = {}): Loose => ({
  logicType: 'AND',
  conditions: [
    {
      id: `cond-${sourceQuestionId}-${requiredValues.join('')}`,
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      sourceQuestionId,
      requiredValues,
      ...extra,
    },
  ],
});

const text = (id: string, content: string, extra: Loose = {}): Loose => ({
  id,
  type: 'text',
  content,
  ...extra,
});
const numberInput = (id: string, extra: Loose = {}): Loose => ({
  id,
  type: 'input',
  content: '명',
  inputType: 'number',
  ...extra,
});
const col = (n: number, extra: Loose = {}): Loose => ({
  id: `col${n}${String(extra['tag'] ?? '')}`,
  label: `열 ${n}`,
  columnCode: `c${String(n).padStart(2, '0')}`,
  ...extra,
});
const row = (n: number, cells: Loose[], extra: Loose = {}): Loose => ({
  id: `row${n}-${String(cells[0]?.['id'])}`,
  label: `행 ${n}`,
  rowCode: `r${String(n).padStart(2, '0')}`,
  cells,
  ...extra,
});

/** 숫자 표 — [이름 | 입력] 두 줄 */
const numberTable = (id: string, order: number, extra: Loose = {}) =>
  question({
    id,
    type: 'table',
    order,
    tableColumns: [col(1, { tag: id }), col(2, { tag: id })],
    tableRowsData: [
      row(1, [text(`${id}-t1`, '전체'), numberInput(`${id}-i1`)]),
      row(2, [text(`${id}-t2`, '피지컬 AI'), numberInput(`${id}-i2`)]),
    ],
    ...extra,
  });

/** 열 방향 보기 그룹 표 — [항목 | 공급 □] 세 줄 */
const choiceTable = (id: string, order: number, group: Loose = {}, extra: Loose = {}) => {
  const g = { id: `${id}-g1`, type: 'checkbox', label: '공급(S)', groupKey: 'chk01', ...group };
  const choice = (n: number): Loose => ({
    id: `${id}-c${n}`,
    type: 'choice_opt',
    content: '',
    choiceGroupId: g.id,
    choiceLabel: `항목 ${n}`,
    optionCode: `opt${String(n).padStart(2, '0')}`,
    spssNumericCode: n,
  });
  return question({
    id,
    type: 'table',
    order,
    required: false,
    choiceGroups: [g],
    tableColumns: [col(1, { tag: id }), col(2, { tag: id })],
    tableRowsData: [1, 2, 3].map((n) => row(n, [text(`${id}-t${n}`, `항목 ${n}`), choice(n)])),
    ...extra,
  });
};

const check = (questions: RawQuestion[], groups: Loose[] = []) =>
  checkSurveyStructure({ questions, groups });
const codes = (findings: CheckFinding[], level?: CheckFinding['level']) =>
  findings.filter((f) => !level || f.level === level).map((f) => `${f.code}:${f.question}`);

describe('깨끗한 설문', () => {
  it('규칙대로 조립한 설문은 오류도 알림도 없다', () => {
    const report = check([
      a2(),
      question({
        id: 'b2',
        type: 'checkbox',
        order: 2,
        options: [
          opt(1, '판매', { optionCode: 'opt01', isCustomOptionCode: true }),
          opt(2, '구독', { optionCode: 'opt02', isCustomOptionCode: true }),
        ],
        displayCondition: when('a2', ['1', '3']),
      }),
      numberTable('c1', 3),
      choiceTable('a3', 4),
      question({
        id: 'd3',
        type: 'ranking',
        order: 5,
        options: [opt(1, '자기 자금'), opt(2, '대출'), opt(3, '지원금')],
        rankingConfig: { inputMode: 'click', positions: 2, requireAllPositions: true },
      }),
    ]);
    expect(report.findings).toEqual([]);
    expect(report.questionCount).toBe(5);
    expect(report.variableCount).toBeGreaterThan(5);
  });
});

describe('조건·수식이 가리키는 곳', () => {
  it('문항 표시 조건이 원천 문항에 없는 보기 저장 키를 가리키면 오류 — 유형을 바꿔 저장 키가 옵션N 이 된 경우', () => {
    const renamed = a2({
      options: [
        opt(1, '공급', { value: '옵션1' }),
        opt(2, '활용', { value: '옵션2' }),
        opt(3, '겸업', { value: '옵션3' }),
      ],
    });
    const b2 = question({
      id: 'b2',
      type: 'radio',
      order: 2,
      options: [opt(1, '예'), opt(2, '아니오')],
      displayCondition: when('a2', ['1', '3']),
    });
    expect(codes(check([renamed, b2]).findings, 'error')).toEqual(['cond-ref:B2']);
    const relinked = { ...b2, displayCondition: when('a2', ['옵션1', '옵션3']) } as RawQuestion;
    expect(codes(check([renamed, relinked]).findings, 'error')).toEqual([]);
  });

  it('열·행 표시 조건과 검증 적용 조건도 같은 눈으로 본다', () => {
    const table = numberTable('c1', 2, {
      tableColumns: [col(1, { tag: 'c1' }), col(2, { tag: 'c1', displayCondition: when('a2', ['9']) })],
      sumConstraints: [
        {
          id: 'sc1',
          target: 1,
          cellIds: ['c1-i1'],
          operator: 'gte',
          aggregate: 'count',
          whenQuestion: when('nowhere', ['1']),
        },
      ],
    });
    const found = check([a2(), table]).findings.filter((f) => f.code === 'cond-ref');
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.detail).join(' | ')).toMatch(/열 표시 조건.*9/);
    expect(found.map((f) => f.detail).join(' | ')).toMatch(/검증 적용 조건.*원천 문항이 없다/);
  });

  it('조건이 뒤 문항을 보면 오류다', () => {
    const early = question({
      id: 'a1',
      type: 'radio',
      order: 1,
      options: [opt(1, '예'), opt(2, '아니오')],
      displayCondition: when('a2', ['1']),
    });
    expect(codes(check([early, a2({ order: 2 })]).findings, 'error')).toEqual(['cond-ref:A1']);
  });

  it('값 대조를 할 줄 모르는 조건 유형은 원천 문항 유무만 본다 — 거짓 오류를 내지 않는다', () => {
    const b2 = question({
      id: 'b2',
      type: 'radio',
      order: 2,
      options: [opt(1, '예'), opt(2, '아니오')],
      displayCondition: when('a2', ['아무 값'], { conditionType: 'table-cell-check' }),
    });
    expect(codes(check([a2(), b2]).findings, 'error')).toEqual([]);
  });

  it('수식 조건은 원천 문항 칸이 비어 있다 — 식 안의 문항이 있으면 통과, 없으면 오류', () => {
    const expression = (questionId: string) => ({
      logicType: 'AND',
      conditions: [
        {
          id: 'cond-expr',
          enabled: true,
          conditionType: 'expression',
          sourceQuestionId: '',
          expressionConfig: {
            clauses: [
              {
                kind: 'comparison',
                comparison: { left: { kind: 'cell', questionId, cellId: 'c1-i1' }, op: '>', right: 0 },
              },
            ],
            joinOps: [],
          },
        },
      ],
    });
    const follow = (questionId: string) =>
      question({
        id: 'c2',
        type: 'radio',
        order: 2,
        options: [opt(1, '예'), opt(2, '아니오')],
        displayCondition: expression(questionId),
      });
    expect(codes(check([numberTable('c1', 1), follow('c1')]).findings, 'error')).toEqual([]);
    expect(codes(check([numberTable('c1', 1), follow('gone')]).findings, 'error')).toEqual([
      'cond-ref:C2',
    ]);
  });

  it('칸 열림 조건·수식이 없는 칸을 가리키거나 뒤 문항의 칸을 끌어오면 오류다', () => {
    const gated = numberTable('c1', 1, {
      tableRowsData: [
        row(1, [
          text('c1-t1', '전체'),
          numberInput('c1-i1', {
            required: true,
            enabledWhen: { kind: 'choice-selected', controllerCellId: 'ghost' },
          }),
        ]),
        row(2, [
          text('c1-t2', '합계'),
          {
            id: 'c1-calc',
            type: 'calc',
            content: '명',
            formula: { kind: 'cell', cellId: 'f2-i1', questionId: 'f2' },
          },
        ]),
      ],
    });
    const later = numberTable('f2', 2);
    expect(codes(check([gated, later]).findings, 'error').sort()).toEqual([
      'expr-ref:C1',
      'gate-ref:C1',
    ]);
  });
});

describe('리뷰에서 나온 자리 (2026-11-13 Codex)', () => {
  it('꺼 둔 조건(enabled: false)은 평가되지 않는다 — 옛 참조가 남아 있어도 오류가 아니다', () => {
    const off = (group: Loose): Loose => ({
      ...group,
      conditions: (group['conditions'] as Loose[]).map((c) => ({ ...c, enabled: false })),
    });
    const table = numberTable('c1', 2, {
      displayCondition: off(when('gone', ['1'])),
      tableColumns: [
        col(1, { tag: 'c1' }),
        col(2, { tag: 'c1', displayCondition: off(when('a2', ['없는 값'])) }),
      ],
      sumConstraints: [
        { id: 'sc1', target: 1, cellIds: ['c1-i1'], operator: 'gte', aggregate: 'count', whenQuestion: off(when('gone', ['1'])) },
      ],
    });
    expect(codes(check([a2(), table]).findings, 'error')).toEqual([]);
  });

  it('칸 열림 조건은 같은 문항의 칸만 읽는다 — 다른 문항의 칸을 가리키면 오류다', () => {
    const other = numberTable('f1', 1);
    const gated = numberTable('f2', 2, {
      tableRowsData: [
        row(1, [
          text('f2-t1', '전체'),
          numberInput('f2-i1', {
            required: true,
            enabledWhen: { kind: 'filled', controllerCellId: 'f1-i1' },
          }),
        ]),
      ],
    });
    expect(codes(check([other, gated]).findings, 'error')).toEqual(['gate-ref:F2']);
  });

  it('그룹 없는 복수 선택 보기 표의 응답값 0 도 오류다 — 단일 선택 보기 표는 괜찮다', () => {
    const embedded = (id: string, type: string, order: number) =>
      question({
        id,
        type,
        order,
        options: [],
        tableColumns: [col(1, { tag: id }), col(2, { tag: id })],
        tableRowsData: [0, 1].map((n) =>
          row(n + 1, [
            text(`${id}-t${n}`, `보기 ${n}`),
            { id: `${id}-c${n}`, type: 'choice_opt', content: '', choiceLabel: `보기 ${n}`, spssNumericCode: n },
          ]),
        ),
      });
    const found = check([embedded('b2', 'checkbox', 1), embedded('c2', 'radio', 2)]).findings;
    expect(codes(found, 'error').filter((c) => c.startsWith('multi-zero'))).toEqual(['multi-zero:B2']);
  });

  it('수식 조건이 보는 칸이 그 문항에 없거나 뒤 문항이면 오류다 — 명단 값만 쓰는 식은 통과', () => {
    const expr = (left: Loose): Loose => ({
      logicType: 'AND',
      conditions: [
        {
          id: 'cond-expr',
          enabled: true,
          conditionType: 'expression',
          sourceQuestionId: '',
          expressionConfig: {
            clauses: [
              {
                kind: 'group',
                group: {
                  clauses: [
                    {
                      kind: 'comparison',
                      comparison: {
                        left: { kind: 'binop', op: '+', left, right: { kind: 'literal', value: 0 } },
                        op: '>',
                        right: { kind: 'literal', value: 0 },
                      },
                    },
                  ],
                  joinOps: [],
                },
              },
            ],
            joinOps: [],
          },
        },
      ],
    });
    const follow = (left: Loose, order = 2) =>
      question({
        id: 'c2',
        type: 'radio',
        order,
        options: [opt(1, '예'), opt(2, '아니오')],
        displayCondition: expr(left),
      });
    const errorsOf = (qs: RawQuestion[]) => codes(check(qs).findings, 'error');

    expect(errorsOf([numberTable('c1', 1), follow({ kind: 'cell', questionId: 'c1', cellId: 'c1-i1' })])).toEqual([]);
    expect(errorsOf([numberTable('c1', 1), follow({ kind: 'attr', attrsKey: '종사자수' })])).toEqual([]);
    expect(errorsOf([numberTable('c1', 1), follow({ kind: 'cell', questionId: 'c1', cellId: '지운 칸' })])).toEqual(['cond-ref:C2']);
    expect(errorsOf([numberTable('c1', 3), follow({ kind: 'cell', questionId: 'c1', cellId: 'c1-i1' })])).toEqual(['cond-ref:C2']);
    expect(errorsOf([numberTable('c1', 3), follow({ kind: 'question', questionId: 'c1' })])).toEqual(['cond-ref:C2']);
  });
});

describe('변수가 사라지는 구조', () => {
  it('보기 칸이 하나도 없는 보기 그룹 정의가 남으면 오류 — 내장 표를 끈 뒤 그 문항 변수가 내보내기에서 빠졌다', () => {
    const stale = a2({
      choiceGroups: [{ id: 'g-stale', type: 'radio', label: '위치', groupKey: 'rad01' }],
    });
    expect(codes(check([stale]).findings, 'error')).toContain('group-empty:A2');
  });

  it('안내가 아닌 문항인데 변수가 0개면 오류, 안내 문항은 변수가 없어도 된다', () => {
    const noOptions = question({ id: 'b1', type: 'checkbox', order: 1, options: [] });
    const notice = question({ id: 'n1', type: 'notice', order: 2, questionCode: null });
    const found = check([noOptions, notice]).findings;
    expect(codes(found, 'error')).toContain('no-variables:B1');
    expect(found.filter((f) => f.question.includes('n1'))).toEqual([]);
  });
});

describe('거짓 오류를 내지 않는 자리', () => {
  it('응답 칸이 없는 표시용 표(코드표)는 변수도 문항코드도 없는 것이 맞다', () => {
    const codeTable = question({
      id: 'codes',
      type: 'table',
      order: 1,
      required: false,
      questionCode: null,
      tableColumns: [col(1, { tag: 'codes' }), col(2, { tag: 'codes' })],
      tableRowsData: [row(1, [text('codes-a', '01'), text('codes-b', '시유')])],
    });
    expect(check([codeTable]).findings).toEqual([]);
  });

  it('행·열·칸 id 가 다른 문항과 겹치면 알림, 한 문항 안에서 겹치면 오류다', () => {
    const first = numberTable('c1', 1);
    const copied = { ...numberTable('c1', 2), id: 'c9', questionCode: 'C9' } as RawQuestion;
    expect(codes(check([first, copied]).findings)).toEqual(['dup-id-across:C9']);

    const twice = numberTable('d1', 1, {
      tableRowsData: [
        row(1, [text('d1-t1', '전체'), numberInput('same')]),
        row(2, [text('d1-t2', '일부'), numberInput('same')]),
      ],
    });
    expect(codes(check([twice]).findings, 'error')).toContain('dup-id:D1');
  });
});

describe('값 규칙', () => {
  it('복수 선택 보기의 응답값 0 은 오류, 단일 선택의 0 은 괜찮다', () => {
    const multi = question({
      id: 'b2',
      type: 'checkbox',
      order: 1,
      options: [opt(0, '없음'), opt(1, '있음')],
    });
    const single = question({
      id: 'c2',
      type: 'radio',
      order: 2,
      options: [opt(0, '0점'), opt(1, '1점')],
    });
    expect(codes(check([multi, single]).findings, 'error')).toEqual(['multi-zero:B2']);
  });

  it('한 문항 안에서 응답값이 겹치면 오류다', () => {
    const dup = question({
      id: 'b2',
      type: 'radio',
      order: 1,
      options: [opt(1, '가'), opt(2, '나'), { ...opt(3, '다'), spssNumericCode: 2 }],
    });
    expect(codes(check([dup]).findings, 'error')).toContain('option-dup-code:B2');
  });

  it('저장 키가 응답값과 다르면 알림 — 자릿수째 넣은 원문 코드(02 ↔ 2)는 같은 것으로 본다', () => {
    const builderMade = a2({
      options: [opt(1, '공급', { value: '옵션1' }), opt(2, '활용', { value: '옵션2' })],
    });
    const sourceCodes = question({
      id: 'q3',
      type: 'select',
      order: 2,
      options: [opt(2, '가공유', { value: '02' }), opt(99, '기타', { value: '99' })],
    });
    expect(codes(check([builderMade, sourceCodes]).findings)).toEqual(['key-vs-code:A2']);
  });

  it('값 라벨이 120바이트를 넘으면 알림이고 바이트 수를 적는다', () => {
    const long = '공급기업 : 피지컬 AI 제품·서비스를 외부 고객에게 공급하거나 외부에 판매·납품·구독 형태로 제공하는 기업';
    expect(Buffer.byteLength(long)).toBeGreaterThan(120);
    const found = check([a2({ options: [opt(1, long), opt(2, '활용')] })]).findings;
    expect(codes(found)).toEqual(['value-label-bytes:A2']);
    expect(found[0]!.detail).toContain(`${Buffer.byteLength(long)}바이트`);
  });
});

describe('화면 규칙 (알림)', () => {
  it('순위형이 모든 순위 필수가 아니면 알림', () => {
    const ranking = question({
      id: 'd3',
      type: 'ranking',
      order: 1,
      options: [opt(1, '가'), opt(2, '나'), opt(3, '다')],
      rankingConfig: { inputMode: 'click', positions: 2 },
    });
    expect(codes(check([ranking]).findings)).toEqual(['rank-partial:D3']);
  });

  it('「기타」 내용이 선택 입력이거나, 조건으로 열리는 칸이 열려도 필수가 아니면 알림', () => {
    const optional = a2({
      options: [opt(1, '공급'), opt(2, '기타', { allowTextInput: true, textInputOptional: true })],
    });
    const gated = choiceTable('a3', 2, {}, {});
    const rows = gated.tableRowsData as unknown as Loose[];
    (rows[2]!['cells'] as Loose[])[0] = {
      id: 'a3-other',
      type: 'input',
      content: '기타',
      inputType: 'text',
      enabledWhen: { kind: 'choice-selected', controllerCellId: 'a3-c3' },
    };
    const found = check([optional, gated]).findings.filter((f) => f.code === 'other-optional');
    expect(found.map((f) => f.question)).toEqual(['A2', 'A3']);
  });

  it('열 방향 보기 그룹에 필수를 걸면 알림 — 줄마다 그룹인 척도 표는 알리지 않는다', () => {
    const columnGroup = choiceTable('b6', 1, { required: true });
    const scaleRow = (n: number): Loose => {
      const gid = `c3-g${n}`;
      const cell = (k: number): Loose => ({
        id: `c3-r${n}-o${k}`,
        type: 'choice_opt',
        content: String(k),
        choiceGroupId: gid,
        choiceLabel: `${k}점`,
        spssNumericCode: k,
      });
      return row(n, [text(`c3-t${n}`, `항목 ${n}`), cell(1), cell(2)]);
    };
    const scale = question({
      id: 'c3',
      type: 'table',
      order: 2,
      choiceGroups: [1, 2].map((n) => ({
        id: `c3-g${n}`,
        type: 'radio',
        label: `항목 ${n}`,
        groupKey: `rad0${n}`,
        required: true,
      })),
      tableColumns: [col(1, { tag: 'c3' }), col(2, { tag: 'c3' }), col(3, { tag: 'c3' })],
      tableRowsData: [scaleRow(1), scaleRow(2)],
    });
    expect(codes(check([columnGroup, scale]).findings)).toEqual(['column-group-required:B6']);
  });

  it('단위 글자가 「백만 원」인 숫자 칸에 단위 설정이 없으면 알림', () => {
    const amount = (extra: Loose) =>
      numberTable('c1', 1, {
        tableRowsData: [
          row(1, [text('c1-t1', '매출'), numberInput('c1-i1', { content: '백만 원', ...extra })]),
        ],
      });
    expect(codes(check([amount({})]).findings)).toEqual(['amount-unit:C1']);
    expect(
      check([amount({ numberFormat: { unit: 'million', unitSuffix: '원' } })]).findings,
    ).toEqual([]);
  });

  it('항목 단위 카드 — 이름 칸 없이 응답 칸만 놓인 줄에 칸 이름이 없으면 알림', () => {
    const inputsOnly = (label?: string) =>
      numberTable('f4', 1, {
        mobileTableDisplayMode: 'item-cards',
        tableRowsData: [
          row(1, [
            numberInput('f4-i1', label ? { mobileLabel: label } : {}),
            numberInput('f4-i2', label ? { mobileLabel: `${label} 2` } : {}),
          ]),
        ],
      });
    expect(codes(check([inputsOnly()]).findings)).toEqual(['item-card-label:F4']);
    expect(check([inputsOnly('1년 미만')]).findings).toEqual([]);
  });

  it('항목 단위 카드 — 앞에 이름 칸이 있으면 그 글자가 카드 제목이라 알리지 않는다', () => {
    const labeled = numberTable('a1', 1, { mobileTableDisplayMode: 'item-cards' });
    expect(check([labeled]).findings).toEqual([]);
  });

  it('행·열 코드가 두 자리 화면 순서가 아니면 알림 — 행 반복 표는 보지 않는다', () => {
    const builderCodes = (extra: Loose = {}) =>
      numberTable('c1', 1, {
        tableRowsData: [
          row(1, [text('c1-t1', '전체'), numberInput('c1-i1')], { rowCode: 'r1' }),
          row(2, [text('c1-t2', '일부'), numberInput('c1-i2')], { rowCode: 'r2' }),
        ],
        ...extra,
      });
    expect(codes(check([builderCodes()]).findings)).toEqual(['codes-not-two-digit:C1']);
    expect(
      codes(check([builderCodes({ rowRepeatConfig: { templateRowIds: [] } })]).findings),
    ).not.toContain('codes-not-two-digit:C1');
  });
});

describe('표 구조', () => {
  it('행의 칸 수가 열 수와 다르면 오류다', () => {
    const broken = numberTable('c1', 1, {
      tableRowsData: [row(1, [text('c1-t1', '전체')])],
    });
    expect(codes(check([broken]).findings, 'error')).toContain('row-cell-count:C1');
  });

  it('병합이 덮는 칸이 숨김이 아니면 오류다', () => {
    const merged = numberTable('c1', 1, {
      tableRowsData: [
        row(1, [text('c1-t1', '합계', { colspan: 2 }), numberInput('c1-i1')]),
        row(2, [text('c1-t2', '일부'), numberInput('c1-i2')]),
      ],
    });
    expect(codes(check([merged]).findings, 'error')).toContain('merge:C1');
  });
});

describe('출력', () => {
  it('점검 종류별로 묶고 오류를 먼저 낸다', () => {
    const report = check([
      a2({ options: [opt(1, '공급', { value: '옵션1' }), opt(2, '활용', { value: '옵션2' })] }),
      question({
        id: 'b2',
        type: 'checkbox',
        order: 2,
        options: [opt(0, '없음'), opt(1, '있음')],
      }),
    ]);
    const text = formatCheckReport('시험 설문', report);
    const lines = text.split('\n');
    expect(lines[0]).toBe(`시험 설문 — 문항 2 · 변수 ${report.variableCount}`);
    expect(lines[1]).toMatch(/^오류 \d+건 · 알림 \d+건$/);
    expect(text.indexOf('[오류]')).toBeLessThan(text.indexOf('[알림]'));
    expect(text).toMatch(/\[오류\] 복수 선택 보기의 응답값이 0이다 — 1문항\n {2}B2: /);
  });

  it('한 종류가 12문항을 넘으면 나머지는 수만 적는다', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      question({
        id: `d${i + 1}`,
        type: 'ranking',
        order: i + 1,
        options: [opt(1, '가'), opt(2, '나'), opt(3, '다')],
        rankingConfig: { positions: 2 },
      }),
    );
    const text = formatCheckReport('시험 설문', check(many));
    expect(text).toContain('15문항');
    expect(text).toContain('… 외 3문항');
  });

  it('발견이 없으면 그렇게 말한다', () => {
    expect(formatCheckReport('시험 설문', check([a2()]))).toMatch(/오류 0건 · 알림 0건$/);
  });
});

describe('parseCheckArgs', () => {
  it('--file 이면 --env 없이 돈다 — DB 에 붙지 않는다', () => {
    expect(parseCheckArgs(['--file', '.scratch/x/out.json', '--tsv', 'vars.tsv'])).toEqual({
      kind: 'file',
      path: '.scratch/x/out.json',
      tsv: 'vars.tsv',
    });
  });

  it('설문 id 면 --env 가 꼭 있어야 한다', () => {
    expect(parseCheckArgs(['abc', '--env', 'prod'])).toEqual({
      kind: 'db',
      surveyId: 'abc',
      env: 'prod',
      tsv: undefined,
    });
    expect(() => parseCheckArgs(['abc'])).toThrow(/--env/);
    expect(() => parseCheckArgs(['--env', 'prod'])).toThrow(/설문 id/);
  });
});
