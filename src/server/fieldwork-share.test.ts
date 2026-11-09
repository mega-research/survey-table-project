import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveFieldworkShare } from './fieldwork-share';

const SURVEY = '0b000000-0000-4000-8000-000000000001';
const OTHER_SURVEY = '0b000000-0000-4000-8000-000000000002';
const LINK = '0c000000-0000-4000-8000-000000000001';

const account = {
  id: '0d000000-0000-4000-8000-000000000001',
  isSuperadmin: false,
  userType: 'internal' as const,
};

function fieldworkLink(shareDivided: boolean, surveyId = SURVEY) {
  return { kind: 'link' as const, linkId: LINK, surveyId, linkKind: 'fieldwork' as const, shareDivided };
}

describe('담당 범위 해석 — 주체·설문 → 설문 전체 | 이 대상들 | 0명', () => {
  it('계정 주체는 설문 전체를 본다', () => {
    expect(resolveFieldworkShare(account, SURVEY)).toEqual({ kind: 'all' });
  });

  it('한 번도 나누지 않은 외주 링크는 설문 전체를 본다 — 업체 하나인 설문은 지금 그대로다', () => {
    expect(resolveFieldworkShare(fieldworkLink(false), SURVEY)).toEqual({ kind: 'all' });
  });

  it('나눈 적 있는 외주 링크는 그 링크의 범위만 본다', () => {
    expect(resolveFieldworkShare(fieldworkLink(true), SURVEY)).toEqual({ kind: 'targets', linkId: LINK });
  });

  it('링크가 자기 설문이 아닌 설문을 물으면 0명으로 닫는다 — 나누지 않았어도', () => {
    expect(resolveFieldworkShare(fieldworkLink(false, OTHER_SURVEY), SURVEY)).toEqual({ kind: 'none' });
    expect(resolveFieldworkShare(fieldworkLink(true, OTHER_SURVEY), SURVEY)).toEqual({ kind: 'none' });
  });

  it('클라이언트 링크에는 담당 범위 축이 없다', () => {
    const client = {
      kind: 'link' as const,
      linkId: LINK,
      surveyId: SURVEY,
      linkKind: 'client' as const,
      clientTabs: { overview: true, report: false, contacts: false, quota: false } as never,
    };
    expect(resolveFieldworkShare(client, SURVEY)).toEqual({ kind: 'all' });
  });
});
