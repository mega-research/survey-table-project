// 어드민 편집 onSubmit 페이로드 — 응답 플로우 컴포넌트가 호출자에게 questionResponses 만 넘길 때 쓴다.
// 서버는 이 타입을 쓰지 않는다. RPC 입력은 server/survey-response/domain 의 SaveAdminEditInput 이고,
// 이쪽은 플로우와 그 호출자 사이의 약속이라 feature 가 소유한다.
// 원위치: src/actions/response-edit-actions.ts → server/survey-response/domain/response-edit.ts.

export interface SaveAdminEditPayload {
  questionResponses: Record<string, unknown>;
}
