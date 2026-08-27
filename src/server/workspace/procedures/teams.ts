import { ORPCError } from '@orpc/server';

import { authed, superadmin } from '@/server/orpc';

import {
  CreateTeamInput,
  CreateTeamOutput,
  DissolveTeamInput,
  DuplicateTeamNameError,
  ListTeamsOutput,
  RenameTeamInput,
  TeamDetailOutput,
  TeamIdInput,
  TeamNameMismatchError,
  TeamNotFoundError,
  WorkspaceActionOutput,
} from '../domain/teams';
import * as svc from '../services/teams';

/**
 * 워크스페이스 도메인 에러 → RPC 코드. 팀·멤버십 procedure 가 함께 쓴다.
 *
 * 매핑되지 않은 예외는 null 을 돌려 호출측이 그대로 올린다(500 으로 남는다) — 사용자 관리
 * 도메인(server/auth/procedures/users)과 같은 관례다.
 */
export function toWorkspaceRpcError(err: unknown): ORPCError<string, unknown> | null {
  if (err instanceof TeamNotFoundError) return new ORPCError('NOT_FOUND', { message: err.message });
  if (err instanceof DuplicateTeamNameError || err instanceof TeamNameMismatchError) {
    return new ORPCError('CONFLICT', { message: err.message });
  }
  return null;
}

/** 도메인 에러를 RPC 코드로 바꿔 다시 던진다. handler 의 catch 한 줄용. */
export function rethrowWorkspaceError(err: unknown): never {
  throw toWorkspaceRpcError(err) ?? err;
}

/** 팀 관리 목록 (.pen FLOW 7-1) — 조직 구조를 보는 화면이라 슈퍼어드민 전용. */
const list = superadmin.output(ListTeamsOutput).handler(() => svc.listTeams());

/** 팀 생성 (슈퍼어드민) — 이름은 전체 조직 경로를 담는다(ADR-0008). */
const create = superadmin
  .input(CreateTeamInput)
  .output(CreateTeamOutput)
  .handler(({ input, context }) =>
    svc.createTeam(context.user.id, input).catch(rethrowWorkspaceError),
  );

/** 팀 이름 수정 (슈퍼어드민) — 조직도를 바꾸는 일이라 팀장에게 열지 않는다. */
const rename = superadmin
  .input(RenameTeamInput)
  .output(WorkspaceActionOutput)
  .handler(({ input, context }) =>
    svc.renameTeam(context.user.id, input).catch(rethrowWorkspaceError),
  );

/**
 * 팀 상세 (.pen FLOW 7-2) — 슈퍼어드민 또는 그 팀 팀장.
 *
 * 판정은 서비스가 한다. 목록(list)과 달리 authed 인 이유는 팀장도 자기 팀 상세를 열기
 * 때문이다 — 자격이 없으면 NOT_FOUND 로 떨어진다(존재를 알려주지 않는다).
 */
const detail = authed
  .input(TeamIdInput)
  .output(TeamDetailOutput)
  .handler(({ input, context }) =>
    svc
      .getTeamDetail(
        { id: context.user.id, isSuperadmin: context.user.isSuperadmin },
        input.teamId,
      )
      .catch(rethrowWorkspaceError),
  );

/**
 * 팀 해산 — 슈퍼어드민 전용, 확정 즉시 (.pen FLOW 8-1).
 *
 * 조직 구조를 없애는 일이라 목록·생성·이름 변경과 같은 축이다. 팀장은 자기 팀을 해산할 수
 * 없다 — 팀 상세가 아니라 팀 관리 목록의 카드 케밥에 진입점이 있는 이유가 그것이다.
 *
 * **해산 취소 procedure 는 만들지 않는다**(ADR-0011). 복구 경로는 재배치 센터(티켓 14)다.
 */
const dissolve = superadmin
  .input(DissolveTeamInput)
  .output(WorkspaceActionOutput)
  .handler(({ input, context }) =>
    svc.dissolveTeam(context.user.id, input).catch(rethrowWorkspaceError),
  );

export const teams = { list, create, rename, detail, dissolve };
