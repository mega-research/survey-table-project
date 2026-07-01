import { describe, expect, it } from 'vitest';

import type { QuotaConfig } from '@/db/schema/schema-types';
import { buildQuotaStatus, quotaTone } from '@/lib/operations/quota-status';

const config: QuotaConfig = {
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
};

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
  ];
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
});
