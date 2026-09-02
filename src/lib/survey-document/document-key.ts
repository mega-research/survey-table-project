import { randomUUID } from 'node:crypto';

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
 * tmp 키를 영구 위치로 옮길 때 쓸 **새 키**를 만든다.
 * tmp 키가 아니면 null (호출자가 거부한다).
 *
 * 이름을 tmp 키에서 **파생하지 않는다.** 파생하면 같은 업로드로 붙이기를 두 번
 * 시도했을 때 두 요청이 같은 영구 키를 가리키고, 한쪽이 커밋에 성공한 뒤 다른 쪽이
 * 실패하면 실패한 쪽의 롤백이 **성공한 행이 참조하는 객체를 지운다**. 발행된 설문의
 * 조사표가 영구히 열리지 않게 되는 실패라, 붙일 때마다 새 이름을 발급한다.
 */
export function toPermanentSurveyDocumentKey(
  tmpKey: string,
  newId: () => string = () => randomUUID(),
): string | null {
  if (!isTmpSurveyDocumentKey(tmpKey)) return null;
  const basename = tmpKey.slice(TMP_SURVEY_DOCUMENT_PREFIX.length);
  if (!basename || basename.includes('/')) return null;
  return `${SURVEY_DOCUMENT_PREFIX}${newId()}.pdf`;
}
