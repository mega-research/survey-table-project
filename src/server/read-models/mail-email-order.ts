import { eq } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { surveys } from '@/db/schema';
import { type MailEmailOrder, resolveMailEmailOrder } from '@/lib/contacts/mail-email-order';
import { decryptPii } from '@/lib/crypto/aes';
import { selectEmailPiiRows } from '@/lib/crypto/contact-pii-repo';

/**
 * 설문의 메일 발송 주소 순서 — 컬럼 설정(`contactColumns`·`testContactColumns`)의 mailOrder 를 읽는다.
 * 파티션마다 스킴이 따로라 순서도 따로다.
 */
export interface MailEmailOrders {
  real: MailEmailOrder;
  test: MailEmailOrder;
}

export async function loadMailEmailOrders(
  surveyId: string,
  executor: DbOrTx = db,
): Promise<MailEmailOrders> {
  const [row] = await executor
    .select({ real: surveys.contactColumns, test: surveys.testContactColumns })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  return {
    real: resolveMailEmailOrder(row?.real),
    test: resolveMailEmailOrder(row?.test),
  };
}

/** 한 파티션의 발송 주소 순서. */
export async function loadMailEmailOrder(
  surveyId: string,
  isTest: boolean,
  executor: DbOrTx = db,
): Promise<MailEmailOrder> {
  const orders = await loadMailEmailOrders(surveyId, executor);
  return isTest ? orders.test : orders.real;
}

/**
 * 조사 대상 한 명의 발송 주소(평문). 없거나 복호화에 실패하면 null.
 * 발송(createCampaign)과 같은 규칙 — 순서대로 훑어 값이 있는 첫 열. 미리보기·수신거부 안내가 쓴다.
 */
export async function loadSendEmailForTarget(target: {
  id: string;
  surveyId: string;
  isTest: boolean;
}): Promise<string | null> {
  const order = await loadMailEmailOrder(target.surveyId, target.isTest);
  const rows = await selectEmailPiiRows(db, [target.id], order);
  for (const row of rows) {
    try {
      const email = decryptPii(row.cipher);
      if (email && email.trim()) return email;
    } catch {
      // 복호화 실패 열은 건너뛰고 다음 순위로 넘어간다.
    }
  }
  return null;
}
