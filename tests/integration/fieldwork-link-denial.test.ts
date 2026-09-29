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
 * `scoped` **전수**는 여기 없다. 그 베이스가 링크를 들이는 것은 handler 들이 주체를 읽을 줄
 * 알게 되는 티켓 06 의 일이고, 그때 「자기 설문에서 열리는 capability 가 정확히 넷」을 같은
 * 열거 위에 세운다. 오늘 scoped 는 `context.user` 를 요구하므로 링크는 여기서도 거부된다 —
 * 아래 단언이 그 사실까지 함께 못 박는다.
 */
import { createRouterClient } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';

import { router } from '@/server/router';
import { linkActorContext } from '@tests/helpers/rpc-context';
import { enumerateProcedures } from '@tests/helpers/rpc-surface';

const LINK_ID = 'a1000000-0000-4000-8000-00000000b001';
const SURVEY_ID = 'a1000000-0000-4000-8000-0000000f0001';

// 서비스까지 새면 여기서 터진다 — 베이스가 막는다는 주장의 반증 장치다.
vi.mock('@/db', async (importOriginal) => {
  // importOriginal 스프레드가 필수다 — `@/db` 는 스키마를 통째로 되내보낸다(db-stub 주석).
  const actual = await importOriginal<typeof import('@/db')>();
  const { createDbStub } = await import('@tests/helpers/db-stub');
  return {
    ...actual,
    db: createDbStub({
      reachedMessage: 'FIELDWORK LINK DENIAL: 베이스를 지나 서비스가 DB 에 닿았다',
      rowsFor: () => [],
    }),
  };
});

const client = createRouterClient(router, {
  context: linkActorContext({ linkId: LINK_ID, surveyId: SURVEY_ID }),
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

/** 오늘의 scoped 전수 — 티켓 06 이 이 베이스를 링크에 열면 이 목록의 기대가 바뀐다. */
const scopedSurfaces = procedures
  .filter((p) => p.base === 'scoped')
  .map((p) => p.path)
  .sort();

describe('계정 축 표면은 외주 실사 링크에게 닫혀 있다', () => {
  it('열거기가 실제로 라우터를 훑는다', () => {
    // 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(accountOnlySurfaces.length).toBeGreaterThan(80);
    expect(scopedSurfaces.length).toBeGreaterThan(0);
  });

  it.each(accountOnlySurfaces)('%s 는 UNAUTHORIZED 다', async (path) => {
    await expect(callerFor(path)({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it.each(scopedSurfaces)('%s 도 아직 UNAUTHORIZED 다 — 링크는 티켓 06 에서 열린다', async (path) => {
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
