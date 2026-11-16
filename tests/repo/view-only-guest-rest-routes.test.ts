import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 보기만 하는 게스트와 게스트용 REST 주소.
 *
 * 화면 차단(미들웨어 `guestPathRedirect`)은 `/admin` 에만 걸려 `/api` 요청을 막지 못한다. 그래서 화면이
 * 막힌 계정이 주소를 직접 불러 파일을 받는 길을 각 라우트가 스스로 막는다(2026-11-16 — 내보내기 주소가
 * 설문 접근 판정만 보고 있어 보기 전용 고객 계정도 평문 파일을 받을 수 있었다).
 * 데이터 조회보다 앞에서 거부하는지를 본다 — 서비스·DB 대역은 불리면 테스트가 깨지게 둔다.
 */
const { authState } = vi.hoisted(() => ({ authState: { user: null as null | { id: string } } }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: authState.user }, error: null })) },
  })),
}));
vi.mock('@/server/data-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/data-scope')>();
  return {
    ...actual,
    loadOperationsDataScope: vi.fn(async () => {
      throw new Error('거부보다 먼저 데이터 스코프를 읽었다');
    }),
  };
});
vi.mock('@/db', () => ({ db: {} }));

import { GET as contactsExportGet } from '@/app/api/surveys/[surveyId]/contacts/export/route';
import { GET as demandSummaryGet } from '@/app/api/surveys/[surveyId]/demand-summary/route';

// guest-grants.ts 의 VIEW_ONLY_GUEST_GRANTS 에 박힌 실제 쌍들.
const VIEW_ONLY = [
  ['c79af8a1-186a-4157-be4c-2bebfbde4a8d', '253534a5-913a-4891-a019-f9643ccea0a7'], // guest9
  ['75060289-51b4-44e7-8fd1-dabf73a0bfaf', '24b15972-36fe-400a-adfe-7d4c80438204'], // dairy@
  ['6ca037a8-c282-4bbe-af64-f4f147bf5039', '8f2bc707-5821-4bbb-bc69-fcd7277cd1cb'], // guest11
] as const;

describe('보기만 하는 게스트는 화면이 막힌 REST 주소도 받지 못한다', () => {
  beforeEach(() => {
    process.env['ADMIN_USER_IDS'] = 'admin-1';
    process.env['GUEST_SURVEY_GRANTS'] = VIEW_ONLY.map(([u, s]) => `${u}:${s}`).join(',');
  });
  afterEach(() => {
    delete process.env['ADMIN_USER_IDS'];
    delete process.env['GUEST_SURVEY_GRANTS'];
  });

  it.each(VIEW_ONLY)('조사 대상 목록 엑셀 — %s', async (userId, surveyId) => {
    authState.user = { id: userId };
    const res = await contactsExportGet(
      new NextRequest(`http://localhost/api/surveys/${surveyId}/contacts/export`),
      { params: Promise.resolve({ surveyId }) },
    );
    expect(res.status).toBe(403);
  });

  it.each(VIEW_ONLY)('문항 수요 집계표 — %s', async (userId, surveyId) => {
    authState.user = { id: userId };
    const res = await demandSummaryGet(
      new NextRequest(`http://localhost/api/surveys/${surveyId}/demand-summary`),
      { params: Promise.resolve({ surveyId }) },
    );
    expect(res.status).toBe(403);
  });
});
