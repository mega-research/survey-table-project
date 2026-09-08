import { describe, expect, it } from 'vitest';

import {
  buildAdminRelaxWarningMessage,
  classifyStepIssues,
  isRelaxableIssueKind,
  snapshotStepResponses,
} from '@/lib/survey/admin-edit-required-relax';
import type { NumericIssue } from '@/lib/survey/numeric-validation';

describe('isRelaxableIssueKind', () => {
  it('required-cells/required-detail 는 완화 대상이다', () => {
    expect(isRelaxableIssueKind('required-cells')).toBe(true);
    expect(isRelaxableIssueKind('required-detail')).toBe(true);
  });

  it('format 도 완화 대상이다 — 외국 번호·대표번호 같은 정당한 예외를 담당자가 넣을 수 있어야 한다', () => {
    expect(isRelaxableIssueKind('format')).toBe(true);
  });

  it('range/sum/formula 는 차단형이라 완화 대상이 아니다', () => {
    expect(isRelaxableIssueKind('range')).toBe(false);
    expect(isRelaxableIssueKind('sum')).toBe(false);
    expect(isRelaxableIssueKind('formula')).toBe(false);
  });
});

describe('classifyStepIssues', () => {
  it('이슈가 전혀 없으면 차단 없음 + 완화 대상 0개', () => {
    expect(classifyStepIssues([], new Map())).toEqual({
      hasBlockingIssue: false,
      emptyRequiredCount: 0,
      formatCount: 0,
    });
  });

  it('필수 셀 누락만 있으면 차단 없음 + cellIds 개수만큼 완화 대상', () => {
    const issues: NumericIssue[] = [
      { kind: 'required-cells', message: 'm', cellIds: ['c1', 'c2'] },
    ];
    expect(classifyStepIssues([], new Map([['q-table', issues]]))).toEqual({
      hasBlockingIssue: false,
      emptyRequiredCount: 2,
      formatCount: 0,
    });
  });

  it('cellIds 가 없는 required-detail 이슈는 1개로 센다', () => {
    const issues: NumericIssue[] = [{ kind: 'required-detail', message: 'm' }];
    expect(classifyStepIssues([], new Map([['q1', issues]]))).toEqual({
      hasBlockingIssue: false,
      emptyRequiredCount: 1,
      formatCount: 0,
    });
  });

  it('서로 다른 질문의 미응답 개수와 셀 단위 누락을 합산한다', () => {
    const issues: NumericIssue[] = [{ kind: 'required-cells', message: 'm', cellIds: ['c1'] }];
    expect(classifyStepIssues(['q-a', 'q-b'], new Map([['q-table', issues]]))).toEqual({
      hasBlockingIssue: false,
      emptyRequiredCount: 3,
      formatCount: 0,
    });
  });

  it('같은 질문이 미응답 목록과 이슈 맵 양쪽에 잡혀도 이중 계산하지 않는다 (비-테이블 상세기입 누락 시나리오)', () => {
    // isQuestionAnswered 는 collectRequiredOptionTextIssues.questionMissing 을 이미 반영하므로
    // 상세기입이 빈 비-테이블 질문은 unansweredQuestionIds 와 numericIssuesByQuestion 양쪽에
    // 동시에 나타난다 — 실제로는 미응답 필수 "1개"일 뿐이다.
    const issues: NumericIssue[] = [{ kind: 'required-detail', message: 'm' }];
    expect(classifyStepIssues(['q-required'], new Map([['q-required', issues]]))).toEqual({
      hasBlockingIssue: false,
      emptyRequiredCount: 1,
      formatCount: 0,
    });
  });

  it('range/sum/formula 이슈가 하나라도 있으면 hasBlockingIssue=true (완화 대상 카운트와 무관하게 항상 차단)', () => {
    const issues: NumericIssue[] = [
      { kind: 'required-cells', message: 'm', cellIds: ['c1'] },
      { kind: 'range', message: '범위 위반', cellIds: ['c2'] },
    ];
    const result = classifyStepIssues([], new Map([['q-table', issues]]));
    expect(result.hasBlockingIssue).toBe(true);
    // 빈 필수 개수 자체는 여전히 계산되지만(참고용), 호출부는 hasBlockingIssue 우선 판단.
    expect(result.emptyRequiredCount).toBe(1);
  });

  it('sum/formula 도 차단형으로 분류한다', () => {
    expect(
      classifyStepIssues([], new Map([['q1', [{ kind: 'sum', message: 'm' } as NumericIssue]]]))
        .hasBlockingIssue,
    ).toBe(true);
    expect(
      classifyStepIssues([], new Map([['q1', [{ kind: 'formula', message: 'm' } as NumericIssue]]]))
        .hasBlockingIssue,
    ).toBe(true);
  });
});

describe('snapshotStepResponses', () => {
  it('같은 질문·값이면 순서와 무관하게 동일한 스냅샷을 반환한다', () => {
    const responses = { q1: 'a', q2: 'b' };
    expect(snapshotStepResponses(['q1', 'q2'], responses)).toBe(
      snapshotStepResponses(['q2', 'q1'], responses),
    );
  });

  it('값이 바뀌면 스냅샷도 달라진다', () => {
    const before = snapshotStepResponses(['q1'], { q1: 'a' });
    const after = snapshotStepResponses(['q1'], { q1: 'b' });
    expect(before).not.toBe(after);
  });

  it('질문 목록이 바뀌면(스텝 이동) 스냅샷도 달라진다', () => {
    const responses = { q1: 'a', q2: 'b' };
    const stepA = snapshotStepResponses(['q1'], responses);
    const stepB = snapshotStepResponses(['q2'], responses);
    expect(stepA).not.toBe(stepB);
  });

  it('테이블 응답(object)처럼 값이 객체여도 안정적으로 직렬화한다', () => {
    const responses = { q1: { c1: '1', c2: '2' } };
    expect(snapshotStepResponses(['q1'], responses)).toBe(
      snapshotStepResponses(['q1'], { q1: { c1: '1', c2: '2' } }),
    );
  });
});

describe('형식 이슈 완화', () => {
  it('형식 위반은 차단이 아니라 형식 카운트로 잡힌다', () => {
    const issues: NumericIssue[] = [
      { kind: 'format', message: '휴대전화 번호가 아닙니다' },
      { kind: 'format', message: '입력 형식이 맞지 않은 칸이 있습니다', cellIds: ['c1', 'c2'] },
    ];
    expect(classifyStepIssues([], new Map([['q1', issues]]))).toEqual({
      hasBlockingIssue: false,
      emptyRequiredCount: 0,
      formatCount: 3,
    });
  });

  it('미응답 질문에 형식 이슈가 함께 잡혀도 형식은 따로 센다', () => {
    // 빈 필수는 질문 단위 이중 계산을 피하지만, 형식은 값이 들어간 칸의 이야기라 별개다.
    const issues: NumericIssue[] = [{ kind: 'format', message: 'm' }];
    expect(classifyStepIssues(['q1'], new Map([['q1', issues]]))).toEqual({
      hasBlockingIssue: false,
      emptyRequiredCount: 1,
      formatCount: 1,
    });
  });
});

describe('buildAdminRelaxWarningMessage', () => {
  it('빈 필수만 있으면 종전 문구', () => {
    expect(buildAdminRelaxWarningMessage({ emptyRequiredCount: 3, formatCount: 0 })).toBe(
      "빈 필수 응답 3개 — '다음 →' 한 번 더 누르면 그대로 넘어갑니다",
    );
  });

  it('형식 불일치만 있으면 형식 문구', () => {
    expect(buildAdminRelaxWarningMessage({ emptyRequiredCount: 0, formatCount: 2 })).toBe(
      "형식이 맞지 않는 값 2개 — '다음 →' 한 번 더 누르면 그대로 넘어갑니다",
    );
  });

  it('둘 다 있으면 함께 말한다', () => {
    expect(buildAdminRelaxWarningMessage({ emptyRequiredCount: 1, formatCount: 2 })).toBe(
      "빈 필수 응답 1개 · 형식이 맞지 않는 값 2개 — '다음 →' 한 번 더 누르면 그대로 넘어갑니다",
    );
  });
});
