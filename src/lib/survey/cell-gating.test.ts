import { describe, expect, it } from 'vitest';
import { isCellEnabled, stripDisabledCellValues } from '@/lib/survey/cell-gating';
import type { Question, TableCell } from '@/types/survey';

const inputCell = (id: string, over: Partial<TableCell> = {}): TableCell =>
  ({ id, content: '', type: 'input', inputType: 'number', ...over }) as TableCell;

describe('isCellEnabled', () => {
  it('enabledWhen 미지정이면 항상 활성', () => {
    expect(isCellEnabled(inputCell('t'), {})).toBe(true);
  });

  it('option 조건 — 지정 값 중 하나가 선택되면 활성', () => {
    const cell = inputCell('t', {
      enabledWhen: { kind: 'option', controllerCellId: 'perf', values: ['1'] },
    });
    expect(isCellEnabled(cell, { perf: '1' })).toBe(true); // 수행
    expect(isCellEnabled(cell, { perf: '2' })).toBe(false); // 미수행
    expect(isCellEnabled(cell, {})).toBe(false); // 미응답 = 비활성
  });

  it('option 조건 — checkbox 배열 응답도 포함 여부로 판정', () => {
    const cell = inputCell('t', {
      enabledWhen: { kind: 'option', controllerCellId: 'chk', values: ['a', 'b'] },
    });
    expect(isCellEnabled(cell, { chk: ['c', 'b'] })).toBe(true);
    expect(isCellEnabled(cell, { chk: ['c'] })).toBe(false);
  });

  it('filled 조건 — 컨트롤러에 비어있지 않은 값이 있으면 활성', () => {
    const cell = inputCell('t', { enabledWhen: { kind: 'filled', controllerCellId: 'src' } });
    expect(isCellEnabled(cell, { src: '기타 내용' })).toBe(true);
    expect(isCellEnabled(cell, { src: '' })).toBe(false);
    expect(isCellEnabled(cell, { src: '   ' })).toBe(false);
    expect(isCellEnabled(cell, {})).toBe(false);
  });

  it('numeric 조건 — 파싱 실패는 미충족', () => {
    const cell = inputCell('t', {
      enabledWhen: { kind: 'numeric', controllerCellId: 'n', op: '>=', value: 5 },
    });
    expect(isCellEnabled(cell, { n: '5' })).toBe(true);
    expect(isCellEnabled(cell, { n: '4' })).toBe(false);
    expect(isCellEnabled(cell, { n: 'abc' })).toBe(false);
    expect(isCellEnabled(cell, { n: '1,000' })).toBe(false); // parseNumericInput 이 콤마 거부
  });

  it('prefill 셀은 게이팅 무시 — 항상 활성 (prefill 우선)', () => {
    const cell = inputCell('t', {
      defaultValueTemplate: '{{name}}',
      enabledWhen: { kind: 'filled', controllerCellId: 'src' },
    });
    expect(isCellEnabled(cell, {})).toBe(true);
  });
});

describe('isCellEnabled — option 조건의 컨트롤러 옵션 해석(rowCells)', () => {
  const controllerCell = (): TableCell =>
    ({
      id: 'ctrl', content: '', type: 'radio',
      radioOptions: [
        { id: 'o1', label: '수행', value: '1' },
        { id: 'o2', label: '미수행', value: '2' },
      ],
    }) as TableCell;

  it('{optionId} 래핑 응답이 옵션 value 조건과 매칭된다', () => {
    const controller = controllerCell();
    const target = inputCell('t', {
      enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
    });
    expect(isCellEnabled(target, { ctrl: { optionId: 'o1' } }, [controller, target])).toBe(true);
    expect(isCellEnabled(target, { ctrl: { optionId: 'o2' } }, [controller, target])).toBe(false);
  });

  it('응답이 옵션 id 문자열로 저장된 경우도(id !== value) 매칭된다', () => {
    const controller = controllerCell();
    const target = inputCell('t', {
      enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
    });
    expect(isCellEnabled(target, { ctrl: 'o1' }, [controller, target])).toBe(true);
    expect(isCellEnabled(target, { ctrl: 'o2' }, [controller, target])).toBe(false);
  });

  it('rowCells 미전달 시 flat 비교로 폴백한다 (하위호환)', () => {
    const target = inputCell('t', {
      enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
    });
    // rowCells 없으면 컨트롤러 정의를 못 찾아 raw 값을 그대로 비교 — id 'o1' 은 value '1' 과 불일치
    expect(isCellEnabled(target, { ctrl: 'o1' })).toBe(false);
    // flat 저장이 이미 value 형태면 매칭된다 (기존 동작 보존)
    expect(isCellEnabled(target, { ctrl: '1' })).toBe(true);
  });
});

describe('stripDisabledCellValues', () => {
  const gatedQuestion = (): Question =>
    ({
      id: 'q1', type: 'table', title: 'T', required: false, order: 1,
      tableRowsData: [{
        id: 'r1', label: 'r1',
        cells: [
          { id: 'perf', content: '', type: 'radio', radioOptions: [
            { id: 'o1', label: '수행', value: '1' },
            { id: 'o2', label: '미수행', value: '2' },
          ] },
          inputCell('men', {
            enabledWhen: { kind: 'option', controllerCellId: 'perf', values: ['1'] },
          }),
        ],
      }],
    }) as Question;

  it('비활성 셀 값을 페이로드에서 제거한다', () => {
    const out = stripDisabledCellValues([gatedQuestion()], {
      q1: { perf: '2', men: '5' }, // 미수행인데 인력 5 잔존 (beacon 타이밍 틈)
    });
    const q1 = out['q1'] as Record<string, unknown>;
    expect(q1['perf']).toBe('2');
    expect('men' in q1).toBe(false); // 키 자체 제거
  });

  it('활성 셀 값은 보존한다', () => {
    const out = stripDisabledCellValues([gatedQuestion()], { q1: { perf: '1', men: '5' } });
    expect((out['q1'] as Record<string, unknown>)['men']).toBe('5');
  });

  it('게이팅 셀이 없으면 원본을 그대로 반환한다 (mutation 없음)', () => {
    const plain = { q9: 'free text' };
    expect(stripDisabledCellValues([], plain)).toBe(plain);
  });

  it('__ prefix 사이드카 키는 건드리지 않는다', () => {
    const out = stripDisabledCellValues([gatedQuestion()], {
      q1: { perf: '2', men: '5', __selectedRowIds: ['r1'] },
    });
    expect((out['q1'] as Record<string, unknown>)['__selectedRowIds']).toEqual(['r1']);
  });
});

describe('stripDisabledCellValues — 인터랙티브 셀 타입 확장 (radio/checkbox/select/ranking)', () => {
  const multiTypeQuestion = (): Question =>
    ({
      id: 'q1', type: 'table', title: 'T', required: false, order: 1,
      tableRowsData: [{
        id: 'r1', label: 'r1',
        cells: [
          { id: 'perf', content: '', type: 'radio', radioOptions: [
            { id: 'o1', label: '수행', value: '1' },
            { id: 'o2', label: '미수행', value: '2' },
          ] },
          { id: 'g-radio', content: '', type: 'radio',
            radioOptions: [{ id: 'a1', label: 'A', value: 'a' }],
            enabledWhen: { kind: 'option', controllerCellId: 'perf', values: ['1'] } },
          { id: 'g-check', content: '', type: 'checkbox',
            checkboxOptions: [{ id: 'b1', label: 'B', value: 'b' }],
            enabledWhen: { kind: 'option', controllerCellId: 'perf', values: ['1'] } },
          { id: 'g-select', content: '', type: 'select',
            selectOptions: [{ id: 'c1', label: 'C', value: 'c' }],
            enabledWhen: { kind: 'option', controllerCellId: 'perf', values: ['1'] } },
        ],
      }],
    }) as unknown as Question;

  it('비활성 radio/checkbox/select 셀 값을 모두 제거한다', () => {
    const out = stripDisabledCellValues([multiTypeQuestion()], {
      q1: { perf: '2', 'g-radio': 'a', 'g-check': ['b'], 'g-select': 'c' },
    });
    const q1 = out['q1'] as Record<string, unknown>;
    expect(q1['perf']).toBe('2');
    expect('g-radio' in q1).toBe(false);
    expect('g-check' in q1).toBe(false);
    expect('g-select' in q1).toBe(false);
  });

  it('활성 상태(수행)면 모든 타입 값을 보존한다', () => {
    const out = stripDisabledCellValues([multiTypeQuestion()], {
      q1: { perf: '1', 'g-radio': 'a', 'g-check': ['b'], 'g-select': 'c' },
    });
    const q1 = out['q1'] as Record<string, unknown>;
    expect(q1['g-radio']).toBe('a');
    expect(q1['g-check']).toEqual(['b']);
    expect(q1['g-select']).toBe('c');
  });
});

describe('stripDisabledCellValues — 게이팅 체인 고정점 정리', () => {
  // A(radio) → B(input, A 옵션 조건) → C(input, B filled 조건) 체인
  const chainQuestion = (): Question =>
    ({
      id: 'q1', type: 'table', title: 'T', required: false, order: 1,
      tableRowsData: [{
        id: 'r1', label: 'r1',
        cells: [
          { id: 'A', content: '', type: 'radio', radioOptions: [
            { id: 'o1', label: '수행', value: '1' },
            { id: 'o2', label: '미수행', value: '2' },
          ] },
          { id: 'B', content: '', type: 'input', inputType: 'number',
            enabledWhen: { kind: 'option', controllerCellId: 'A', values: ['1'] } },
          { id: 'C', content: '', type: 'input', inputType: 'number',
            enabledWhen: { kind: 'filled', controllerCellId: 'B' } },
        ],
      }],
    }) as unknown as Question;

  it('상류가 지워지면 그 값에 의존하던 하류도 함께 지운다 (A 미수행 → B, C 모두 제거)', () => {
    const out = stripDisabledCellValues([chainQuestion()], {
      q1: { A: '2', B: '5', C: '7' }, // B 잔존 값이 C 를 활성으로 오판시키면 안 됨
    });
    const q1 = out['q1'] as Record<string, unknown>;
    expect('B' in q1).toBe(false);
    expect('C' in q1).toBe(false);
  });

  it('체인 전체가 활성(A 수행, B 입력)이면 모두 보존한다', () => {
    const out = stripDisabledCellValues([chainQuestion()], {
      q1: { A: '1', B: '5', C: '7' },
    });
    const q1 = out['q1'] as Record<string, unknown>;
    expect(q1['B']).toBe('5');
    expect(q1['C']).toBe('7');
  });

  it('중간만 미입력이면 하류만 지운다 (A 수행, B 빈 값 → C 제거)', () => {
    const out = stripDisabledCellValues([chainQuestion()], {
      q1: { A: '1', C: '7' },
    });
    const q1 = out['q1'] as Record<string, unknown>;
    expect(q1['A']).toBe('1');
    expect('C' in q1).toBe(false);
  });

  // 셀 id 가 Object.prototype 프로퍼티명과 겹치면 `in` 연산자는 delete 이후에도
  // 프로토타입 체인에서 계속 true 라 고정점 루프가 영원히 돌 수 있다 — own key 판정 강제.
  it(
    'Object.prototype 프로퍼티명 셀 id(toString)에서도 종료하고 값을 지운다',
    () => {
      const q = {
        id: 'q1', type: 'table', title: 'T', required: false, order: 1,
        tableRowsData: [{
          id: 'r1', label: 'r1',
          cells: [
            { id: 'A', content: '', type: 'radio', radioOptions: [
              { id: 'o1', label: '수행', value: '1' },
            ] },
            { id: 'toString', content: '', type: 'input', inputType: 'number',
              enabledWhen: { kind: 'option', controllerCellId: 'A', values: ['1'] } },
          ],
        }],
      } as unknown as Question;
      const out = stripDisabledCellValues([q], { q1: { toString: '5' } });
      const q1 = out['q1'] as Record<string, unknown>;
      expect(Object.hasOwn(q1, 'toString')).toBe(false);
    },
    2000,
  );

  it(
    '페이로드에 키가 없는 프로토타입명 셀 id(constructor)도 무한 루프 없이 통과한다',
    () => {
      const q = {
        id: 'q1', type: 'table', title: 'T', required: false, order: 1,
        tableRowsData: [{
          id: 'r1', label: 'r1',
          cells: [
            { id: 'A', content: '', type: 'radio', radioOptions: [
              { id: 'o1', label: '수행', value: '1' },
            ] },
            { id: 'constructor', content: '', type: 'input', inputType: 'number',
              enabledWhen: { kind: 'option', controllerCellId: 'A', values: ['1'] } },
          ],
        }],
      } as unknown as Question;
      const plain = { q1: { A: '1' } };
      const out = stripDisabledCellValues([q], plain);
      expect((out['q1'] as Record<string, unknown>)['A']).toBe('1');
    },
    2000,
  );
});

describe('stripDisabledCellValues — 다른 행의 컨트롤러', () => {
  const controller: TableCell = {
    id: 'ctrl', content: '', type: 'radio',
    radioOptions: [
      { id: 'o1', label: '있다', value: '1' },
      { id: 'o2', label: '없다', value: '2' },
    ],
  } as TableCell;
  const question = {
    id: 'q',
    type: 'table',
    title: '',
    required: false,
    order: 0,
    tableRowsData: [
      { id: 'r1', label: '1행', cells: [controller] },
      {
        id: 'r2',
        label: '2행',
        cells: [inputCell('t', { enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] } })],
      },
    ],
  } as unknown as Question;

  it('다른 행 라디오의 옵션 id 저장값을 표 전체 셀 정의로 해석해 활성이면 보존한다', () => {
    const payload = { q: { ctrl: { optionId: 'o1' }, t: '5' } };
    expect(stripDisabledCellValues([question], payload)).toBe(payload);
  });

  it('다른 행 라디오가 미충족이면 지운다', () => {
    const out = stripDisabledCellValues([question], { q: { ctrl: { optionId: 'o2' }, t: '5' } });
    expect(out['q']).toEqual({ ctrl: { optionId: 'o2' } });
  });
});

describe('choice-selected 조건 — 보기 옵션 셀이 선택되면 활성', () => {
  const gated = inputCell('t', {
    enabledWhen: { kind: 'choice-selected', controllerCellId: 'opt-other' },
  });

  it('선택된 보기 id 집합에 컨트롤러가 있으면 활성, 없거나 집합이 없으면 비활성', () => {
    expect(isCellEnabled(gated, {}, undefined, new Set(['opt-other']))).toBe(true);
    expect(isCellEnabled(gated, {}, undefined, new Set(['opt-1']))).toBe(false);
    expect(isCellEnabled(gated, {}, undefined, undefined)).toBe(false);
  });

  it('보기 소스 표에서는 사이드카(__optTexts__)의 그 셀 값을 지운다 — 표 문항 경로가 아니다', () => {
    const question = {
      id: 'q',
      type: 'checkbox',
      title: '',
      required: false,
      order: 0,
      tableColumns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }],
      tableRowsData: [
        {
          id: 'r8',
          label: '기타',
          cells: [gated, { id: 'opt-other', type: 'choice_opt', content: '기타' }],
        },
      ],
    } as unknown as Question;
    const unmet = { q: ['opt-1'], __optTexts__: { q: { 'opt-other': '', t: '적은 내용' } } };
    const out = stripDisabledCellValues([question], unmet);
    expect(out['__optTexts__']).toEqual({ q: { 'opt-other': '' } });
    expect(out['q']).toEqual(['opt-1']);

    const met = { q: ['opt-other'], __optTexts__: { q: { t: '적은 내용' } } };
    expect(stripDisabledCellValues([question], met)).toBe(met);
  });
});

describe('choice-selected 조건 — 보기 그룹 표 (table + __choiceGroups)', () => {
  const groupedTable = {
    id: 't',
    type: 'table',
    title: '',
    required: false,
    order: 0,
    choiceGroups: [{ id: 'g1', groupKey: 'rad1', type: 'radio', label: '보유' }],
    tableColumns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }, { id: 'c3', label: '' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'opt-yes', type: 'choice_opt', content: '있음', choiceGroupId: 'g1' },
          { id: 'opt-no', type: 'choice_opt', content: '없음', choiceGroupId: 'g1' },
          inputCell('when', { enabledWhen: { kind: 'choice-selected', controllerCellId: 'opt-yes' } }),
        ],
      },
    ],
  } as unknown as Question;

  it('저장 strip 이 표 응답 안 예약 키의 선택으로 게이팅 셀을 판정한다 — 표 문항 경로', () => {
    const unmet = { t: { when: '지워져야 한다', __choiceGroups: { rad1: 'opt-no' } } };
    expect(stripDisabledCellValues([groupedTable], unmet)['t']).toEqual({
      __choiceGroups: { rad1: 'opt-no' },
    });

    const met = { t: { when: '내년', __choiceGroups: { rad1: 'opt-yes' } } };
    expect(stripDisabledCellValues([groupedTable], met)).toBe(met);
  });
});

describe('보기 소스 표 사이드카 게이팅', () => {
  const checkboxController = (): TableCell =>
    ({
      id: 'cb', content: '', type: 'checkbox',
      checkboxOptions: [
        { id: 'o1', label: '해당', value: '1' },
        { id: 'o2', label: '비해당', value: '2' },
      ],
    }) as TableCell;
  const inputText = (id: string, over: Partial<TableCell> = {}): TableCell =>
    ({ id, content: '', type: 'input', ...over }) as TableCell;

  const choiceTable = (id: string, cells: TableCell[]): Question =>
    ({
      id,
      type: 'checkbox',
      title: '',
      required: false,
      order: 0,
      tableColumns: cells.map((_, i) => ({ id: `c${i}`, label: '' })),
      tableRowsData: [{ id: 'r1', label: '', cells }],
    }) as unknown as Question;

  it('체크박스 셀의 JSON 배열 문자열 값으로 option 조건을 판정한다', () => {
    const controller = checkboxController();
    const target = inputText('t', {
      enabledWhen: { kind: 'option', controllerCellId: 'cb', values: ['1'] },
    });
    const cells = [controller, target];
    expect(isCellEnabled(target, { cb: '["o1"]' }, cells)).toBe(true);
    expect(isCellEnabled(target, { cb: '["1"]' }, cells)).toBe(true);
    expect(isCellEnabled(target, { cb: '["o2"]' }, cells)).toBe(false);
    expect(isCellEnabled(target, { cb: '' }, cells)).toBe(false);
    // JSON 이 아닌 옛 단일 값은 한 개짜리 선택으로 읽는다
    expect(isCellEnabled(target, { cb: 'o1' }, cells)).toBe(true);
  });

  it('조건을 충족한 체크박스 종속 값은 저장 정리에서 지우지 않는다', () => {
    const target = inputText('t', {
      enabledWhen: { kind: 'option', controllerCellId: 'cb', values: ['1'] },
    });
    const question = choiceTable('q', [checkboxController(), target]);
    const payload = { q: [], __optTexts__: { q: { cb: '["o1"]', t: '적은 내용' } } };
    expect(stripDisabledCellValues([question], payload)).toBe(payload);
  });

  it('두 표를 정리해도 앞 표에서 지운 값이 되살아나지 않는다', () => {
    const gated = (id: string) =>
      inputText(id, { enabledWhen: { kind: 'filled', controllerCellId: 'ctl' } });
    const q1 = choiceTable('q1', [inputText('ctl'), gated('t')]);
    const q2 = choiceTable('q2', [inputText('ctl'), gated('t')]);
    const payload = {
      __optTexts__: {
        q1: { ctl: '', t: '남으면 안 됨' },
        q2: { ctl: '', t: '이것도' },
      },
    };
    const out = stripDisabledCellValues([q1, q2], payload);
    expect(out['__optTexts__']).toEqual({ q1: { ctl: '' }, q2: { ctl: '' } });
  });

  it('종속 셀이 컨트롤러보다 앞에 있어도 체인 끝까지 지운다', () => {
    // A 비움 → B 비활성 → C 비활성. 셀 순서는 C, B, A.
    const c = inputText('C', { enabledWhen: { kind: 'filled', controllerCellId: 'B' } });
    const b = inputText('B', { enabledWhen: { kind: 'filled', controllerCellId: 'A' } });
    const a = inputText('A');
    const question = choiceTable('q', [c, b, a]);
    const payload = { __optTexts__: { q: { A: '', B: '남은 값', C: '남은 값' } } };
    const out = stripDisabledCellValues([question], payload);
    expect(out['__optTexts__']).toEqual({ q: { A: '' } });
  });
});

describe('조건 묶음 — AND / OR / NOT 과 중첩', () => {
  const gte1 = (id: string) =>
    ({ kind: 'numeric', controllerCellId: id, op: '>=', value: 1 }) as const;
  const group = (
    op: 'AND' | 'OR' | 'NOT',
    terms: NonNullable<TableCell['enabledWhen']>[],
  ): NonNullable<TableCell['enabledWhen']> => ({ kind: 'group', op, terms });

  it('OR — 하나라도 충족하면 활성 (Q8 기타 행: 현재 보유 ≥ 1 또는 희망 규모 ≥ 1)', () => {
    const cell = inputCell('name', { enabledWhen: group('OR', [gte1('now'), gte1('want')]) });
    expect(isCellEnabled(cell, { now: '2' })).toBe(true);
    expect(isCellEnabled(cell, { want: '1' })).toBe(true);
    expect(isCellEnabled(cell, { now: '0', want: '0' })).toBe(false);
    expect(isCellEnabled(cell, {})).toBe(false);
  });

  it('AND — 모두 충족해야 활성', () => {
    const cell = inputCell('t', { enabledWhen: group('AND', [gte1('a'), gte1('b')]) });
    expect(isCellEnabled(cell, { a: '1', b: '1' })).toBe(true);
    expect(isCellEnabled(cell, { a: '1' })).toBe(false);
  });

  it('NOT — 하나도 충족하지 않아야 활성이고, 미응답은 미충족이라 처음에는 활성이다', () => {
    const cell = inputCell('t', { enabledWhen: group('NOT', [gte1('a'), gte1('b')]) });
    expect(isCellEnabled(cell, {})).toBe(true);
    expect(isCellEnabled(cell, { a: '0', b: '0' })).toBe(true);
    expect(isCellEnabled(cell, { a: '3' })).toBe(false);
  });

  it('중첩 — (a 또는 b) 그리고 c', () => {
    const cell = inputCell('t', {
      enabledWhen: group('AND', [group('OR', [gte1('a'), gte1('b')]), gte1('c')]),
    });
    expect(isCellEnabled(cell, { b: '1', c: '1' })).toBe(true);
    expect(isCellEnabled(cell, { a: '1', b: '1' })).toBe(false);
    expect(isCellEnabled(cell, { c: '1' })).toBe(false);
  });

  it('조건이 0개인 묶음은 "조건 없음" 이라 충족이다 (표시조건의 빈 그룹 규칙과 같다)', () => {
    for (const op of ['AND', 'OR', 'NOT'] as const) {
      expect(isCellEnabled(inputCell('t', { enabledWhen: group(op, []) }), {})).toBe(true);
    }
  });

  it('묶음 안에서 종류가 다른 조건을 섞는다 — 옵션 선택 또는 보기 선택', () => {
    const cell = inputCell('t', {
      enabledWhen: group('OR', [
        { kind: 'option', controllerCellId: 'perf', values: ['1'] },
        { kind: 'choice-selected', controllerCellId: 'opt' },
      ]),
    });
    expect(isCellEnabled(cell, { perf: '1' })).toBe(true);
    expect(isCellEnabled(cell, {}, undefined, new Set(['opt']))).toBe(true);
    expect(isCellEnabled(cell, { perf: '2' }, undefined, new Set(['other']))).toBe(false);
  });

  it('저장 strip — OR 묶음의 컨트롤러가 모두 미충족이면 값을 지우고, 하나라도 충족하면 둔다', () => {
    const q = {
      id: 'q',
      type: 'table',
      tableRowsData: [
        {
          id: 'r',
          label: '',
          cells: [
            inputCell('now'),
            inputCell('want'),
            inputCell('name', { inputType: 'text', enabledWhen: group('OR', [gte1('now'), gte1('want')]) }),
          ],
        },
      ],
    } as unknown as Question;
    const kept = { q: { want: '2', name: 'X100' } };
    expect(stripDisabledCellValues([q], kept)).toBe(kept);
    expect(stripDisabledCellValues([q], { q: { now: '0', name: 'X100' } })).toEqual({
      q: { now: '0' },
    });
  });

  it('저장 strip — 묶음을 거친 체인도 고정점까지 지운다', () => {
    // a 비움 → b(OR[a]) 비활성 → c(AND[b 값 있음]) 비활성
    const q = {
      id: 'q',
      type: 'table',
      tableRowsData: [
        {
          id: 'r',
          label: '',
          cells: [
            inputCell('c', { enabledWhen: group('AND', [{ kind: 'filled', controllerCellId: 'b' }]) }),
            inputCell('b', { enabledWhen: group('OR', [gte1('a')]) }),
            inputCell('a'),
          ],
        },
      ],
    } as unknown as Question;
    expect(stripDisabledCellValues([q], { q: { a: '', b: '5', c: '7' } })).toEqual({ q: { a: '' } });
  });
});

describe('비활성 컨트롤러의 값은 없는 것으로 본다 — NOT 과 체인', () => {
  // x 가 비면 a·b 가 비활성. c 는 "a 에 값이 있거나, b 에 값이 없으면" 활성.
  // x 를 비운 직후 저장 페이로드에는 a·b 의 옛 값이 남아 있다. a·b 는 어차피 지워질 값이라
  // c 는 "b 에 값이 없다" 로 활성이어야 하고, c 의 답은 보존돼야 한다.
  const gatedBy = (id: string) => ({ kind: 'filled', controllerCellId: id }) as const;
  const cCondition: NonNullable<TableCell['enabledWhen']> = {
    kind: 'group',
    op: 'OR',
    terms: [gatedBy('a'), { kind: 'group', op: 'NOT', terms: [gatedBy('b')] }],
  };
  const cells = {
    x: inputCell('x'),
    a: inputCell('a', { enabledWhen: gatedBy('x') }),
    b: inputCell('b', { enabledWhen: gatedBy('x') }),
    c: inputCell('c', { enabledWhen: cCondition }),
  };
  const tableOf = (order: Array<keyof typeof cells>) =>
    ({
      id: 'q',
      type: 'table',
      tableRowsData: [{ id: 'r', label: '', cells: order.map((k) => cells[k]) }],
    }) as unknown as Question;
  const stale = { q: { x: '', a: '옛값', b: '옛값', c: '지켜야 할 답' } };

  it('저장 strip 결과가 셀 배치 순서와 무관하다', () => {
    const orders: Array<Array<keyof typeof cells>> = [
      ['x', 'a', 'b', 'c'],
      ['x', 'a', 'c', 'b'],
      ['c', 'b', 'a', 'x'],
      ['b', 'c', 'x', 'a'],
    ];
    for (const order of orders) {
      expect(stripDisabledCellValues([tableOf(order)], stale)).toEqual({
        q: { x: '', c: '지켜야 할 답' },
      });
    }
  });

  it('isCellEnabled 도 비활성 컨트롤러의 잔존 값을 무시한다 (표 전체 셀을 넘겼을 때)', () => {
    const all = Object.values(cells);
    expect(isCellEnabled(cells.c, stale.q, all)).toBe(true);
    // x 가 채워져 a·b 가 살아 있으면 값 그대로 판정한다
    expect(isCellEnabled(cells.c, { x: '1', a: '', b: '값' }, all)).toBe(false);
    expect(isCellEnabled(cells.c, { x: '1', a: '값', b: '값' }, all)).toBe(true);
  });

  it('체인 — 상류가 비활성이면 그 값이 남아 있어도 하류는 곧바로 비활성이다', () => {
    const b = inputCell('b', { enabledWhen: gatedBy('a') });
    const c = inputCell('c', { enabledWhen: gatedBy('b') });
    expect(isCellEnabled(c, { a: '', b: '남은 값' }, [inputCell('a'), b, c])).toBe(false);
  });

  it('순환 참조는 종전처럼 값만 보고 판정한다 — 무한 재귀하지 않는다', () => {
    const p = inputCell('p', { enabledWhen: gatedBy('r') });
    const r = inputCell('r', { enabledWhen: gatedBy('p') });
    expect(isCellEnabled(p, { p: '1', r: '1' }, [p, r])).toBe(true);
    expect(isCellEnabled(p, {}, [p, r])).toBe(false);
  });

  it('보기 소스 표 사이드카도 순서와 무관하다', () => {
    const text = (id: string, over: Partial<TableCell> = {}) =>
      inputCell(id, { inputType: 'text', ...over });
    const defs = {
      x: text('x'),
      a: text('a', { enabledWhen: gatedBy('x') }),
      b: text('b', { enabledWhen: gatedBy('x') }),
      c: text('c', { enabledWhen: cCondition }),
    };
    for (const order of [
      ['x', 'a', 'c', 'b'],
      ['c', 'b', 'a', 'x'],
    ] as Array<Array<keyof typeof defs>>) {
      const q = {
        id: 'q',
        type: 'checkbox',
        tableRowsData: [
          {
            id: 'r',
            label: '',
            cells: [{ id: 'opt', type: 'choice_opt', content: '' }, ...order.map((k) => defs[k])],
          },
        ],
      } as unknown as Question;
      const out = stripDisabledCellValues([q], {
        q: [],
        __optTexts__: { q: { x: '', a: '옛값', b: '옛값', c: '지켜야 할 답' } },
      });
      expect(out['__optTexts__']).toEqual({ q: { x: '', c: '지켜야 할 답' } });
    }
  });
});
