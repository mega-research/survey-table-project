import { describe, expect, it } from 'vitest';

import { normalizeSlug } from '@/features/survey-builder/server/services/survey-save.service';

/**
 * M65 회귀: 빈 slug 정규화.
 *
 * store 는 사용자가 커스텀 URL 입력을 비우면 slug:'' 를 그대로 전송한다(undefined 가 아님).
 * slug 컬럼은 UNIQUE 이고 Postgres 는 여러 NULL 은 충돌로 보지 않지만 여러 '' 는 충돌로 본다.
 * 따라서 '' 를 그대로 쓰면 두 번째 빈 slug 저장에서 raw unique-constraint 에러가 난다.
 * normalizeSlug 는 '' / 공백을 null 로 변환해 컬럼 의미(미설정 = NULL)에 맞춘다.
 */
describe('normalizeSlug (M65 회귀)', () => {
  it("빈 문자열('')은 null 로 정규화한다", () => {
    expect(normalizeSlug('')).toBeNull();
  });

  it('공백만 있는 문자열은 null 로 정규화한다', () => {
    expect(normalizeSlug('   ')).toBeNull();
  });

  it('undefined 는 null 로 정규화한다', () => {
    expect(normalizeSlug(undefined)).toBeNull();
  });

  it('null 은 null 로 유지한다', () => {
    expect(normalizeSlug(null)).toBeNull();
  });

  it('유효한 slug 는 그대로 보존한다', () => {
    expect(normalizeSlug('my-survey')).toBe('my-survey');
  });

  it('한글 slug 도 보존한다', () => {
    expect(normalizeSlug('설문조사')).toBe('설문조사');
  });

  it('앞뒤 공백은 제거한 값을 반환한다', () => {
    expect(normalizeSlug('  my-survey  ')).toBe('my-survey');
  });
});
