import { describe, expect, it } from 'vitest';

import { loadAppFiles } from '@tests/helpers/app-files';

/**
 * 회귀 가드: 서버 데이터를 직접 부르는 RSC 페이지는 자기 인증 가드를 가져야 한다 (티켓 31).
 *
 * App Router 의 partial rendering 때문에 **상위 레이아웃은 하드 내비게이션에서만 재실행된다**.
 * 소프트 내비게이션으로 같은 레이아웃 아래를 오갈 때는 다시 돌지 않으므로, 그 사이 세션이
 * 폐기돼도(정지·퇴사·비밀번호 재설정) leaf 페이지는 아무 검사 없이 DB 를 읽는다.
 *
 * 콘솔 RSC 는 procedure 가 아니라 service·read-model 을 직접 부른다 — oRPC 의 authed/scoped 를
 * 지나지 않는다는 뜻이다. 그래서 "레이아웃이 위에서 막아준다" 는 전제는 여기서 성립하지 않고,
 * 각 페이지가 스스로 물어야 한다.
 *
 * 사람 눈에 맡기면 새 페이지가 조용히 빠진다. 이 테스트가 그 자리를 지킨다.
 */

/** 페이지가 서버 데이터에 닿는다는 신호 — service·read-model·drizzle 직접 import. */
const SERVER_DATA_IMPORT = /from '@\/(server\/read-models|server\/[a-z-]+\/services|db)/;

/** 자기 가드로 인정하는 호출. 무엇을 막는지는 각 가드가 정한다(내부 전용·유형·설문 경계). */
const PAGE_GUARD =
  /\b(requireAuth|requireAdminPage|requireSuperadminPage|requireActiveAccount|requireAccountTypePage|assertSurveyConsolePageAccess)\s*\(/;

/**
 * 인증 없이 열려야 하는 페이지 — 응답자 표면.
 *
 * 셋 다 URL 에 실린 토큰이 곧 자격이다(초대 코드·프리뷰 토큰·수신거부 토큰). 로그인을 요구하면
 * 응답자가 설문에 들어올 수 없다. 여기 새 항목을 더할 때는 **왜 무인증이어야 하는지**를
 * 같은 줄에 적을 것 — 적을 말이 없으면 가드가 빠진 것이다.
 */
const PUBLIC_PAGES: Record<string, string> = {
  'i/[code]/page.tsx': '짧은 초대 링크 — inviteCode 가 자격이다',
  'preview/[token]/page.tsx': '빌더 미리보기 — previewToken 이 자격이다',
  'unsubscribe/[token]/page.tsx': '메일 수신거부 — unsubscribeToken 이 자격이다',
  'survey/[id]/page.tsx': '공개 응답 페이지 — 설문 자체가 공개 표면이다',
};

const pages = loadAppFiles('page.tsx');

const dataPages = pages.filter((page) => SERVER_DATA_IMPORT.test(page.source));

describe('RSC 페이지 인증 가드', () => {
  it('서버 데이터를 부르는 페이지를 실제로 찾아낸다 (탐지기가 죽지 않았다)', () => {
    // 정규식이 어긋나 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(dataPages.length).toBeGreaterThan(10);
  });

  it('공개 허용 목록은 실재하는 페이지만 담는다', () => {
    const known = new Set(pages.map((page) => page.rel));
    for (const rel of Object.keys(PUBLIC_PAGES)) {
      expect(known, `${rel} 가 사라졌다면 허용 목록에서도 지울 것`).toContain(rel);
    }
  });

  it('공개 허용 목록 밖의 페이지는 전부 자기 가드를 갖는다', () => {
    const unguarded = dataPages
      .filter((page) => !(page.rel in PUBLIC_PAGES))
      .filter((page) => !PAGE_GUARD.test(page.source))
      .map((page) => page.rel);

    expect(unguarded).toEqual([]);
  });
});
