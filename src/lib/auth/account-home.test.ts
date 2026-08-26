/**
 * 계정 유형별 홈과 로그인 직후 목적지 (역할 모델 v2 티켓 05).
 *
 * 이 파일이 지키는 것은 "유형마다 갈 곳이 있다" 는 것 하나다. 티켓 03 이 계정 유형 게이트를
 * 앞당겨 넣은 뒤로 guest·fieldwork 계정은 로그인은 되는데 목적지가 없어 내부 화면에서 거부만
 * 됐다 — 유형이 늘거나 홈 경로가 바뀔 때 이 표가 유일한 출처여야 그 상태로 되돌아가지 않는다.
 */
import { describe, expect, it } from 'vitest';

import type { UserType } from '@/shared/contracts/auth';
import { userTypeValues } from '@/shared/contracts/auth';

import {
  ACCOUNT_HOME_PATH,
  accountHomePath,
  isAccountTypePath,
  resolvePostLoginDestination,
} from './account-home';

describe('accountHomePath', () => {
  it.each([
    ['internal', '/admin/surveys'],
    ['guest', '/guest'],
    ['fieldwork', '/fieldwork'],
  ] as const)('%s 의 홈은 %s', (userType, expected) => {
    expect(accountHomePath(userType)).toBe(expected);
  });

  it('유형 어휘 전체에 홈이 있다 (목적지 없는 유형을 만들지 않는다)', () => {
    for (const userType of userTypeValues) {
      expect(ACCOUNT_HOME_PATH[userType]).toMatch(/^\//);
    }
  });

  it('홈 경로는 유형마다 다르다', () => {
    const homes = userTypeValues.map((t) => accountHomePath(t));
    expect(new Set(homes).size).toBe(homes.length);
  });
});

describe('isAccountTypePath — 이 경로가 어느 유형의 구역인가', () => {
  it('게스트·실사 구역은 자기 유형만 인정한다', () => {
    expect(isAccountTypePath('/guest', 'guest')).toBe(true);
    expect(isAccountTypePath('/guest/surveys/abc', 'guest')).toBe(true);
    expect(isAccountTypePath('/guest', 'fieldwork')).toBe(false);
    expect(isAccountTypePath('/fieldwork/surveys/abc', 'fieldwork')).toBe(true);
    expect(isAccountTypePath('/fieldwork', 'internal')).toBe(false);
  });

  it('접두어만 같은 남의 경로를 자기 구역으로 착각하지 않는다', () => {
    // /guestbook 은 /guest 로 시작하지만 게스트 구역이 아니다.
    expect(isAccountTypePath('/guestbook', 'guest')).toBe(false);
    expect(isAccountTypePath('/fieldworker', 'fieldwork')).toBe(false);
  });
});

describe('resolvePostLoginDestination', () => {
  it('내부 계정은 요청한 목적지로 그대로 간다', () => {
    expect(resolvePostLoginDestination('internal', '/admin/surveys/abc/edit')).toBe(
      '/admin/surveys/abc/edit',
    );
  });

  it('게스트·실사는 자기 구역 안의 목적지만 존중한다', () => {
    expect(resolvePostLoginDestination('guest', '/guest/surveys/abc/overview')).toBe(
      '/guest/surveys/abc/overview',
    );
    expect(resolvePostLoginDestination('fieldwork', '/fieldwork/surveys/abc/contacts')).toBe(
      '/fieldwork/surveys/abc/contacts',
    );
  });

  it('게스트·실사가 내부 경로를 요청하면 자기 홈으로 접는다', () => {
    // 그대로 보내면 admin 게이트가 되돌려 보내 로그인 화면을 오가게 된다.
    expect(resolvePostLoginDestination('guest', '/admin/surveys')).toBe('/guest');
    expect(resolvePostLoginDestination('fieldwork', '/admin/surveys/abc/operations')).toBe(
      '/fieldwork',
    );
    expect(resolvePostLoginDestination('guest', '/fieldwork')).toBe('/guest');
  });

  it('세 유형 모두 프로필 목적지는 존중한다 (자기 계정 화면은 공통)', () => {
    for (const userType of userTypeValues satisfies readonly UserType[]) {
      expect(resolvePostLoginDestination(userType, '/admin/profile')).toBe('/admin/profile');
    }
  });

  it('목적지가 없으면 자기 홈으로 간다', () => {
    expect(resolvePostLoginDestination('guest', '')).toBe('/guest');
    expect(resolvePostLoginDestination('internal', '')).toBe('/admin/surveys');
  });

  it('로그인·로그아웃 라우트는 목적지가 될 수 없다', () => {
    // 되돌려 보내면 그대로 로그인 화면을 오가는 루프가 된다.
    expect(resolvePostLoginDestination('internal', '/admin/login')).toBe('/admin/surveys');
    expect(resolvePostLoginDestination('guest', '/admin/logout')).toBe('/guest');
  });
});
