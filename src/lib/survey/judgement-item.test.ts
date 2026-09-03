import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import {
  OPINION_CODE_SUFFIX,
  resolveJudgementBulkChoices,
  resolveJudgementShape,
  resolveOpinionPairs,
} from './judgement-item';

/** 판단 항목 — 필요함 / 필요하지 않음. 선택지 값은 문항마다 따로 발번된다. */
const judgement = (id: string, extra: Partial<Question> = {}): Question =>
  ({
    id,
    type: 'radio',
    title: id,
    questionCode: id.toUpperCase(),
    required: true,
    order: 0,
    options: [
      { id: `${id}-need`, value: `${id}_1`, label: '필요함' },
      { id: `${id}-drop`, value: `${id}_2`, label: '필요하지 않음' },
    ],
    ...extra,
  }) as Question;

/** 문항 의견 — 부모 코드 + _T 장문형. */
const opinion = (parentId: string, extra: Partial<Question> = {}): Question =>
  ({
    id: `${parentId}-op`,
    type: 'textarea',
    title: `${parentId} 의견`,
    questionCode: `${parentId.toUpperCase()}${OPINION_CODE_SUFFIX}`,
    required: false,
    order: 0,
    ...extra,
  }) as Question;

describe('resolveJudgementShape', () => {
  it('필요함 / 필요하지 않음 2지선다를 판단 항목으로 본다', () => {
    expect(resolveJudgementShape(judgement('a1'))).toEqual({
      needValue: 'a1_1',
      dropValue: 'a1_2',
    });
  });

  it('부정 선택지를 먼저 배치해도 필요/불필요가 뒤집히지 않는다', () => {
    const q = judgement('a1', {
      options: [
        { id: 'x', value: '2', label: '필요하지 않음' },
        { id: 'y', value: '1', label: '필요함' },
      ],
    } as Partial<Question>);
    expect(resolveJudgementShape(q)).toEqual({ needValue: '1', dropValue: '2' });
  });

  it('어느 쪽이 필요함인지 가릴 수 없으면 판단 항목이 아니다', () => {
    const q = judgement('a1', {
      options: [
        { id: 'x', value: '1', label: '유지' },
        { id: 'y', value: '2', label: '삭제' },
      ],
    } as Partial<Question>);
    expect(resolveJudgementShape(q)).toBeNull();
  });

  it('옛 3지선다(의견 선택지 포함)는 더 이상 판단 항목이 아니다', () => {
    // 의견은 판정값이 아니라 짝 문항이다(ADR 0022). 옛 모양을 계속 받아 주면
    // 이전이 덜 된 설문이 조용히 옛 규칙(의견이 분모에 들어감)으로 집계된다.
    const q = judgement('a1', {
      options: [
        { id: 'x', value: '1', label: '필요함' },
        { id: 'y', value: '2', label: '필요하지 않음' },
        { id: 'z', value: '3', label: '의견', allowTextInput: true },
      ],
    } as Partial<Question>);
    expect(resolveJudgementShape(q)).toBeNull();
  });

  it('선택지에 기타입력이 있으면 판단 항목이 아니다', () => {
    const q = judgement('a1', {
      options: [
        { id: 'x', value: '1', label: '필요함', allowTextInput: true },
        { id: 'y', value: '2', label: '필요하지 않음' },
      ],
    } as Partial<Question>);
    expect(resolveJudgementShape(q)).toBeNull();
  });

  it('장문형은 판단 항목이 아니다', () => {
    expect(resolveJudgementShape(opinion('a1'))).toBeNull();
  });
});

describe('resolveOpinionPairs', () => {
  it('부모 바로 뒤의 _T 장문형을 의견 짝으로 잇는다', () => {
    const pairs = resolveOpinionPairs([judgement('a1'), opinion('a1'), judgement('a2')]);
    expect(pairs.opinionOf.get('a1')?.id).toBe('a1-op');
    expect(pairs.opinionOf.has('a2')).toBe(false);
    expect(pairs.opinionIds).toEqual(new Set(['a1-op']));
  });

  it('코드가 맞아도 바로 뒤가 아니면 짝이 아니다', () => {
    // 순서만 보면 우연히 뒤에 온 서술 문항을 의견으로 오인하고, 코드만 보면
    // 관리자가 순서를 옮겼을 때 다른 행에 붙어 그려진다. 둘 다 맞아야 짝이다.
    const pairs = resolveOpinionPairs([judgement('a1'), judgement('a2'), opinion('a1')]);
    expect(pairs.opinionOf.has('a1')).toBe(false);
    expect(pairs.opinionIds.size).toBe(0);
  });

  it('바로 뒤라도 코드가 부모_T 가 아니면 짝이 아니다', () => {
    const stray = opinion('a1', { questionCode: 'MEMO' });
    const pairs = resolveOpinionPairs([judgement('a1'), stray]);
    expect(pairs.opinionOf.has('a1')).toBe(false);
  });

  it('코드는 대소문자·공백을 무시하지 않는다 — 규약은 글자 그대로다', () => {
    const lower = opinion('a1', { questionCode: 'a1_t' });
    expect(resolveOpinionPairs([judgement('a1'), lower]).opinionOf.has('a1')).toBe(false);
  });

  it('장문형이 아니면 짝이 아니다', () => {
    const text = opinion('a1', { type: 'text' });
    expect(resolveOpinionPairs([judgement('a1'), text]).opinionOf.has('a1')).toBe(false);
  });

  it('판단 항목이 아닌 문항 뒤의 _T 는 짝이 아니다', () => {
    const notice = { id: 'n', type: 'notice', title: 'n', questionCode: 'N', order: 0 } as Question;
    const pairs = resolveOpinionPairs([notice, opinion('n')]);
    expect(pairs.opinionIds.size).toBe(0);
  });

  it('부모 코드가 비어 있으면 짝을 만들지 않는다', () => {
    // 빈 코드 + _T === '_T' 인 문항이 우연히 뒤에 오면 짝이 되어 버린다.
    const parent = judgement('a1', { questionCode: '' });
    const child = opinion('a1', { questionCode: OPINION_CODE_SUFFIX });
    expect(resolveOpinionPairs([parent, child]).opinionIds.size).toBe(0);
  });
});

describe('resolveJudgementBulkChoices', () => {
  it('선택지 값이 문항마다 달라도 일괄 선택을 낸다', () => {
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

  it('의견 짝 문항은 일괄 대상이 아니다', () => {
    const choices = resolveJudgementBulkChoices([
      judgement('sq1'),
      opinion('sq1'),
      judgement('sq2'),
      opinion('sq2'),
    ]);
    expect(Object.keys(choices[0]?.valueByQuestionId ?? {})).toEqual(['sq1', 'sq2']);
  });

  it('판단 항목이 하나뿐이면 내지 않는다', () => {
    expect(resolveJudgementBulkChoices([judgement('sq1')])).toEqual([]);
  });

  it('판단 항목이 아닌 문항은 세지 않고, 남은 것이 하나면 내지 않는다', () => {
    const free = { id: 'z', type: 'textarea', title: 'z', required: false, order: 0 } as Question;
    expect(resolveJudgementBulkChoices([judgement('sq1'), free])).toEqual([]);
  });
});
