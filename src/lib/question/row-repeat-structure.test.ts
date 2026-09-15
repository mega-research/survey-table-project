import { describe, expect, it } from 'vitest';

import type { RowRepeatConfig, TableRow } from '@/types/survey';

import { expandRepeatRows, isRowRepeatIntact } from './row-repeat';

/**
 * 템플릿 행이 지워지거나 흩어진 뒤의 펼치기.
 *
 * 설정은 행 id 로 템플릿을 가리키는데 편집 화면은 그 행을 지우거나 옮길 수 있다. 설정이
 * 낡은 채로 펼치면 남은 벌이 주인 없이 떠돌거나 반복 단위가 조용히 바뀐다. 구조가 설정과
 * 어긋나면 **펼치지 않고 구조를 원래대로 되돌린다** — 조용히 다른 것을 만들지 않는다.
 */
const config: RowRepeatConfig = {
  enabled: true,
  templateRowIds: ['a', 'b'],
  maxRepeats: 3,
};

function seed(): TableRow[] {
  return [
    { id: 'head', label: '머리', cells: [{ id: 'h1', type: 'input', content: '' }] },
    { id: 'a', label: '가', cells: [{ id: 'a1', type: 'input', content: '' }] },
    { id: 'b', label: '나', cells: [{ id: 'b1', type: 'input', content: '' }] },
    { id: 'tail', label: '꼬리', cells: [{ id: 'z1', type: 'input', content: '' }] },
  ] as TableRow[];
}

function expand(rows: TableRow[], cfg: RowRepeatConfig = config) {
  let n = 0;
  return expandRepeatRows(rows, cfg, () => `gen${++n}`);
}

describe('isRowRepeatIntact', () => {
  it('템플릿 행이 전부 있고 붙어 있으면 온전하다', () => {
    expect(isRowRepeatIntact(seed(), config)).toBe(true);
  });

  it('템플릿 행이 하나라도 없으면 깨진 것이다', () => {
    expect(isRowRepeatIntact(seed().filter((r) => r.id !== 'b'), config)).toBe(false);
  });

  it('템플릿 행 사이에 남의 행이 끼면 깨진 것이다', () => {
    const rows = seed();
    const [head, a, b, tail] = rows;
    expect(isRowRepeatIntact([head!, a!, tail!, b!], config)).toBe(false);
  });

  it('설정이 꺼져 있으면 판정 대상이 아니다', () => {
    expect(isRowRepeatIntact(seed(), { ...config, enabled: false })).toBe(true);
  });
});

describe('구조가 설정과 어긋나면 펼치지 않고 되돌린다', () => {
  it('템플릿 행 하나를 지우면 남은 벌을 걷어낸다 — 주인 없는 행을 남기지 않는다', () => {
    const expanded = expand(seed());
    expect(expanded.filter((r) => r.repeatIndex).length).toBe(6);

    const afterDelete = expanded.filter((r) => r.repeatSourceRowId !== 'b' && r.id !== 'b');
    const out = expand(afterDelete);

    expect(out.some((r) => r.repeatIndex !== undefined)).toBe(false);
    expect(out.map((r) => r.id)).toEqual(['head', 'a', 'tail']);
  });

  it('되돌린 행은 rowCode 의 벌 접미까지 떼어 원래 코드로 돌아온다', () => {
    const expanded = expand(seed());
    const afterDelete = expanded.filter((r) => r.repeatSourceRowId !== 'b' && r.id !== 'b');
    const out = expand(afterDelete);
    expect(out.find((r) => r.id === 'a')!.rowCode).toBe('r2');
  });

  it('템플릿 묶음이 흩어지면 조용히 반복 단위를 바꾸지 않는다', () => {
    const rows = seed();
    const [head, a, b, tail] = rows;
    const out = expand([head!, a!, tail!, b!]);
    expect(out.some((r) => r.repeatIndex !== undefined)).toBe(false);
  });

  it('템플릿이 온전하면 평소대로 펼친다', () => {
    expect(expand(seed()).filter((r) => r.repeatIndex).length).toBe(6);
  });
});
