import { describe, expect, it } from 'vitest';

import {
  collectRequiredOptionTextIssues,
  resolveEffectiveOptionTextsByQuestion,
} from '@/lib/survey/required-option-text-validation';
import type { Question } from '@/types/survey';

/**
 * 수요조사의 판단 항목은 **전용 질문 유형이 아니다** — 평범한 radio 다.
 * 선택지는 필요함 / 필요하지 않음 / 의견이고, '의견'만 기타입력을 켠 옵션이다.
 *
 * 이 파일은 새 코드를 재지 않는다. "이 형식을 위해 신설한 것이 없다"는 결정이
 * 기존 검증으로 실제로 성립하는지를 붙잡는다 — 나중에 전용 유형을 만들고 싶어질 때
 * 여기가 먼저 깨지지 않으면 그 유혹을 막을 근거가 없다.
 */
function judgementQuestion(): Question {
  return {
    id: 'a7',
    type: 'radio',
    title: 'A7 대표자 학력',
    required: true,
    order: 0,
    questionCode: 'A7',
    allowOtherOption: false,
    options: [
      { id: 'need', value: '1', label: '필요함' },
      { id: 'drop', value: '2', label: '필요하지 않음' },
      { id: 'opinion', value: '3', label: '의견', allowTextInput: true },
    ],
  } as Question;
}

const question = judgementQuestion();

/** 사이드카에 담긴 의견 텍스트를 검증 뷰로 접는다. */
function issuesFor(answer: string, opinionText: string | undefined) {
  const responses: Record<string, unknown> = { [question.id]: answer };
  const optionTexts = resolveEffectiveOptionTextsByQuestion(
    responses,
    opinionText === undefined ? {} : { [question.id]: { opinion: opinionText } },
  );
  return collectRequiredOptionTextIssues(question, responses, optionTexts[question.id] ?? {});
}

describe('판단 항목은 평범한 radio 다', () => {
  it('필요함을 고르면 그것으로 답이 된다', () => {
    expect(issuesFor('1', undefined).questionMissing).toBe(false);
  });

  it('필요하지 않음도 마찬가지다', () => {
    expect(issuesFor('2', undefined).questionMissing).toBe(false);
  });

  it('의견을 고르고 서술을 적으면 답이 된다', () => {
    expect(issuesFor('3', '문항 취지가 B4 와 겹칩니다').questionMissing).toBe(false);
  });

  it('의견을 골라놓고 서술이 비면 답으로 치지 않는다', () => {
    // 빈 의견은 판단이 아니다 — 이 규칙이 없으면 n=5 집계에 빈 칸이 섞인다
    expect(issuesFor('3', '').questionMissing).toBe(true);
    expect(issuesFor('3', '   ').questionMissing).toBe(true);
    expect(issuesFor('3', undefined).questionMissing).toBe(true);
  });
});

describe('의견 텍스트는 옵션 텍스트 사이드카에 산다', () => {
  it('사이드카 키는 실존 질문 id 가 아니라 예약 키다', () => {
    // 집계·검증·필터가 질문 id 로 순회하면 이 값을 조용히 건너뛰거나 예외를 던진다.
    // 새 경로마다 한 번 분기해야 한다는 사실을 여기 박아 둔다.
    const responses = { [question.id]: '3', __optTexts__: { [question.id]: { opinion: '겹침' } } };
    const resolved = resolveEffectiveOptionTextsByQuestion(responses, {});
    expect(resolved[question.id]).toEqual({ opinion: '겹침' });
    expect(Object.keys(responses)).toContain('__optTexts__');
  });

  it('편집 중인 빈 값은 저장값을 이긴다 — 지우면 답이 풀린다', () => {
    const responses = { [question.id]: '3', __optTexts__: { [question.id]: { opinion: '겹침' } } };
    const resolved = resolveEffectiveOptionTextsByQuestion(responses, {
      [question.id]: { opinion: '' },
    });
    expect(resolved[question.id]).toEqual({ opinion: '' });
    expect(
      collectRequiredOptionTextIssues(question, responses, resolved[question.id] ?? {})
        .questionMissing,
    ).toBe(true);
  });
});
