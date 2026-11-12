import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canAccessSurvey,
  canViewOnlyGuestPreview,
  getGuestSurveyIds,
  getViewOnlyPreviewSurveyIds,
  getViewOnlySurveyIds,
  guestPathRedirect,
  guestPostLoginRedirect,
  isAdminOrGuestGrantHolder,
  isForeignSurveyConsolePath,
  isGuestUser,
  isViewOnlyGuest,
  parseGuestGrants,
  sanitizeInternalPath,
} from '@/lib/auth/guest-grants';

afterEach(() => vi.unstubAllEnvs());

describe('parseGuestGrants', () => {
  it('userId:surveyId 콤마 목록을 Map<userId, surveyId[]> 로 파싱한다', () => {
    const map = parseGuestGrants('u1:s1, u2:s2');
    expect(map.get('u1')).toEqual(['s1']);
    expect(map.get('u2')).toEqual(['s2']);
  });

  it('같은 userId 반복 등재는 설문 목록으로 누적한다', () => {
    const map = parseGuestGrants('u1:s1, u1:s2, u2:s3');
    expect(map.get('u1')).toEqual(['s1', 's2']);
    expect(map.get('u2')).toEqual(['s3']);
  });

  it('중복 pair 는 한 번만 담는다', () => {
    expect(parseGuestGrants('u1:s1, u1:s1').get('u1')).toEqual(['s1']);
  });

  it('빈 값·공백·형식 오류 항목은 무시한다', () => {
    expect(parseGuestGrants(undefined).size).toBe(0);
    expect(parseGuestGrants('').size).toBe(0);
    expect(parseGuestGrants(' , u1 , :s1, u2: ').size).toBe(0);
  });
});

describe('getGuestSurveyIds / isGuestUser', () => {
  it('grant 있으면 설문 목록, 없으면 빈 배열', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a,guest-1:survey-b');
    expect(getGuestSurveyIds('guest-1')).toEqual(['survey-a', 'survey-b']);
    expect(getGuestSurveyIds('other')).toEqual([]);
  });

  it('isGuestUser 는 grant 보유 여부', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(isGuestUser('guest-1')).toBe(true);
    expect(isGuestUser('other')).toBe(false);
  });
});

describe('canAccessSurvey', () => {
  it('admin allowlist 통과자는 어느 설문이든 true', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(canAccessSurvey('admin-1', 'survey-x')).toBe(true);
  });

  it('게스트는 grant 된 설문들만 true', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a,guest-1:survey-b');
    expect(canAccessSurvey('guest-1', 'survey-a')).toBe(true);
    expect(canAccessSurvey('guest-1', 'survey-b')).toBe(true);
    expect(canAccessSurvey('guest-1', 'survey-c')).toBe(false);
  });

  it('allowlist 밖 + grant 없음은 false', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    expect(canAccessSurvey('nobody', 'survey-a')).toBe(false);
  });

  it('allowlist 미설정 fail-open 이어도 grant 보유자는 grant 설문만 접근한다', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(canAccessSurvey('guest-1', 'survey-a')).toBe(true);
    expect(canAccessSurvey('guest-1', 'survey-b')).toBe(false);
  });
});

describe('isAdminOrGuestGrantHolder', () => {
  it('admin allowlist 포함이면 true', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    expect(isAdminOrGuestGrantHolder('admin-1')).toBe(true);
  });

  it('allowlist 밖이라도 grant 보유자면 true - 게스트 업로드 표면 허용', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(isAdminOrGuestGrantHolder('guest-1')).toBe(true);
  });

  it('allowlist 밖 + grant 없음이면 false', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    expect(isAdminOrGuestGrantHolder('nobody')).toBe(false);
  });
});

describe('guestPathRedirect', () => {
  const grants = ['survey-a', 'survey-b'];

  it('grant 된 모든 설문의 operations 는 허용 (+ 로그인·강제 로그아웃 라우트)', () => {
    expect(guestPathRedirect('/admin/surveys/survey-a/operations', grants)).toBeNull();
    expect(guestPathRedirect('/admin/surveys/survey-b/operations/contacts', grants)).toBeNull();
    expect(guestPathRedirect('/admin/login', grants)).toBeNull();
    expect(guestPathRedirect('/admin/logout', grants)).toBeNull();
  });

  it('grant 설문의 설문 보기(preview)는 허용, 무권한 설문 preview 는 강제 로그아웃으로', () => {
    expect(guestPathRedirect('/admin/surveys/survey-a/preview', grants)).toBeNull();
    expect(guestPathRedirect('/admin/surveys/survey-b/preview', grants)).toBeNull();
    expect(guestPathRedirect('/admin/surveys/other/preview', grants)).toBe('/admin/logout');
    expect(guestPathRedirect('/admin/surveys/survey-a-suffix/preview', grants)).toBe(
      '/admin/logout',
    );
  });

  it('설문 콘솔 외 차단 경로도 강제 로그아웃 - 자기 설문으로 조용히 보내지 않는다', () => {
    expect(guestPathRedirect('/admin/surveys', grants)).toBe('/admin/logout');
    expect(guestPathRedirect('/admin/surveys/survey-a/edit', grants)).toBe('/admin/logout');
    expect(guestPathRedirect('/analytics', grants)).toBe('/admin/logout');
    expect(guestPathRedirect('/admin/billing/mail-cost', grants)).toBe('/admin/logout');
  });

  it('무권한 설문의 operations 는 강제 로그아웃 라우트로 보낸다', () => {
    expect(guestPathRedirect('/admin/surveys/other/operations', grants)).toBe('/admin/logout');
    expect(guestPathRedirect('/admin/surveys/other/operations/contacts', grants)).toBe(
      '/admin/logout',
    );
    // prefix 오탐 방지 — granted id 로 시작하는 다른 설문 id
    expect(guestPathRedirect('/admin/surveys/survey-a-suffix/operations', grants)).toBe(
      '/admin/logout',
    );
  });

  it('액션이 authed 로 막힌 편집 페이지는 grant 설문이라도 경로 차단 - 해당 설문 overview 로', () => {
    for (const sid of grants) {
      const base = `/admin/surveys/${sid}/operations`;
      const dest = `${base}/overview`;
      expect(guestPathRedirect(`${base}/contacts/upload`, grants)).toBe(dest);
      expect(guestPathRedirect(`${base}/contacts/upload/new`, grants)).toBe(dest);
      expect(guestPathRedirect(`${base}/contacts/result-codes`, grants)).toBe(dest);
      expect(guestPathRedirect(`${base}/contacts/columns`, grants)).toBe(dest);
      expect(guestPathRedirect(`${base}/contacts/assignments`, grants)).toBe(dest);
      expect(guestPathRedirect(`${base}/contacts/assignments/abc`, grants)).toBe(dest);
      expect(guestPathRedirect(`${base}/quota`, grants)).toBe(dest);
      expect(guestPathRedirect(`${base}/scale-mean`, grants)).toBe(dest);
      // 허용 유지 — 컨택 목록·상세·수동 추가는 게스트 허용 procedure 와 짝
      expect(guestPathRedirect(`${base}/contacts`, grants)).toBeNull();
      expect(guestPathRedirect(`${base}/contacts/new`, grants)).toBeNull();
      expect(guestPathRedirect(`${base}/contacts/abc123`, grants)).toBeNull();
    }
  });
});

describe('보기만 하는 게스트 grant', () => {
  const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
  const AI_2026_PUBLIC = '253534a5-913a-4891-a019-f9643ccea0a7';
  const base = `/admin/surveys/${AI_2026_PUBLIC}/operations`;
  const overview = `${base}/overview`;

  it('등록된 계정이 그 설문 grant 를 가질 때만 보기 전용이다', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${AI_2026_PUBLIC},${GUEST9}:other-survey`);
    expect(getViewOnlySurveyIds(GUEST9)).toEqual([AI_2026_PUBLIC]);
    expect(isViewOnlyGuest(GUEST9, AI_2026_PUBLIC)).toBe(true);
    expect(isViewOnlyGuest(GUEST9, 'other-survey')).toBe(false);
    expect(isViewOnlyGuest('guest-other', AI_2026_PUBLIC)).toBe(false);

    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:other-survey`);
    expect(getViewOnlySurveyIds(GUEST9)).toEqual([]);
  });

  it('dairy@(처음 client1@) 은 유가공업 실태조사를 보기만 한다(2026-11-05 고객 계정)', () => {
    const CLIENT1 = '75060289-51b4-44e7-8fd1-dabf73a0bfaf';
    const DAIRY_2026 = '24b15972-36fe-400a-adfe-7d4c80438204';
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${CLIENT1}:${DAIRY_2026}`);
    expect(isViewOnlyGuest(CLIENT1, DAIRY_2026)).toBe(true);
  });

  it('guest11 은 여성기업 사전 설문조사를 보기만 하고 설문 보기는 열지 않는다(2026-11-12)', () => {
    const GUEST11 = '6ca037a8-c282-4bbe-af64-f4f147bf5039';
    const WOMEN_BIZ_2026 = '8f2bc707-5821-4bbb-bc69-fcd7277cd1cb';
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST11}:${WOMEN_BIZ_2026}`);
    expect(isViewOnlyGuest(GUEST11, WOMEN_BIZ_2026)).toBe(true);
    expect(canViewOnlyGuestPreview(GUEST11, WOMEN_BIZ_2026)).toBe(false);
  });

  it('설문 보기를 허용한 보기 전용 grant 는 설문 보기만 더 열린다(dairy@, 2026-11-05)', () => {
    const DAIRY = '75060289-51b4-44e7-8fd1-dabf73a0bfaf';
    const DAIRY_2026 = '24b15972-36fe-400a-adfe-7d4c80438204';
    const dairyBase = `/admin/surveys/${DAIRY_2026}/operations`;
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${DAIRY}:${DAIRY_2026}`);
    const grants = getGuestSurveyIds(DAIRY);
    const only = getViewOnlySurveyIds(DAIRY);
    const previewOk = getViewOnlyPreviewSurveyIds(DAIRY);
    expect(previewOk).toEqual([DAIRY_2026]);
    expect(canViewOnlyGuestPreview(DAIRY, DAIRY_2026)).toBe(true);

    expect(
      guestPathRedirect(`/admin/surveys/${DAIRY_2026}/preview`, grants, only, previewOk),
    ).toBeNull();
    expect(
      guestPostLoginRedirect(`/admin/surveys/${DAIRY_2026}/preview`, grants, only, previewOk),
    ).toBe(`/admin/surveys/${DAIRY_2026}/preview`);
    // 보기 전용의 나머지 제한은 그대로
    expect(guestPathRedirect(`${dairyBase}/report`, grants, only, previewOk)).toBe(
      `${dairyBase}/overview`,
    );
    expect(guestPathRedirect(`${dairyBase}/profiles/r1/edit`, grants, only, previewOk)).toBe(
      `${dairyBase}/overview`,
    );
  });

  it('guest9 의 인공지능 실태조사는 협업 업체 사정으로 설문 보기가 계속 막힌다', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST9}:${AI_2026_PUBLIC}`);
    expect(getViewOnlyPreviewSurveyIds(GUEST9)).toEqual([]);
    expect(canViewOnlyGuestPreview(GUEST9, AI_2026_PUBLIC)).toBe(false);
    expect(
      guestPathRedirect(
        `/admin/surveys/${AI_2026_PUBLIC}/preview`,
        [AI_2026_PUBLIC],
        [AI_2026_PUBLIC],
        getViewOnlyPreviewSurveyIds(GUEST9),
      ),
    ).toBe(overview);
  });

  it('응답 현황·응답 내역 목록 밖의 콘솔 화면과 설문 보기는 응답 현황으로 돌려보낸다', () => {
    const grants = [AI_2026_PUBLIC, 'survey-b'];
    const only = [AI_2026_PUBLIC];
    expect(guestPathRedirect(overview, grants, only)).toBeNull();
    expect(guestPathRedirect(`${overview}/anything`, grants, only)).toBeNull();
    expect(guestPathRedirect(`${base}/profiles`, grants, only)).toBeNull();
    for (const sub of [
      '',
      '/profiles/r1/edit',
      '/profiles/columns',
      '/report',
      '/contacts',
      '/contacts/abc',
      '/mail/campaigns',
      '/demand',
      '/quota',
    ]) {
      expect(guestPathRedirect(`${base}${sub}`, grants, only)).toBe(overview);
    }
    expect(guestPathRedirect(`/admin/surveys/${AI_2026_PUBLIC}/preview`, grants, only)).toBe(
      overview,
    );
    // 같은 계정의 다른 grant 설문은 종전 규칙 그대로
    expect(
      guestPathRedirect('/admin/surveys/survey-b/operations/contacts', grants, only),
    ).toBeNull();
    expect(guestPathRedirect('/admin/surveys/survey-b/preview', grants, only)).toBeNull();
    // grant 밖은 종전대로 강제 로그아웃
    expect(guestPathRedirect('/admin/surveys', grants, only)).toBe('/admin/logout');
  });

  it('로그인 직후 다른 화면이 목적지여도 응답 현황에 정착시킨다', () => {
    const grants = [AI_2026_PUBLIC];
    expect(guestPostLoginRedirect(`${base}/contacts?page=2`, grants, grants)).toBe(overview);
    expect(guestPostLoginRedirect(`${overview}?mode=hour`, grants, grants)).toBe(
      `${overview}?mode=hour`,
    );
  });
});

describe('guestPostLoginRedirect', () => {
  const grants = ['survey-a', 'survey-b'];
  const home = '/admin/surveys/survey-a/operations/overview';

  it('redirect 대상이 grant 설문의 허용 경로면 쿼리까지 그대로 복귀', () => {
    const target = '/admin/surveys/survey-b/operations/contacts?page=2';
    expect(guestPostLoginRedirect(target, grants)).toBe(target);
  });

  it('무권한 설문 콘솔이 대상이면 로그아웃 루프 대신 첫 grant 설문 overview 로', () => {
    expect(guestPostLoginRedirect('/admin/surveys/other/operations/overview', grants)).toBe(home);
  });

  it('기본 목적지(/admin/surveys)·기타 admin 경로는 첫 grant 설문 overview 로', () => {
    expect(guestPostLoginRedirect('/admin/surveys', grants)).toBe(home);
    expect(guestPostLoginRedirect('/analytics', grants)).toBe(home);
  });

  it('grant 설문 안의 차단 편집 화면이 대상이면 해당 설문 overview 로', () => {
    expect(
      guestPostLoginRedirect('/admin/surveys/survey-b/operations/contacts/upload', grants),
    ).toBe('/admin/surveys/survey-b/operations/overview');
  });

  it('로그인·로그아웃 라우트가 대상이면 첫 grant 설문 overview 로', () => {
    expect(guestPostLoginRedirect('/admin/login', grants)).toBe(home);
    expect(guestPostLoginRedirect('/admin/logout', grants)).toBe(home);
  });
});

describe('isForeignSurveyConsolePath', () => {
  const grants = ['survey-a', 'survey-b'];

  it('grant 밖 설문의 operations/preview 경로면 true', () => {
    expect(isForeignSurveyConsolePath('/admin/surveys/other/operations/overview', grants)).toBe(
      true,
    );
    expect(isForeignSurveyConsolePath('/admin/surveys/other/preview', grants)).toBe(true);
    // prefix 오탐 방지 — granted id 로 시작하는 다른 설문 id
    expect(isForeignSurveyConsolePath('/admin/surveys/survey-a-suffix/operations', grants)).toBe(
      true,
    );
  });

  it('grant 설문의 콘솔 경로는 false', () => {
    expect(isForeignSurveyConsolePath('/admin/surveys/survey-a/operations/overview', grants)).toBe(
      false,
    );
    expect(isForeignSurveyConsolePath('/admin/surveys/survey-b/preview', grants)).toBe(false);
  });

  it('설문 콘솔이 아닌 경로는 false - 특정 설문 의도가 없는 접근', () => {
    expect(isForeignSurveyConsolePath('/admin', grants)).toBe(false);
    expect(isForeignSurveyConsolePath('/admin/surveys', grants)).toBe(false);
    expect(isForeignSurveyConsolePath('/admin/surveys/other/edit', grants)).toBe(false);
  });
});

describe('sanitizeInternalPath', () => {
  it('같은 출처 내부 경로는 쿼리·해시와 함께 그대로 통과한다', () => {
    for (const path of [
      '/admin/surveys',
      '/admin/surveys/s1/preview?x=1&y=%2F%2F',
      '/admin/surveys/s1/operations/profiles#row',
    ]) {
      expect(sanitizeInternalPath(path)).toBe(path);
    }
  });

  it('비었거나 상대 경로·절대 URL·protocol-relative 는 거부한다', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'admin',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
    ]) {
      expect(sanitizeInternalPath(raw)).toBeNull();
    }
  });

  it('URL 해석이 지우는 탭·개행이나 역슬래시로 외부 호스트를 만드는 우회를 거부한다', () => {
    for (const raw of [
      '/\t/evil.example/signin',
      '/\n/evil.example',
      '/\r\n/evil.example',
      '/\t\\evil.example',
      '\t//evil.example',
      '/x\\..\\..\\evil',
      '/\u0000/evil.example',
      '/\u007f/evil.example',
    ]) {
      expect(sanitizeInternalPath(raw)).toBeNull();
    }
  });
});
