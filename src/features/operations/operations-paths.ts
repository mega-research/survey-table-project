/**
 * 운영 콘솔 주소 조립 — 접두를 아는 유일한 자리.
 *
 * 화면 컴포넌트는 `/surveys/<id>/operations` 를 직접 쓰지 않고 `basePath` 를 주입받는다.
 * 소비자가 둘이라(내부 콘솔·외주 실사 링크 콘솔) 이 이음새가 실제로 맞는지 증명돼 있고,
 * `/admin` 접두를 걷을 때 만진 자리도 이 파일 하나였다.
 *
 * 링크 콘솔이 재사용하지 않는 화면(메일·업로드·컬럼 설정·응답 내역)은 주입받을 상대가 없어
 * `internalOperationsPaths` 를 스스로 부른다 — 주입과 자가 조립이 갈리는 기준은 **그 화면이
 * 내부 콘솔 밖에서도 열리는가**이고, 하드코딩 문자열은 어느 쪽에도 남기지 않는다.
 */

/** 운영 콘솔 하위 주소 모음. 문자열 자리는 고정 주소, 함수 자리는 id 를 받는 주소다. */
export interface OperationsPaths {
  readonly base: string;
  readonly overview: string;
  readonly profiles: string;
  readonly report: string;
  readonly reportColumns: string;
  readonly contacts: string;
  readonly contactsColumns: string;
  readonly contactsResultCodes: string;
  readonly contactsUpload: string;
  readonly contactsUploadNew: string;
  readonly mailTemplates: string;
  readonly mailTemplateNew: string;
  readonly mailCampaigns: string;
  readonly mailCampaignNew: string;
  readonly quota: string;
  readonly demand: string;
  contact(contactId: string): string;
  profileEdit(responseId: string): string;
  mailTemplateEdit(templateId: string): string;
  mailCampaign(campaignId: string): string;
}

/**
 * 주어진 base 아래의 운영 콘솔 주소를 만든다.
 *
 * base 끝의 슬래시를 흡수하는 것은 호출부 편의가 아니라 계약이다 — 이중 슬래시가 섞이면
 * 탭 활성 판정(`pathname.startsWith`)이 조용히 빗나가 아무 탭도 활성으로 보이지 않는다.
 */
export function operationsPaths(base: string): OperationsPaths {
  const root = base.endsWith('/') ? base.slice(0, -1) : base;
  const contacts = `${root}/contacts`;
  const profiles = `${root}/profiles`;
  const mail = `${root}/mail`;
  return {
    base: root,
    overview: `${root}/overview`,
    profiles,
    report: `${root}/report`,
    reportColumns: `${root}/report/columns`,
    contacts,
    contactsColumns: `${contacts}/columns`,
    contactsResultCodes: `${contacts}/result-codes`,
    contactsUpload: `${contacts}/upload`,
    contactsUploadNew: `${contacts}/upload/new`,
    mailTemplates: `${mail}/templates`,
    mailTemplateNew: `${mail}/templates/new`,
    mailCampaigns: `${mail}/campaigns`,
    mailCampaignNew: `${mail}/campaigns/new`,
    quota: `${root}/quota`,
    demand: `${root}/demand`,
    contact: (contactId) => `${contacts}/${contactId}`,
    profileEdit: (responseId) => `${profiles}/${responseId}/edit`,
    mailTemplateEdit: (templateId) => `${mail}/templates/${templateId}/edit`,
    mailCampaign: (campaignId) => `${mail}/campaigns/${campaignId}`,
  };
}

/**
 * 내부 콘솔의 base — 직원이 쓰는 주소.
 *
 * 세그먼트가 `/surveys` 로 시작하는 것이 요점이다. 파일은 라우트 그룹 `app/(internal)/` 안에
 * 묶여 있지만 괄호는 주소에 나타나지 않으므로, **파일 트리와 주소가 한 단계 어긋난다** —
 * 이 함수가 그 어긋남을 흡수하는 유일한 자리다.
 */
export function internalOperationsBase(surveyId: string): string {
  return `/surveys/${surveyId}/operations`;
}

/** 내부 콘솔 전용 화면이 스스로 부르는 편의 생성자. */
export function internalOperationsPaths(surveyId: string): OperationsPaths {
  return operationsPaths(internalOperationsBase(surveyId));
}

/**
 * 외주 실사 링크 콘솔의 base — 접두가 `/fw/<token>` 이다 (ADR-0026, .pen FLOW 10-4).
 *
 * 설문 id 가 아니라 **링크 토큰**이 주소에 실리는 것이 요점이다. 외주에게 설문 id 를 보여줄
 * 이유가 없고, 토큰 하나가 곧 그 설문을 지목하므로 경로에 둘이 함께 실릴 필요도 없다.
 */
export function fieldworkLinkOperationsBase(token: string): string {
  return `/fw/${token}/operations`;
}

export function fieldworkLinkOperationsPaths(token: string): OperationsPaths {
  return operationsPaths(fieldworkLinkOperationsBase(token));
}

export function surveyListPath(): string {
  return '/surveys';
}

export function surveyEditPath(surveyId: string): string {
  return `/surveys/${surveyId}/edit`;
}

export function surveyPreviewPath(surveyId: string): string {
  return `/surveys/${surveyId}/preview`;
}

/** 메일 비용 정산은 인스턴스 전체 단위라 설문 스코프 밖의 글로벌 주소다. */
export function mailCostPath(): string {
  return '/billing/mail-cost';
}
