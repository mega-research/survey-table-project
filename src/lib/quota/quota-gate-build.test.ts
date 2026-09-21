import { describe, expect, it } from 'vitest';

import type { QuotaConfig, QuotaDimension } from '@/shared/contracts/quota';

import { buildQuotaGate } from './quota-gate-build';

const attrDim: QuotaDimension = {
  id: 'd1',
  questionId: '',
  label: '산업 분야',
  kind: 'attr',
  attrKey: '산업 분야',
  categories: [],
};
const textDim: QuotaDimension = {
  id: 'd2',
  questionId: 'q1',
  label: '지역',
  kind: 'text',
  cellIds: ['sido', 'sigungu'],
  categories: [],
};
const choiceDim: QuotaDimension = {
  id: 'd3',
  questionId: 'q-gender',
  label: '성별',
  kind: 'choice',
  categories: [],
};

function plan(dimensions: QuotaDimension[], enabled = true): QuotaConfig {
  return { enabled, dimensions, cells: [], closedMessage: null };
}

describe('buildQuotaGate', () => {
  it('미설정·미집행이면 null', () => {
    expect(buildQuotaGate(null)).toBeNull();
    expect(buildQuotaGate(plan([choiceDim], false))).toBeNull();
  });
  it('옵션형은 문항만 싣는다 (기존 동작)', () => {
    expect(buildQuotaGate(plan([choiceDim]))).toEqual({ questionIds: ['q-gender'] });
  });
  it('속성형은 게이트 문항을 만들지 않고, 텍스트형은 대상 칸을 함께 싣는다', () => {
    expect(buildQuotaGate(plan([attrDim, textDim]))).toEqual({
      questionIds: ['q1'],
      cellIdsByQuestion: { q1: ['sido', 'sigungu'] },
    });
  });
  it('속성형만 있는 플랜은 문항 없이 확인한다', () => {
    expect(buildQuotaGate(plan([attrDim]))).toEqual({
      questionIds: [],
      checkWithoutQuestions: true,
    });
  });
});
