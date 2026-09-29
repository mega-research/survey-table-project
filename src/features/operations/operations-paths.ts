/**
 * 운영 콘솔 주소 조립 — 접두를 아는 유일한 자리.
 *
 * 화면 컴포넌트는 `/admin/surveys/<id>/operations` 를 직접 쓰지 않고 `basePath` 를 주입받는다.
 * 오늘 주입되는 값은 admin 하나뿐이라 보이는 것은 종전과 같지만, 외주 실사 링크 콘솔이
 * **같은 화면 정의를 다른 접두로** 열고(ADR-0026) 나중에 `/admin` 접두를 걷는 작업도 이 파일
 * 하나만 만지게 된다.
 *
 * 링크 콘솔이 재사용하지 않는 화면(메일·업로드·컬럼 설정·응답 내역)은 주입받을 상대가 없어
 * `adminOperationsPaths` 를 스스로 부른다 — 주입과 자가 조립이 갈리는 기준은 **그 화면이
 * admin 밖에서도 열리는가**이고, 하드코딩 문자열은 어느 쪽에도 남기지 않는다.
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

/** 내부 운영 콘솔의 base. `/admin` 접두를 아는 자리는 이 아래 넷뿐이다. */
export function adminOperationsBase(surveyId: string): string {
  return `/admin/surveys/${surveyId}/operations`;
}

/** admin 전용 화면이 스스로 부르는 편의 생성자. */
export function adminOperationsPaths(surveyId: string): OperationsPaths {
  return operationsPaths(adminOperationsBase(surveyId));
}

export function adminSurveyListPath(): string {
  return '/admin/surveys';
}

export function adminSurveyEditPath(surveyId: string): string {
  return `/admin/surveys/${surveyId}/edit`;
}

export function adminSurveyPreviewPath(surveyId: string): string {
  return `/admin/surveys/${surveyId}/preview`;
}

/** 메일 비용 정산은 인스턴스 전체 단위라 설문 스코프 밖의 글로벌 주소다. */
export function adminMailCostPath(): string {
  return '/admin/billing/mail-cost';
}
