import { describe, expect, it } from 'vitest';

import { buildQuotaStatus, quotaTone } from '@/lib/quota/quota-status-calc';
import { normalizeQuotaConfig } from '@/lib/quota/normalize';

// 프로덕션과 같은 입구를 거친다 — 정규화가 쿼터 플랜의 유일한 생산자다.
const config = normalizeQuotaConfig({
  enabled: true,
  dimensions: [
    {
      id: 'd-g',
      questionId: 'q-g',
      label: '성별',
      kind: 'choice',
      categories: [
        { id: 'c-m', label: '남성', values: ['male'] },
        { id: 'c-f', label: '여성', values: ['female'] },
      ],
    },
    {
      id: 'd-a',
      questionId: 'q-a',
      label: '연령',
      kind: 'numeric',
      categories: [
        { id: 'c-20', label: '20대', min: 20, max: 30 },
        { id: 'c-60', label: '60대 이상', min: 60, max: null },
      ],
    },
  ],
  cells: [
    { categoryIds: ['c-m', 'c-20'], target: 2 },
    { categoryIds: ['c-f', 'c-60'], target: 4 },
  ],
  closedMessage: null,
})!;

describe('quotaTone', () => {
  it('100% 이상 done', () => expect(quotaTone(4, 4)).toBe('done'));
  it('70% 이상 good', () => expect(quotaTone(3, 4)).toBe('good'));
  it('40~69% warn', () => expect(quotaTone(2, 4)).toBe('warn'));
  it('40% 미만 low', () => expect(quotaTone(1, 4)).toBe('low'));
  it('target 0 은 done', () => expect(quotaTone(0, 0)).toBe('done'));
});

describe('buildQuotaStatus', () => {
  const answersList = [
    { 'q-g': 'male', 'q-a': '25' }, // c-m,c-20
    { 'q-g': 'male', 'q-a': '25' }, // c-m,c-20  (2 → target 2 마감)
    { 'q-g': 'female', 'q-a': '63' }, // c-f,c-60
    { 'q-g': 'other', 'q-a': '63' }, // 미분류
  ].map((answers) => ({ answers, attrs: null }));
  it('셀별 current/target/pct/tone/labels', () => {
    const status = buildQuotaStatus(config, answersList);
    const mCell = status.cells.find((c) => c.categoryIds.join() === 'c-m,c-20')!;
    expect(mCell.current).toBe(2);
    expect(mCell.target).toBe(2);
    expect(mCell.pct).toBe(100);
    expect(mCell.tone).toBe('done');
    expect(mCell.labels).toEqual(['남성', '20대']);
    const fCell = status.cells.find((c) => c.categoryIds.join() === 'c-f,c-60')!;
    expect(fCell.current).toBe(1);
    expect(fCell.tone).toBe('low'); // 1/4 = 25%
  });
  it('summary: 목표합/현재합(분류분)/마감셀수', () => {
    const { summary } = buildQuotaStatus(config, answersList);
    expect(summary.targetTotal).toBe(6);
    expect(summary.currentTotal).toBe(3); // 미분류 1 제외
    expect(summary.pct).toBe(50);
    expect(summary.closedCells).toBe(1);
    expect(summary.totalCells).toBe(2);
  });
  it('summary.unclassified: 카테고리를 못 얻은 완료 수 — 목표 없는 셀에 분류된 응답은 세지 않는다', () => {
    const sparse = { answers: { 'q-g': 'female', 'q-a': '25' }, attrs: null }; // 분류는 되나 목표 없는 셀
    const { summary } = buildQuotaStatus(config, [...answersList, sparse]);
    expect(summary.unclassified).toBe(1);
  });
});

describe('buildQuotaStatus — 「완료」 조건', () => {
  const totalOnly = normalizeQuotaConfig({
    enabled: true,
    dimensions: [],
    cells: [],
    totalTarget: 1100,
    closedMessage: null,
  })!;

  it('서버가 센 전체 완료 수(완료 + 실사 완료 처리)로 달성률을 낸다', () => {
    const status = buildQuotaStatus(totalOnly, [], 886);
    expect(status.summary.total).toEqual({ target: 1100, current: 886, pct: 81, tone: 'good' });
    // 셀이 없는 플랜이다 — 셀 요약은 0 이다.
    expect(status.cells).toEqual([]);
    expect(status.summary.totalCells).toBe(0);
  });

  it('목표에 닿으면 마감 톤이다', () => {
    expect(buildQuotaStatus(totalOnly, [], 1100).summary.total).toMatchObject({ pct: 100, tone: 'done' });
    expect(buildQuotaStatus(totalOnly, [], 1103).summary.total).toMatchObject({ tone: 'done' });
  });

  it('조건이 없는 플랜은 total 이 null 이다 — 넘긴 수를 쓰지 않는다', () => {
    expect(buildQuotaStatus(config, [], 500).summary.total).toBeNull();
  });

  it('셀 목표와 함께 있으면 둘 다 낸다', () => {
    const both = normalizeQuotaConfig({ ...config, totalTarget: 10 })!;
    const status = buildQuotaStatus(both, [{ answers: { 'q-g': 'male', 'q-a': '25' }, attrs: null }], 3);
    expect(status.summary.total).toMatchObject({ target: 10, current: 3 });
    expect(status.summary.currentTotal).toBe(1);
  });
});
