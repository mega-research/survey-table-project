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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const APP_DIR = resolve(REPO_ROOT, 'src/app');

/** 설문 단위 RSC 콘솔 — URL 에 설문 id 가 실리는 화면 묶음. */
const SURVEY_CONSOLE_ROOTS = ['admin/surveys/[id]', 'analytics/[surveyId]'];

/** 설문 capability 관문으로 인정하는 호출. 어느 capability 인지는 각 화면이 정한다. */
const PAGE_CAPABILITY_GATE =
  /\b(assertSurveyCapabilityPage|assertSurveyConsolePageAccess)\s*\(/;

/** REST 쪽 짝 — 사유를 HTTP 코드로 옮기는 어댑터(404 존재 은닉 / 403). */
const REST_CAPABILITY_GATE =
  /\b(checkSurveyCapabilityRest|checkScopedSurveyCapabilityRest)\s*\(/;

/**
 * 클라이언트 컴포넌트 페이지는 서버에서 아무것도 읽지 않는다 — 데이터는 전부 관문을 지난
 * oRPC 로 온다. 그래서 여기서 요구하는 것은 관문이 아니라 **서버 데이터를 안 읽는다는 사실**이다.
 */
const CLIENT_PAGE = /^\s*['"]use client['"]/m;

function collectFiles(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectFiles(full, name));
    else if (entry === name) found.push(full);
  }
  return found;
}

function load(name: string, root = APP_DIR) {
  return collectFiles(root, name).map((full) => ({
    rel: relative(APP_DIR, full).replaceAll('\\', '/'),
    source: readFileSync(full, 'utf8'),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// RSC — 설문 콘솔 페이지
// ─────────────────────────────────────────────────────────────────────────────

describe('설문 콘솔 RSC 페이지는 설문 capability 관문을 진다', () => {
  const consolePages = load('page.tsx').filter((page) =>
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
  const surveyRoutes = load('route.ts').filter((route) =>
    route.rel.startsWith('api/surveys/[surveyId]/'),
  );

  it('탐지기가 export 라우트들을 찾아낸다', () => {
    expect(surveyRoutes.map((route) => route.rel).sort()).toEqual([
      'api/surveys/[surveyId]/contacts/export/route.ts',
      'api/surveys/[surveyId]/export/route.ts',
      'api/surveys/[surveyId]/export/split-preview/route.ts',
    ]);
  });

  it('셋 다 인증 + capability 관문을 부른다', () => {
    for (const route of surveyRoutes) {
      expect(route.source, `${route.rel} 에 인증 가드가 없다`).toMatch(
        /\b(requireAuth|requireActiveAccount)\s*\(/,
      );
      expect(route.source, `${route.rel} 에 설문 관문이 없다`).toMatch(REST_CAPABILITY_GATE);
    }
  });

  /**
   * 업로드 REST 3종은 **의도된 면제**다 — surveyId 없는 tmp 네임스페이스 전용이라 지목할
   * 설문이 없고, 영구 승격 경로(설문 저장·템플릿 저장·media.*)가 관문을 진다
   * (lib/upload/route-guard.ts 주석). 여기서는 "그 셋이 정말 설문 스코프가 아닌가" 만 본다.
   */
  it('업로드 라우트는 설문 id 를 받지 않는다 — 면제의 근거', () => {
    const uploads = load('route.ts').filter((route) => route.rel.startsWith('api/upload/'));
    expect(uploads.length).toBeGreaterThanOrEqual(3);
    for (const route of uploads) {
      expect(route.rel, '업로드 경로에 설문 세그먼트가 생겼다').not.toContain('[surveyId]');
    }
  });
});
