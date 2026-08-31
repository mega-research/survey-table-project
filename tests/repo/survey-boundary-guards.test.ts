/**
 * 설문 경계를 지는 **비-RPC 표면**의 인벤토리 — RSC 콘솔 페이지와 REST 라우트
 * (역할 모델 v2 티켓 15, B 검증 게이트).
 *
 * oRPC 쪽은 라우터를 열거해 음성 스위트를 돌릴 수 있지만(cross-team-idor-rpc), RSC 페이지와
 * Route Handler 는 라우터가 없다 — 목록의 출처가 **파일 시스템**이다. 그래서 여기서 훑는다.
 *
 * 형제 가드와의 분담:
 *  - `rsc-page-guards`      : 페이지가 **인증** 가드를 갖는가 (누구인가)
 *  - `analytics-page-guards`: 분석 화면 둘이 responses.view 까지 요구하는가 (무엇을 렌더하는가)
 *  - 이 파일               : 설문 콘솔·export 표면이 **설문 capability** 관문을 지는가 (어느 설문인가)
 *
 * 인증만 보는 가드는 팀 경계를 모른다 — `requireAdminPage` 는 "내부 활성 계정" 까지만
 * 확인하므로, 그것만 붙은 콘솔 페이지는 URL 의 설문 id 를 그대로 믿고 남의 팀 설문을 렌더한다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_DIR, loadAppFiles, REPO_ROOT } from '@tests/helpers/app-files';

/**
 * 설문 단위 RSC 콘솔 — URL 에 설문 id 가 실리는 화면 묶음.
 *
 * 게스트 콘솔(`guest/surveys/[surveyId]`)도 여기 있다(티켓 22). 주소에 설문 id 가 실리는
 * 순간 「남의 설문 id 를 넣으면 멈추는가」가 같은 질문이 되기 때문이다 — 청중이 다르다고
 * 인벤토리를 나누면 새 트리가 이 게이트 밖에서 자란다.
 */
const SURVEY_CONSOLE_ROOTS = [
  'admin/surveys/[id]',
  'analytics/[surveyId]',
  'guest/surveys/[surveyId]',
];

/**
 * 설문 capability 관문으로 인정하는 호출. 어느 capability 인지는 각 화면이 정한다.
 *
 * `assertGuestSurveyPageAccess` 는 capability(`operations.view`) 위에 **탭 축**을 하나 더
 * 묻는 게스트 짝이다(티켓 22).
 */
const PAGE_CAPABILITY_GATE =
  /\b(assertSurveyCapabilityPage|assertSurveyConsolePageAccess|assertGuestSurveyPageAccess)\s*\(/;

/** REST 쪽 짝 — 사유를 HTTP 코드로 옮기는 어댑터(404 존재 은닉 / 403). */
const REST_CAPABILITY_GATE =
  /\b(checkSurveyCapabilityRest|checkScopedSurveyCapabilityRest)\s*\(/;

/**
 * 클라이언트 컴포넌트 페이지는 서버에서 아무것도 읽지 않는다 — 데이터는 전부 관문을 지난
 * oRPC 로 온다. 그래서 여기서 요구하는 것은 관문이 아니라 **서버 데이터를 안 읽는다는 사실**이다.
 */
const CLIENT_PAGE = /^\s*['"]use client['"]/m;


// ─────────────────────────────────────────────────────────────────────────────
// RSC — 설문 콘솔 페이지
// ─────────────────────────────────────────────────────────────────────────────

describe('설문 콘솔 RSC 페이지는 설문 capability 관문을 진다', () => {
  const consolePages = loadAppFiles('page.tsx').filter((page) =>
    SURVEY_CONSOLE_ROOTS.some((root) => page.rel.startsWith(`${root}/`)),
  );

  it('탐지기가 콘솔 화면들을 실제로 찾아낸다', () => {
    // 경로가 바뀌어 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(consolePages.length).toBeGreaterThan(15);
  });

  it('서버 페이지는 전부 관문을 부른다', () => {
    const unguarded = consolePages
      .filter((page) => !CLIENT_PAGE.test(page.source))
      .filter((page) => !PAGE_CAPABILITY_GATE.test(page.source))
      .map((page) => page.rel);
    expect(unguarded).toEqual([]);
  });

  it('관문이 없는 화면은 클라이언트 컴포넌트뿐이다 — 데이터는 관문을 지난 RPC 로 온다', () => {
    const clientPages = consolePages
      .filter((page) => CLIENT_PAGE.test(page.source))
      .map((page) => page.rel);
    // 빌더 편집 화면 하나. 늘어난다면 "왜 서버에서 안 읽는가" 를 확인하고 여기 등재할 것.
    expect(clientPages).toEqual(['admin/surveys/[id]/edit/page.tsx']);
  });

  it('설문 콘솔 트리의 진입 레이아웃이 관문을 진다', () => {
    // leaf 가 자기 정밀 관문을 갖지만, 트리 진입점에서 survey.view 를 한 번 접는 것이
    // 「보이지도 않는 설문」의 헤더·탭이 먼저 그려지는 것을 막는다.
    const layout = readFileSync(
      resolve(APP_DIR, 'admin/surveys/[id]/layout.tsx'),
      'utf8',
    );
    expect(PAGE_CAPABILITY_GATE.test(layout)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REST — 설문 스코프 Route Handler
// ─────────────────────────────────────────────────────────────────────────────

describe('설문 스코프 REST 라우트는 관문을 진다', () => {
  const surveyRoutes = loadAppFiles('route.ts').filter((route) =>
    route.rel.startsWith('api/surveys/[surveyId]/'),
  );

  it('탐지기가 export 라우트들을 찾아낸다', () => {
    expect(surveyRoutes.map((route) => route.rel).sort()).toEqual([
      'api/surveys/[surveyId]/contacts/export/route.ts',
      'api/surveys/[surveyId]/export/route.ts',
      'api/surveys/[surveyId]/export/split-preview/route.ts',
    ]);
  });

  /**
   * 인증 가드는 **`requireAuth` 여야 한다** — `requireActiveAccount` 는 계정 유형을 보지
   * 않아 게스트·실사가 그대로 들어온다(lib/auth.ts 주석). 스펙 §8 의 「export 는 비내부
   * 계정에게 **항상 차단**」이 두 겹인 것이 그 계약이고, 이것이 바깥 겹이다: 안쪽 겹인
   * capability 열은 설문마다 달라질 수 있지만 이 문은 유형만 본다.
   *
   * 예전 이 가드는 둘 중 아무거나 받았다. 실물 셋은 모두 requireAuth 였지만, 프로필
   * 표면(아바타 업로드)이 requireActiveAccount 를 쓰는 형제라 복사 한 번이면 뚫린다 —
   * 그때 이 파일은 초록으로 남는다.
   */
  it('셋 다 내부 전용 인증 + capability 관문을 부른다', () => {
    for (const route of surveyRoutes) {
      expect(route.source, `${route.rel} 에 내부 전용 인증 가드가 없다`).toMatch(
        /\brequireAuth\s*\(/,
      );
      expect(
        route.source,
        `${route.rel} 이 requireActiveAccount 를 쓴다 — 게스트·실사가 export 로 들어온다`,
      ).not.toMatch(/\brequireActiveAccount\s*\(/);
      expect(route.source, `${route.rel} 에 설문 관문이 없다`).toMatch(REST_CAPABILITY_GATE);
    }
  });

  /**
   * 업로드 REST 3종은 **의도된 면제**다 — surveyId 없는 tmp 네임스페이스 전용이라 지목할
   * 설문이 없고, 영구 승격 경로(설문 저장·템플릿 저장·media.*)가 관문을 진다
   * (lib/upload/route-guard.ts 주석). 여기서는 "그 셋이 정말 설문 스코프가 아닌가" 만 본다.
   */
  it('업로드 라우트는 설문 id 를 받지 않는다 — 면제의 근거', () => {
    const uploads = loadAppFiles('route.ts').filter((route) => route.rel.startsWith('api/upload/'));
    expect(uploads.length).toBeGreaterThanOrEqual(3);
    for (const route of uploads) {
      expect(route.rel, '업로드 경로에 설문 세그먼트가 생겼다').not.toContain('[surveyId]');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 정적 가드가 증명하지 못하는 것 — 행동 검증이 어디 있는지 못 박는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 위 검사들은 「관문 함수 이름이 파일에 있다」만 증명한다. 그 호출이 **실제로 돌고
 * 민감 조회보다 먼저** 서는지는 증명하지 못한다 — 실제로 티켓 15 에서 컨택·응답 상세
 * RSC 가 관문을 지난 뒤 **하위 행을 설문 경계 없이 읽어 복호화**하고 있었다.
 *
 * 그래서 행동 검증이 있는 자리를 여기서 함께 묶는다. 그 파일이 사라지거나 교차 팀
 * 케이스가 빠지면 정적 가드만 남는데, 그 상태는 사람 눈에 「초록」으로 보인다.
 */
const BEHAVIOURAL_COVERAGE: Record<string, readonly string[]> = {
  // REST export 3종의 404 존재 은닉 (티켓 11)
  'tests/unit/api/export-route-auth.test.ts': ['타 팀 설문', '404'],
  'tests/integration/contacts-export-route.test.ts': ['타 팀 설문', '404'],
  // 하위 행 주입 — 관문이 통과한 뒤의 축 (티켓 15)
  'tests/integration/cross-team-idor.realdb.test.ts': ['남의 하위 행'],
};

describe('정적 가드의 짝이 되는 행동 검증이 실재한다', () => {
  it.each(Object.entries(BEHAVIOURAL_COVERAGE))('%s', (rel, needles) => {
    const source = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    for (const needle of needles) {
      expect(source, `${rel} 에서 「${needle}」 검증이 사라졌다`).toContain(needle);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 외부 지속 — 팀이 사라져도 계속 도는 경로는 팀 컬럼을 읽지 않는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 팀 해산·배치 대기 뒤에도 **공개 응답·예약 메일·백그라운드 잡은 계속 돈다**(ADR-0011).
 *
 * 그 약속의 근거는 정책 문장이 아니라 **그 경로들이 팀 컬럼을 아예 읽지 않는다**는 사실이다.
 * 누군가 새 게이트에 `teamId`·`assignmentStatus` 를 끌어들이는 순간 약속이 조용히 깨지고,
 * 증상은 「해산 뒤 응답이 안 들어온다」로 한참 뒤에 나타난다. 여기서 그 사실을 고정한다.
 */
const TEAM_COLUMN_FREE_PATHS = [
  'src/server/survey-response/services/response-gate.ts',
  'src/server/mail/services/campaign-dispatch.ts',
  'src/server/workflows/jobs/campaign-dispatcher.ts',
  'src/server/workflows/jobs/campaign-reconciler.ts',
];

const TEAM_COLUMN = /\bteamId\b|\bassignmentStatus\b|\bteam_id\b|\bassignment_status\b/;

describe('팀이 사라져도 도는 경로는 팀 컬럼을 읽지 않는다', () => {
  it.each(TEAM_COLUMN_FREE_PATHS)('%s', (rel) => {
    const source = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    expect(
      TEAM_COLUMN.test(source),
      `${rel} 가 팀 컬럼을 읽기 시작했다 — 해산 뒤 외부 지속 약속(ADR-0011)이 깨진다`,
    ).toBe(false);
  });
});
