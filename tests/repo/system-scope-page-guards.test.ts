/**
 * 시스템 범위 화면은 URL 직접 진입에서도 슈퍼어드민만 연다 (역할 모델 v2 티켓 15).
 *
 * 「메가리서치」 요청이 들어올 수 있는 세 채널 중 **URL 축**이다 — 나머지 둘(입력·쿠키)은
 * 런타임 검증이라 `tests/integration/system-scope-rejection.test.ts` 에 있다. 이쪽만
 * 소스를 훑는 드리프트 가드라 레포 관례대로 `tests/repo` 에 둔다.
 *
 * 여기 있는 화면들의 목록은 **팀 경계로 좁힐 수 없다**: 재배치 센터의 사람·설문은 어느
 * 팀에도 속하지 않아 팀장에게 하나라도 열면 그 순간 전사 열람이 되고(티켓 14), 팀 관리
 * 목록과 사용자 관리는 조직 구조 자체를 다룬다.
 */
import { describe, expect, it } from 'vitest';

import { loadAppFiles } from '@tests/helpers/app-files';

/** 슈퍼어드민 전용이어야 하는 라우트 묶음. */
const SYSTEM_SCOPE_ROUTES = ['admin/teams', 'admin/users', 'admin/reassignment'];

/** 그 아래여도 팀 경계로 좁혀지는 화면 — 사유를 함께 적는다. */
const TEAM_SCOPED_EXCEPTIONS: Record<string, string> = {
  'admin/teams/[teamId]/page.tsx':
    '팀 상세는 그 팀 소속도 연다 — 슈퍼어드민 전용이 아니고 서비스가 NOT_FOUND 로 접는다',
};

describe('시스템 범위 화면은 슈퍼어드민 가드를 진다', () => {
  const pages = loadAppFiles('page.tsx');
  const systemPages = pages.filter((page) =>
    SYSTEM_SCOPE_ROUTES.some((route) => page.rel.startsWith(`${route}/`)),
  );

  it('탐지기가 실제로 그 화면들을 찾아낸다', () => {
    // 라우트가 사라지거나 경로가 바뀌면 아래 검사가 조용히 0건이 된다.
    expect(systemPages.length).toBeGreaterThanOrEqual(4);
  });

  it('예외를 뺀 전부가 requireSuperadminPage 를 부른다', () => {
    const unguarded = systemPages
      .filter((page) => !(page.rel in TEAM_SCOPED_EXCEPTIONS))
      .filter((page) => !/\brequireSuperadminPage\s*\(/.test(page.source))
      .map((page) => page.rel);
    expect(unguarded).toEqual([]);
  });

  it('예외 목록은 실재하는 화면만 담는다', () => {
    const known = new Set(pages.map((page) => page.rel));
    for (const rel of Object.keys(TEAM_SCOPED_EXCEPTIONS)) {
      expect(known, `${rel} 가 사라졌다면 예외 목록에서도 지울 것`).toContain(rel);
    }
  });
});
