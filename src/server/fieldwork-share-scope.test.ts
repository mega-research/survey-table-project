import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FIELDWORK_SHARE_ALL,
  isShareRestricted,
  resolveGuestShare,
  shareAttrStamp,
  shareTargetCondition,
  shareTargetSql,
} from './fieldwork-share-scope';

afterEach(() => vi.unstubAllEnvs());

// guest-grants.ts 의 GUEST_TARGET_SHARES 에 박힌 실제 쌍
const FROM2 = 'ddcdc638-3cc2-4a84-acd9-204b66b57e28';
const PRIME2 = '882ddaa3-f52b-4c7b-8837-0dcffc44575d';
const SURVEY = '1b88ae5a-257a-40ad-80a4-a6a698fde05a';

/**
 * 담당 범위 해석 — 계정·설문을 「전체 · 이 대상들 · 0명」으로 접는다. 술어가 실제로 무엇을 거르는지(SQL)는
 * 실DB 스위트(tests/integration/guest-target-share.realdb.test.ts)가 본다.
 */
describe('resolveGuestShare', () => {
  it('grant 가 없는 계정(관리자)은 설문 전체다', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${FROM2}:${SURVEY}`);
    expect(resolveGuestShare('admin-1', SURVEY)).toEqual(FIELDWORK_SHARE_ALL);
  });

  it('범위 등재가 없는 게스트는 자기 grant 설문 전체다', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY}`);
    expect(resolveGuestShare('guest-1', SURVEY)).toEqual(FIELDWORK_SHARE_ALL);
  });

  it('등재된 게스트는 그 명단 값의 대상만이다 — 계정마다 값이 다르다', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${FROM2}:${SURVEY},${PRIME2}:${SURVEY}`);
    expect(resolveGuestShare(FROM2, SURVEY)).toEqual({
      kind: 'targets',
      surveyId: SURVEY,
      attrsKey: '실사업체',
      value: '프롬',
    });
    expect(resolveGuestShare(PRIME2, SURVEY)).toMatchObject({ kind: 'targets', value: '프라임' });
  });

  it('게스트가 자기 grant 밖 설문을 물으면 0명으로 닫는다(넓어지지 않는다)', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${FROM2}:${SURVEY}`);
    expect(resolveGuestShare(FROM2, 'other-survey')).toEqual({ kind: 'none' });
  });
});

describe('담당 범위 술어', () => {
  const targets = { kind: 'targets', surveyId: SURVEY, attrsKey: '실사업체', value: '프롬' } as const;

  it('전체면 조건이 없고(and 가 건너뛴다), 날 SQL 자리에는 TRUE 다', () => {
    expect(shareTargetCondition(FIELDWORK_SHARE_ALL)).toBeUndefined();
    expect(shareTargetSql(FIELDWORK_SHARE_ALL)).toBeDefined();
    expect(isShareRestricted(FIELDWORK_SHARE_ALL)).toBe(false);
  });

  it('범위가 걸리면 조건이 생긴다 — 0명도 조건이다', () => {
    expect(shareTargetCondition(targets)).toBeDefined();
    expect(shareTargetCondition({ kind: 'none' })).toBeDefined();
    expect(isShareRestricted(targets)).toBe(true);
    expect(isShareRestricted({ kind: 'none' })).toBe(true);
  });

  it('범위 게스트가 쓰는 대상에 찍을 값은 범위가 걸렸을 때만 있다', () => {
    expect(shareAttrStamp(targets)).toEqual({ attrsKey: '실사업체', value: '프롬' });
    expect(shareAttrStamp(FIELDWORK_SHARE_ALL)).toBeNull();
    expect(shareAttrStamp({ kind: 'none' })).toBeNull();
  });
});
