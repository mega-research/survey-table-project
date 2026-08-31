import { describe, expect, it } from 'vitest';

import {
  buildRenderSteps,
  isSplitStep,
  resolveSplitStartIndex,
  stepIdOf,
  type AnchorOwnerRef,
} from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

const G = (id: string, order: number, extra: Partial<QuestionGroup> = {}): QuestionGroup =>
  ({ id, surveyId: 's', name: id.toUpperCase(), order, ...extra }) as QuestionGroup;
const Q = (id: string, order: number, extra: Partial<Question> = {}): Question =>
  ({ id, type: 'radio', title: id.toUpperCase(), required: false, order, ...extra }) as Question;

const onQuestion = (id: string): AnchorOwnerRef => ({ ownerKind: 'question', ownerId: id });
const onGroup = (id: string): AnchorOwnerRef => ({ ownerKind: 'group', ownerId: id });

/** 인적사항 2쪽 뒤에 검토 2쪽 — 이 형식의 전형적 구성 */
function survey() {
  const groups = [G('intro', 0), G('review', 1)];
  const questions = [
    Q('name', 0, { groupId: 'intro' }),
    Q('org', 1, { groupId: 'intro', pageBreakBefore: true }),
    Q('a1', 2, { groupId: 'review', pageBreakBefore: true }),
    Q('a2', 3, { groupId: 'review', pageBreakBefore: true }),
  ];
  return { groups, questions, steps: buildRenderSteps(questions, groups) };
}

describe('resolveSplitStartIndex', () => {
  it('앵커가 하나도 없으면 분할 없음', () => {
    const { steps, groups } = survey();
    expect(resolveSplitStartIndex(steps, [], groups)).toBe(-1);
  });

  it('앵커를 가진 항목이 처음 나타나는 페이지가 시작점', () => {
    const { steps, groups } = survey();
    expect(resolveSplitStartIndex(steps, [onQuestion('a1')], groups)).toBe(2);
  });

  it('그룹에 붙은 앵커와 질문에 붙은 앵커가 똑같이 시작점을 만든다', () => {
    const { steps, groups } = survey();
    expect(resolveSplitStartIndex(steps, [onGroup('review')], groups)).toBe(2);
    expect(resolveSplitStartIndex(steps, [onQuestion('a1')], groups)).toBe(2);
  });

  it('여러 앵커 중 가장 앞선 것이 시작점', () => {
    const { steps, groups } = survey();
    expect(
      resolveSplitStartIndex(steps, [onQuestion('a2'), onQuestion('a1'), onGroup('review')], groups),
    ).toBe(2);
  });

  it('하위 그룹의 후손 질문도 상위 그룹 앵커에 걸린다', () => {
    const groups = [G('root', 0), G('child', 0, { parentGroupId: 'root' })];
    const questions = [Q('q1', 0, { groupId: 'child' })];
    const steps = buildRenderSteps(questions, groups);
    expect(resolveSplitStartIndex(steps, [onGroup('root')], groups)).toBe(0);
  });

  it('어디에도 걸리지 않는 앵커(지워진 대상)는 분할을 만들지 않는다', () => {
    const { steps, groups } = survey();
    expect(resolveSplitStartIndex(steps, [onQuestion('gone'), onGroup('gone')], groups)).toBe(-1);
  });

  it('그룹 사슬이 자기참조로 꼬여 있어도 멈춘다', () => {
    const groups = [G('g1', 0, { parentGroupId: 'g1' })];
    const questions = [Q('q1', 0, { groupId: 'g1' })];
    const steps = buildRenderSteps(questions, groups);
    expect(resolveSplitStartIndex(steps, [onGroup('없음')], groups)).toBe(-1);
  });

  describe('판정은 구조 기준 — 응답자의 답이 시작점을 흔들지 않는다', () => {
    it('조건부로 숨은 질문의 앵커도 센다', () => {
      // 조건부 표시는 스텝 구성에 관여하지 않는다. 그래서 앵커가 조건부 질문에만
      // 붙어 있어도 시작점이 나온다 — 응답자가 앞 답을 고쳐도 페이지 구성이 안 바뀐다.
      const groups = [G('intro', 0), G('review', 1)];
      const questions = [
        Q('name', 0, { groupId: 'intro' }),
        Q('hidden', 1, {
          groupId: 'review',
          pageBreakBefore: true,
          displayCondition: { logicType: 'AND', conditions: [] },
        }),
      ];
      const steps = buildRenderSteps(questions, groups);
      expect(resolveSplitStartIndex(steps, [onQuestion('hidden')], groups)).toBe(1);
    });

    it('같은 구조를 넘기는 한 조건이 어떻든 시작 인덱스가 같다', () => {
      const { steps, groups } = survey();
      const anchors = [onQuestion('a1')];
      const first = resolveSplitStartIndex(steps, anchors, groups);
      const again = resolveSplitStartIndex(buildRenderSteps(survey().questions, groups), anchors, groups);
      expect(again).toBe(first);
    });
  });
});

describe('isSplitStep — sticky', () => {
  it('시작 페이지 이후는 앵커 유무와 무관하게 전부 분할이다', () => {
    // 앵커 없는 마무리 페이지도 조사표를 계속 보면서 답한다
    expect(isSplitStep(2, 1)).toBe(false);
    expect(isSplitStep(2, 2)).toBe(true);
    expect(isSplitStep(2, 3)).toBe(true);
    expect(isSplitStep(2, 99)).toBe(true);
  });

  it('분할 없음(-1)이면 어느 페이지도 분할이 아니다', () => {
    expect(isSplitStep(-1, 0)).toBe(false);
    expect(isSplitStep(-1, 5)).toBe(false);
  });
});

describe('페이지 식별자 형식', () => {
  it('분할 파생이 얹혀도 stepId 는 page:<첫 질문 id> 그대로다', () => {
    // 운영 콘솔이 기록해 둔 기존 응답 데이터(current_step_id)와의 호환이 여기 걸려 있다
    const { steps } = survey();
    expect(steps.map(stepIdOf)).toEqual(['page:name', 'page:org', 'page:a1', 'page:a2']);
  });
});
