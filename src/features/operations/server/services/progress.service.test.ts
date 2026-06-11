import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateProgressColumnsInput } from '../../domain/progress';

// db.update().set().where() 체인의 set 페이로드를 캡처하도록 stub.
const capturedSets: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => {
  return {
    db: {
      update: vi.fn(() => ({
        set: vi.fn((payload: Record<string, unknown>) => {
          capturedSets.push(payload);
          return { where: vi.fn(async () => undefined) };
        }),
      })),
    },
  };
});

import { db } from '@/db';

import { updateProgressColumns } from './progress.service';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('updateProgressColumns columns 방어', () => {
  beforeEach(() => {
    capturedSets.length = 0;
    vi.clearAllMocks();
  });

  it('scheme.columns 누락 시 throw 없이 { ok:false, error } 를 반환한다', async () => {
    // 비-UI/API 호출이 columns 를 빠뜨린 케이스 (domain scheme 은 z.custom 이라 런타임 미검증).
    const input = {
      surveyId: SURVEY_ID,
      scheme: { version: 1 },
    } as unknown as UpdateProgressColumnsInput;

    const res = await updateProgressColumns(input);

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    // 방어로 인해 DB 쓰기까지 도달하지 않아야 한다.
    expect(db.update).not.toHaveBeenCalled();
  });

  it('scheme.columns 가 null 이어도 throw 없이 { ok:false } 를 반환한다', async () => {
    const input = {
      surveyId: SURVEY_ID,
      scheme: { version: 1, columns: null },
    } as unknown as UpdateProgressColumnsInput;

    const res = await updateProgressColumns(input);

    expect(res.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('정상 columns 는 진척률 컬럼을 DB 에 저장한다', async () => {
    const input: UpdateProgressColumnsInput = {
      surveyId: SURVEY_ID,
      scheme: { version: 1, columns: [{ key: 'month', label: '개최 월', order: 0 }] },
    };

    const res = await updateProgressColumns(input);

    expect(res).toEqual({ ok: true });
    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toMatchObject({
      progressColumns: { version: 1, columns: [{ key: 'month', label: '개최 월', order: 0 }] },
    });
  });

  it('빈 columns 배열은 progressColumns 를 null 로 set 한다', async () => {
    const input: UpdateProgressColumnsInput = {
      surveyId: SURVEY_ID,
      scheme: { version: 1, columns: [] },
    };

    const res = await updateProgressColumns(input);

    expect(res).toEqual({ ok: true });
    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toMatchObject({ progressColumns: null });
  });
});
