import { notFound } from 'next/navigation';

import {
  contactDetailPermissions,
  type ContactDetailPermissions,
} from '@/features/operations/contacts/contact-detail-permissions';
import { ContactDetailForm } from '@/features/operations/contacts/contact-detail-form';
import { attrsKeyOf } from '@/lib/operations/contacts-format';
import { extractSystemFieldKeys } from '@/lib/operations/contacts-shared';
import type { OperationsDataScope } from '@/server/data-scope';
import { getMailTemplatesBySurvey } from '@/server/mail/services/templates';
import {
  getContactColumnScheme,
  getContactDetailById,
  getContactResultCodes,
  getEditableResponseIdForTarget,
  getMailRecipientsForTarget,
  getResponseEditLogs,
} from '@/server/read-models/contacts';
import { isReeditableResponseStatus } from '@/shared/contracts/survey-response';
import type { SurveyCapability } from '@/shared/contracts/workspace';

/**
 * 조사 대상 단건 상세의 본문 — 내부 콘솔(`app/(internal)`)과 외주 실사 링크 트리가 함께 쓰는 **한 벌**
 * (ADR-0026, 티켓 08).
 *
 * 형제 `overview-screen` 의 주석에 이 폴더의 규칙이 있다: **가로질러 읽는 화면만 여기 온다.**
 * 이 조립은 컨택 read-model 과 메일 도메인 서비스를 함께 읽으므로 어느 도메인도 소유할 수
 * 없고, UI 는 `@/server` 를 import 하지 못한다.
 *
 * ## 그리지 않는 것은 **읽지도 않는다**
 *
 * 메일 이력·템플릿은 `mail.view`/`mail.send` 가 있을 때만 조회한다. 「화면에서 감춘다」와
 * 「서버가 안 읽는다」는 다르다 — 감추기만 하면 수신자 이력이 RSC payload 로 그대로 나간다.
 * 응답 편집 이력도 같다(그 행에는 고친 사람의 이메일이 실린다).
 *
 * ## 대행 진입점은 **여기서** 정한다
 *
 * 초대 코드는 곧 그 사람의 응답 화면이고 그 주소는 `pub` 경로라, 한 번 payload 에 실리면
 * 서버가 다시 막을 수 없다. 그래서 화면에 넘길지를 이 자리에서 정하고
 * (`canProxyRespond`), 폼은 받은 것만 그린다.
 */
interface Props {
  surveyId: string;
  contactId: string;
  /** 이 콘솔의 주소 접두. */
  basePath: string;
  capabilities: ReadonlySet<SurveyCapability>;
  scope: OperationsDataScope;
  /**
   * 이 주체가 이 대상을 **대신 입력해도 되는가**.
   *
   * capability 로 물을 수 없다 — 상세를 볼 수 있다는 것(`contacts.view`)과 남의 응답 화면을
   * 대신 열어도 된다는 것이 같지 않다. 판정은 라우트가 주체를 보고 하고, 여기서는 그 결과를
   * 초대 코드의 노출로 옮긴다.
   */
  canProxyRespond: boolean;
}

export async function ContactDetailScreen({
  surveyId,
  contactId,
  basePath,
  capabilities,
  scope,
  canProxyRespond,
}: Props) {
  // surveyId 는 read-model 의 WHERE 로 내려간다 — 사후 비교로 두면 타 팀 컨택의 PII 가
  // 이미 복호화된 뒤에 접히게 된다(티켓 15).
  const detail = await getContactDetailById(contactId, surveyId, scope);
  if (!detail) notFound();

  const permissions = contactDetailPermissions(capabilities, { proxyRespond: canProxyRespond });

  // 완료·진행중·이탈 통틀어 최신 응답이 수정 대상. contactTargetId 미링크
  // 레거시 완료 건만 contact_targets.responseId 로 폴백한다 (레거시 링크는
  // 완료 시점에만 생기므로 completed 로 간주).
  const editable = await getEditableResponseIdForTarget(detail.contact.id, scope);
  const editableResponseId = editable?.id ?? detail.contact.responseId;
  // 재응답 허용 대상 상태 판정은 contracts 의 술어 하나가 소유한다 — 여기서 리터럴로
  // 다시 쓰면 서비스 가드(allowReeditResponse)와 조용히 어긋나 버튼이 안 뜨거나,
  // 떠도 no-op 이 된다. 자격미달도 대상이다.
  const editableResponseReeditable = editable
    ? isReeditableResponseStatus(editable.status)
    : detail.contact.responseId != null;

  const [scheme, resultCodes, mailHistory, editLogs, mailTemplates] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
    permissions.viewMail ? getMailRecipientsForTarget(detail.contact.id, scope) : [],
    permissions.manageResponses ? getResponseEditLogs(editableResponseId, detail.contact.id) : [],
    permissions.sendMail ? getMailTemplatesBySurvey(surveyId) : [],
  ]);
  if (!scheme) notFound();

  const groupLabel = detail.contact.groupValue ?? '미지정';
  const companyKey = scheme.columns.find((c) => attrsKeyOf(c.source)?.includes('기업명'))?.source;
  const companyAttrsKey = companyKey ? attrsKeyOf(companyKey) : null;
  const companyName = companyAttrsKey ? detail.contact.attrs[companyAttrsKey] : null;

  const hasEmail = Object.values(detail.contact.piiDecrypted).some(
    (p) => p.fieldType === 'email' && p.plain.trim() !== '',
  );
  const mailSendDisabledReason = detail.contact.unsubscribedAt
    ? '수신거부된 대상입니다'
    : !hasEmail
      ? '이메일 정보가 없습니다'
      : null;
  const mailTemplateOptions = mailTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    fromName: t.fromName,
  }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          조사 대상 단건 편집 — resid {detail.contact.resid}
        </h2>
        <p className="text-sm text-slate-500">
          {groupLabel}
          {companyName ? ` · ${companyName}` : ''}
        </p>
      </div>

      <ContactDetailForm
        surveyId={surveyId}
        basePath={basePath}
        scheme={scheme}
        resultCodes={resultCodes}
        systemFieldKeys={extractSystemFieldKeys(scheme)}
        mailHistory={mailHistory}
        editLogs={editLogs}
        {...(permissions.sendMail
          ? {
              mailSend: {
                templates: mailTemplateOptions,
                disabledReason: mailSendDisabledReason,
              },
            }
          : {})}
        permissions={permissions}
        initial={{
          id: detail.contact.id,
          resid: detail.contact.resid,
          attrs: detail.contact.attrs,
          piiDecrypted: detail.contact.piiDecrypted,
          memo: detail.contact.memo,
          contactMethod: detail.contact.contactMethod,
          respondedAt: detail.contact.respondedAt,
          // **대행 진입점의 실체.** 못 누르는 주체에게는 코드 자체를 넘기지 않는다 —
          // 버튼만 감추면 이 값이 payload 로 나가고 그 주소는 `pub` 이라 막을 수 없다.
          // 원문 토큰은 아예 넘기지 않는다: 화면이 쓰는 것은 짧은 링크의 코드뿐이다.
          inviteCode: canProxyRespond ? detail.contact.inviteCode : null,
          responseId: editableResponseId,
          responseReeditable: editableResponseReeditable,
          attempts: detail.attempts,
        }}
      />
    </main>
  );
}

export type { ContactDetailPermissions };
