import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 회귀: 빌더 create 페이지(미저장 로컬 설문)에서 질문을 추가하면 SortableQuestionList 가
 * testSample.get 을 백그라운드로 호출한다. 설문이 아직 DB 에 없는데 loadOperationsDataScope
 * 가 throw 해 500 + dev 오버레이/로그 오염이 났다 (2026-08-20). 설문 미존재는 에러가 아니라
 * "컨택 0건" 과 동일 의미론(null)이어야 한다.
 */

const limitMock = vi.hoisted(() => vi.fn());
vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: limitMock }),
      }),
    }),
  },
}));

vi.mock('@/server/shared/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(),
}));
vi.mock('@/server/shared/contact-sample.server', () => ({
  getFirstContactSample: vi.fn(),
}));

import { getFirstContactSample } from '@/server/shared/contact-sample.server';
import { loadOperationsDataScope } from '@/server/shared/data-scope.server';

import { getSurveyTestSample } from './test-sample.service';

describe('getSurveyTestSample', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('설문이 DB 에 없으면(미저장 로컬 설문) throw 대신 null 을 반환한다', async () => {
    limitMock.mockResolvedValue([]);
    await expect(getSurveyTestSample('local-only-id')).resolves.toBeNull();
    expect(loadOperationsDataScope).not.toHaveBeenCalled();
    expect(getFirstContactSample).not.toHaveBeenCalled();
  });

  it('설문이 존재하면 기존 동작 — 스코프 로드 후 첫 컨택 샘플을 반환한다', async () => {
    limitMock.mockResolvedValue([{ id: 's1' }]);
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real' as never);
    vi.mocked(getFirstContactSample).mockResolvedValue({
      attrs: { 이름: '홍길동' },
      resid: 1,
    } as never);
    await expect(getSurveyTestSample('s1')).resolves.toEqual({
      attrs: { 이름: '홍길동' },
      resid: 1,
    });
  });

  it('설문은 있는데 컨택이 0건이면 null (기존 동작 보존)', async () => {
    limitMock.mockResolvedValue([{ id: 's1' }]);
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real' as never);
    vi.mocked(getFirstContactSample).mockResolvedValue(null as never);
    await expect(getSurveyTestSample('s1')).resolves.toBeNull();
  });
});
