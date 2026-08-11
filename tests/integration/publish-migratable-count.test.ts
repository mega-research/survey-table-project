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

import { countMigratableResponses } from '@/features/survey-builder/server/services/survey-publish.service';

describe('countMigratableResponses', () => {
  beforeEach(() => {
    whereMock.mockReset();
  });

  it('집계 행의 count 를 반환한다', async () => {
    whereMock.mockResolvedValue([{ count: 7 }]);
    await expect(countMigratableResponses({ surveyId: 'survey-1' })).resolves.toEqual({
      count: 7,
    });
  });

  it('행이 없으면 0 을 반환한다', async () => {
    whereMock.mockResolvedValue([]);
    await expect(countMigratableResponses({ surveyId: 'survey-1' })).resolves.toEqual({
      count: 0,
    });
  });

});
