import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canAccessSurvey,
  getGuestSurveyIds,
  guestPathRedirect,
  isAdminOrGuestGrantHolder,
  isGuestUser,
  parseGuestGrants,
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
    expect(
      guestPathRedirect('/admin/surveys/survey-b/operations/contacts', grants),
    ).toBeNull();
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

  it('설문 콘솔 외 차단 경로는 첫 grant 설문 overview 로 리다이렉트', () => {
    const dest = '/admin/surveys/survey-a/operations/overview';
    expect(guestPathRedirect('/admin/surveys', grants)).toBe(dest);
    expect(guestPathRedirect('/admin/surveys/survey-a/edit', grants)).toBe(dest);
    expect(guestPathRedirect('/analytics', grants)).toBe(dest);
    expect(guestPathRedirect('/admin/billing/mail-cost', grants)).toBe(dest);
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
      expect(guestPathRedirect(`${base}/quota`, grants)).toBe(dest);
      // 허용 유지 — 컨택 목록·상세·수동 추가는 게스트 허용 procedure 와 짝
      expect(guestPathRedirect(`${base}/contacts`, grants)).toBeNull();
      expect(guestPathRedirect(`${base}/contacts/new`, grants)).toBeNull();
      expect(guestPathRedirect(`${base}/contacts/abc123`, grants)).toBeNull();
    }
  });
});
