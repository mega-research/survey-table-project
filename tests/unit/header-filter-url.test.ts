import { describe, expect, it } from 'vitest';

import {
  hasBuilderFilterParams,
  hasHeaderFilterParams,
  joinHeaderValues,
  parseHeaderFilterEntries,
  removeHeaderFilter,
  splitHeaderValues,
  upsertHeaderFilter,
} from '@/features/operations/filters/header-filter-url';
import { HEADER_FILTER_VALUE_SEPARATOR as SEP } from '@/lib/operations/filter-shared';

function params(init: Record<string, string[]>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, vs] of Object.entries(init)) vs.forEach((v) => p.append(k, v));
  return p;
}

describe('parseHeaderFilterEntries', () => {
  it('hcol/hm/hv 병렬 배열을 엔트리로 파싱한다', () => {
    const p = params({
      hcol: ['attrs.지역', 'attrs.유형'],
      hm: ['in', 'text'],
      hv: [`서울${SEP}부산`, '제조'],
    });
    expect(parseHeaderFilterEntries(p)).toEqual([
      { source: 'attrs.지역', mode: 'in', hv: `서울${SEP}부산` },
      { source: 'attrs.유형', mode: 'text', hv: '제조' },
    ]);
  });

  it('길이 불일치는 짧은 쪽까지, 잘못된 mode 는 drop', () => {
    const p = params({ hcol: ['attrs.a', 'attrs.b'], hm: ['in', 'bogus'], hv: ['1', '2'] });
    expect(parseHeaderFilterEntries(p)).toEqual([{ source: 'attrs.a', mode: 'in', hv: '1' }]);
  });

  it('빈 params → 빈 배열', () => {
    expect(parseHeaderFilterEntries(new URLSearchParams())).toEqual([]);
  });
});

describe('upsertHeaderFilter', () => {
  it('새 컬럼은 append, page 삭제, 빌더 파라미터(col/q/op) 전부 제거', () => {
    const p = params({
      col: ['attrs.전시회명'],
      q: ['핵심'],
      op: [''],
      page: ['3'],
    });
    upsertHeaderFilter(p, { source: 'attrs.지역', mode: 'in', hv: '서울' });
    expect(p.getAll('hcol')).toEqual(['attrs.지역']);
    expect(p.getAll('hm')).toEqual(['in']);
    expect(p.getAll('hv')).toEqual(['서울']);
    expect(p.has('col')).toBe(false);
    expect(p.has('q')).toBe(false);
    expect(p.has('op')).toBe(false);
    expect(p.has('page')).toBe(false);
  });

  it('기존 컬럼은 해당 자리에서 교체, 다른 컬럼 유지', () => {
    const p = params({
      hcol: ['attrs.지역', 'attrs.유형'],
      hm: ['in', 'in'],
      hv: ['서울', '제조'],
    });
    upsertHeaderFilter(p, { source: 'attrs.지역', mode: 'in', hv: `서울${SEP}부산` });
    expect(p.getAll('hcol')).toEqual(['attrs.지역', 'attrs.유형']);
    expect(p.getAll('hv')).toEqual([`서울${SEP}부산`, '제조']);
  });
});

describe('removeHeaderFilter', () => {
  it('해당 컬럼 삼중항만 제거, 나머지 유지, page 삭제', () => {
    const p = params({
      hcol: ['attrs.지역', 'attrs.유형'],
      hm: ['in', 'text'],
      hv: ['서울', '제조'],
      page: ['2'],
    });
    removeHeaderFilter(p, 'attrs.지역');
    expect(p.getAll('hcol')).toEqual(['attrs.유형']);
    expect(p.getAll('hm')).toEqual(['text']);
    expect(p.getAll('hv')).toEqual(['제조']);
    expect(p.has('page')).toBe(false);
  });

  it('마지막 필터 제거 시 hcol/hm/hv 파라미터 자체가 사라진다', () => {
    const p = params({ hcol: ['attrs.지역'], hm: ['in'], hv: ['서울'] });
    removeHeaderFilter(p, 'attrs.지역');
    expect(p.has('hcol')).toBe(false);
    expect(p.has('hm')).toBe(false);
    expect(p.has('hv')).toBe(false);
  });
});

describe('활성 필터 감지', () => {
  it('hasBuilderFilterParams — col+q 둘 다 있어야 true', () => {
    expect(hasBuilderFilterParams(params({ col: ['a'], q: ['x'] }))).toBe(true);
    expect(hasBuilderFilterParams(params({ col: ['a'] }))).toBe(false);
    expect(hasBuilderFilterParams(new URLSearchParams())).toBe(false);
  });

  it('hasHeaderFilterParams — 유효 엔트리가 하나라도 있어야 true', () => {
    expect(hasHeaderFilterParams(params({ hcol: ['a'], hm: ['in'], hv: ['x'] }))).toBe(true);
    expect(hasHeaderFilterParams(params({ hcol: ['a'] }))).toBe(false);
    expect(hasHeaderFilterParams(new URLSearchParams())).toBe(false);
  });
});

describe('값 조인/분리', () => {
  it('joinHeaderValues ↔ splitHeaderValues 왕복', () => {
    const values = ['서울', '부산', '값 에 공백'];
    expect(splitHeaderValues(joinHeaderValues(values))).toEqual(values);
  });

  it('splitHeaderValues 는 빈 토큰을 버린다', () => {
    expect(splitHeaderValues(`${SEP}서울${SEP}${SEP}`)).toEqual(['서울']);
  });
});
