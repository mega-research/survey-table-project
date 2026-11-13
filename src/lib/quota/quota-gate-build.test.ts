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
  describe('진행 중 마감', () => {
    it('집행 중 + 옵션 켜짐이면 페이지마다 재확인 표식을 싣는다', () => {
      expect(buildQuotaGate({ ...plan([choiceDim]), midSurveyClose: true })).toEqual({
        questionIds: ['q-gender'],
        recheckOnEachStep: true,
      });
    });
    it('옵션이 부재·꺼짐인 기존 플랜은 표식이 없다', () => {
      expect(buildQuotaGate(plan([choiceDim]))).not.toHaveProperty('recheckOnEachStep');
      expect(buildQuotaGate({ ...plan([choiceDim]), midSurveyClose: false })).not.toHaveProperty(
        'recheckOnEachStep',
      );
    });
    it('집행 꺼짐 + 옵션 켜짐이면 게이트 자체가 null 이다', () => {
      expect(buildQuotaGate({ ...plan([choiceDim], false), midSurveyClose: true })).toBeNull();
    });
  });
  // ── 「완료」 조건 (CONTEXT.md 「완료 조건」) ──
  it('「완료」 조건만 있는 플랜은 기다릴 문항이 없어 첫 전환에서 확인한다', () => {
    expect(buildQuotaGate({ ...plan([]), totalTarget: 1100 })).toEqual({
      questionIds: [],
      checkWithoutQuestions: true,
    });
  });

  it('조건이 하나도 없는 집행 플랜은 확인을 발동하지 않는다 — 「완료」 조건이 없으면 종전과 같다', () => {
    expect(buildQuotaGate(plan([]))).toEqual({ questionIds: [] });
    expect(buildQuotaGate({ ...plan([]), totalTarget: null })).toEqual({ questionIds: [] });
  });

  it('문항 조건과 함께 있으면 그 문항에 답했을 때 함께 판정한다', () => {
    const gate = buildQuotaGate({ ...plan([choiceDim]), totalTarget: 1100 });
    expect(gate?.questionIds).toEqual(['q-gender']);
    expect(gate?.checkWithoutQuestions).toBeUndefined();
  });

  it('진행 중 마감이 켜지면 「완료」 조건만 있는 플랜도 페이지마다 재확인한다', () => {
    expect(
      buildQuotaGate({ ...plan([]), totalTarget: 1100, midSurveyClose: true }),
    ).toMatchObject({ checkWithoutQuestions: true, recheckOnEachStep: true });
  });

  it('집행이 꺼진 플랜은 「완료」 조건이 있어도 게이트가 없다 — 다른 조건과 같은 스위치를 따른다', () => {
    expect(buildQuotaGate({ ...plan([], false), totalTarget: 1100 })).toBeNull();
  });
});
