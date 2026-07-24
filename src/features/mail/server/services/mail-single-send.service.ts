import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';

import type { CreateCampaignResult, SendSingleCampaignInput } from '../../domain/mail-campaign';
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
): Promise<CreateCampaignResult> {
  const [contact] = await db
    .select({
      id: contactTargets.id,
      surveyId: contactTargets.surveyId,
      unsubscribedAt: contactTargets.unsubscribedAt,
    })
    .from(contactTargets)
    .where(
      and(eq(contactTargets.id, input.contactTargetId), eq(contactTargets.surveyId, input.surveyId)),
    )
    .limit(1);
  if (!contact) {
    throw new Error('조사 대상을 찾을 수 없습니다.');
  }
  if (contact.unsubscribedAt) {
    throw new Error('수신거부된 조사 대상에게는 메일을 보낼 수 없습니다.');
  }

  const [emailPii] = await db
    .select({ id: contactPii.id })
    .from(contactPii)
    .where(
      and(eq(contactPii.contactTargetId, input.contactTargetId), eq(contactPii.fieldType, 'email')),
    )
    .orderBy(asc(contactPii.columnKey))
    .limit(1);
  if (!emailPii) {
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
    { kind: 'single' },
  );
}
