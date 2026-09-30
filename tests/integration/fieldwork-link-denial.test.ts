/**
 * 외주 실사 링크 음성 스위트 — 내부 표면은 링크에게 전부 닫혀 있다 (ADR-0026, 티켓 05).
 *
 * 선례는 `guest-account-denial.test.ts`·`fieldwork-account-denial.test.ts` 와 글자까지 같은
 * 구조다. **목록의 출처가 라우터 자신**이라 새 procedure 가 붙으면 저절로 검사 대상이 되고,
 * 손으로 적은 목록만 도는 스위트가 새 표면을 영원히 초록으로 두는 일이 생기지 않는다.
 *
 * 이 파일이 원래 티켓 03 의 항목이었다는 것이 중요하다. 그때는 링크 주체를 RPC 컨텍스트에
 * 넣을 자리가 없어 **두드릴 방법 자체가 없었고**(그 사이의 보장은 구조적이었다), 링크 세션이
 * 서는 이 티켓으로 옮겨졌다. 이제 실제로 두드린다.
 *
 * 묻는 것은 하나다 — **계정 축 세 베이스(authed·superadmin·account)가 링크를 들이지 않는가.**
 * 거부 코드가 FORBIDDEN 이 아니라 **UNAUTHORIZED** 인 것이 이 모델의 자국이다: 게스트·실사는
 * 「계정은 있는데 유형이 아니다」라 FORBIDDEN 이었지만, 링크에는 계정이 아예 없어
 * `requireActiveUser` 의 첫 줄에서 끝난다. 관문(capability)이 아니라 **베이스**가 막는다 —
 * 관문은 판정하려고 DB 를 한 번 읽지만 베이스는 읽지 않는다.
 *
 * **`scoped` 는 티켓 06 에서 열렸다.** 그래서 두 번째 질문이 붙는다 — 그 문 전수 중 링크가
 * 통과하는 것이 **정확히 어느 아홉인가**(`LINK_OPEN_SCOPED_PATHS`), 그리고 자기 설문에서
 * 서는 capability 가 **정확히 여섯인가**(넷에서 ADR-0027 이 응답 수정·단건 메일 둘을 더했다). 두 목록의 합집합이 라우터 열거와 같아야 하므로, 새
 * scoped procedure 가 붙으면 그 자리에서 빨개진다 — 그것이 「누락 표면 없음」의 증명이다.
 *
 * 여기서 두드리지 않는 축이 하나 있다: **미부여 설문 id 를 넣었을 때의 사유 대비**
 * (자기 설문=FORBIDDEN ↔ 타 설문=NOT_FOUND). 목의 `rowsFor` 는 WHERE 를 모르고 어떤 id 에도
 * 같은 행을 돌려주므로 목으로는 증명되지 않는다 — `fieldwork-link.realdb.test.ts` 가 진다.
 */
import { createRouterClient } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';

import { router } from '@/server/router';
import { assertSurveyCapability, loadSurveyAccess } from '@/server/survey-access';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';
import { linkActorContext } from '@tests/helpers/rpc-context';
import { enumerateProcedures, takesSurveyId } from '@tests/helpers/rpc-surface';
import {
  LINK_BLOCKED_SCOPED_PATHS,
  LINK_OPEN_SCOPED_PATHS,
  SCOPED_INPUTS,
} from '@tests/helpers/scoped-surface-inputs';

const IDS = vi.hoisted(() => ({
  LINK_ID: 'a1000000-0000-4000-8000-00000000b001',
  SURVEY_ID: 'a1000000-0000-4000-8000-0000000f0001',
  TOKEN: 'fieldworkLinkToken01',
  PASSWORD_UPDATED_AT: '2026-09-29T00:00:00.000Z',
  OWNER_TEAM_ID: 'a1000000-0000-4000-8000-0000000a1111',
  OWNER_ID: 'a1000000-0000-4000-8000-0000000a0001',
}));

const { LINK_ID, SURVEY_ID } = IDS;

/**
 * 살아 있는 링크 하나 + 그 설문 하나.
 *
 * 계정 축을 물을 때는 빈 목이 맞았지만(베이스가 먼저 막으므로 DB 에 닿는 것 자체가 사고였다)
 * scoped 축은 **관문이 판정을 해야** 하므로 두 행이 필요하다 — 링크 행은 세션 검증용,
 * 설문 행은 capability 판정용이다. 쓰기는 여전히 전부 사고다.
 */
vi.mock('@/db', async (importOriginal) => {
  // importOriginal 스프레드가 필수다 — `@/db` 는 스키마를 통째로 되내보낸다(db-stub 주석).
  const actual = await importOriginal<typeof import('@/db')>();
  const { createDbStub } = await import('@tests/helpers/db-stub');
  const { surveyFieldworkLinks, surveys } = await import('@/db/schema');

  const linkRow = {
    linkId: IDS.LINK_ID,
    surveyId: IDS.SURVEY_ID,
    surveyTitle: '외주 조사',
    passwordCipher: 'cipher',
    passwordUpdatedAt: new Date(IDS.PASSWORD_UPDATED_AT),
    closedAt: null,
    isPaused: false,
    assignmentStatus: 'assigned',
    deletedAt: null,
  };
  const surveyRow = {
    id: IDS.SURVEY_ID,
    teamId: IDS.OWNER_TEAM_ID,
    visibility: 'team',
    ownerUserId: IDS.OWNER_ID,
    assignmentStatus: 'assigned',
    isPaused: false,
    deletedAt: null,
    participantKind: null,
    guestTabs: null,
  };

  return {
    ...actual,
    db: createDbStub({
      reachedMessage: 'FIELDWORK LINK DENIAL: 베이스를 지나 서비스가 DB 에 닿았다',
      rowsFor: (table) => {
        if (table === surveyFieldworkLinks) return [linkRow];
        if (table === surveys) return [surveyRow];
        return [];
      },
      relationalRowFor: (table) => (table === 'surveys' ? surveyRow : undefined),
    }),
  };
});

const client = createRouterClient(router, {
  context: linkActorContext({
    linkId: LINK_ID,
    surveyId: SURVEY_ID,
    token: IDS.TOKEN,
    passwordUpdatedAt: IDS.PASSWORD_UPDATED_AT,
  }),
});

function callerFor(path: string): (input: unknown) => Promise<unknown> {
  const fn = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client as unknown);
  if (typeof fn !== 'function') throw new Error(`호출할 수 없는 경로: ${path}`);
  return fn as (input: unknown) => Promise<unknown>;
}

const procedures = enumerateProcedures();

/**
 * 계정을 요구하는 베이스 전수.
 *
 * 베이스 미들웨어가 입력 검증보다 **먼저** 돌기 때문에 입력을 채울 필요가 없다. 거부가
 * BAD_REQUEST 로 나온다면 그것 자체가 회귀 신호다(계정 가드가 뒤로 밀렸다는 뜻).
 */
const accountOnlySurfaces = procedures
  .filter((p) => p.base === 'authed' || p.base === 'superadmin' || p.base === 'account')
  .map((p) => p.path)
  .sort();


describe('계정 축 표면은 외주 실사 링크에게 닫혀 있다', () => {
  it('열거기가 실제로 라우터를 훑는다', () => {
    // 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(accountOnlySurfaces.length).toBeGreaterThan(80);
  });

  it.each(accountOnlySurfaces)('%s 는 UNAUTHORIZED 다', async (path) => {
    await expect(callerFor(path)({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('링크 세션 표면 둘만 pub 이다 — 외주가 실제로 부를 수 있는 것의 전부', () => {
    const linkSurfaces = procedures
      .filter((p) => p.path.startsWith('workspace.fieldworkLink'))
      .map((p) => `${p.path}:${p.base}`)
      .sort();
    // 관리 다섯이 pub 으로 내려가면 외주가 자기 비밀번호를 읽거나 바꾼다 — 그 순간 담당
    // 연구원이 통제권을 잃는다. 세션 둘이 authed 로 올라가면 접속할 방법이 사라진다.
    expect(linkSurfaces).toEqual([
      'workspace.fieldworkLinkSession.authenticate:pub',
      'workspace.fieldworkLinkSession.signOut:pub',
      'workspace.fieldworkLinks.close:authed',
      'workspace.fieldworkLinks.get:authed',
      'workspace.fieldworkLinks.issue:authed',
      'workspace.fieldworkLinks.resetPassword:authed',
      'workspace.fieldworkLinks.revealPassword:authed',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scoped — 링크가 지나는 유일한 문. 통과하는 것이 정확히 아홉이다
// ─────────────────────────────────────────────────────────────────────────────

const linkActor = { kind: 'link' as const, linkId: LINK_ID, surveyId: SURVEY_ID };

/** 링크 열 — 스펙 §8 의 「외주 링크」. 여기 없는 것이 「항상 차단」 목록이다. */
const LINK_COLUMN: SurveyCapability[] = [
  'survey.view',
  'operations.view',
  'contacts.view',
  'contacts.writeAttempts',
  // ADR-0027 — 응답 목록·상세·수정과 조사 대상 단건 메일. 응답 관리(`responses.manage`)와
  // 메일 탭(`mail.view`·`mail.send`)은 없다 — 아래 BLOCKED 목록이 그것을 관문으로 확인한다.
  'responses.view',
  'mail.sendSingle',
];

const BLOCKED_CAPABILITIES = surveyCapabilityValues.filter(
  (capability) => !LINK_COLUMN.includes(capability),
);

describe('자기 설문에서 열리는 capability 가 정확히 여섯이다', () => {
  it('판정 결과가 링크 열과 정확히 같다', async () => {
    const { capabilities } = await loadSurveyAccess(linkActor, SURVEY_ID);
    expect([...capabilities].sort()).toEqual([...LINK_COLUMN].sort());
  });

  it.each(BLOCKED_CAPABILITIES)('%s 는 관문이 거부한다', async (capability) => {
    // 보이는 설문의 권한 부족이므로 forbidden — 링크를 들고 있으니 존재는 이미 안다.
    await expect(
      assertSurveyCapability(linkActor, SURVEY_ID, capability),
    ).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('링크에는 탭 축이 없다 — 게스트와 갈리는 지점', async () => {
    // 게스트는 설문마다 고르는 화면 축(`guest_tabs`)이 있고 링크는 없다. null 이 아니라
    // 「전부 false」가 오면 링크 콘솔이 자기 탭을 스스로 숨긴다.
    const { guestTabs } = await loadSurveyAccess(linkActor, SURVEY_ID);
    expect(guestTabs).toBeNull();
  });
});

describe('scoped 표면 전수 — 열린 아홉과 막힌 나머지', () => {
  it('두 목록의 합집합이 라우터 열거와 같다 — 새 표면은 막힌 쪽으로 떨어진다', () => {
    const enumerated = procedures
      .filter((p) => p.base === 'scoped')
      .map((p) => p.path)
      .sort();
    expect(enumerated).toEqual(
      [...LINK_OPEN_SCOPED_PATHS, ...LINK_BLOCKED_SCOPED_PATHS].sort(),
    );
  });

  it('scoped 표면은 전부 설문 id 를 받는다 — 무관문 문이 하나도 없다', () => {
    // 링크를 통과시키는 유일한 베이스이므로 여기 예외가 하나라도 생기면 위의 capability
    // 검사가 통째로 우회된다(게스트 축과 같은 이유, 티켓 21).
    const withoutSurvey = procedures
      .filter((p) => p.base === 'scoped' && !takesSurveyId(p))
      .map((p) => p.path);
    expect(withoutSurvey).toEqual([]);
  });

  it.each(LINK_BLOCKED_SCOPED_PATHS)('%s 는 FORBIDDEN 이다', async (path) => {
    // UNAUTHORIZED 가 나오면 베이스가 다시 계정을 요구하기 시작한 것이고(링크 콘솔이
    // 통째로 죽는다), 성공하면 반경이 넓어진 것이다. 둘 다 잡으려면 코드를 못 박아야 한다.
    await expect(
      callerFor(path)({ surveyId: SURVEY_ID, ...SCOPED_INPUTS[path] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(LINK_OPEN_SCOPED_PATHS)('%s 는 관문을 지난다 — 거부가 권한 때문이 아니다', async (path) => {
    // 관문을 지나면 서비스가 없는 하위 행을 만나 NOT_FOUND 를 내거나 목의 쓰기 차단에
    // 걸린다. 여기서 묻는 것은 **관문이 거부한 것이 아니라는 것** 하나다 — 그 뒤의 행동은
    // realdb 스위트가 실제 행으로 본다.
    const code = await callerFor(path)({ surveyId: SURVEY_ID, ...SCOPED_INPUTS[path] }).then(
      () => 'RESOLVED',
      (error: unknown) => (error as { code?: string }).code ?? 'NO_CODE',
    );
    // UNAUTHORIZED 가 나오면 베이스가 다시 계정을 요구하기 시작한 것이고(링크 콘솔이 통째로
    // 죽는다), FORBIDDEN 이면 링크 열에서 그 capability 가 빠진 것이다.
    expect(code).not.toBe('UNAUTHORIZED');
    expect(code).not.toBe('FORBIDDEN');
  });
});
