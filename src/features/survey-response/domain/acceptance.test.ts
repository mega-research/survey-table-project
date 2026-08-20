import { describe, expect, it } from 'vitest';

import {
  newResponseDenial,
  ongoingResponseDenial,
  reeditDenial,
  type SurveyAcceptanceState,
} from './acceptance';

const NOW = new Date('2026-08-20T00:00:00.000Z').getTime();

function survey(over: Partial<SurveyAcceptanceState> = {}): SurveyAcceptanceState {
  return {
    status: 'published',
    isPaused: false,
    endDate: null,
    maxResponses: null,
    isPublic: true,
    requireInviteToken: false,
    ...over,
  };
}

const OK = { contactTargetId: 'ct-1', isTest: false, now: NOW } as const;

describe('newResponseDenial — 술어 경계', () => {
  it('설문 published 이거나 버전 published 면 통과, 둘 다 아니면 거부', () => {
    expect(newResponseDenial(survey(), null, OK)).toBeNull();
    expect(newResponseDenial(survey({ status: 'draft' }), { status: 'published' }, OK)).toBeNull();
    expect(newResponseDenial(survey(), { status: 'superseded' }, OK)).toBeNull();
    expect(newResponseDenial(survey({ status: 'draft' }), null, OK)).toBe('status_not_published');
    expect(newResponseDenial(survey({ status: 'closed' }), { status: 'closed' }, OK)).toBe(
      'status_not_published',
    );
  });

  it('마감 경계는 <= 다 — endDate === now 는 거부, +1ms 는 통과, null 은 무제한', () => {
    expect(newResponseDenial(survey({ endDate: new Date(NOW) }), null, OK)).toBe('end_date_passed');
    expect(newResponseDenial(survey({ endDate: new Date(NOW + 1) }), null, OK)).toBeNull();
    expect(newResponseDenial(survey({ endDate: null }), null, OK)).toBeNull();
  });

  it('정원은 completedCount 를 받은 호출자만 하드체크한다', () => {
    const s = survey({ maxResponses: 2 });
    // completedCount 미전달 = create 시점 soft.
    expect(newResponseDenial(s, null, OK)).toBeNull();
    expect(newResponseDenial(s, null, { ...OK, completedCount: 1 })).toBeNull();
    expect(newResponseDenial(s, null, { ...OK, completedCount: 2 })).toBe('max_responses_reached');
    expect(newResponseDenial(s, null, { ...OK, completedCount: 3 })).toBe('max_responses_reached');
    // maxResponses 가 null 이면 카운트가 아무리 커도 통과.
    expect(newResponseDenial(survey(), null, { ...OK, completedCount: 999 })).toBeNull();
  });

  it('invite 는 isPublic=false 또는 requireInviteToken 두 갈래 모두에서 걸린다', () => {
    const noContact = { ...OK, contactTargetId: null };
    expect(newResponseDenial(survey({ isPublic: false }), null, noContact)).toBe('invite_required');
    expect(newResponseDenial(survey({ requireInviteToken: true }), null, noContact)).toBe(
      'invite_required',
    );
    expect(newResponseDenial(survey({ isPublic: false }), null, OK)).toBeNull();
    expect(newResponseDenial(survey(), null, noContact)).toBeNull();
  });
});

describe('판정 순서 불변식', () => {
  const allBad = survey({
    status: 'draft',
    isPaused: true,
    endDate: new Date(NOW - 1000),
    maxResponses: 1,
    isPublic: false,
    requireInviteToken: true,
  });

  it('각 함수는 자기 검사 집합 ∩ CHECK_ORDER 의 첫 항을 돌려준다', () => {
    expect(
      newResponseDenial(allBad, null, { contactTargetId: null, completedCount: 9, isTest: false, now: NOW }),
    ).toBe('status_not_published');
    expect(reeditDenial(allBad, null, { isTest: false, now: NOW })).toBe('status_not_published');
    expect(ongoingResponseDenial(allBad, { isTest: false })).toBe('survey_paused');
  });

  it('status 를 통과시키면 다음 순위인 survey_paused 가 나온다', () => {
    const paused = survey({ isPaused: true, endDate: new Date(NOW - 1000) });
    expect(
      newResponseDenial(paused, null, { contactTargetId: null, isTest: false, now: NOW }),
    ).toBe('survey_paused');
    expect(reeditDenial(paused, null, { isTest: false, now: NOW })).toBe('survey_paused');
  });
});

describe('부분집합', () => {
  it('reeditDenial 은 정원·초대에 반응하지 않는다 (의도된 미검사)', () => {
    const s = survey({ maxResponses: 1, isPublic: false, requireInviteToken: true });
    expect(reeditDenial(s, null, { isTest: false, now: NOW })).toBeNull();
  });

  it('ongoingResponseDenial 은 중단만 본다 — status·endDate 에 반응하지 않는다', () => {
    expect(ongoingResponseDenial({ isPaused: false }, { isTest: false })).toBeNull();
    expect(ongoingResponseDenial({ isPaused: true }, { isTest: false })).toBe('survey_paused');
  });
});

describe('isTest 면제', () => {
  const allBad = survey({
    status: 'draft',
    isPaused: true,
    endDate: new Date(NOW - 1000),
    maxResponses: 1,
    isPublic: false,
  });

  it('세 함수 모두 isTest=true 면 전 규칙 위반에도 null 이다', () => {
    expect(
      newResponseDenial(allBad, null, { contactTargetId: null, completedCount: 9, isTest: true, now: NOW }),
    ).toBeNull();
    expect(reeditDenial(allBad, null, { isTest: true, now: NOW })).toBeNull();
    expect(ongoingResponseDenial(allBad, { isTest: true })).toBeNull();
  });
});
