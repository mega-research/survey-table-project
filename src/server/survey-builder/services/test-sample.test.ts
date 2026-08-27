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

vi.mock('@/server/data-scope', () => ({
  loadOperationsDataScope: vi.fn(),
}));
vi.mock('@/server/read-models/contact-sample', () => ({
  getFirstContactSample: vi.fn(),
}));
vi.mock('@/server/survey-access', () => ({ loadSurveyCapabilities: vi.fn() }));

import { getFirstContactSample } from '@/server/read-models/contact-sample';
import { loadOperationsDataScope } from '@/server/data-scope';
import { loadSurveyCapabilities } from '@/server/survey-access';

import { getSurveyTestSample } from './test-sample';

const VIEWER = { id: 'u-1', isSuperadmin: false, userType: 'internal' as const };

describe('getSurveyTestSample', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 기본은 컨택 열람 권한 보유 — 권한 축은 아래 전용 케이스가 고정한다.
    vi.mocked(loadSurveyCapabilities).mockResolvedValue(
      new Set(['survey.view', 'contacts.view']) as never,
    );
  });

  it('설문이 DB 에 없으면(미저장 로컬 설문) throw 대신 null 을 반환한다', async () => {
    limitMock.mockResolvedValue([]);
    await expect(getSurveyTestSample(VIEWER, 'local-only-id')).resolves.toBeNull();
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
    await expect(getSurveyTestSample(VIEWER, 's1')).resolves.toEqual({
      attrs: { 이름: '홍길동' },
      resid: 1,
    });
  });

  // survey.view 는 있고 contacts.view 는 없는 주체 = 팀 공개 설문의 일반 팀원.
  // 이 RPC 가 컨택 열람 매트릭스를 우회하던 자리다(Codex 적대적 리뷰).
  it('contacts.view 가 없으면 실컨택을 읽지도 않고 null 이다', async () => {
    limitMock.mockResolvedValue([{ id: 's1' }]);
    vi.mocked(loadSurveyCapabilities).mockResolvedValue(new Set(['survey.view']) as never);

    await expect(getSurveyTestSample(VIEWER, 's1')).resolves.toBeNull();

    expect(loadOperationsDataScope).not.toHaveBeenCalled();
    expect(getFirstContactSample).not.toHaveBeenCalled();
  });

  it('설문은 있는데 컨택이 0건이면 null (기존 동작 보존)', async () => {
    limitMock.mockResolvedValue([{ id: 's1' }]);
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real' as never);
    vi.mocked(getFirstContactSample).mockResolvedValue(null as never);
    await expect(getSurveyTestSample(VIEWER, 's1')).resolves.toBeNull();
  });
});
