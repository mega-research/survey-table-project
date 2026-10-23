import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptAnswerValue } from '@/lib/crypto/response-pii';
import { answerColumnKey } from '@/lib/operations/profile-columns-format';

import { formatProfileAnswerValue, loadProfileAnswerValues } from './profile-answer-values';

const selectRows = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
const selectSpy = vi.hoisted(() => vi.fn());

vi.mock('@/db', () => ({
  db: {
    select: (fields: Record<string, unknown>) => {
      selectSpy(fields);
      return {
        from: () => ({ where: () => Promise.resolve(selectRows.rows) }),
      };
    },
  },
}));

describe('formatProfileAnswerValue', () => {
  it('문자열·숫자는 그대로, 배열은 쉼표로 잇고, 객체는 비운다', () => {
    expect(formatProfileAnswerValue('메가리서치')).toBe('메가리서치');
    expect(formatProfileAnswerValue(12)).toBe('12');
    expect(formatProfileAnswerValue(['a', 'b'])).toBe('a, b');
    expect(formatProfileAnswerValue({ x: 1 })).toBe('');
    expect(formatProfileAnswerValue(undefined)).toBe('');
  });
});

describe('loadProfileAnswerValues', () => {
  beforeEach(() => {
    selectRows.rows = [];
    selectSpy.mockClear();
  });

  it('응답값 열이 없거나 행이 없으면 DB 를 읽지 않는다', async () => {
    await expect(loadProfileAnswerValues(['r1'], ['sys.idx'])).resolves.toEqual({});
    await expect(loadProfileAnswerValues([], [answerColumnKey('q1')])).resolves.toEqual({});
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('문항 값과 표 칸 값을 꺼내고 암호화된 칸은 복호화한다', async () => {
    const textKey = answerColumnKey('q-text');
    const companyKey = answerColumnKey('q-table', 'cell-company');
    const bizKey = answerColumnKey('q-table', 'cell-biz');
    // 문항마다 한 필드 — 같은 표의 칸 둘은 한 번만 읽는다
    selectRows.rows = [
      {
        id: 'r1',
        q0: '기타 의견',
        q1: { 'cell-company': encryptAnswerValue('메가리서치'), 'cell-biz': '123-45-67890' },
      },
      { id: 'r2', q0: null, q1: null },
    ];

    const out = await loadProfileAnswerValues(['r1', 'r2'], [textKey, companyKey, bizKey]);

    expect(Object.keys(selectSpy.mock.calls[0]![0] as object)).toEqual(['id', 'q0', 'q1']);
    expect(out).toEqual({
      r1: { [textKey]: '기타 의견', [companyKey]: '메가리서치', [bizKey]: '123-45-67890' },
      r2: {},
    });
  });
});
