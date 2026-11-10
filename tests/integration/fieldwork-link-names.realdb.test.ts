/**
 * 내부 기록의 「외주 · 이름표」 — 실 로컬 DB (fieldwork-multi-company 티켓 02).
 *
 * 한 설문을 외주 업체 여럿이 뛰면 연구원은 회차·대상 정보 수정 현황·응답 수정 이력에서 **어느
 * 링크가 남긴 줄인가**를 알아야 한다(이중 전화 항의). 이름표는 링크의 메모라 **읽는 시점의 것**이고
 * (고치면 지난 줄도 새 이름표로 보인다), 외주 콘솔에는 여전히 「외주」 하나만 실린다.
 *
 * 관찰 지점은 조사 대상 상세의 조립(`ContactDetailScreen`)이 화면에 넘기는 props 다 — 그것이 곧
 * RSC payload 다. 두 콘솔이 같은 조립을 쓰고 갈리는 것은 외주 트리가 켜는 `hideStaffEmails` 하나다.
 *
 * 실 DB 인 이유: 기록 행이 가리키는 링크 id 를 이름표로 바꾸는 것은 조인·조회의 일이라 목이 무엇을
 * 돌려주든 통과한다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ContactDetailScreen } from '@/app/_operations/contact-detail-screen';
import { db } from '@/db';
import { contactTargets, responseEditLogs, surveys, users } from '@/db/schema';
import { linkContactEditor } from '@/server/contacts/domain/contact-target-edit';
import { addAttempt, updateAttempt } from '@/server/contacts/services/contact-attempts';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';
import { issueAccessLink, setAccessLinkLabel } from '@/server/workspace/services/access-links';
import type { SurveyCapability } from '@/shared/contracts/workspace';

// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

const OWNER_ID = randomUUID();
const OWNER_EMAIL = `names-${OWNER_ID}@local`;

/** 상세 화면이 응답 편집 이력·대상 정보 수정 현황을 함께 읽는 권한 묶음 — 두 콘솔이 같다. */
const CAPABILITIES: ReadonlySet<SurveyCapability> = new Set([
  'contacts.view',
  'contacts.writeAttempts',
  'responses.view',
  'responses.edit',
] as SurveyCapability[]);

/** React 요소 트리를 문자열로 — RSC 가 직렬화하는 것은 props 뿐이라 그것만 따라간다. */
function payloadOf(node: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(node, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
}

run('내부 기록의 외주 이름표 (real DB)', () => {
  let surveyId = '';
  let targetId = '';
  let linkA = '';
  let linkB = '';

  beforeAll(async () => {
    await db.insert(users).values({
      id: OWNER_ID,
      name: '이름표 발급자',
      email: OWNER_EMAIL,
      emailVerified: true,
      status: 'active',
      userType: 'internal',
    });
    surveyId = randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '이름표 조사',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
      contactColumns: { columns: [] } as never,
    });
    targetId = randomUUID();
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 1,
      isTest: false,
      attrs: {},
      inviteCode: randomUUID(),
    });

    // 링크 A 는 이름표 「프롬」, 링크 B 는 이름표 없이 — B 는 발급 순번 2 로 구별된다.
    linkA = (await issueAccessLink({ surveyId, kind: 'fieldwork', label: '프롬', actorId: OWNER_ID })).link.id;
    linkB = (await issueAccessLink({ surveyId, kind: 'fieldwork', actorId: OWNER_ID })).link.id;

    // 회차: A 가 하나, B 가 하나, 연구원이 하나.
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려' },
      true,
      { accountUserId: null, fieldworkLinkId: linkA },
      linkContactEditor(linkA),
      FIELDWORK_SHARE_ALL,
    );
    await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '14. 부재' },
      true,
      { accountUserId: null, fieldworkLinkId: linkB },
      linkContactEditor(linkB),
      FIELDWORK_SHARE_ALL,
    );
    await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '15. 거절' },
      false,
      { accountUserId: OWNER_ID, fieldworkLinkId: null },
      { id: OWNER_ID, email: OWNER_EMAIL },
      FIELDWORK_SHARE_ALL,
    );
    // 대상 정보 수정 현황: A 가 자기 회차를 고친 줄.
    await updateAttempt(
      { id: added.id, contactTargetId: targetId, surveyId, resultCode: '16. 재통화', note: '오후' },
      true,
      linkContactEditor(linkA),
      FIELDWORK_SHARE_ALL,
    );
    // 응답 수정 이력: B 가 고친 줄 — 링크가 고친 행은 계정 칸·이메일이 빈다.
    await db.insert(responseEditLogs).values({
      surveyId,
      contactTargetId: targetId,
      responseId: null,
      action: 'reset',
      editedBy: null,
      editorEmail: null,
      fieldworkLinkId: linkB,
    });
  });

  afterAll(async () => {
    if (surveyId) await db.delete(surveys).where(eq(surveys.id, surveyId));
    await db.delete(users).where(eq(users.id, OWNER_ID));
  });

  async function screenProps(console: 'internal' | 'link') {
    const element = (await ContactDetailScreen({
      surveyId,
      contactId: targetId,
      basePath: '/x',
      capabilities: CAPABILITIES,
      scope: 'real',
      share: FIELDWORK_SHARE_ALL,
      canProxyRespond: false,
      hideStaffEmails: console === 'link',
    })) as { props: { children: unknown } };
    const form = (element.props.children as unknown[]).find(
      (child) => (child as { props?: { initial?: unknown } })?.props?.initial !== undefined,
    ) as {
      props: {
        initial: { attempts: Array<{ resultCode: string; createdByEmail: string | null }> };
        targetEditLogs: Array<{ editorEmail: string | null }>;
        editLogs: Array<{ editorEmail: string | null; byFieldworkLink: boolean }>;
      };
    };
    return { form: form.props, payload: payloadOf(element) };
  }

  it('내부 콘솔의 회차·수정 현황·응답 수정 이력에 「외주 · 이름표」가 붙고, 이름표가 없으면 순번이 붙는다', async () => {
    const { form } = await screenProps('internal');

    const byCode = Object.fromEntries(form.initial.attempts.map((a) => [a.resultCode, a.createdByEmail]));
    expect(byCode).toEqual({
      '16. 재통화': '외주 · 프롬',
      '14. 부재': '외주 · 링크 2',
      '15. 거절': OWNER_EMAIL,
    });
    expect(form.targetEditLogs.map((r) => r.editorEmail)).toEqual(['외주 · 프롬']);
    expect(form.editLogs.map((r) => ({ editorEmail: r.editorEmail, byFieldworkLink: r.byFieldworkLink }))).toEqual([
      { editorEmail: '외주 · 링크 2', byFieldworkLink: true },
    ]);
  });

  it('이름표를 고치면 지난 줄도 새 이름표로 보인다 — 이름표는 읽는 시점의 것이다', async () => {
    await setAccessLinkLabel({ surveyId, linkId: linkA, label: '프라임' });
    try {
      const { form } = await screenProps('internal');
      expect(form.initial.attempts.find((a) => a.resultCode === '16. 재통화')?.createdByEmail).toBe(
        '외주 · 프라임',
      );
      expect(form.targetEditLogs.map((r) => r.editorEmail)).toEqual(['외주 · 프라임']);
    } finally {
      await setAccessLinkLabel({ surveyId, linkId: linkA, label: '프롬' });
    }
  });

  it('외주 콘솔의 같은 기록은 「외주」 하나이고 payload 에 이름표 문자열이 없다', async () => {
    const { form, payload } = await screenProps('link');

    expect(form.initial.attempts.map((a) => a.createdByEmail).sort()).toEqual(
      // 연구원의 이메일은 걷힌다(기존 계약) — 외주 두 줄은 링크를 가르지 않는다.
      ['외주', '외주', null].sort(),
    );
    expect(form.targetEditLogs.map((r) => r.editorEmail)).toEqual(['외주']);
    expect(form.editLogs.map((r) => r.editorEmail)).toEqual([null]);
    expect(payload).not.toContain('프롬');
    expect(payload).not.toContain('링크 2');
    expect(payload).not.toContain(linkA);
    expect(payload).not.toContain(linkB);
  });
});
