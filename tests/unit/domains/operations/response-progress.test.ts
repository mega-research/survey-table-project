import { describe, expect, it } from 'vitest';

import { calculateProgressPct } from '@/lib/operations/response-progress';

/** 테스트용 positionMap 헬퍼 — id `q1`..`qN` → position 1..N */
function makePositionMap(n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < n; i += 1) m.set(`q${i + 1}`, i + 1);
  return m;
}

describe('calculateProgressPct', () => {
  it('빈 answeredQuestionIds → null', () => {
    expect(calculateProgressPct([], makePositionMap(10), 10)).toBeNull();
  });

  it('totalQuestions = 0 → null', () => {
    expect(calculateProgressPct(['q1'], new Map(), 0)).toBeNull();
  });

  it('single answer position=3, total=10 → 30', () => {
    expect(calculateProgressPct(['q3'], makePositionMap(10), 10)).toBe(30);
  });

  it('multi answer 의 max position 선택 (5, 2, 8 → 80)', () => {
    expect(
      calculateProgressPct(['q5', 'q2', 'q8'], makePositionMap(10), 10),
    ).toBe(80);
  });

  it('positionMap 에 없는 questionId 는 무시 (legacy)', () => {
    const map = makePositionMap(5);
    expect(
      calculateProgressPct(['q2', 'unknown-id', 'q4'], map, 5),
    ).toBe(80); // max position = 4 → 80%
  });

  it('모든 답이 legacy → null', () => {
    expect(
      calculateProgressPct(['unknown-1', 'unknown-2'], makePositionMap(5), 5),
    ).toBeNull();
  });

  it('반올림: 1/3 → 33', () => {
    expect(calculateProgressPct(['q1'], makePositionMap(3), 3)).toBe(33);
  });

  it('반올림: 2/3 → 67', () => {
    expect(calculateProgressPct(['q2'], makePositionMap(3), 3)).toBe(67);
  });

  it('max position = total → 100', () => {
    expect(calculateProgressPct(['q10'], makePositionMap(10), 10)).toBe(100);
  });

  it('비정상 입력 clamp: maxPos > total → 100 으로 cap', () => {
    // positionMap 에 position=6 인 q6 이 있으나 totalQuestions=5 인 비일관 입력.
    // 정상 호출에서는 발생하지 않지만 fail-soft 로 100 보장.
    const map = new Map([['q6', 6]]);
    expect(calculateProgressPct(['q6'], map, 5)).toBe(100);
  });
});
