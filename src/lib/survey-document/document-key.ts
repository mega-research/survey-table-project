/**
 * 조사표 PDF 의 R2 키 규약 — 순수 모듈.
 *
 * 업로드는 tmp 로 받고, 설문에 붙이는 시점(attach)에 영구 위치로 promote 한다.
 * 이미지·공지 첨부와 같은 관례다. tmp 는 R2 lifecycle(24h) 소관이라 붙이지 못한
 * 업로드가 저절로 사라지고, 영구 키만 유예 삭제 시스템의 대상이 된다.
 *
 * 영구 접두사는 **기존 영구 네임스페이스 `survey/` 안**이다 — 새 네임스페이스를
 * 만들지 않으므로 key-extract 의 화이트리스트를 건드리지 않는다.
 */

export const TMP_SURVEY_DOCUMENT_PREFIX = 'tmp/survey-document/';
export const SURVEY_DOCUMENT_PREFIX = 'survey/document/';

/** 업로드 tmp 키인가. attach 입력 검증에서 쓴다. */
export function isTmpSurveyDocumentKey(key: string): boolean {
  return key.startsWith(TMP_SURVEY_DOCUMENT_PREFIX) && !key.includes('..');
}

/**
 * tmp 키 → 영구 키. 파일명 부분만 옮긴다.
 * tmp 키가 아니면 null (호출자가 거부한다).
 */
export function toPermanentSurveyDocumentKey(tmpKey: string): string | null {
  if (!isTmpSurveyDocumentKey(tmpKey)) return null;
  const basename = tmpKey.slice(TMP_SURVEY_DOCUMENT_PREFIX.length);
  if (!basename || basename.includes('/')) return null;
  return `${SURVEY_DOCUMENT_PREFIX}${basename}`;
}
