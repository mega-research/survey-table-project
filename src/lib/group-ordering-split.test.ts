import { describe, expect, it } from 'vitest';

import {
  buildRenderSteps,
  resolveSplitSteps,
  stepIdOf,
  type AnchorOwnerRef,
  type RenderStep,
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

describe('resolveSplitSteps — 페이지마다 따로 판정한다', () => {
  it('앵커가 하나도 없으면 어느 페이지도 분할이 아니다', () => {
    const { steps, groups } = survey();
    expect(resolveSplitSteps(steps, [], groups)).toEqual([false, false, false, false]);
  });

  it('앵커 걸린 항목을 담은 페이지만 분할이다', () => {
    const { steps, groups } = survey();
    expect(resolveSplitSteps(steps, [onQuestion('a1')], groups)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('조사표에 등록되지 않은 페이지는 앞뒤 어디에 있든 일반 문항 페이지다', () => {
    // 앞의 인적사항만이 아니라 **사이와 뒤**도 일반이다. 조사표에 없는 문항을
    // 좁은 오른쪽 판에 밀어 넣으면 일반 문항이 조사표 판단 항목처럼 보인다.
    const groups = [G('intro', 0), G('review', 1), G('closing', 2)];
    const questions = [
      Q('notice', 0, { groupId: 'intro' }),
      Q('a1', 1, { groupId: 'review', pageBreakBefore: true }),
      Q('note', 2, { groupId: 'closing', pageBreakBefore: true }),
      Q('a2', 3, { groupId: 'review', pageBreakBefore: true }),
      Q('thanks', 4, { groupId: 'closing', pageBreakBefore: true }),
    ];
    const steps = buildRenderSteps(questions, groups);
    const anchored = resolveSplitSteps(steps, [onQuestion('a1'), onQuestion('a2')], groups);
    const idOf = steps.map(stepIdOf);
    const splitIds = idOf.filter((_, i) => anchored[i]);
    expect(splitIds).toEqual(['page:a1', 'page:a2']);
  });

  it('그룹에 붙은 앵커는 그 그룹의 후손 질문이 있는 페이지를 분할로 만든다', () => {
    const { steps, groups } = survey();
    expect(resolveSplitSteps(steps, [onGroup('review')], groups)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('하위 그룹의 후손 질문도 상위 그룹 앵커에 걸린다', () => {
    const groups = [G('root', 0), G('child', 0, { parentGroupId: 'root' })];
    const questions = [Q('q1', 0, { groupId: 'child' })];
    const steps = buildRenderSteps(questions, groups);
    expect(resolveSplitSteps(steps, [onGroup('root')], groups)).toEqual([true]);
  });

  it('어디에도 걸리지 않는 앵커(지워진 대상)는 분할을 만들지 않는다', () => {
    const { steps, groups } = survey();
    expect(resolveSplitSteps(steps, [onQuestion('gone'), onGroup('gone')], groups)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('그룹 사슬이 순환으로 꼬여 있어도 멈춘다', () => {
    // buildRenderSteps 는 순환 그룹을 아예 최상위로 치지 않아 스텝이 비므로,
    // 사슬 추적이 실제로 도는지 보려면 스텝을 손으로 세워야 한다.
    const groups = [G('a', 0, { parentGroupId: 'b' }), G('b', 0, { parentGroupId: 'a' })];
    const steps: RenderStep[] = [
      {
        kind: 'page',
        items: [
          {
            question: Q('q1', 0, { groupId: 'a' }),
            rootGroupId: 'a',
            rootGroupName: 'A',
            subgroupName: null,
          },
        ],
      },
    ];
    expect(resolveSplitSteps(steps, [onGroup('없음')], groups)).toEqual([false]);
    // 순환 안의 그룹에 앵커가 있으면 걸린다 — 멈추기만 하고 못 찾는 것이 아니다.
    expect(resolveSplitSteps(steps, [onGroup('b')], groups)).toEqual([true]);
  });

  describe('판정은 구조 기준 — 응답자의 답이 레이아웃을 흔들지 않는다', () => {
    it('조건부로 숨은 질문의 앵커도 센다', () => {
      // 조건부 표시는 스텝 구성에 관여하지 않는다. 앵커가 조건부 질문에만 붙어
      // 있어도 그 페이지는 분할이다 — 응답자가 앞 답을 고쳐도 판이 접혔다 펴지지 않는다.
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
      expect(resolveSplitSteps(steps, [onQuestion('hidden')], groups)).toEqual([false, true]);
    });

    it('같은 구조를 넘기는 한 조건이 어떻든 판정이 같다', () => {
      const { steps, groups } = survey();
      const anchors = [onQuestion('a1')];
      const first = resolveSplitSteps(steps, anchors, groups);
      const again = resolveSplitSteps(buildRenderSteps(survey().questions, groups), anchors, groups);
      expect(again).toEqual(first);
    });
  });
});

describe('페이지 식별자 형식', () => {
  it('분할 파생이 얹혀도 stepId 는 page:<첫 질문 id> 그대로다', () => {
    // 운영 콘솔이 기록해 둔 기존 응답 데이터(current_step_id)와의 호환이 여기 걸려 있다
    const { steps } = survey();
    expect(steps.map(stepIdOf)).toEqual(['page:name', 'page:org', 'page:a1', 'page:a2']);
  });
});
