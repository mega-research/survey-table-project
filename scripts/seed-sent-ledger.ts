/**
 * 발송 장부 1회 시딩 스크립트 (이슈 04 / PRD "발송 장부 기록 + 1회 시딩")
 *
 * 기존 mail_campaigns 전수(아카이브 여부 무관, isTest 포함)의
 * bodyHtmlSnapshot·attachmentsSnapshot 에서 R2 키를 추출해 r2_sent_keys 에
 * 기록한다. 재실행 멱등 — recordSentKeys 가 중복 키를 무시한다.
 *
 * 사용법:
 *   pnpm ledger:seed        # DATABASE_URL 대상 (.env.local 우선, 없으면 .env)
 *
 * 주의: .env 는 로컬, .env.local 은 원격 DB 를 가리키는 관행 — Next.js 와 같은
 * 우선순위(.env.local > .env)로 로드하며, 셸에서 DATABASE_URL 을 직접 지정하면
 * 그것이 최우선이다. 실행 시 대상 DB 호스트를 출력하니 반드시 확인할 것.
 *
 * 구현 노트: import 체인에 `server-only` 마커가 있어 tsx 단독으로는 resolve
 * 되지 않는다. package.json 의 ledger:seed 가 tsconfig.scripts.json 의 paths
 * 스텁(tests/stubs/server-only.ts — vitest 와 동일 스텁)을 --tsconfig 로
 * 지정해 통과시킨다.
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

  const { seedSentLedgerFromCampaignSnapshots } = await import(
    '../src/lib/r2-lifecycle/sent-ledger-seed.server'
  );
  const result = await seedSentLedgerFromCampaignSnapshots();
  console.log(`캠페인 ${result.campaigns}건 스캔, 장부 신규 기록 ${result.recorded}건`);
  process.exit(0);
}

main().catch((error) => {
  console.error('발송 장부 시딩 중 오류:', error);
  process.exit(1);
});
