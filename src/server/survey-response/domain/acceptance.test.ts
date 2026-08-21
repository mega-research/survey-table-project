import { describe, expect, it } from 'vitest';

import {
  completeResponseDenial,
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
    expect(
      reeditDenial(allBad, null, { contactTargetId: 'ct-1', isTest: false, now: NOW }),
    ).toBe('status_not_published');
    expect(ongoingResponseDenial(allBad, { isTest: false })).toBe('survey_paused');
  });

  it('status 를 통과시키면 다음 순위인 survey_paused 가 나온다', () => {
    const paused = survey({ isPaused: true, endDate: new Date(NOW - 1000) });
    expect(
      newResponseDenial(paused, null, { contactTargetId: null, isTest: false, now: NOW }),
    ).toBe('survey_paused');
    expect(
      reeditDenial(paused, null, { contactTargetId: 'ct-1', isTest: false, now: NOW }),
    ).toBe('survey_paused');
  });
});

describe('부분집합', () => {
  it('reeditDenial 은 정원에 반응하지 않는다 (되돌리기가 자기 슬롯을 비운다)', () => {
    const s = survey({ maxResponses: 1 });
    expect(
      reeditDenial(s, null, { contactTargetId: 'ct-1', isTest: false, now: NOW }),
    ).toBeNull();
  });

  it('reeditDenial 은 초대를 검사한다 — 앵커 없는 비공개 응답은 되돌리지 않는다 (B-a)', () => {
    const closed = survey({ isPublic: false });
    const tokenForced = survey({ requireInviteToken: true });
    expect(
      reeditDenial(closed, null, { contactTargetId: null, isTest: false, now: NOW }),
    ).toBe('invite_required');
    expect(
      reeditDenial(tokenForced, null, { contactTargetId: null, isTest: false, now: NOW }),
    ).toBe('invite_required');
    // 앵커가 있으면 통과. 공개 설문의 익명 응답도 술어 자체가 걸리지 않아 통과한다.
    expect(
      reeditDenial(closed, null, { contactTargetId: 'ct-1', isTest: false, now: NOW }),
    ).toBeNull();
    expect(
      reeditDenial(survey(), null, { contactTargetId: null, isTest: false, now: NOW }),
    ).toBeNull();
  });

  it('ongoingResponseDenial 은 중단만 본다 — 진행 중 응답은 마감·폐쇄로 몰수하지 않는다', () => {
    expect(ongoingResponseDenial({ isPaused: false }, { isTest: false })).toBeNull();
    expect(ongoingResponseDenial({ isPaused: true }, { isTest: false })).toBe('survey_paused');
  });
});

describe('completeResponseDenial — 마감은 진행 중 응답을 몰수하지 않는다 (B-b)', () => {
  const PAST = new Date(NOW - 60_000);
  const base = { contactTargetId: 'ct-1', completedCount: 0, isTest: false, now: NOW } as const;

  it('마감이 지나도 완료는 통과한다 — 같은 입력에서 신규 진입은 여전히 거부된다', () => {
    const closed = survey({ endDate: PAST });
    expect(completeResponseDenial(closed, null, base)).toBeNull();
    // 정책 분기의 대조군. create 는 마감을 계속 본다.
    expect(
      newResponseDenial(closed, null, { contactTargetId: 'ct-1', isTest: false, now: NOW }),
    ).toBe('end_date_passed');
  });

  it('마감 + 정원초과는 계속 차단한다 — 사유가 end_date_passed 에서 max_responses_reached 로 승계된다', () => {
    const s = survey({ endDate: PAST, maxResponses: 2 });
    expect(completeResponseDenial(s, null, { ...base, completedCount: 2 })).toBe(
      'max_responses_reached',
    );
    expect(completeResponseDenial(s, null, { ...base, completedCount: 1 })).toBeNull();
    // 종전에는 마감이 먼저 잘라 정원 검사에 도달조차 하지 않았다.
    expect(
      newResponseDenial(s, null, {
        contactTargetId: 'ct-1',
        completedCount: 2,
        isTest: false,
        now: NOW,
      }),
    ).toBe('end_date_passed');
  });

  it('마감 + 중단은 계속 차단한다 (survey_paused)', () => {
    expect(
      completeResponseDenial(survey({ endDate: PAST, isPaused: true }), null, base),
    ).toBe('survey_paused');
  });

  it('마감 외 검사는 신규 진입과 동일하다 — 미배포·초대', () => {
    expect(completeResponseDenial(survey({ status: 'draft' }), null, base)).toBe(
      'status_not_published',
    );
    expect(completeResponseDenial(survey({ status: 'draft' }), { status: 'published' }, base)).toBeNull();
    expect(
      completeResponseDenial(survey({ isPublic: false }), null, {
        ...base,
        contactTargetId: null,
      }),
    ).toBe('invite_required');
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

  it('네 함수 모두 isTest=true 면 전 규칙 위반에도 null 이다', () => {
    expect(
      newResponseDenial(allBad, null, { contactTargetId: null, completedCount: 9, isTest: true, now: NOW }),
    ).toBeNull();
    expect(
      completeResponseDenial(allBad, null, {
        contactTargetId: null,
        completedCount: 9,
        isTest: true,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      reeditDenial(allBad, null, { contactTargetId: null, isTest: true, now: NOW }),
    ).toBeNull();
    expect(ongoingResponseDenial(allBad, { isTest: true })).toBeNull();
  });
});
