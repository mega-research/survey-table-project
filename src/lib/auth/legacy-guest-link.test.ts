import { describe, expect, it } from 'vitest';

import { legacyConsoleStaffPath, parseLegacyGuestSurveyIds } from '@/lib/auth/legacy-guest-link';

const S1 = '9f550d8b-24d2-4b19-b5d7-00684e0d8644';
const S2 = '643147f7-93fa-495a-9c78-b0fccb9e776e';
const U1 = '7ea4b5f9-a128-474c-bf87-270498629281';
const U2 = '8d9d98dc-0aed-44e0-b8fb-9596ef30227a';

describe('parseLegacyGuestSurveyIds', () => {
  it('옛 grant 목록에서 설문 id 만 모은다', () => {
    const ids = parseLegacyGuestSurveyIds(`${U1}:${S1},${U2}:${S2}`);
    expect([...ids].sort()).toEqual([S1, S2].sort());
  });

  it('한 설문을 두 계정이 가져도 한 번만 센다', () => {
    expect(parseLegacyGuestSurveyIds(`${U1}:${S1}, ${U2}:${S1}`).size).toBe(1);
  });

  it('대소문자를 접는다 — 주소의 id 가 대문자로 와도 같은 설문이다', () => {
    expect(parseLegacyGuestSurveyIds(`${U1}:${S1.toUpperCase()}`).has(S1)).toBe(true);
  });

  it('비어 있으면 다리가 꺼진다', () => {
    expect(parseLegacyGuestSurveyIds(undefined).size).toBe(0);
    expect(parseLegacyGuestSurveyIds('').size).toBe(0);
  });

  it('모양이 틀린 항목은 버린다 — UUID 가 아닌 값이 조회로 흘러가지 않는다', () => {
    const ids = parseLegacyGuestSurveyIds(
      `${U1}:${S1},깨진항목,${U2}:,:${S2},${U2}:not-a-uuid`,
    );
    expect([...ids]).toEqual([S1]);
  });
});

describe('legacyConsoleStaffPath', () => {
  it('접두를 걷은 운영 콘솔 주소를 만든다', () => {
    expect(legacyConsoleStaffPath(S1, ['contacts', 'abc'])).toBe(
      `/surveys/${S1}/operations/contacts/abc`,
    );
  });

  it('탭 없는 주소는 응답 현황으로 보낸다 — 그 주소 자체에는 페이지가 없어 404 가 된다', () => {
    expect(legacyConsoleStaffPath(S1, [])).toBe(`/surveys/${S1}/operations/overview`);
    expect(legacyConsoleStaffPath(S1, ['..', '.'])).toBe(`/surveys/${S1}/operations/overview`);
  });

  it('세그먼트를 인코딩하고 점 세그먼트를 버린다 — 실려 온 값이 콘솔 경로를 벗어나지 못한다', () => {
    expect(legacyConsoleStaffPath('a/b', ['..', '.', 'x y'])).toBe(
      '/surveys/a%2Fb/operations/x%20y',
    );
  });
});
