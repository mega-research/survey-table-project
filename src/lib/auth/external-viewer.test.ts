import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireActiveAccount } from '@/lib/auth';
import { isExternalViewer } from '@/lib/auth/external-viewer';

vi.mock('@/lib/auth', () => ({ requireActiveAccount: vi.fn() }));

/**
 * 데이터 파티션 판정 — 접근제어가 아니다(그쪽은 server/survey-access 코어).
 *
 * **티켓 25 에서 질문이 바뀌었다.** 이 술어는 티켓 21 까지 「게스트인가」였고, 그때의 테스트는
 * 실사가 false 임을 못 박았다(유형을 뭉개지 않으려고). 그런데 실사가 `contacts.view`·
 * `contacts.writeAttempts` 를 얻으면서 컨택 표면이 실제로 열렸고, 그 상태에서 게스트만
 * real 로 고정하면 **테스트 모드가 켜진 설문에서 실사원이 test 파티션을 읽고 결과코드를
 * test 로 쓴다** — 밖에서 전화를 돌리는 사람이 실데이터를 못 본다.
 *
 * 그래서 유형을 뭉갠 것이 아니라 **다른 질문으로 바꿨다**: 「내부가 아닌가」. 유형이 늘 때마다
 * 술어를 고치는 대신, 내부 표면만 전역 테스트 모드를 따른다는 사실을 그대로 적는다.
 */
describe('isExternalViewer', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['guest', 'fieldwork'] as const)('%s 계정은 외부 뷰어다 — 언제나 실데이터', async (userType) => {
    vi.mocked(requireActiveAccount).mockResolvedValue({ userType } as never);
    await expect(isExternalViewer()).resolves.toBe(true);
  });

  it('내부 계정만 전역 테스트 모드를 따른다', async () => {
    vi.mocked(requireActiveAccount).mockResolvedValue({ userType: 'internal' } as never);
    await expect(isExternalViewer()).resolves.toBe(false);
  });

  it('auth 조회가 실패하면 어드민으로 폴백하지 않고 throw 한다', async () => {
    // null 을 「내부 계정」으로 해석하면 일시적 auth 장애가 외부 계정을 어드민 스코프로
    // 흘려보낸다 — fail-closed 가 이 함수의 계약이다.
    vi.mocked(requireActiveAccount).mockRejectedValue(new Error('인증이 필요합니다.'));
    await expect(isExternalViewer()).rejects.toThrow('인증이 필요합니다.');
  });
});
