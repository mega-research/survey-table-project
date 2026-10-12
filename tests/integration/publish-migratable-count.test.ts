import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 배포 안내 N건 집계 (ADR-0014, .scratch/response-version-migration 티켓 06)
// ========================
// 발행 확인 UI 의 "진행 중 응답 N건이 새 버전으로 이어집니다" 문구에 쓰는 집계.
// N = 해당 설문의 in_progress + drop, 테스트·soft delete 제외.

const { whereMock } = vi.hoisted(() => ({
  whereMock: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: whereMock,
      })),
    })),
  },
}));

import { countMigratableResponses } from '@/server/survey-builder/services/survey-publish';

describe('countMigratableResponses', () => {
  beforeEach(() => {
    whereMock.mockReset();
  });

  /** 두 조회가 차례로 나간다 — 진행 중 응답 수, 그리고 설문 status. */
  function mockQueries(countRows: unknown[], surveyRows: unknown[]) {
    whereMock.mockResolvedValueOnce(countRows).mockResolvedValueOnce(surveyRows);
  }

  it('집계 행의 count 를 반환한다', async () => {
    mockQueries([{ count: 7 }], [{ status: 'published' }]);
    await expect(countMigratableResponses({ surveyId: 'survey-1' })).resolves.toEqual({
      count: 7,
      isClosed: false,
    });
  });

  it('행이 없으면 0 을 반환한다', async () => {
    mockQueries([], []);
    await expect(countMigratableResponses({ surveyId: 'survey-1' })).resolves.toEqual({
      count: 0,
      isClosed: false,
    });
  });

  it('종료된 설문이면 isClosed 를 알린다 — 배포가 종료를 푼다는 안내의 재료다 (ADR-0030)', async () => {
    mockQueries([{ count: 2 }], [{ status: 'closed' }]);
    await expect(countMigratableResponses({ surveyId: 'survey-1' })).resolves.toEqual({
      count: 2,
      isClosed: true,
    });
  });
});
