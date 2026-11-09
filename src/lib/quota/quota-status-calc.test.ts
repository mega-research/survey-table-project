import { describe, expect, it } from 'vitest';

import {
  buildQuotaStatus,
  buildShareQuotaStatus,
  quotaTone,
  summarizeShareQuota,
} from '@/lib/quota/quota-status-calc';
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

describe('buildShareQuotaStatus — 외주 링크의 쿼터 투영', () => {
  const male25 = { answers: { 'q-g': 'male', 'q-a': '25' }, attrs: null };
  const female63 = { answers: { 'q-g': 'female', 'q-a': '63' }, attrs: null };
  // 설문 전체: 남성·20대 2(목표 2 — 마감), 여성·60대 1(목표 4)
  const all = [male25, male25, female63];

  it('셀마다 내 달성 수와 마감 여부만 담고 목표·전체 달성 수 키가 없다', () => {
    const status = buildShareQuotaStatus(config, all, [male25]);
    expect(status.cells).toEqual([
      { categoryIds: ['c-m', 'c-20'], labels: ['남성', '20대'], mine: 1, closed: true },
      { categoryIds: ['c-f', 'c-60'], labels: ['여성', '60대 이상'], mine: 0, closed: false },
    ]);
    expect(Object.keys(status).sort()).toEqual(['cells', 'dimensions', 'enabled']);
  });

  it('마감은 설문 전체 기준 — 내 달성 수가 0 이어도 전체가 찼으면 마감이다', () => {
    const status = buildShareQuotaStatus(config, all, []);
    expect(status.cells.map((c) => [c.mine, c.closed])).toEqual([
      [0, true],
      [0, false],
    ]);
  });

  it('목표 0 인 셀은 응답이 없어도 마감이다 — 집행과 같은 술어', () => {
    const zero = normalizeQuotaConfig({
      ...config,
      cells: [{ categoryIds: ['c-m', 'c-20'], target: 0 }],
    })!;
    expect(buildShareQuotaStatus(zero, [], []).cells[0]!.closed).toBe(true);
  });

  it('요약은 내 달성 수 합(분류된 것만)과 마감 셀 수·셀 수다', () => {
    const unclassified = { answers: { 'q-g': 'other', 'q-a': '25' }, attrs: null };
    const status = buildShareQuotaStatus(config, all, [male25, female63, unclassified]);
    expect(summarizeShareQuota(status)).toEqual({ mineTotal: 2, closedCells: 1, totalCells: 2 });
  });
});
