import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isAdminUserAllowed,
  parseAdminAllowlist,
  resetAdminAllowlistWarningForTest,
} from '@/lib/auth/admin-allowlist';

const ENV_KEY = 'ADMIN_USER_IDS';

describe('parseAdminAllowlist', () => {
  it('미설정(undefined)이면 빈 Set 을 반환한다', () => {
    const result = parseAdminAllowlist(undefined);
    expect(result.size).toBe(0);
  });

  it('빈 문자열이면 빈 Set 을 반환한다', () => {
    expect(parseAdminAllowlist('').size).toBe(0);
  });

  it('공백만 있으면 빈 Set 을 반환한다', () => {
    expect(parseAdminAllowlist('   ').size).toBe(0);
  });

  it('단일 항목을 파싱한다', () => {
    const result = parseAdminAllowlist('user-1');
    expect([...result]).toEqual(['user-1']);
  });

  it('콤마로 여러 항목을 분리한다', () => {
    const result = parseAdminAllowlist('user-1,user-2,user-3');
    expect([...result]).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('각 항목의 앞뒤 공백을 trim 한다', () => {
    const result = parseAdminAllowlist(' user-1 , user-2 ');
    expect([...result]).toEqual(['user-1', 'user-2']);
  });

  it('빈 항목(연속 콤마/끝 콤마)을 제거한다', () => {
    const result = parseAdminAllowlist('user-1,,user-2,');
    expect([...result]).toEqual(['user-1', 'user-2']);
  });

  it('중복 항목을 합친다', () => {
    const result = parseAdminAllowlist('user-1,user-1,user-2');
    expect([...result]).toEqual(['user-1', 'user-2']);
  });
});

describe('isAdminUserAllowed', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAdminAllowlistWarningForTest();
    delete process.env[ENV_KEY];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env[ENV_KEY];
  });

  it('미설정이면 fail-open 으로 통과시킨다', () => {
    expect(isAdminUserAllowed('any-user')).toBe(true);
  });

  it('미설정 경고를 최초 1회만 출력한다', () => {
    isAdminUserAllowed('user-a');
    isAdminUserAllowed('user-b');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('설정 상태에서 허용 목록에 있는 user 는 통과한다', () => {
    process.env[ENV_KEY] = 'user-1,user-2';
    expect(isAdminUserAllowed('user-2')).toBe(true);
  });

  it('설정 상태에서 허용 목록에 없는 user 는 차단한다', () => {
    process.env[ENV_KEY] = 'user-1,user-2';
    expect(isAdminUserAllowed('intruder')).toBe(false);
  });

  it('설정 상태에서는 경고를 출력하지 않는다', () => {
    process.env[ENV_KEY] = 'user-1';
    isAdminUserAllowed('user-1');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
