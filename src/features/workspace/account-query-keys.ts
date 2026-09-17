/**
 * 계정·업체 쿼리 키 — 두 하위 묶음이 서로의 캐시를 접어야 해서 루트에 둔다 (루트 잔류 기준 ①).
 *
 * 의존이 실재한다: 업체 이름을 바꾸면 사용자 관리 표의 「소속」 열이 그 이름을 그리고 있고
 * (서버가 조인으로 준다), 업체 종료는 발급 모달의 선택지를 바꾼다. 그래서 업체 mutation 이
 * **양쪽**을 무효화해야 하는데, 키를 각 묶음이 들고 있으면 그 한 줄 때문에 실사 업체가
 * 사용자 관리를 import 하게 된다 — 사용자 관리는 이미 실사 업체를 import 하므로 순환이다.
 *
 * `shared/lib/survey-group-queries.ts` 가 feature 사이에서 같은 이유로 존재하는 자리이고,
 * 여기는 그 한 단계 안쪽(한 feature 의 하위 묶음 사이)이다.
 */
import type { UserStatusFilter, UserTypeFilter } from '@/shared/contracts/auth-io';

export const userKeys = {
  all: ['users'] as const,
  list: (userType: UserTypeFilter, status: UserStatusFilter) =>
    [...userKeys.all, 'list', userType, status] as const,
};

export const fieldworkOrgKeys = {
  all: ['fieldwork-orgs'] as const,
  /** 카드 목록 — 계정 명단까지 실어 온다. */
  list: () => [...fieldworkOrgKeys.all, 'list'] as const,
  /** 발급 모달·탭 라벨이 쓰는 가벼운 선택지. 목록과 **다른 키**여야 한다(무게가 다르다). */
  options: () => [...fieldworkOrgKeys.all, 'options'] as const,
};
