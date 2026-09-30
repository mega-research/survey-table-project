import { describe, expect, it } from 'vitest';

import {
  PUBLIC_ROOT_SEGMENTS,
  SESSION_GATED_ROOT_SEGMENTS,
} from '@/lib/auth/protected-paths';
import {
  PUBLIC_PAGES,
  appRootSegments,
  routeGroupRootSegments,
} from '@tests/helpers/app-files';

/**
 * 회귀 가드: 1차 게이트의 루트 어휘가 **파일 시스템과 어긋나지 않는다**.
 *
 * `/admin` 접두를 걷으면서(라우트 그룹 `app/(internal)/`) 내부 콘솔이 루트 여러 개로 흩어졌다.
 * 접두 하나로 「이 아래는 전부 세션이 필요하다」를 말할 수 없게 됐으므로, 게이트가 보는 것은
 * 이제 **목록**이다 — 그리고 목록은 조용히 낡는다. 새 내부 루트를 만들고 등재를 빠뜨리면
 * 그 구역만 1차 게이트 없이 렌더를 시작하고, 아무 에러도 나지 않는다.
 *
 * 그래서 완전성의 출처를 사람이 아니라 **디렉터리**에 둔다. 이 레포가 라우터 열거
 * (`tests/helpers/rpc-surface`)·RSC 페이지 열거(`rsc-page-guards`)에서 쓰는 관용구를 그대로
 * 쓴다. matcher 리터럴 ↔ 어휘의 대조는 `src/lib/auth/proxy-gate.test.ts` 몫이라 여기서는
 * 어휘 ↔ 파일 시스템만 본다.
 */

/** 내부 콘솔 루트 — 라우트 그룹의 괄호는 주소에 나타나지 않으므로 이 디렉터리들이 곧 루트다. */
const INTERNAL_ROOTS = routeGroupRootSegments('internal');

/** `src/app` 직속 루트 — 라우트 그룹 밖에서 이미 루트였던 구역들. */
const APP_ROOTS = appRootSegments();

/** 무인증 페이지의 첫 세그먼트 — `survey/[id]/page.tsx` → `survey`. */
const PUBLIC_PAGE_ROOTS = [
  ...new Set(Object.keys(PUBLIC_PAGES).map((rel) => rel.split('/')[0]!)),
];

describe('1차 게이트 루트 어휘', () => {
  it('열거가 죽지 않았다 — 디렉터리를 실제로 읽어낸다', () => {
    // 훑기가 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(INTERNAL_ROOTS.length).toBeGreaterThan(5);
    expect(APP_ROOTS).toContain('api');
  });

  it('`app/(internal)/*` 의 모든 루트가 세션 게이트 어휘에 있다', () => {
    const gated = new Set(SESSION_GATED_ROOT_SEGMENTS);
    const missing = INTERNAL_ROOTS.filter((root) => !gated.has(root));
    expect(
      missing,
      '내부 콘솔 루트를 새로 만들었다면 SESSION_GATED_ROOT_SEGMENTS 와 proxy matcher 에 함께 등재할 것',
    ).toEqual([]);
  });

  it('세션 게이트 어휘는 실재하는 루트만 담는다', () => {
    const real = new Set([...INTERNAL_ROOTS, ...APP_ROOTS]);
    const phantom = SESSION_GATED_ROOT_SEGMENTS.filter((root) => !real.has(root));
    expect(phantom, '사라진 루트는 어휘에서도 지울 것').toEqual([]);
  });

  it('무인증 표면의 루트는 세션 게이트 어휘에 없다', () => {
    // 여기 섞이면 응답자·외주가 전원 로그인으로 튕겨 그 표면이 통째로 닫힌다.
    const gated = new Set(SESSION_GATED_ROOT_SEGMENTS);
    const leaked = PUBLIC_PAGE_ROOTS.filter((root) => gated.has(root));
    expect(leaked).toEqual([]);
  });

  it('공개 루트 어휘가 무인증 페이지 목록에서 유도된 것과 일치한다', () => {
    // 출처를 rsc-page-guards 와 공유한다 — 한쪽에만 페이지를 더하면 여기서 갈린다.
    expect([...PUBLIC_ROOT_SEGMENTS].sort()).toEqual([...PUBLIC_PAGE_ROOTS].sort());
  });

  it('두 어휘는 겹치지 않는다', () => {
    const gated = new Set(SESSION_GATED_ROOT_SEGMENTS);
    expect(PUBLIC_ROOT_SEGMENTS.filter((root) => gated.has(root))).toEqual([]);
  });

  it('`api` 는 어느 어휘에도 없다 — Route Handler 는 각자 가드를 진다', () => {
    expect(SESSION_GATED_ROOT_SEGMENTS).not.toContain('api');
    expect(PUBLIC_ROOT_SEGMENTS).not.toContain('api');
  });
});
