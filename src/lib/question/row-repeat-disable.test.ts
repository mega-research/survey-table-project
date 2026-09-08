import { describe, expect, it } from 'vitest';

import type { RowRepeatConfig, TableRow } from '@/types/survey';

import { collapseRepeatRows, disableRowRepeat, expandRepeatRows } from './row-repeat';

/**
 * 반복 끄기 — 뒤쪽 벌을 걷고 1벌을 원래 모습으로 되돌린다.
 *
 * 필드를 지우는 것으로는 부족하다. 부분 패치 저장(updateQuestion)은 undefined 를
 * "미변경"으로 읽어 DB 에 이전 설정이 그대로 남는다. 그 상태로 다시 열면 남은 설정이
 * `_01` 로 끝나는 rowCode 를 밑동 삼아 다시 펼쳐져 `_01_01` 이 생긴다.
 */
const config: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 3 };

function seed(): TableRow[] {
  return [
    { id: 'head', label: '머리', cells: [{ id: 'h1', type: 'input', content: '' }] },
    { id: 'tpl', label: '성과', cells: [{ id: 't1', type: 'input', content: '' }] },
  ] as TableRow[];
}

function expanded(): TableRow[] {
  let n = 0;
  return expandRepeatRows(seed(), config, () => `gen${++n}`);
}

describe('disableRowRepeat', () => {
  it('2벌 이후를 걷어내고 반복 표식을 지운다', () => {
    const rows = disableRowRepeat(expanded());
    expect(rows.map((r) => r.id)).toEqual(['head', 'tpl']);
    expect(rows.every((r) => r.repeatIndex === undefined)).toBe(true);
    expect(rows.every((r) => r.repeatSourceRowId === undefined)).toBe(true);
  });

  it('1벌의 rowCode 에서 벌 접미를 떼어 원래 코드로 되돌린다', () => {
    expect(expanded().find((r) => r.repeatIndex === 1)!.rowCode).toBe('r2_01');
    expect(disableRowRepeat(expanded()).find((r) => r.id === 'tpl')!.rowCode).toBe('r2');
  });

  it('반복이 없던 표는 손대지 않는다', () => {
    const rows = seed();
    expect(disableRowRepeat(rows)).toBe(rows);
  });

  it('끈 뒤 다시 켜도 rowCode 가 겹쳐 붙지 않는다', () => {
    const off = disableRowRepeat(expanded());
    let n = 0;
    const on = expandRepeatRows(off, config, () => `re${++n}`);
    expect(on.find((r) => r.repeatIndex === 1)!.rowCode).toBe('r2_01');
    expect(on.find((r) => r.repeatIndex === 2)!.rowCode).toBe('r2_02');
  });

  it('collapseRepeatRows 만으로는 표식도 rowCode 도 남는다 — 끄기와 다른 연산이다', () => {
    const collapsed = collapseRepeatRows(expanded());
    expect(collapsed.find((r) => r.id === 'tpl')!.rowCode).toBe('r2_01');
    expect(collapsed.find((r) => r.id === 'tpl')!.repeatIndex).toBe(1);
  });
});

describe('끄기 값이 저장 경계를 통과한다', () => {
  it('부분 패치 스키마가 명시적 null 을 받아 넘긴다 — 키 삭제는 미변경으로 읽힌다', async () => {
    const { UpdateQuestionData } = await import('@/features/survey-builder/domain/question');
    const parsed = UpdateQuestionData.parse({ rowRepeatConfig: null });
    expect(parsed).toHaveProperty('rowRepeatConfig', null);
    expect('rowRepeatConfig' in UpdateQuestionData.parse({})).toBe(false);
  });
})
