import { describe, expect, it } from 'vitest';

import { collectPriorAnswerRetractions } from '@/lib/survey/prior-answer-prefill';
import type { Question } from '@/types/survey';

/**
 * 이월값 회수 — 조건이 참일 때 깔린 값을 조건이 거짓으로 뒤집히면 걷어낸다.
 *
 * 회수가 없으면 조건이 반쪽만 동작한다. "이직 안 함" 으로 작년 회사가 깔린 뒤 "이직함" 으로
 * 고쳐도 작년 회사가 그대로 제출된다 — 이 기능을 만든 이유가 바로 그 시나리오다.
 *
 * **프리필로 들어온 값만 회수한다.** 조건이 처음부터 거짓인 문항에 응답자가 직접 쓴 답을
 * 지우면 안 되고, 상태 기준으로 걸면 조건이 거짓인 동안 응답자가 새로 치는 값까지 매번
 * 지워 싸운다. 판정 근거는 둘이다.
 * - `prefilled` — 이 세션에서 프리필한 문항 id. 고쳤든 안 고쳤든 회수한다.
 * - 값이 이월값과 같음 — 재진입해 이력이 없을 때의 폴백. 손 안 댄 것만 회수한다.
 */
const MOVED = 'q-moved';
const EMPLOY = 'q-employment';

function employmentQuestion(): Question {
  return {
    id: EMPLOY,
    type: 'table',
    title: '취업 현황',
    required: false,
    order: 1,
    priorAnswerCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'c1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'value-match',
          sourceQuestionId: MOVED,
          requiredValues: ['no'],
        },
      ],
    },
  } as unknown as Question;
}

const movedQuestion = {
  id: MOVED,
  type: 'radio',
  title: '이직 여부',
  required: false,
  order: 0,
} as unknown as Question;

const prior = { [EMPLOY]: { company: 'SK텔레콤', joined: '2016' } };

describe('collectPriorAnswerRetractions', () => {
  const questions = [movedQuestion, employmentQuestion()];

  it('조건이 거짓으로 뒤집히면 이 세션에서 깐 값을 회수한다', () => {
    const out = collectPriorAnswerRetractions(
      questions,
      prior,
      { [MOVED]: 'yes', [EMPLOY]: { company: 'SK텔레콤', joined: '2016' } },
      questions,
      new Set([EMPLOY]),
    );
    expect(out).toEqual([EMPLOY]);
  });

  it('응답자가 고친 값도 회수한다 — 프리필 이력이 있으면 내용을 따지지 않는다', () => {
    const out = collectPriorAnswerRetractions(
      questions,
      prior,
      { [MOVED]: 'yes', [EMPLOY]: { company: '응답자가 고친 회사' } },
      questions,
      new Set([EMPLOY]),
    );
    expect(out).toEqual([EMPLOY]);
  });

  it('조건이 참이면 회수하지 않는다', () => {
    const out = collectPriorAnswerRetractions(
      questions,
      prior,
      { [MOVED]: 'no', [EMPLOY]: { company: 'SK텔레콤', joined: '2016' } },
      questions,
      new Set([EMPLOY]),
    );
    expect(out).toEqual([]);
  });

  it('프리필 이력이 없으면 값이 이월값과 같아도 회수하지 않는다', () => {
    // 상태 기준(값 일치)으로 걸면 응답자가 작년과 같은 보기를 고르는 순간 매 렌더
    // 지워져 컨트롤이 눌리지 않는 것처럼 보인다 — 조건을 늘 거짓으로 막아 둔 문항에서
    // 실제로 응답이 막혔다(2026-09-08 DQ7 매출액).
    const out = collectPriorAnswerRetractions(
      questions,
      prior,
      { [MOVED]: 'yes', [EMPLOY]: { company: 'SK텔레콤', joined: '2016' } },
      questions,
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it('조건이 처음부터 거짓이어도 응답자가 고른 값은 남는다', () => {
    const out = collectPriorAnswerRetractions(
      questions,
      prior,
      { [MOVED]: 'yes', [EMPLOY]: { company: 'SK텔레콤' } },
      questions,
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it('프리필 이력이 없고 값도 다르면 회수하지 않는다 — 응답자가 직접 쓴 답이다', () => {
    const out = collectPriorAnswerRetractions(
      questions,
      prior,
      { [MOVED]: 'yes', [EMPLOY]: { company: '응답자가 직접 쓴 회사' } },
      questions,
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it('조건이 없는 문항은 회수 대상이 아니다', () => {
    const { priorAnswerCondition: _drop, ...plain } = employmentQuestion();
    const out = collectPriorAnswerRetractions(
      [movedQuestion, plain],
      prior,
      { [MOVED]: 'yes', [EMPLOY]: { company: 'SK텔레콤', joined: '2016' } },
      [movedQuestion, plain],
      new Set([EMPLOY]),
    );
    expect(out).toEqual([]);
  });

  it('값이 없으면 회수할 것도 없다', () => {
    const out = collectPriorAnswerRetractions(
      questions,
      prior,
      { [MOVED]: 'yes' },
      questions,
      new Set([EMPLOY]),
    );
    expect(out).toEqual([]);
  });

  it('이월값이 없는 문항은 건드리지 않는다', () => {
    const out = collectPriorAnswerRetractions(
      questions,
      {},
      { [MOVED]: 'yes', [EMPLOY]: { company: '응답자 입력' } },
      questions,
      new Set([EMPLOY]),
    );
    expect(out).toEqual([]);
  });
});
