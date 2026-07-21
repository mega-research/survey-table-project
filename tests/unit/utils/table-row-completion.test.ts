import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';
import { MOBILE_TABLE_COMPLETION_TYPES } from '@/utils/mobile-original-row';
import { isTableRowCompleted } from '@/utils/table-row-completion';

// 테스트용 셀 팩토리 — 최소 필드만 채우고 나머지는 기본값
function cell(overrides: Partial<TableCell> & { id: string; type: TableCell['type'] }): TableCell {
  return {
    content: '',
    ...overrides,
  } as TableCell;
}

function row(cells: TableCell[]): TableRow {
  return { id: 'row1', label: '행', cells };
}

describe('isTableRowCompleted', () => {
  it('single-select radio 그룹: 한 멤버만 선택되고 sibling이 빈 문자열이어도 완료로 본다', () => {
    // 핵심 회귀 케이스: 같은 radioGroupName 셀 2개. 하나를 선택하면
    // use-cell-response 의 sibling-clear 가 나머지를 ''로 클리어한다.
    const r = row([
      cell({ id: 'c1', type: 'radio', radioGroupName: 'g' }),
      cell({ id: 'c2', type: 'radio', radioGroupName: 'g' }),
    ]);
    // c1 선택, c2는 sibling-clear 로 빈 문자열
    const response = { c1: 'selected-value', c2: '' };
    expect(isTableRowCompleted(r, response)).toBe(true);
  });

  it('single-select radio 그룹: 멤버가 모두 미선택이면 미완료', () => {
    const r = row([
      cell({ id: 'c1', type: 'radio', radioGroupName: 'g' }),
      cell({ id: 'c2', type: 'radio', radioGroupName: 'g' }),
    ]);
    expect(isTableRowCompleted(r, {})).toBe(false);
    expect(isTableRowCompleted(r, { c1: '', c2: '' })).toBe(false);
  });

  it('그룹 멤버가 1개뿐이면 단일 radio 로 취급 — 빈 문자열은 미완료', () => {
    const r = row([cell({ id: 'c1', type: 'radio', radioGroupName: 'solo' })]);
    expect(isTableRowCompleted(r, { c1: '' })).toBe(false);
    expect(isTableRowCompleted(r, { c1: 'v' })).toBe(true);
  });

  it('radioGroupName 없는 단일 radio: 빈 문자열은 미완료', () => {
    const r = row([cell({ id: 'c1', type: 'radio' })]);
    expect(isTableRowCompleted(r, { c1: '' })).toBe(false);
    expect(isTableRowCompleted(r, { c1: 'v' })).toBe(true);
  });

  it('그룹 + 다른 입력 셀 혼합: 그룹은 선택됐지만 다른 input 이 비면 미완료', () => {
    const r = row([
      cell({ id: 'c1', type: 'radio', radioGroupName: 'g' }),
      cell({ id: 'c2', type: 'radio', radioGroupName: 'g' }),
      cell({ id: 'c3', type: 'input' }),
    ]);
    // 그룹은 완료(c1 선택, c2 클리어)지만 c3 input 미응답
    expect(isTableRowCompleted(r, { c1: 'v', c2: '', c3: '' })).toBe(false);
    // 모두 응답되면 완료
    expect(isTableRowCompleted(r, { c1: 'v', c2: '', c3: '값' })).toBe(true);
  });

  it('isHidden 셀은 렌더되지 않아 응답 불가하므로 완료 판정에서 제외한다', () => {
    // interactive-table-response 가 isHidden 셀을 return null 로 렌더하지 않아 사용자가 응답할 수 없다.
    // buildRadioGroupBuckets 도 isHidden 을 그룹에서 제외하므로, 완료 판정도 동일하게 제외해야 정합이다.
    // (제외하지 않으면 응답 불가한 숨김 셀이 행을 영구 미완료로 만든다.)
    const r = row([
      cell({ id: 'c1', type: 'radio', radioGroupName: 'g' }),
      cell({ id: 'c2', type: 'radio', radioGroupName: 'g', isHidden: true }),
    ]);
    // c2(isHidden) 는 무시되고 가시 셀 c1 으로만 판정 → c1 응답되면 완료
    expect(isTableRowCompleted(r, { c1: 'v', c2: '' })).toBe(true);
    // c1 미응답이면 미완료(숨김 c2 와 무관)
    expect(isTableRowCompleted(r, { c1: '', c2: '' })).toBe(false);
  });

  it('_isContinuation 셀은 완료 판정에서 무시', () => {
    const r = row([
      cell({ id: 'c1', type: 'input' }),
      cell({ id: 'c2', type: 'radio', _isContinuation: true }),
    ]);
    expect(isTableRowCompleted(r, { c1: '값' })).toBe(true);
  });

  it('비입력 셀(text 표시·image 등)은 완료 판정에 영향 없음', () => {
    const r = row([
      cell({ id: 't1', type: 'image' }),
      cell({ id: 'i1', type: 'input' }),
    ]);
    expect(isTableRowCompleted(r, { i1: '값' })).toBe(true);
    expect(isTableRowCompleted(r, {})).toBe(false);
  });

  it('text 셀(라벨 셀)은 응답 대상으로 판정 — 빈값이면 미완료', () => {
    // 주의: checkRow 의 answerable 타입에 text 가 포함되어 기존 동작을 보존한다.
    const r = row([cell({ id: 'tx', type: 'text' })]);
    expect(isTableRowCompleted(r, { tx: '' })).toBe(false);
    expect(isTableRowCompleted(r, { tx: '입력' })).toBe(true);
  });

  it('checkbox/select 셀: 빈값 미완료, 값 있으면 완료', () => {
    const rCheckbox = row([cell({ id: 'cb', type: 'checkbox' })]);
    expect(isTableRowCompleted(rCheckbox, { cb: [] as unknown })).toBe(true); // 빈 배열은 !== '' → 응답으로 간주(기존 동작 보존)
    expect(isTableRowCompleted(rCheckbox, {})).toBe(false);

    const rSelect = row([cell({ id: 'sel', type: 'select' })]);
    expect(isTableRowCompleted(rSelect, { sel: 'x' })).toBe(true);
    expect(isTableRowCompleted(rSelect, { sel: '' })).toBe(false);
  });

  it('모바일 원본 행 타입 집합에서는 정적 text를 제외한다', () => {
    const r = row([
      cell({ id: 'label', type: 'text' }),
      cell({ id: 'v', type: 'input' }),
    ]);

    expect(isTableRowCompleted(r, { v: '1' }, MOBILE_TABLE_COMPLETION_TYPES)).toBe(true);
  });

  it('모바일 원본 행 타입 집합에서는 ranking을 완료 대상으로 포함한다', () => {
    const r = row([cell({ id: 'rank', type: 'ranking' })]);

    expect(isTableRowCompleted(r, {}, MOBILE_TABLE_COMPLETION_TYPES)).toBe(false);
  });
});
