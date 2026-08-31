import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { resolveBulkChoices } from './bulk-choice';

const judgement = (id: string, extra: Partial<Question> = {}): Question =>
  ({
    id,
    type: 'radio',
    title: id,
    required: true,
    order: 0,
    options: [
      { id: `${id}-1`, value: '1', label: '필요함' },
      { id: `${id}-2`, value: '2', label: '필요하지 않음' },
      { id: `${id}-3`, value: '3', label: '의견', allowTextInput: true },
    ],
    ...extra,
  }) as Question;

describe('resolveBulkChoices', () => {
  it('선택지가 같은 판단 항목이 둘 이상이면 일괄 선택지를 낸다', () => {
    expect(resolveBulkChoices([judgement('a1'), judgement('a2')])).toEqual([
      { value: '1', label: '필요함' },
      { value: '2', label: '필요하지 않음' },
    ]);
  });

  it('기타입력 선택지(의견)는 일괄 대상에서 뺀다', () => {
    // 일괄로 고르면 서술이 비어 전부 미응답이 된다
    const choices = resolveBulkChoices([judgement('a1'), judgement('a2')]);
    expect(choices.map((c) => c.value)).not.toContain('3');
  });

  it('문항이 하나뿐이면 내지 않는다 — 일괄이 될 일이 없다', () => {
    expect(resolveBulkChoices([judgement('a1')])).toEqual([]);
  });

  it('선택지 값이 하나라도 다르면 내지 않는다', () => {
    const odd = judgement('a2', {
      options: [
        { id: 'x', value: '1', label: '필요함' },
        { id: 'y', value: '9', label: '보류' },
        { id: 'z', value: '3', label: '의견', allowTextInput: true },
      ],
    } as Partial<Question>);
    expect(resolveBulkChoices([judgement('a1'), odd])).toEqual([]);
  });

  it('단일선택이 아닌 문항이 섞이면 내지 않는다', () => {
    const scale = judgement('a2', { type: 'textarea', options: [] } as Partial<Question>);
    expect(resolveBulkChoices([judgement('a1'), scale])).toEqual([]);
  });

  it('선택지가 없는 문항이 섞이면 내지 않는다', () => {
    const empty = judgement('a2', { options: [] } as Partial<Question>);
    expect(resolveBulkChoices([judgement('a1'), empty])).toEqual([]);
  });
});
