/**
 * 「메가리서치」(시스템 전체 보기) 요청은 일반 사용자에게 열리지 않는다 — 세 채널 전부
 * (역할 모델 v2 티켓 15, B 검증 게이트).
 *
 * 시스템 범위는 팀 경계를 통째로 걷어내는 값이라 여기가 뚫리면 팀 격리 전체가 무의미하다.
 * 요청이 들어올 수 있는 길은 셋이고, **셋의 처리가 서로 다른 것이 정책**이다.
 *
 *  ① 입력(RPC) — 화면이 명시적으로 지목한 값. **거부한다.** 조용히 자기 팀으로 접으면
 *     "전체를 봤다" 고 믿는 화면이 부분 목록을 전체로 표시한다(work-scope 의 계약).
 *  ② 쿠키 — 브라우저 편의값. **기본 범위로 접는다** — 강등된 슈퍼어드민의 잔존 쿠키로
 *     화면이 통째로 잠기지 않게. 접는 쪽이 언제나 더 좁으므로 시스템 범위는 얻지 못한다.
 *     읽기(화면)와 쓰기(설문 생성)가 같은 처리를 진다 — 갈라 두면 스위처에는 팀이 보이는데
 *     생성만 막히는 상태가 생긴다.
 *  ③ URL — 시스템 범위 화면(팀 관리·사용자 관리·재배치 센터)으로의 직접 진입.
 *     **notFound 로 접는다.** 그 축은 파일 스캔 가드라 `tests/repo/system-scope-page-guards`
 *     에 산다(레포 관례: 소스를 훑는 드리프트 가드는 tests/repo).
 *
 * ①이 예전에는 500 이었다(WorkScopeError 에 RPC 매핑이 없었다). 데이터가 새지는 않았지만
 * "거부" 가 아니라 크래시였고 Sentry 에도 예상 못 한 오류로 쌓였다 — 티켓 15 가 매핑을 붙였다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createRouterClient } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';

import { surveys } from '@/server/survey-builder/procedures/surveys';
import { read } from '@/server/survey-builder/procedures/read';
import { resolveWorkScope, resolveWorkScopeFor, WorkScopeError } from '@/server/work-scope';
import { SYSTEM_SCOPE, WORK_SCOPE_COOKIE } from '@/shared/contracts/workspace';
import { internalActorContext } from '@tests/helpers/rpc-context';

const REPO_ROOT = resolve(__dirname, '..', '..');

const IDS = vi.hoisted(() => ({
  MEMBER_ID: '4b000000-0000-4000-8000-0000000e0001',
  ADMIN_ID: '4b000000-0000-4000-8000-0000000ad001',
  TEAM_ID: '4b000000-0000-4000-8000-0000000a1111',
}));

/** 쿠키 축을 재현한다 — 브라우저에 `work_scope=system` 이 남아 있는 상태. */
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'work_scope' ? { value: 'system' } : undefined),
  }),
}));

vi.mock('@/server/read-models/team-memberships', () => ({
  getActiveTeamMemberships: vi.fn(async (userId: string) =>
    userId === IDS.MEMBER_ID ? [{ teamId: IDS.TEAM_ID, role: 'member' }] : [],
  ),
  getTeamRole: vi.fn(async () => null),
}));

/**
 * DB 는 열어만 둔다 — 이 파일의 모든 거부는 판정 단계에서 끝나므로 조회 결과가 필요 없다.
 * 혹시라도 판정을 지나 데이터까지 갔다면 빈 결과 대신 사고가 나야 하므로 쓰기는 던진다.
 */
vi.mock('@/db', () => {
  function resolving(rows: unknown[]): unknown {
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onFulfilled: (value: unknown) => unknown) => onFulfilled(rows);
          }
          return () => chain;
        },
      },
    );
    return chain;
  }
  function explode(): never {
    throw new Error('SYSTEM_SCOPE: 판정을 지나 데이터에 닿았다');
  }
  const select = () => ({ from: () => resolving([]) });
  const executor = { select, insert: explode, update: explode, delete: explode };
  return {
    db: {
      ...executor,
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(executor),
      query: new Proxy({}, { get: () => ({ findFirst: async () => null, findMany: async () => [] }) }),
    },
  };
});

function clientFor(userId: string, isSuperadmin: boolean) {
  return createRouterClient(
    { surveys, read },
    { context: internalActorContext({ id: userId, isSuperadmin }) },
  );
}

const member = clientFor(IDS.MEMBER_ID, false);
const admin = clientFor(IDS.ADMIN_ID, true);

const NEW_SURVEY = { title: '새 설문', isPublic: false };

/** ensure 의 최소 설정 — 판정은 그 앞에서 끝나므로 값은 읽히지 않는다. */
const MINIMAL_SETTINGS = {
  isPublic: false,
  allowMultipleResponses: false,
  showProgressBar: true,
  shuffleQuestions: false,
  requireLogin: false,
  thankYouMessage: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// ① 입력 축 — 화면이 명시적으로 지목한 범위
// ─────────────────────────────────────────────────────────────────────────────

describe('① 입력: 일반 사용자의 system 요청은 FORBIDDEN 이다', () => {
  it('설문 목록', async () => {
    await expect(member.read.list({ scope: SYSTEM_SCOPE })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('설문 생성', async () => {
    await expect(
      member.surveys.create({ ...NEW_SURVEY, scope: SYSTEM_SCOPE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('빌더 자동 생성(ensure)', async () => {
    await expect(
      member.surveys.ensure({
        id: '4b000000-0000-4000-8000-0000000f0001',
        title: '새 설문',
        settings: MINIMAL_SETTINGS,
        scope: SYSTEM_SCOPE,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('거부가 뭉뚱그려진 것이 아니다 — 슈퍼어드민은 다른 사유로 막힌다', async () => {
    // 슈퍼어드민은 system 범위를 가질 수 있다. 다만 시스템 전체 보기는 teams 행이 아니라
    // 조회 범위라 소유 목적지가 될 수 없어 CONFLICT 다(.pen 6-2). 코드가 갈리는 것이
    // "권한 거부" 와 "상태 충돌" 을 실제로 구분하고 있다는 증거다.
    await expect(
      admin.surveys.create({ ...NEW_SURVEY, scope: SYSTEM_SCOPE }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 쿠키 축 — 브라우저에 남은 편의값
// ─────────────────────────────────────────────────────────────────────────────

describe('② 쿠키: system 이 남아 있어도 시스템 범위를 얻지 못한다', () => {
  it('쓰기 경로(설문 생성)가 읽는 쿠키도 접힌다 — 결과는 자기 팀이다', async () => {
    // 입력에 scope 가 없으면 서비스가 쿠키를 읽는다(resolveWorkScope). 잔존 'system' 은
    // 거부가 아니라 기본 범위로 접힌다 — 화면이 이미 접은 것과 같은 처리라야, 스위처에는
    // 팀 A 가 보이는데 생성만 막히는 상태가 생기지 않는다.
    await expect(
      resolveWorkScope({ id: IDS.MEMBER_ID, isSuperadmin: false, userType: 'internal' }, null),
    ).resolves.toEqual({ kind: 'team', teamId: IDS.TEAM_ID });
  });

  it('슈퍼어드민의 같은 쿠키는 접히지 않는다 — 접기가 뭉뚱그린 것이 아니다', async () => {
    await expect(
      resolveWorkScope({ id: IDS.ADMIN_ID, isSuperadmin: true, userType: 'internal' }, null),
    ).resolves.toEqual({ kind: 'system' });
  });

  it('읽기 화면은 기본 범위로 접는다 — 접힌 결과는 언제나 자기 팀이다', () => {
    const subject = {
      userId: IDS.MEMBER_ID,
      isSuperadmin: false,
      userType: 'internal' as const,
      activeTeamIds: [IDS.TEAM_ID],
      leaderTeamIds: [],
    };
    // 화면(admin 셸·분석 목록)이 쓰는 접기 — 판정은 거부지만 화면은 그것을 잡아 기본으로 접는다.
    expect(() => resolveWorkScopeFor(subject, SYSTEM_SCOPE)).toThrow(WorkScopeError);
    expect(resolveWorkScopeFor(subject, null)).toEqual({ kind: 'team', teamId: IDS.TEAM_ID });
  });

  it('접기를 하는 화면 둘이 실제로 그 처리를 들고 있다', () => {
    // 이 파일의 쿠키 모킹이 진짜 쿠키 이름을 쓰고 있는지 먼저 못 박는다 — 이름이 바뀌면
    // 모킹만 살아남아 "쿠키 축을 검증했다" 는 말이 거짓이 된다.
    expect(WORK_SCOPE_COOKIE).toBe('work_scope');
    // 두 파일이 갈리면 한쪽만 500 을 내므로 여기서 함께 묶는다.
    for (const rel of ['src/app/admin/layout.tsx', 'src/app/analytics/page.tsx']) {
      const source = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
      expect(source, `${rel} 이 쿠키 범위를 해석한다`).toContain('WORK_SCOPE_COOKIE');
      expect(source, `${rel} 에 접기 처리가 없다`).toMatch(/catch/);
    }
  });
});
