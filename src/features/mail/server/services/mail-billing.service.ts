import 'server-only';

import { eq, gt } from 'drizzle-orm';

import { db } from '@/db';
import { mailBillingPeriods } from '@/db/schema/mail-billing';

import type {
  CreateBillingPeriodInput,
  MailBillingPeriod,
} from '../../domain/mail-billing';

/**
 * 요금제·결제일 행 등록.
 *
 * - 인증은 authed 미들웨어가 담당. createdBy 는 procedure 에서 context.user.id 주입.
 * - start_date.day === billing_day_of_month 강제. 결제일은 startDate.day 에서 추출.
 * - day 1~28 범위 위반은 service throw (월말 보정 회피). 원본 ActionResult error 의미 보존.
 * - unique(start_date) 위반은 Postgres 런타임 에러라 service catch 에서 한국어 메시지로 변환.
 *   Postgres 가 자동 부여한 unique 제약 이름은 `<table>_<column>_key` 형식이므로
 *   메시지 매칭은 컬럼명 기준으로 느슨하게 처리해 향후 제약 이름 변경에도 견디게 함.
 */
export async function createBillingPeriod(
  input: CreateBillingPeriodInput,
  createdBy: string,
): Promise<MailBillingPeriod> {
  const day = parseInt(input.startDate.slice(8, 10), 10);
  if (!Number.isFinite(day) || day < 1 || day > 28) {
    throw new Error('시작일은 매달 1~28일 사이여야 합니다 (월말 보정 회피).');
  }

  try {
    const [row] = await db
      .insert(mailBillingPeriods)
      .values({
        startDate: input.startDate,
        billingDayOfMonth: day,
        planLabel: input.planLabel,
        monthlyFeeKrw: input.monthlyFeeKrw,
        includedEmails: input.includedEmails,
        overagePer1kKrw: input.overagePer1kKrw,
        note: input.note ?? null,
        createdBy,
      })
      .returning();
    if (!row) throw new Error('mail_billing_periods INSERT 실패');
    return row;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('start_date') && (msg.includes('unique') || msg.includes('duplicate key'))) {
      throw new Error('동일한 시작일의 요금제가 이미 등록되어 있습니다.');
    }
    throw err;
  }
}

/**
 * 가장 최근 행만 삭제 허용. 중간 행 삭제는 과거 사이클 정합성을 깨므로 거부.
 */
export async function deleteLatestBillingPeriod(id: string): Promise<void> {
  const target = await db
    .select({ id: mailBillingPeriods.id, startDate: mailBillingPeriods.startDate })
    .from(mailBillingPeriods)
    .where(eq(mailBillingPeriods.id, id))
    .limit(1);
  if (target.length === 0) {
    throw new Error('대상 요금제를 찾을 수 없습니다.');
  }

  const newer = await db
    .select({ id: mailBillingPeriods.id })
    .from(mailBillingPeriods)
    .where(gt(mailBillingPeriods.startDate, target[0]!.startDate))
    .limit(1);
  if (newer.length > 0) {
    throw new Error(
      '더 최근의 요금제가 존재합니다. 가장 최근 행부터 차례로 삭제해주세요.',
    );
  }

  await db.delete(mailBillingPeriods).where(eq(mailBillingPeriods.id, id));
}
