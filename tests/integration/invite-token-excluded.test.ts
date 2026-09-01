import { describe, expect, it, beforeEach, vi } from 'vitest';
import { extractRawSql } from './_helpers/result-code-mock';

// ========================
// 모듈 모킹
// ========================
//
// findContactByInviteToken 은 다음에 의존한다:
// - @/db 의 drizzle client (db.execute - RPC lookup 1회 + excluded EXISTS 1회)
// - getResultCodeStatuses (surveys.contact_result_codes → negative codes)
//
// 진짜 PG 가 없는 vitest 환경에서 SQL 의미를 JS 로 시뮬레이션:
//   1) lookup_contact_by_invite_token RPC → 등록된 token → contactTargetId
//   2) excluded EXISTS — unsubscribed_at 또는 negative result_code 매칭
//
// extractRawSql / mockBuildNegativeCodeExists 는 _helpers/result-code-mock 공통화.
// Task 4 (report-progress-exclusion.test.ts) 의 mock 패턴과 동일.

interface SeedContact {
  id: string;
  surveyId: string;
  inviteToken: string;
  unsubscribedAt: Date | null;
  attempts: string[];
}

interface FakeState {
  contacts: SeedContact[];
  negativeCodes: string[];
}

const state: FakeState = {
  contacts: [],
  negativeCodes: [],
};

function findByToken(token: string): SeedContact | undefined {
  return state.contacts.find((c) => c.inviteToken === token);
}

function isExcluded(c: SeedContact): boolean {
  if (c.unsubscribedAt) return true;
  if (state.negativeCodes.length === 0) return false;
  return c.attempts.some((a) => state.negativeCodes.includes(a));
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// SQL 패턴 식별 후 in-memory 결과 직조
function executeMock(sqlObj: unknown): unknown[] {
  const lower = extractRawSql(sqlObj).toLowerCase();

  // 1) RPC lookup: SELECT public.lookup_contact_by_invite_token(<surveyId>, <inviteToken>) AS id
  if (lower.includes('lookup_contact_by_invite_token')) {
    const uuids = lower.match(UUID_RE) ?? [];
    // 첫번째 UUID = surveyId, 두번째 = inviteToken
    const inviteToken = uuids[1] ?? '';
    const found = findByToken(inviteToken);
    return [{ id: found?.id ?? null }];
  }

  // 2) excluded EXISTS: SELECT 1 FROM contact_targets ct WHERE ct.id = <contactTargetId> AND (...)
  if (lower.includes('contact_targets') && lower.includes('unsubscribed_at')) {
    const uuids = lower.match(UUID_RE) ?? [];
    // 첫번째 UUID = contactTargetId
    const contactTargetId = uuids[0] ?? '';
    const contact = state.contacts.find((c) => c.id === contactTargetId);
    if (!contact) return [];
    return isExcluded(contact) ? [{ '?column?': 1 }] : [];
  }

  return [];
}

vi.mock('@/db', () => ({
  db: {
    execute: vi.fn((sqlObj: unknown) => Promise.resolve(executeMock(sqlObj))),
    query: {
      contactTargets: {
        findFirst: vi.fn(async () => {
          const contact = state.contacts[0];
          if (!contact) return undefined;
          return {
            id: contact.id,
            surveyId: contact.surveyId,
            respondedAt: null,
            isTest: false,
            survey: { testModeEnabled: true, deletedAt: null },
          };
        }),
      },
    },
  },
}));

vi.mock('@/lib/operations/result-code-statuses.server', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => ({
      positive: [],
      negative: state.negativeCodes,
    })),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { findContactByInviteToken } from '@/lib/duplicate-detection/invite-lookup';
import { randomUUID } from 'crypto';

const SURVEY_ID = '00000000-0000-4000-8000-000000000020';

interface SeedContactInput {
  unsubscribed?: boolean;
  attempts?: string[];
}

function seedContact(opts: SeedContactInput = {}): { id: string; inviteToken: string } {
  const id = randomUUID();
  const inviteToken = randomUUID();
  state.contacts.push({
    id,
    surveyId: SURVEY_ID,
    inviteToken,
    unsubscribedAt: opts.unsubscribed ? new Date() : null,
    attempts: opts.attempts ?? [],
  });
  return { id, inviteToken };
}

// 2026-09-01 결정: 수신거부는 메일 채널 해지일 뿐 응답 자격이 아니고, 부정 결과코드도 초대 링크
// 응답을 막지 않는다 — 초대 링크로는 어떤 경우에도 응답할 수 있어야 한다 (운영 요청).
describe('findContactByInviteToken — 수신거부·부정 결과코드 컨택도 valid', () => {
  beforeEach(() => {
    state.contacts = [];
    state.negativeCodes = ['수신거부'];
  });

  it('정상 ct → valid', async () => {
    const { id, inviteToken } = seedContact();
    const result = await findContactByInviteToken(SURVEY_ID, inviteToken);
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      expect(result.contactTargetId).toBe(id);
      expect(result.isTest).toBe(false);
    }
  });

  it('부정 결과코드(수신거부) 마킹 컨택도 valid — 링크 응답은 막지 않는다', async () => {
    const { id, inviteToken } = seedContact({ attempts: ['수신거부'] });
    const result = await findContactByInviteToken(SURVEY_ID, inviteToken);
    expect(result).toMatchObject({ kind: 'valid', contactTargetId: id });
  });

  it('unsubscribed_at IS NOT NULL(메일 해지) 컨택도 valid', async () => {
    const { id, inviteToken } = seedContact({ unsubscribed: true });
    const result = await findContactByInviteToken(SURVEY_ID, inviteToken);
    expect(result).toMatchObject({ kind: 'valid', contactTargetId: id });
  });

  it('무효 토큰 → invalid', async () => {
    const result = await findContactByInviteToken(SURVEY_ID, randomUUID());
    expect(result.kind).toBe('invalid');
  });
});
