import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { QueryProvider } from '@/components/providers/query-provider';
import { AdminShell } from '@/features/workspace/admin-shell/admin-shell';
import { accountHomePath } from '@/lib/auth/account-home';
import { ACCOUNT_PAGES, AUTH_PAGES } from '@/lib/auth/protected-paths';
import { readSessionUser } from '@/lib/auth/session';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { listActiveTeams } from '@/server/read-models/teams';
import { resolveWorkScopeFor } from '@/server/work-scope';
import { isActiveUser, isInternalUser, type AuthUser } from '@/shared/contracts/auth';
import { WORK_SCOPE_COOKIE } from '@/shared/contracts/workspace';

// TanStack Query 는 관리자 화면만 쓴다. 공개 응답 페이지(/survey, /i, /preview, /unsubscribe)는
// plain RPC client 만 쓰므로 Provider 를 루트가 아니라 여기서 연다 — 응답자 번들에서 Query 런타임을 뺀다.
//
// 인증 가드도 여기가 집이다. proxy 는 세션 쿠키 존재만 보는 1차 게이트라, 만료·폐기된 쿠키와
// 비활성 계정은 이 레이아웃이 걸러야 한다(2단 게이트).
//
// 다만 이 레이아웃은 **하드 내비게이션에서만** 다시 돈다 — 클라이언트 소프트 내비게이션은
// 공통 상위 레이아웃을 재렌더하지 않는다(partial rendering). 그래서 데이터에 닿는 자리는
// 각자 가드를 갖는다: 설문 경계는 surveys/[id]/layout.tsx, 게스트 차단 화면과 전역 관리
// 화면은 페이지의 requireAdminPage, procedure 는 authed/scoped. 이 레이아웃은 그 위의
// 첫 관문이지 유일한 관문이 아니다 — x-pathname 이 없어 가드를 건너뛰어도(프록시 미경유)
// 데이터가 새지 않는 이유가 이것이다.
//
// 내부 계정에게는 공통 셸(좌측 사이드바 + 팀 스위처)을 입힌다(역할 모델 v2 티켓 08).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-pathname') ?? '';

  // proxy 를 거치지 않아 경로를 모르는 호출(테스트 등)은 페이지 자체 가드에 맡긴다.
  if (pathname !== '' && !AUTH_PAGES.has(pathname)) {
    const user = await readSessionUser(requestHeaders);
    if (!user) {
      redirect(`/admin/login?redirect=${encodeURIComponent(pathname)}`);
    }
    if (!isActiveUser(user.status)) {
      redirect('/admin/login');
    }

    // 계정 유형 게이트 — /admin 은 내부 구역이다. 게스트·실사는 자기 홈으로 돌려보낸다.
    // notFound 가 아니라 리다이렉트인 이유: 이 구역의 존재는 비밀이 아니고, 잘못 들어온
    // 사용자에게 갈 곳을 알려주는 편이 낫다(막다른 404 보다). 진짜 차단은 페이지·procedure
    // 가드가 한다 — 이 레이아웃은 하드 내비게이션에서만 다시 돈다.
    // 프로필은 세 유형 공통 화면이라 비켜준다(.pen FLOW 3-2) — 셸 없이 그대로 연다.
    if (!isInternalUser(user.userType) && !ACCOUNT_PAGES.has(pathname)) {
      redirect(accountHomePath(user.userType));
    }

    // 여기까지 온 비내부 계정은 ACCOUNT_PAGES(프로필)뿐이다 — 셸 없이 그대로 연다.
    // 티켓 21 전에는 이 자리에 env grant 게스트의 경로 화이트리스트와 강제 로그아웃 분기가
    // 있었다. 게스트가 계정 유형이 되면서 위의 유형 게이트 한 줄이 그 일을 대신한다.
    if (isInternalUser(user.userType)) {
      return (
        <QueryProvider>
          <InternalShell user={user}>{children}</InternalShell>
        </QueryProvider>
      );
    }
  }

  return <QueryProvider>{children}</QueryProvider>;
}

/**
 * 내부 계정용 공통 셸 준비 — 소속·초기 작업 범위를 서버에서 해석해 AdminShell 에 넘긴다.
 *
 * 초기 범위는 쿠키를 그대로 믿지 않는다: 판정 코어(resolveWorkScopeFor)가 멤버십으로 다시
 * 해석해 슈퍼어드민은 system, 일반 사용자는 마지막 유효 팀 → 첫 활성 팀 → 없음으로 접는다
 * (.pen FLOW 6-1 노트). 목록 procedure 도 같은 코어를 지나므로 셸과 데이터가 어긋나지 않는다.
 */
async function InternalShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const memberships = await getActiveTeamMemberships(user.id);
  const teams = user.isSuperadmin
    ? await listActiveTeams()
    : memberships.map((m) => ({ id: m.teamId, name: m.teamName }));

  const requestedScope = (await cookies()).get(WORK_SCOPE_COOKIE)?.value ?? null;
  const subject = {
    userId: user.id,
    isSuperadmin: user.isSuperadmin,
    userType: user.userType,
    activeTeamIds: memberships.map((m) => m.teamId),
    leaderTeamIds: memberships.filter((m) => m.role === 'leader').map((m) => m.teamId),
  };
  let scope;
  try {
    scope = resolveWorkScopeFor(subject, requestedScope);
  } catch {
    // 쿠키는 편의값이다 — 강등된 슈퍼어드민의 'system' 잔존 쿠키 같은 무효 값은 거부(500)가
    // 아니라 기본 범위로 접는다. 명시 요청의 거부 의미론은 procedure 쪽에 그대로 남는다.
    scope = resolveWorkScopeFor(subject, null);
  }

  return (
    <AdminShell
      user={{
        id: user.id,
        name: user.name,
        isSuperadmin: user.isSuperadmin,
        image: user.image ?? null,
      }}
      memberships={memberships.map((m) => ({
        teamId: m.teamId,
        teamName: m.teamName,
        role: m.role,
      }))}
      teams={teams}
      initialScope={scope}
    >
      {children}
    </AdminShell>
  );
}
