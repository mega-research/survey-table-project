/**
 * 조사표(survey-document) 도메인의 JSONB 문서 어휘.
 * 버전 스냅샷(`survey_versions.snapshot.anchors`)에 실리는 모양이라 여기가 SoT 다.
 */

/**
 * 스냅샷에 실리는 앵커 한 건. 대상 종류는 저장하고(파생 불가한 층이므로) 좌표만 담는다.
 *
 * `documentId` 는 조사표가 둘 이상 붙었을 때 이 사각형이 **어느 조사표의 것인지**를
 * 가린다. 지금 화면은 하나만 붙이지만 테이블이 여러 행을 받는 모양이라, 이 필드가
 * 없으면 두 번째 조사표의 앵커가 첫 번째 위에 조용히 그려진다.
 * 이 필드 도입 이전 발행본은 undefined — 그때는 조사표가 하나뿐이었다.
 */
export interface SurveyAnchorSnapshot {
  documentId?: string;
  ownerKind: 'question' | 'group';
  ownerId: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
