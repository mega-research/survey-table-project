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
});
