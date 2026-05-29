import { describe, expect, it } from 'vitest';

import {
  formatDropFunnel,
  shapeDropFunnel,
  type DropFunnelInput,
  type FunnelQuestion,
} from '@/lib/operations/drop-funnel';

/** 테스트용 snapshot 헬퍼 — id `q1`..`qN` 형식, 라벨 `Q1`..`QN`. */
function makeQuestions(n: number): FunnelQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    position: i + 1,
    label: `Q${i + 1}`,
  }));
}

describe('shapeDropFunnel', () => {
  it('빈 drops 입력 → bars 배열이 비고 totalDrops=0', () => {
    const input: DropFunnelInput = {
      questions: makeQuestions(5),
      drops: [],
    };
    const result = shapeDropFunnel(input);
    expect(result.bars).toEqual([]);
    expect(result.totalDrops).toBe(0);
  });

  it('한 질문에 모든 drop 집중 → 단일 막대 + position-based 진행률 정확', () => {
    // q3 / 5문항 → (3/5)*100 = 60%
    const input: DropFunnelInput = {
      questions: makeQuestions(5),
      drops: [
        { responseId: 'r1', lastQuestionId: 'q3', exposedQuestionIds: null },
        { responseId: 'r2', lastQuestionId: 'q3', exposedQuestionIds: null },
        { responseId: 'r3', lastQuestionId: 'q3', exposedQuestionIds: null },
      ],
    };
    const result = shapeDropFunnel(input);

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]).toMatchObject({
      questionId: 'q3',
      label: 'Q3',
      position: 3,
      page: null,
      dropCount: 3,
      cumulativeProgressPct: 60, // (3/5)*100
    });
    expect(result.totalDrops).toBe(3);
  });

  it('topN=3, 5개 질문에 drop 분포 → 상위 3 막대(position ASC) + 기타 1 막대', () => {
    // dropCount: q1=10, q2=8, q3=5, q4=3, q5=1 (총 27)
    // 상위 3: q1, q2, q3 → position ASC 정렬 시 q1, q2, q3 순서 유지
    const drops: DropFunnelInput['drops'] = [];
    const counts: Record<string, number> = { q1: 10, q2: 8, q3: 5, q4: 3, q5: 1 };
    let rid = 0;
    for (const [qid, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        drops.push({ responseId: `r${rid++}`, lastQuestionId: qid, exposedQuestionIds: null });
      }
    }
    const input: DropFunnelInput = {
      questions: makeQuestions(5),
      drops,
      topN: 3,
    };
    const result = shapeDropFunnel(input);

    // [q1, q2, q3, 기타(q4+q5=4)]
    expect(result.bars).toHaveLength(4);
    expect(result.bars.slice(0, 3).map((b) => b.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(result.bars.slice(0, 3).map((b) => b.dropCount)).toEqual([10, 8, 5]);
    // position-based 진행률: q1=20%, q2=40%, q3=60% (총 5문항)
    expect(result.bars.slice(0, 3).map((b) => b.cumulativeProgressPct)).toEqual([20, 40, 60]);

    const others = result.bars[3];
    expect(others.questionId).toBe('others');
    expect(others.label).toBe('기타');
    expect(others.dropCount).toBe(4);
    expect(others.cumulativeProgressPct).toBeNull();
    expect(others.position).toBeNull();
    expect(others.page).toBeNull();

    expect(result.totalDrops).toBe(27);
  });

  it('lastQuestionId가 snapshot에 없는 drop → legacy 버킷', () => {
    const input: DropFunnelInput = {
      questions: makeQuestions(3),
      drops: [
        { responseId: 'r1', lastQuestionId: 'q1', exposedQuestionIds: null },
        { responseId: 'r2', lastQuestionId: 'q-deleted', exposedQuestionIds: null },
        { responseId: 'r3', lastQuestionId: 'q-other-version', exposedQuestionIds: null },
      ],
    };
    const result = shapeDropFunnel(input);

    // [q1, legacy]
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0].questionId).toBe('q1');
    expect(result.bars[0].dropCount).toBe(1);

    const legacy = result.bars[1];
    expect(legacy.questionId).toBe('legacy');
    expect(legacy.label).toBe('(legacy)');
    expect(legacy.dropCount).toBe(2);
    expect(legacy.cumulativeProgressPct).toBeNull();
    expect(legacy.position).toBeNull();
    expect(legacy.page).toBeNull();

    expect(result.totalDrops).toBe(3);
  });

  it('lastQuestionId가 null인 drop (답변 0건) → legacy 버킷', () => {
    const input: DropFunnelInput = {
      questions: makeQuestions(3),
      drops: [
        { responseId: 'r1', lastQuestionId: null, exposedQuestionIds: null },
        { responseId: 'r2', lastQuestionId: null, exposedQuestionIds: null },
      ],
    };
    const result = shapeDropFunnel(input);

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].questionId).toBe('legacy');
    expect(result.bars[0].dropCount).toBe(2);
    expect(result.totalDrops).toBe(2);
  });

  it('exposedQuestionIds 정의되어 있고 lastQuestionId 미포함 → drop 완전 제외 (어떤 버킷에도 없음)', () => {
    const input: DropFunnelInput = {
      questions: makeQuestions(5),
      drops: [
        // 정상: q3가 노출 목록에 포함.
        { responseId: 'r1', lastQuestionId: 'q3', exposedQuestionIds: ['q1', 'q2', 'q3'] },
        // 제외: q3가 노출 목록에 없음 (분기 버그).
        { responseId: 'r2', lastQuestionId: 'q3', exposedQuestionIds: ['q1', 'q2'] },
        // 제외: q5가 노출 목록에 없음.
        { responseId: 'r3', lastQuestionId: 'q5', exposedQuestionIds: ['q1', 'q4'] },
      ],
    };
    const result = shapeDropFunnel(input);

    // 정상 1건만 반영. 제외된 2건은 어떤 버킷에도 들어가지 않음.
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].questionId).toBe('q3');
    expect(result.bars[0].dropCount).toBe(1);
    expect(result.totalDrops).toBe(1);
  });

  it('exposedQuestionIds 정의되어 있고 lastQuestionId 포함 → 정상 귀속', () => {
    const input: DropFunnelInput = {
      questions: makeQuestions(3),
      drops: [
        { responseId: 'r1', lastQuestionId: 'q1', exposedQuestionIds: ['q1', 'q2'] },
        { responseId: 'r2', lastQuestionId: 'q2', exposedQuestionIds: ['q1', 'q2', 'q3'] },
      ],
    };
    const result = shapeDropFunnel(input);

    expect(result.bars).toHaveLength(2);
    // q1, q2 모두 포함 — position ASC 정렬이므로 [q1, q2] 순서 (입력 순서 무관).
    expect(result.bars.map((b) => b.questionId)).toEqual(['q1', 'q2']);
    expect(result.totalDrops).toBe(2);
  });

  it('exposedQuestionIds=null → 노출 정보 미상으로 간주, 정상 귀속', () => {
    const input: DropFunnelInput = {
      questions: makeQuestions(3),
      drops: [
        { responseId: 'r1', lastQuestionId: 'q2', exposedQuestionIds: null },
        { responseId: 'r2', lastQuestionId: 'q2', exposedQuestionIds: null },
      ],
    };
    const result = shapeDropFunnel(input);

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].questionId).toBe('q2');
    expect(result.bars[0].dropCount).toBe(2);
    expect(result.totalDrops).toBe(2);
  });

  it('막대 정렬 — position ASC (sequential funnel 형태)', () => {
    // q5에 5건, q1에 3건, q3에 7건.
    // dropCount DESC 라면 [q3, q5, q1] 이지만, 새 사양은 position ASC → [q1, q3, q5].
    const drops: DropFunnelInput['drops'] = [];
    const counts: Record<string, number> = { q5: 5, q1: 3, q3: 7 };
    let rid = 0;
    for (const [qid, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        drops.push({ responseId: `r${rid++}`, lastQuestionId: qid, exposedQuestionIds: null });
      }
    }
    const input: DropFunnelInput = {
      questions: makeQuestions(5),
      drops,
    };
    const result = shapeDropFunnel(input);

    expect(result.bars.map((b) => b.questionId)).toEqual(['q1', 'q3', 'q5']);
    expect(result.bars.map((b) => b.dropCount)).toEqual([3, 7, 5]);
    // 진행률: q1 = 1/5*100=20, q3=60, q5=100
    expect(result.bars.map((b) => b.cumulativeProgressPct)).toEqual([20, 60, 100]);
  });

  it('totalQuestions=0인데 drops가 있으면 → 모두 legacy (정상 귀속 자체가 불가능)', () => {
    const input: DropFunnelInput = {
      questions: [],
      drops: [
        { responseId: 'r1', lastQuestionId: 'q2', exposedQuestionIds: null },
      ],
    };
    const result = shapeDropFunnel(input);

    // 빈 questions → 어떤 id든 questionMap.has=false → legacy.
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].questionId).toBe('legacy');
    expect(result.bars[0].cumulativeProgressPct).toBeNull();
  });

  it('position-based 진행률 — 16번 / 50문항 → 32%', () => {
    // mockup p1 예시: Q16 / 50문항 → 32.0%
    const questions: FunnelQuestion[] = Array.from({ length: 50 }, (_, i) => ({
      id: `q${i + 1}`,
      position: i + 1,
      label: `Q${i + 1}`,
    }));
    const input: DropFunnelInput = {
      questions,
      drops: [
        { responseId: 'r1', lastQuestionId: 'q16', exposedQuestionIds: null },
      ],
    };
    const result = shapeDropFunnel(input);
    expect(result.bars[0].cumulativeProgressPct).toBe(32);
  });

  it('topN 기본값 10 — 12개 위치에 drop 분산 시 10막대(position ASC) + 기타 1막대', () => {
    const drops: DropFunnelInput['drops'] = [];
    // 12개 질문에 dropCount 12, 11, 10, ..., 1 할당. (q1=12, ..., q12=1)
    let rid = 0;
    for (let i = 1; i <= 12; i++) {
      const n = 13 - i;
      for (let k = 0; k < n; k++) {
        drops.push({ responseId: `r${rid++}`, lastQuestionId: `q${i}`, exposedQuestionIds: null });
      }
    }
    const input: DropFunnelInput = {
      questions: makeQuestions(12),
      drops,
    };
    const result = shapeDropFunnel(input);

    // 단독 막대 후보: dropCount DESC 상위 10 = q1..q10. 잔여 q11(2)+q12(1)=3 → 기타.
    // 단독 막대들은 position ASC 재정렬 → q1..q10. 그 뒤 기타.
    expect(result.bars).toHaveLength(11);
    expect(result.bars.slice(0, 10).map((b) => b.questionId)).toEqual([
      'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10',
    ]);
    const others = result.bars[10];
    expect(others.questionId).toBe('others');
    expect(others.dropCount).toBe(3);
  });

  it('legacy + others 모두 존재 → [정상(position ASC), others, legacy] 순서', () => {
    const drops: DropFunnelInput['drops'] = [
      // 정상: q1×3, q2×2, q3×1 (topN=2 → q1, q2 단독, q3는 기타)
      { responseId: 'r1', lastQuestionId: 'q1', exposedQuestionIds: null },
      { responseId: 'r2', lastQuestionId: 'q1', exposedQuestionIds: null },
      { responseId: 'r3', lastQuestionId: 'q1', exposedQuestionIds: null },
      { responseId: 'r4', lastQuestionId: 'q2', exposedQuestionIds: null },
      { responseId: 'r5', lastQuestionId: 'q2', exposedQuestionIds: null },
      { responseId: 'r6', lastQuestionId: 'q3', exposedQuestionIds: null },
      // legacy
      { responseId: 'r7', lastQuestionId: 'q-deleted', exposedQuestionIds: null },
      { responseId: 'r8', lastQuestionId: null, exposedQuestionIds: null },
    ];
    const input: DropFunnelInput = {
      questions: makeQuestions(3),
      drops,
      topN: 2,
    };
    const result = shapeDropFunnel(input);

    // 단독: q1, q2 (position ASC). 기타(q3=1). legacy(2).
    // [q1, q2, others(1), legacy(2)]
    expect(result.bars).toHaveLength(4);
    expect(result.bars.map((b) => b.questionId)).toEqual(['q1', 'q2', 'others', 'legacy']);
    expect(result.bars.map((b) => b.dropCount)).toEqual([3, 2, 1, 2]);
    expect(result.bars[2].cumulativeProgressPct).toBeNull();
    expect(result.bars[3].cumulativeProgressPct).toBeNull();
    expect(result.totalDrops).toBe(8);
  });

  it('FunnelQuestion.page 필드 → DropFunnelBar.page 로 전파', () => {
    // mockup 예: Q16 (page 6). 여기선 단순화해 q3을 page=2, q5를 page=3 으로.
    const questions: FunnelQuestion[] = [
      { id: 'q1', position: 1, label: 'Q1', page: 1 },
      { id: 'q2', position: 2, label: 'Q2', page: 1 },
      { id: 'q3', position: 3, label: 'Q3', page: 2 },
      { id: 'q4', position: 4, label: 'Q4' }, // ungrouped → page undefined
      { id: 'q5', position: 5, label: 'Q5', page: 3 },
    ];
    const input: DropFunnelInput = {
      questions,
      drops: [
        { responseId: 'r1', lastQuestionId: 'q3', exposedQuestionIds: null },
        { responseId: 'r2', lastQuestionId: 'q4', exposedQuestionIds: null },
        { responseId: 'r3', lastQuestionId: 'q5', exposedQuestionIds: null },
      ],
    };
    const result = shapeDropFunnel(input);

    // position ASC: q3 (page 2), q4 (page null), q5 (page 3)
    expect(result.bars).toHaveLength(3);
    expect(result.bars.map((b) => b.questionId)).toEqual(['q3', 'q4', 'q5']);
    expect(result.bars.map((b) => b.page)).toEqual([2, null, 3]);
    // 진행률: q3=60, q4=80, q5=100
    expect(result.bars.map((b) => b.cumulativeProgressPct)).toEqual([60, 80, 100]);
  });
});

describe('formatDropFunnel — stepId 키 귀속', () => {
  it('stepId를 id로 받아 막대를 만든다', () => {
    const out = formatDropFunnel({
      questions: [
        { id: 'group:root', position: 1, label: 'Q1', page: 1 },
        { id: 'table:abc', position: 2, label: 'Q2', page: 1 },
      ],
      counts: new Map([['table:abc', 3]]),
      legacyCount: 1,
      totalDrops: 4,
    });
    const bar = out.bars.find((b) => b.questionId === 'table:abc');
    expect(bar?.dropCount).toBe(3);
    expect(out.bars.some((b) => b.questionId === 'legacy')).toBe(true);
    expect(out.bars.find((b) => b.questionId === 'group:root')).toBeUndefined();
    expect(out.totalDrops).toBe(4);
  });
});
