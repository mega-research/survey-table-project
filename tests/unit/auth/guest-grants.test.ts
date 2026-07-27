import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  canAccessSurvey,
  getGuestSurveyId,
  guestPathRedirect,
  parseGuestGrants,
} from '@/lib/auth/guest-grants';

afterEach(() => vi.unstubAllEnvs());

describe('parseGuestGrants', () => {
  it('userId:surveyId 콤마 목록을 Map 으로 파싱한다', () => {
    const map = parseGuestGrants('u1:s1, u2:s2');
    expect(map.get('u1')).toBe('s1');
    expect(map.get('u2')).toBe('s2');
  });

  it('빈 값·공백·형식 오류 항목은 무시한다', () => {
    expect(parseGuestGrants(undefined).size).toBe(0);
    expect(parseGuestGrants('').size).toBe(0);
    expect(parseGuestGrants(' , u1 , :s1, u2: ').size).toBe(0);
  });
});

describe('getGuestSurveyId', () => {
  it('grant 있으면 surveyId, 없으면 null', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(getGuestSurveyId('guest-1')).toBe('survey-a');
    expect(getGuestSurveyId('other')).toBeNull();
  });
});

describe('canAccessSurvey', () => {
  it('admin allowlist 통과자는 어느 설문이든 true', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(canAccessSurvey('admin-1', 'survey-x')).toBe(true);
  });

  it('게스트는 grant 설문만 true', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(canAccessSurvey('guest-1', 'survey-a')).toBe(true);
    expect(canAccessSurvey('guest-1', 'survey-b')).toBe(false);
  });

  it('allowlist 밖 + grant 없음은 false', () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    expect(canAccessSurvey('nobody', 'survey-a')).toBe(false);
  });

  it('allowlist 미설정 fail-open 이어도 grant 보유자는 자기 설문만 접근한다', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    expect(canAccessSurvey('guest-1', 'survey-a')).toBe(true);
    expect(canAccessSurvey('guest-1', 'survey-b')).toBe(false);
  });
});

describe('guestPathRedirect', () => {
  const sid = 'survey-a';

  it('허용 경로는 null (operations prefix + 로그인)', () => {
    expect(guestPathRedirect(`/admin/surveys/${sid}/operations`, sid)).toBeNull();
    expect(guestPathRedirect(`/admin/surveys/${sid}/operations/contacts`, sid)).toBeNull();
    expect(guestPathRedirect('/admin/login', sid)).toBeNull();
  });

  it('차단 경로는 overview 로 리다이렉트', () => {
    const dest = `/admin/surveys/${sid}/operations/overview`;
    expect(guestPathRedirect('/admin/surveys', sid)).toBe(dest);
    expect(guestPathRedirect(`/admin/surveys/${sid}/edit`, sid)).toBe(dest);
    expect(guestPathRedirect('/admin/surveys/other/operations', sid)).toBe(dest);
    expect(guestPathRedirect('/analytics', sid)).toBe(dest);
    expect(guestPathRedirect('/admin/billing/mail-cost', sid)).toBe(dest);
  });

  it('operations 로 시작하지만 다른 설문이면 차단 - prefix 오탐 방지', () => {
    expect(guestPathRedirect(`/admin/surveys/${sid}-suffix/operations`, sid)).toBe(
      `/admin/surveys/${sid}/operations/overview`,
    );
  });
});
