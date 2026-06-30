import { describe, expect, it } from 'vitest';

import { buildRenderSteps } from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

function q(id: string, groupId: string, order: number): Question {
  return { id, type: 'text', title: id, required: false, order, groupId } as Question;
}

describe('buildRenderSteps 루트 그룹 디자인 전달', () => {
  it('루트 그룹의 nameDesign 을 step 항목에 싣는다', () => {
    const groups: QuestionGroup[] = [
      {
        id: 'g1',
        surveyId: 's',
        name: 'G1',
        order: 0,
        nameDesign: { fullWidth: true, bgColor: '#123456', textColor: '#ffffff' },
      },
    ];
    const steps = buildRenderSteps([q('q1', 'g1', 0)], groups);
    // 신모델: step.items[0] 에서 그룹 컨텍스트를 읽는다
    const step = steps.find((s) => s.items.some((it) => it.rootGroupId === 'g1'))!;
    expect(step.items[0]!.rootGroupNameDesign).toEqual({
      fullWidth: true,
      bgColor: '#123456',
      textColor: '#ffffff',
    });
  });

  it('hideName 그룹은 이름과 디자인을 노출하지 않는다', () => {
    const groups: QuestionGroup[] = [
      { id: 'g1', surveyId: 's', name: 'G1', order: 0, hideName: true, nameDesign: { bgColor: '#123456' } },
    ];
    const steps = buildRenderSteps([q('q1', 'g1', 0)], groups);
    // 신모델: step.items[0] 에서 그룹 컨텍스트를 읽는다
    const step = steps.find((s) => s.items.some((it) => it.rootGroupId === 'g1'))!;
    expect(step.items[0]!.rootGroupName).toBeNull();
    expect(step.items[0]!.rootGroupNameDesign).toBeUndefined();
  });

  it('ungrouped step 에는 디자인이 없다', () => {
    const steps = buildRenderSteps([q('q1', '', 0)], []);
    // ungrouped 항목: rootGroupId === null
    expect(steps[0]!.items[0]!.rootGroupNameDesign).toBeUndefined();
  });
});
