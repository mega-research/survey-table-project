import * as z from 'zod';

/**
 * 어드민 응답 수정(saveAdminEdit) 도메인 스키마.
 *
 * questionResponses 는 질문 유형마다 형태가 제각각인 복잡 JSONB 라 z.custom 으로
 * 타입만 보장한다(런타임 형태 변형 위험 방지).
 * surveyId/responseId 는 기존 server action 이 형식 검증 없이 받았으므로
 * .uuid() 강제하지 않는다 — value-mismatch 시 변경 0행 + ok:true 동작을 보존.
 */
export const SaveAdminEditInput = z.object({
  surveyId: z.string(),
  responseId: z.string(),
  questionResponses: z.custom<Record<string, unknown>>(),
});
export type SaveAdminEditInput = z.infer<typeof SaveAdminEditInput>;

export const SaveAdminEditOutput = z.object({ ok: z.literal(true) });
export type SaveAdminEditOutput = z.infer<typeof SaveAdminEditOutput>;

/**
 * 어드민 편집 onSubmit 페이로드 — 클라이언트 컴포넌트가 questionResponses 만 전달할 때 쓰는 타입.
 * 원위치: src/actions/response-edit-actions.ts 의 SaveAdminEditPayload.
 */
export interface SaveAdminEditPayload {
  questionResponses: Record<string, unknown>;
}
