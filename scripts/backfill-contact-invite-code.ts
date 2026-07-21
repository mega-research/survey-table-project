import 'dotenv/config';

import { eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '../src/db';
import { contactTargets } from '../src/db/schema/contacts';

async function backfill() {
  const rows = await db
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(isNull(contactTargets.inviteCode));

  console.log(`백필 대상: ${rows.length}건`);

  let done = 0;
  for (const row of rows) {
    // UNIQUE 충돌 시 재발번 재시도 (nanoid(10) 충돌은 사실상 없음 — 방어적).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await db
          .update(contactTargets)
          .set({ inviteCode: nanoid(10) })
          .where(eq(contactTargets.id, row.id));
        done += 1;
        break;
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
  }

  console.log(`백필 완료: ${done}/${rows.length}건`);
  process.exit(0);
}

backfill().catch((error) => {
  console.error('백필 중 오류:', error);
  process.exit(1);
});
