import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 분석 화면은 **원문 응답을 직렬화한다** — 그래서 `analytics.view` 만으로는 열리지 않는다.
 *
 * `getResponsesWithAnswers` 는 복호화된 questionResponses 와 응답 행 전체
 * (contactTargetId·sessionId·ipHash·fpHash·deviceId·userAgent·metadata)를 돌려주고, 두 페이지가
 * 그것을 클라이언트 컴포넌트 props 로 넘긴다. RSC payload 에 그대로 실리므로 응답 열람 권한이
 * 없는 팀원이 브라우저에서 꺼낼 수 있었다(Codex 적대적 리뷰, 사용자 확정 2026-08-27).
 *
 * 화면이 둘이라 한쪽만 조이면 다른 쪽이 뒷문이 된다 — 메타테스트로 둘을 함께 묶는다.
 * 새 분석 화면을 만들면 여기 목록에 더할 것.
 */

const REPO_ROOT = join(import.meta.dirname, '../..');

const ANALYTICS_PAGES = [
  'src/app/analytics/[surveyId]/page.tsx',
  'src/app/admin/surveys/[id]/analytics/page.tsx',
];

/** 원문 응답 행을 읽는 read model — 이걸 부르면 응답 열람 권한이 필요하다. */
const RAW_RESPONSE_READ = 'getResponsesWithAnswers';

describe('분석 화면 관문', () => {
  it.each(ANALYTICS_PAGES)('%s 는 analytics.view 와 responses.view 를 함께 요구한다', (page) => {
    const source = readFileSync(join(REPO_ROOT, page), 'utf8');

    // 전제 확인 — 이 페이지가 정말 원문 응답을 읽는가. 안 읽게 바뀌었다면 이 테스트를
    // 지우는 것이 맞고, 그 판단을 사람이 하도록 여기서 먼저 깨뜨린다.
    expect(source).toContain(RAW_RESPONSE_READ);

    expect(source).toContain("'analytics.view'");
    expect(source).toContain("'responses.view'");
  });
});
