import { ORPCError } from '@orpc/server';

import { superadmin } from '@/server/orpc';

import {
  ArchiveFieldworkOrgInput,
  CreateFieldworkOrgInput,
  CreateFieldworkOrgOutput,
  DuplicateFieldworkOrgNameError,
  FieldworkOrgHasActiveAccountsError,
  FieldworkOrgNotFoundError,
  ListFieldworkOrgOptionsOutput,
  ListFieldworkOrgsOutput,
  UpdateFieldworkOrgInput,
  WorkspaceActionOutput,
} from '../domain/fieldwork-orgs';
import * as svc from '../services/fieldwork-orgs';

/**
 * 실사 업체 도메인 에러 → RPC 코드.
 *
 * 팀 쪽 매퍼(toWorkspaceRpcError)와 합치지 않는다 — 두 엔티티의 에러 어휘가 겹치지 않고,
 * 합쳐 두면 한쪽에 에러가 늘 때 다른 쪽 procedure 의 매핑이 조용히 넓어진다.
 */
function rethrowFieldworkOrgError(err: unknown): never {
  if (err instanceof FieldworkOrgNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  if (
    err instanceof DuplicateFieldworkOrgNameError ||
    err instanceof FieldworkOrgHasActiveAccountsError
  ) {
    // 입력은 문법적으로 옳고 지금 상태와 충돌할 뿐이다 — 화면은 문구를 그대로 띄우고
    // 목록을 다시 읽으면 된다(팀·사용자 관리와 같은 관례).
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  throw err;
}

/**
 * 실사 업체 관리 표면 — **전부 슈퍼어드민 전용** (.pen FLOW 10-4, 스펙 §6).
 *
 * 팀장에게도 실사 팀장에게도 열지 않는다. 업체 목록은 협력사 명부라 한 업체 사람에게 열면
 * 경쟁 업체의 존재와 인원이 그대로 드러난다 — 실사 팀장이 보는 것은 자기 업체 소속원이
 * 초대된 **설문**이지 업체 명부가 아니다(티켓 25).
 */
const list = superadmin.output(ListFieldworkOrgsOutput).handler(() => svc.listFieldworkOrgs());

/** 계정 발급 모달의 소속 업체 선택지 — id·이름만. */
const options = superadmin
  .output(ListFieldworkOrgOptionsOutput)
  .handler(() => svc.listFieldworkOrgOptions());

const create = superadmin
  .input(CreateFieldworkOrgInput)
  .output(CreateFieldworkOrgOutput)
  .handler(({ input, context }) =>
    svc.createFieldworkOrg(context.user.id, input).catch(rethrowFieldworkOrgError),
  );

const update = superadmin
  .input(UpdateFieldworkOrgInput)
  .output(WorkspaceActionOutput)
  .handler(({ input }) => svc.updateFieldworkOrg(input).catch(rethrowFieldworkOrgError));

/** 업체 종료 — archived 전환. 재직 중 계정이 남아 있으면 거부한다(CONFLICT). */
const archive = superadmin
  .input(ArchiveFieldworkOrgInput)
  .output(WorkspaceActionOutput)
  .handler(({ input, context }) =>
    svc.archiveFieldworkOrg(context.user.id, input).catch(rethrowFieldworkOrgError),
  );

export const fieldworkOrgs = { list, options, create, update, archive };
