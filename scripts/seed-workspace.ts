/**
 * 실전 워크스페이스 시드 — 팀 5개 + 실사 업체 1개 발급, 그리고 기존 설문 백필 검증 (티켓 29).
 *
 * 사용법:
 *   pnpm workspace:seed                    # 계획만 출력 (DRY_RUN 기본)
 *   pnpm workspace:seed:live "협력사 이름"  # 실제 적용 — LIVE 는 업체 이름을 요구한다
 *
 * 슈퍼어드민이 **먼저** 있어야 한다(`pnpm auth:seed`) — 팀 감사 행의 행위자이자 0116 백필이
 * 채우는 설문 소유자다. 없으면 아무것도 하지 않고 멈춘다.
 *
 * **행 생성은 서비스를 그대로 부른다**(`createTeam`·`createFieldworkOrg`). 스크립트가 INSERT 를
 * 직접 쓰면 order 계산·감사 행·이름 중복 처리가 화면 경로와 갈려, 시드로 만든 팀만 규약이 다른
 * 팀이 된다. 재실행 안전성(같은 이름을 두 번 만들지 않는다)은 순수 모듈
 * `seed-workspace-plan.ts` 가 정하고 `tests/repo/seed-workspace-plan.test.ts` 가 잰다.
 *
 * 주의: .env 는 로컬, .env.local 은 원격 DB 를 가리키는 관행 — Next.js 와 같은
 * 우선순위(.env.local > .env)로 로드하며, 셸에서 DATABASE_URL 을 직접 지정하면 그것이 최우선이다.
 * **대상 DB 호스트를 첫 줄에 출력하므로 LIVE 는 그것을 보고 진행할 것.**
 */
import dotenv from 'dotenv';

import {
  planFieldworkOrgSeed,
  planTeamSeed,
  summarizeSurveyBackfill,
} from './seed-workspace-plan';

// src/db 가 import 시점에 DATABASE_URL 을 읽으므로, env 로드 후 동적 import 한다.
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const DRY_RUN = process.env['DRY_RUN'] !== 'false';

/** 대상 DB 호스트. 잘못된 DB 에 시드가 도는 것이 이 스크립트의 유일한 사고라 먼저 출력한다. */
function targetHost(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL 이 없다. .env.local / .env 를 확인하거나 셸에서 지정할 것.');
    process.exit(1);
  }
  try {
    return new URL(url).host;
  } catch {
    console.error('DATABASE_URL 을 URL 로 읽지 못했다.');
    process.exit(1);
  }
}

async function main() {
  const orgName = process.argv[2]?.trim();
  if (!DRY_RUN && !orgName) {
    // 기본 이름을 프로덕션에 박지 않는다 — 실사 업체는 활성 이름이 유일해서 잘못 만들면
    // 지우지 못하고 종료만 된다(0120). 계획 출력에는 기본 이름을 써도 남는 것이 없다.
    console.error('LIVE 모드는 실사 업체 이름을 인자로 요구한다: pnpm workspace:seed:live "<협력사 이름>"');
    process.exit(1);
  }

  const { and, asc, eq, isNull } = await import('drizzle-orm');
  const { db } = await import('../src/db');
  const { fieldworkOrgs, surveys, teams, users } = await import('../src/db/schema');
  const { createTeam } = await import('@/server/workspace/services/teams');
  const { createFieldworkOrg } = await import('@/server/workspace/services/fieldwork-orgs');

  console.log(`대상 DB: ${targetHost()}`);
  console.log(DRY_RUN ? '모드: DRY RUN (아무것도 쓰지 않는다)' : '모드: LIVE');

  const superadmin = await db.query.users.findFirst({
    where: and(eq(users.isSuperadmin, true), eq(users.status, 'active')),
    columns: { id: true, email: true },
    orderBy: [asc(users.createdAt)],
  });
  if (!superadmin) {
    console.error('활성 슈퍼어드민이 없다. 먼저 `pnpm auth:seed <email> <name> <password>` 를 돌릴 것.');
    process.exit(1);
  }
  console.log(`행위자 슈퍼어드민: ${superadmin.email}`);

  // 팀 --------------------------------------------------------------------
  const activeTeams = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.status, 'active'));
  const teamPlan = planTeamSeed(activeTeams.map((t) => t.name));

  for (const name of teamPlan.skip) console.log(`  팀 건너뜀 (이미 있음): ${name}`);
  for (const name of teamPlan.create) {
    console.log(`  팀 생성: ${name}`);
    if (!DRY_RUN) await createTeam(superadmin.id, { name });
  }

  // 실사 업체 --------------------------------------------------------------
  if (!orgName) {
    // DRY RUN 에서만 도달한다(LIVE 는 위에서 멈춘다). 기본 이름을 지어내지 않는다 —
    // 계획에 뜬 이름을 그대로 적용하는 것이 이 스크립트의 사용법이라, 가짜 이름을 보여주면
    // 그것이 그대로 프로덕션 업체 이름이 된다.
    console.log('  실사 업체: 이름 미지정 — LIVE 에서 인자로 지정한다.');
  } else {
    const activeOrgs = await db
      .select({ name: fieldworkOrgs.name })
      .from(fieldworkOrgs)
      .where(eq(fieldworkOrgs.status, 'active'));
    const orgPlan = planFieldworkOrgSeed(
      activeOrgs.map((o) => o.name),
      orgName,
    );

    for (const name of orgPlan.skip) console.log(`  실사 업체 건너뜀 (이미 있음): ${name}`);
    for (const name of orgPlan.create) {
      console.log(`  실사 업체 생성: ${name}`);
      if (!DRY_RUN) await createFieldworkOrg(superadmin.id, { name, memo: null });
    }
  }

  // 기존 설문 백필 검증 ----------------------------------------------------
  const rows = await db
    .select({
      id: surveys.id,
      teamId: surveys.teamId,
      ownerUserId: surveys.ownerUserId,
      assignmentStatus: surveys.assignmentStatus,
    })
    .from(surveys);
  const summary = summarizeSurveyBackfill(rows, superadmin.id);

  console.log(
    `설문 ${summary.total}건 — 배치됨 ${summary.assigned} / 배치 대기 ${summary.pending}`,
  );
  console.log(
    `  배치 대기 내역 — 시드 슈퍼어드민 소유(0116 백필) ${summary.backfilledToSeed.length} / ` +
      `다른 소유자(해산 유래) ${summary.pendingWithOtherOwner.length}`,
  );

  for (const id of summary.pendingWithTeam) {
    console.error(`  계약 위반 — 배치 대기인데 팀이 있다 (0116 CHECK 확인): ${id}`);
  }
  for (const id of summary.assignedWithoutTeam) {
    console.error(`  계약 위반 — 배치됐는데 팀이 없다 (0116 CHECK 확인): ${id}`);
  }
  if (summary.pendingWithTeam.length + summary.assignedWithoutTeam.length > 0) {
    console.error('백필 검증 실패 — 배치 상태 제약이 깨졌다. 소유자 보정보다 이것이 먼저다.');
    process.exit(1);
  }

  if (summary.missingOwner.length > 0) {
    console.log(
      DRY_RUN
        ? `  소유자 없음 ${summary.missingOwner.length}건 — LIVE 에서 시드 슈퍼어드민으로 채운다.`
        : `  소유자 없음 ${summary.missingOwner.length}건 — 시드 슈퍼어드민으로 채운다.`,
    );
    if (!DRY_RUN) {
      // 0116 백필의 보정이다. **소유자 컬럼만** 건드린다 — assignment_status 를 함께 손대면
      // 이미 배치된 설문이 배치 대기로 되돌아간다(0116 헤더의 경고).
      const filled = await db
        .update(surveys)
        .set({ ownerUserId: superadmin.id })
        .where(isNull(surveys.ownerUserId))
        .returning({ id: surveys.id });
      console.log(`  소유자 채움: ${filled.length}건`);
    }
  }

  console.log(DRY_RUN ? '계획 출력 완료. 적용하려면 pnpm workspace:seed:live "<협력사 이름>"' : '시드 완료.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
