import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateProfileColumnsInput } from '../domain/profile-columns';

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

import { updateProfileColumns } from './profile-columns';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('updateProfileColumns 검증', () => {
  beforeEach(() => {
    capturedSets.length = 0;
    vi.clearAllMocks();
  });

  it('scheme.columns 누락 시 throw 없이 { ok:false, error } 를 반환한다', async () => {
    const input = {
      surveyId: SURVEY_ID,
      scheme: { version: 1 },
    } as unknown as UpdateProfileColumnsInput;

    const res = await updateProfileColumns(input);

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('key 중복이면 { ok:false } 를 반환한다', async () => {
    const input: UpdateProfileColumnsInput = {
      surveyId: SURVEY_ID,
      scheme: {
        version: 1,
        columns: [
          { key: 'sys.idx', label: '순번', order: 0 },
          { key: 'sys.idx', label: '순번2', order: 1 },
        ],
      },
    };

    const res = await updateProfileColumns(input);

    expect(res.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('빈 라벨이 있으면 { ok:false } 를 반환한다', async () => {
    const input: UpdateProfileColumnsInput = {
      surveyId: SURVEY_ID,
      scheme: { version: 1, columns: [{ key: 'sys.idx', label: '  ', order: 0 }] },
    };

    const res = await updateProfileColumns(input);

    expect(res.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('정상 columns 는 profileColumns 를 DB 에 저장한다', async () => {
    const input: UpdateProfileColumnsInput = {
      surveyId: SURVEY_ID,
      scheme: { version: 1, columns: [{ key: 'attrs.업체명', label: '업체명', order: 0 }] },
    };

    const res = await updateProfileColumns(input);

    expect(res).toEqual({ ok: true });
    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]).toMatchObject({
      profileColumns: {
        version: 1,
        columns: [{ key: 'attrs.업체명', label: '업체명', order: 0 }],
      },
    });
  });

  it('빈 columns 배열은 profileColumns 를 null 로 set 한다 (기본 스킴 복귀)', async () => {
    const input: UpdateProfileColumnsInput = {
      surveyId: SURVEY_ID,
      scheme: { version: 1, columns: [] },
    };

    const res = await updateProfileColumns(input);

    expect(res).toEqual({ ok: true });
    expect(capturedSets[0]).toMatchObject({ profileColumns: null });
  });
});
