import { describe, expect, it } from 'vitest';

import type { QuestionConditionGroup, RowRepeatConfig, TableCell, TableRow } from '@/types/survey';

import {
  applyRepeatBlockCondition,
  deriveOpenRepeatCount,
  hiddenRepeatRowIds,
  isRepeatBlockHidden,
  repeatStartsCollapsed,
  startedRepeatBundles,
} from './row-repeat';

/**
 * 행 반복 블록 표시 조건 · 처음엔 접어 두기 (2026-11-06, .scratch/repeat-block-visibility/PRD.md).
 * 유가공업 문2-2 「품목 추가」는 문2 에 수입 기타 품목이 있을 때만, 문2 「원료 추가」는 문1 국내산이 있을 때만 첫 줄을 편다.
 */
const cell = (id: string): TableCell => ({ id, content: '', type: 'input' });
const rows: TableRow[] = [
  { id: 'fixed', label: '① 원유', cells: [cell('f1')] },
  { id: 'tpl', label: '품목', repeatIndex: 1, cells: [cell('b1')] },
  { id: 'tpl-2', label: '품목 ②', repeatIndex: 2, repeatSourceRowId: 'tpl', cells: [cell('b2')] },
  { id: 'tpl-3', label: '품목 ③', repeatIndex: 3, repeatSourceRowId: 'tpl', cells: [cell('b3')] },
];
const cond: QuestionConditionGroup = {
  logicType: 'AND',
  conditions: [{ id: 'c', conditionType: 'value-match', sourceQuestionId: 'q', requiredValues: ['1'] }],
} as QuestionConditionGroup;
const config = (extra: Partial<RowRepeatConfig> = {}): RowRepeatConfig => ({
  enabled: true,
  templateRowIds: ['tpl'],
  maxRepeats: 3,
  ...extra,
});

describe('applyRepeatBlockCondition', () => {
  it('블록 행(틀·벌)에만 블록 조건을 행 표시 조건으로 얹고, 고정 행은 그대로 둔다', () => {
    const out = applyRepeatBlockCondition(rows, config({ displayCondition: cond }));
    expect(out[0]).toBe(rows[0]);
    expect(out.slice(1).map((r) => r.displayCondition)).toEqual([cond, cond, cond]);
    // 원본은 건드리지 않는다
    expect(rows[1]!.displayCondition).toBeUndefined();
  });

  it('조건이 없거나 비었거나 반복이 꺼져 있으면 원본 배열 그대로', () => {
    expect(applyRepeatBlockCondition(rows, config())).toBe(rows);
    expect(applyRepeatBlockCondition(rows, config({ displayCondition: { logicType: 'AND', conditions: [] } }))).toBe(rows);
    expect(applyRepeatBlockCondition(rows, config({ enabled: false, displayCondition: cond }))).toBe(rows);
  });
});

describe('isRepeatBlockHidden', () => {
  it('블록 조건이 거짓이면 숨고 참이면 보인다', () => {
    expect(isRepeatBlockHidden(config({ displayCondition: cond }), () => false)).toBe(true);
    expect(isRepeatBlockHidden(config({ displayCondition: cond }), () => true)).toBe(false);
    expect(isRepeatBlockHidden(config(), () => false)).toBe(false);
  });
});

describe('처음엔 접어 두기', () => {
  it('켜져 있으면 접고, 펼쳐 둘 조건이 참이면 편다', () => {
    expect(repeatStartsCollapsed(config({ startCollapsed: true }), () => false)).toBe(true);
    expect(repeatStartsCollapsed(config({ startCollapsed: true, expandWhen: cond }), () => true)).toBe(false);
    expect(repeatStartsCollapsed(config({ startCollapsed: true, expandWhen: cond }), () => false)).toBe(true);
    expect(repeatStartsCollapsed(config(), () => false)).toBe(false);
  });

  it('접으면 값이 없을 때 열린 벌이 0 — 첫 벌도 숨는다', () => {
    expect(deriveOpenRepeatCount(rows, {}, 0)).toBe(0);
    expect([...hiddenRepeatRowIds(rows, 0)].sort()).toEqual(['tpl', 'tpl-2', 'tpl-3']);
  });

  it('접어도 값이 든 벌까지는 보인다 — 첫 벌에 값이 있으면 1, 둘째 벌이면 2', () => {
    expect(deriveOpenRepeatCount(rows, { b1: 'x' }, 0)).toBe(1);
    expect(deriveOpenRepeatCount(rows, { b2: 'x' }, 0)).toBe(2);
  });

  it('첫 벌도 「적기 시작한 벌」로 셀 수 있다 — 접힌 첫 벌의 필수 판정용', () => {
    expect(startedRepeatBundles(rows, { b1: 'x' }, 1)).toEqual(new Set([1]));
    expect(startedRepeatBundles(rows, { b1: 'x' })).toEqual(new Set());
  });
});
