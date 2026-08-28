import { GuestShell } from '@/features/guest-console/guest-shell';
import { requireAccountTypePage } from '@/lib/auth/require-account-page';
import { getProfile } from '@/server/auth/services/auth';

/**
 * 게스트 구역 레이아웃 — 가드 + 공통 셸 (.pen FLOW 5-2·5-3, 역할 모델 v2 티켓 22).
 *
 * 티켓 05 는 페이지가 하나뿐이라 가드를 페이지에 뒀다. 하위 라우트가 생겼으므로 여기로
 * 올린다 — 다만 **페이지의 가드를 대신하지는 않는다**: App Router 는 소프트 내비게이션에서
 * 상위 레이아웃을 다시 돌리지 않아, 세션이 폐기된 뒤에도 하위 페이지가 서비스를 직접 부를 수
 * 있다(AGENTS.md 「RSC 페이지는 자기 가드를 갖는다」). 설문 화면은 각자
 * `assertGuestSurveyPageAccess` 를 지난다.
 *
 * **QueryProvider 를 열지 않는다.** 이 구역이 마운트하는 클라이언트 조각(현황 위젯·진척
 * 표·응답 미리보기)은 전부 서버가 넘긴 props 만 그리고 TanStack Query 를 쓰지 않는다 —
 * 게스트에게는 조회할 RPC 표면 자체가 없기 때문이다(티켓 21). Provider 를 미리 두면
 * 응답자 번들과 같은 이유로 쓰지 않는 런타임이 실린다.
 */
export default async function GuestLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAccountTypePage('guest');
  // 소속 기관은 세션 페이로드에 없다 — 헤더 표시에 쓰므로 DB 에서 읽는다.
  // 헤더 한 줄 때문에 구역 전체를 500 으로 떨어뜨리지 않는다.
  const organization = await getProfile(user.id)
    .then((profile) => profile.organization)
    .catch(() => null);

  return (
    <GuestShell user={user} organization={organization}>
      {children}
    </GuestShell>
  );
}
