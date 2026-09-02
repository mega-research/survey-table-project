import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { resolveJudgementBulkChoices, resolveJudgementShape } from './judgement-item';

/** 판단 항목 — 선택지 값은 문항마다 따로 발번된다는 실제 조건을 반영한다. */
const judgement = (id: string, extra: Partial<Question> = {}): Question =>
  ({
    id,
    type: 'radio',
    title: id,
    required: true,
    order: 0,
    options: [
      { id: `${id}-need`, value: `${id}_1`, label: '필요함' },
      { id: `${id}-drop`, value: `${id}_2`, label: '필요하지 않음' },
      { id: `${id}-op`, value: `${id}_3`, label: '의견 (자유기재)', allowTextInput: true },
    ],
    ...extra,
  }) as Question;

describe('resolveJudgementShape', () => {
  it('선택지 셋 중 하나가 기타입력인 단일선택을 판단 항목으로 본다', () => {
    expect(resolveJudgementShape(judgement('a1'))).toEqual({
      needValue: 'a1_1',
      dropValue: 'a1_2',
      opinionValue: 'a1_3',
      opinionOptionId: 'a1-op',
    });
  });

  it('부정 선택지를 먼저 배치해도 필요/불필요가 뒤집히지 않는다', () => {
    const q = judgement('a1', {
      options: [
        { id: 'x', value: '2', label: '필요하지 않음' },
        { id: 'y', value: '1', label: '필요함' },
        { id: 'z', value: '3', label: '의견', allowTextInput: true },
      ],
    } as Partial<Question>);
    expect(resolveJudgementShape(q)).toMatchObject({ needValue: '1', dropValue: '2' });
  });

  it('어느 쪽이 필요함인지 가릴 수 없으면 판단 항목이 아니다', () => {
    const q = judgement('a1', {
      options: [
        { id: 'x', value: '1', label: '유지' },
        { id: 'y', value: '2', label: '삭제' },
        { id: 'z', value: '3', label: '의견', allowTextInput: true },
      ],
    } as Partial<Question>);
    expect(resolveJudgementShape(q)).toBeNull();
  });

  it('장문형은 판단 항목이 아니다', () => {
    expect(
      resolveJudgementShape({ id: 'z', type: 'textarea', title: 'z', required: false, order: 0 } as Question),
    ).toBeNull();
  });
});

describe('resolveJudgementBulkChoices', () => {
  it('선택지 값이 문항마다 달라도 일괄 선택을 낸다', () => {
    // 값이 같아야 한다는 규칙이었을 때는 실제 데이터에서 버튼이 아예 나오지 않았다 —
    // 선택지 값은 문항별로 발번되기 때문이다.
    const choices = resolveJudgementBulkChoices([judgement('sq1'), judgement('sq2')]);
    expect(choices.map((c) => c.key)).toEqual(['need', 'drop']);
    expect(choices[0]?.label).toBe('필요함');
    expect(choices[1]?.label).toBe('필요하지 않음');
  });

  it('문항마다 **자기 값**을 담는다 — 옆 문항 값을 쓰면 보이지 않는 오답이 된다', () => {
    const choices = resolveJudgementBulkChoices([judgement('sq1'), judgement('sq2')]);
    expect(choices[0]?.valueByQuestionId).toEqual({ sq1: 'sq1_1', sq2: 'sq2_1' });
    expect(choices[1]?.valueByQuestionId).toEqual({ sq1: 'sq1_2', sq2: 'sq2_2' });
  });

  it('의견은 일괄 대상이 아니다 — 서술이 비면 전부 미응답이 된다', () => {
    const choices = resolveJudgementBulkChoices([judgement('sq1'), judgement('sq2')]);
    for (const choice of choices) {
      expect(Object.values(choice.valueByQuestionId)).not.toContain('sq1_3');
    }
  });

  it('판단 항목이 하나뿐이면 내지 않는다', () => {
    expect(resolveJudgementBulkChoices([judgement('sq1')])).toEqual([]);
  });

  it('판단 항목이 아닌 문항은 세지 않고, 남은 것이 하나면 내지 않는다', () => {
    const free = { id: 'z', type: 'textarea', title: 'z', required: false, order: 0 } as Question;
    expect(resolveJudgementBulkChoices([judgement('sq1'), free])).toEqual([]);
  });

  it('섞여 있어도 판단 항목만 대상으로 삼는다', () => {
    const free = { id: 'z', type: 'textarea', title: 'z', required: false, order: 0 } as Question;
    const choices = resolveJudgementBulkChoices([judgement('sq1'), free, judgement('sq2')]);
    expect(Object.keys(choices[0]?.valueByQuestionId ?? {})).toEqual(['sq1', 'sq2']);
  });
});
