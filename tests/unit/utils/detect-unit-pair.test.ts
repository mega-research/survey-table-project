import { describe, expect, it } from 'vitest';

import { detectUnitPair } from '@/utils/mobile-card-options';

/**
 * detectUnitPair 는 모바일 카드에서 "수량 셀 + 단위 셀" 쌍을 한 줄로 묶기 위해
 * (1) 현재 셀이 쌍의 시작인지(isUnitPairStart) (2) 현재 셀이 이미 묶여 렌더된 단위 셀인지(wasAlreadyPaired)
 * 를 판정한다. mobile-row-card 는 wasAlreadyPaired 면 해당 셀을 skip(return null) 한다.
 *
 * 시작 판정(isUnitPairStart)과 이미-묶임 판정(wasAlreadyPaired)이 동일한 broad 규칙
 * (endsWith('단위'))을 써야 한 셀이 두 번 렌더되지 않는다.
 */

// 컬럼 라벨 배열로 실제 렌더 순서를 시뮬레이션. inline 으로 묶인 셀은 "(inline)" 접미.
function simulateRender(labels: ReadonlyArray<string>): string[] {
  const rendered: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const current = labels[i]!;
    const next = labels[i + 1];
    const prev = i > 0 ? labels[i - 1] : undefined;
    const { isUnitPairStart, wasAlreadyPaired } = detectUnitPair(current, next, prev);
    if (wasAlreadyPaired) continue; // mobile-row-card 의 `return null`
    rendered.push(current);
    if (isUnitPairStart && next !== undefined) rendered.push(`${next}(inline)`);
  }
  return rendered;
}

describe('detectUnitPair', () => {
  it('_단위 컨벤션 쌍을 한 줄로 묶고 단위 셀을 중복 렌더하지 않는다', () => {
    expect(simulateRender(['수량', '수량_단위'])).toEqual(['수량', '수량_단위(inline)']);
  });

  it('정확히 "단위" 인 셀도 한 번만 렌더한다', () => {
    expect(simulateRender(['값', '단위'])).toEqual(['값', '단위(inline)']);
  });

  it('회귀: "원단위" 처럼 컨벤션 외로 "단위" 로 끝나는 셀이 두 번 렌더되지 않는다', () => {
    // 수정 전: isUnitPairStart 는 broad('단위'), wasAlreadyPaired 는 narrow('_단위'|='단위')
    // 라 "원단위" 가 인라인 + 단독으로 두 번 렌더됐다.
    expect(simulateRender(['비용', '원단위'])).toEqual(['비용', '원단위(inline)']);
  });

  it('단위와 무관한 연속 셀은 각각 단독 렌더한다', () => {
    expect(simulateRender(['이름', '나이'])).toEqual(['이름', '나이']);
  });

  it('첫 셀이 단위 셀이면(직전 셀 없음) 단독 렌더한다', () => {
    expect(simulateRender(['단위', '이름'])).toEqual(['단위', '이름']);
    expect(detectUnitPair('단위', '이름', undefined).wasAlreadyPaired).toBe(false);
  });

  it('나란히 오는 단위 셀은 직전 셀이 인라인하므로 wasAlreadyPaired=true', () => {
    expect(detectUnitPair('원단위', '비고', '비용').wasAlreadyPaired).toBe(true);
  });
});
