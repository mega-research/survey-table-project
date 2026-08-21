import { describe, expect, it } from 'vitest';

import { buildRenderSteps, resolveRestoreStepIndex, stepIdOf } from '@/utils/group-ordering';
import type { Question } from '@/types/survey';

// ========================
// 재개 위치 해석 (응답 버전 이관, ADR-0014)
// ========================
// 답이 폐기·제거된 질문(affectedQuestionIds)이 있으면 그중 신버전에 실존하는
// 가장 앞 페이지로 재개 위치를 되돌린다 — 빈 답을 모른 채 제출하는 것을 막는다.
// 영향 질문이 없거나 전부 신버전에서 삭제됐으면 저장된 진행 위치 그대로다.

function q(id: string, pageBreakBefore = false): Question {
  return {
    id,
    type: 'text',
    title: id,
    required: false,
    order: 0,
    ...(pageBreakBefore ? { pageBreakBefore } : {}),
  } as Question;
}

// 3페이지 구성: [q1] [q2, q3] [q4]
const steps = buildRenderSteps([q('q1'), q('q2', true), q('q3'), q('q4', true)], []);

describe('resolveRestoreStepIndex', () => {
  it('영향 질문이 없으면 저장된 스텝 위치를 그대로 쓴다', () => {
    expect(resolveRestoreStepIndex(steps, stepIdOf(steps[2]!), [])).toBe(2);
  });

  it('영향 질문이 저장 위치보다 앞 페이지면 그 페이지로 되돌린다', () => {
    expect(resolveRestoreStepIndex(steps, stepIdOf(steps[2]!), ['q2'])).toBe(1);
  });

  it('영향 질문이 여럿이면 가장 앞 페이지를 고른다', () => {
    expect(resolveRestoreStepIndex(steps, stepIdOf(steps[2]!), ['q3', 'q1'])).toBe(0);
  });

  it('영향 질문이 저장 위치보다 뒤면 저장 위치를 유지한다 (앞으로 당기지 않는다)', () => {
    expect(resolveRestoreStepIndex(steps, stepIdOf(steps[0]!), ['q4'])).toBe(0);
  });

  it('영향 질문이 전부 신버전에서 삭제된 경우 저장 위치를 유지한다 — 다시 답할 대상이 없다', () => {
    expect(resolveRestoreStepIndex(steps, stepIdOf(steps[2]!), ['q-deleted'])).toBe(2);
  });

  it('저장 스텝이 신버전에 없으면(-1) 실존하는 영향 페이지로 간다', () => {
    expect(resolveRestoreStepIndex(steps, 'page:gone', ['q3'])).toBe(1);
  });

  it('저장 스텝도 없고 영향 질문도 없으면 -1 (호출자가 1페이지 시작으로 처리)', () => {
    expect(resolveRestoreStepIndex(steps, 'page:gone', [])).toBe(-1);
  });
});
