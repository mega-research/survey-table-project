import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { selectEmailPiiRows } from '@/lib/crypto/contact-pii-repo';
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/server/read-models/result-code-statuses.server';

import type { CreateCampaignResult, SendSingleCampaignInput } from '../domain/mail-campaign';
import { createCampaign } from './mail-campaigns.service';
import { getMailTemplate } from './mail-templates.service';

/**
 * 컨택 1명에게 템플릿 메일 발송 — kind='single' 캠페인 생성 후 기존 파이프라인 재사용.
 *
 * 가드는 createCampaign 내부(수신거부/이메일/부정 결과코드 제외)에도 있지만,
 * 단건은 "왜 안 되는지"를 사용자에게 정확히 알려야 하므로 여기서 선검증한다 (fail-closed).
 */
export async function sendSingleCampaign(
  input: SendSingleCampaignInput,
  userId: string,
  isGuest: boolean,
): Promise<CreateCampaignResult> {
  const [contact] = await db
    .select({
      id: contactTargets.id,
      surveyId: contactTargets.surveyId,
      unsubscribedAt: contactTargets.unsubscribedAt,
    })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, input.contactTargetId),
        eq(contactTargets.surveyId, input.surveyId),
      ),
    )
    .limit(1);
  if (!contact) {
    throw new Error('조사 대상을 찾을 수 없습니다.');
  }
  if (contact.unsubscribedAt) {
    throw new Error('수신거부된 조사 대상에게는 메일을 보낼 수 없습니다.');
  }

  const { negative: negativeCodes } = await getResultCodeStatuses(input.surveyId);
  const [negativeCodeContact] = await db
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, input.contactTargetId),
        buildNegativeCodeExists(negativeCodes, sql`"contact_targets"."id"`),
      ),
    )
    .limit(1);
  if (negativeCodeContact) {
    throw new Error('연락금지 결과코드가 기록된 조사 대상입니다.');
  }

  // 존재 검사만 필요하지만 "어떤 행이 이메일인가" 는 selectEmailPiiRows 한 곳이 정한다.
  const emailRows = await selectEmailPiiRows(db, [input.contactTargetId]);
  if (emailRows.length === 0) {
    throw new Error('이메일 정보가 없는 조사 대상입니다.');
  }

  const template = await getMailTemplate(input.surveyId, input.mailTemplateId);
  if (!template) {
    throw new Error('선택한 메일 템플릿을 찾을 수 없습니다.');
  }

  return createCampaign(
    {
      surveyId: input.surveyId,
      mailTemplateId: input.mailTemplateId,
      title: `단건: ${template.name}`,
      contactTargetIds: [input.contactTargetId],
    },
    userId,
    isGuest,
    { kind: 'single' },
  );
}
