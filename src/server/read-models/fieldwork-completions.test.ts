import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));

import { positiveCodePairs } from './fieldwork-completions';

describe('positiveCodePairs', () => {
  it('저장된 결과코드에서 positive 만 설문 id 와 짝짓는다', () => {
    expect(
      positiveCodePairs([
        {
          id: 's1',
          codes: [
            { code: '1.조사완료', label: '조사완료', order: 1, status: 'positive' },
            { code: '9.FAX 회수', label: 'FAX', order: 1, status: 'positive' },
            { code: '2.거절', label: '거절', order: 1, status: 'negative' },
          ],
        },
      ]),
    ).toEqual([
      ['s1', '1.조사완료'],
      ['s1', '9.FAX 회수'],
    ]);
  });

  it('결과코드를 저장하지 않은 설문은 기본 코드셋의 1.조사완료 를 쓴다', () => {
    expect(positiveCodePairs([{ id: 's2', codes: null }])).toEqual([['s2', '1.조사완료']]);
  });

  it('positive 코드가 하나도 없는 설문은 짝을 내지 않는다', () => {
    expect(
      positiveCodePairs([{ id: 's3', codes: [{ code: '2.거절', label: '거절', order: 1, status: 'negative' }] }]),
    ).toEqual([]);
  });
});
