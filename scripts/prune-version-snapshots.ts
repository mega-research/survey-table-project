/**
 * 버전 스냅샷 일회성 정리 스크립트 (2026-07-31 spec §5.3 ①)
 *
 * 보존 규칙(현재 발행본 OR 살아있는 비테스트 응답 보유)에 미달하는 버전의
 * snapshot 을 NULL 로 비우고, 그 스냅샷이 참조하던 R2 키를 유예 큐에 등록한다.
 *
 * 사용법:
 *   pnpm versions:prune         # DRY_RUN — 대상만 출력, 변경 없음
 *   pnpm versions:prune:live    # 실제 적용
 *
 * 주의: .env 는 로컬, .env.local 은 원격 DB 를 가리키는 관행 — Next.js 와 같은
 * 우선순위(.env.local > .env)로 로드하며, 셸에서 DATABASE_URL 을 직접 지정하면
 * 그것이 최우선이다. 실행 시 대상 DB 호스트를 출력하니 반드시 확인할 것.
 *
 * 되돌릴 수 없다. 반드시 DRY_RUN 출력을 확인한 뒤 live 로 실행한다.
 *
 * 구현 노트: import 체인에 `server-only` 마커가 있어 tsx 단독으로는 resolve
 * 되지 않는다. package.json 이 tsconfig.scripts.json 을 --tsconfig 로 지정한다.
 */
import dotenv from 'dotenv';

// src/db 가 import 시점에 DATABASE_URL 을 읽으므로, env 로드 후 동적 import 한다.
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL 이 설정되지 않았습니다 (.env.local / .env 확인).');
    process.exit(1);
  }
  try {
    console.log(`대상 DB 호스트: ${new URL(databaseUrl).host}`);
  } catch {
    console.log('대상 DB 호스트: (URL 파싱 불가 — DATABASE_URL 형식 확인 권장)');
  }

  const dryRun = process.env['DRY_RUN'] !== 'false';
  console.log(dryRun ? '모드: DRY_RUN (변경 없음)' : '모드: LIVE (실제 적용)');

  const { db } = await import('../src/db');
  const { findPrunableVersionIds } = await import(
    '../src/lib/versioning/version-retention.server'
  );
  const { pruneVersionSnapshots } = await import('../src/lib/versioning/version-prune.server');

  const targets = await findPrunableVersionIds(db);
  console.log(`정리 대상 버전: ${targets.length}건`);

  if (targets.length === 0 || dryRun) {
    if (dryRun && targets.length > 0) {
      console.log('DRY_RUN 이므로 변경하지 않았습니다. 적용하려면 pnpm versions:prune:live');
    }
    process.exit(0);
  }

  // 배치로 나눠 트랜잭션 하나가 지나치게 커지지 않게 한다.
  const BATCH = 50;
  let pruned = 0;
  let registeredKeys = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const result = await db.transaction((tx) =>
      pruneVersionSnapshots(tx, slice, '버전 보존 정책 일회성 정리'),
    );
    pruned += result.pruned;
    registeredKeys += result.registeredKeys;
    console.log(`  ${Math.min(i + BATCH, targets.length)}/${targets.length} 처리`);
  }

  console.log(`정리 완료: 버전 ${pruned}건, 유예 큐 신규 등록 키 ${registeredKeys}건`);
  process.exit(0);
}

main().catch((error) => {
  console.error('버전 정리 실패:', error);
  process.exit(1);
});
