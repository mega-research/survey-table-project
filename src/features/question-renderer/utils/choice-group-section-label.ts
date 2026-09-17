/**
 * 그룹별 섹션 카드의 섹션 제목 — 보기 그룹 라벨에서 **행 제목 접두를 뗀 짧은 축 이름**.
 *
 * 빌더는 열마다 하나씩 고르는 표의 그룹 라벨을 "1) 얼라이언스 운영 - 인지여부"처럼 행 제목과
 * 축 이름을 이어 붙여 짓는 일이 많다(내보내기 라벨이 그 문구를 그대로 쓴다). 카드 제목이
 * 이미 행 제목이므로 섹션에는 축 이름만 남긴다.
 *
 * 규칙(순서대로):
 * 1. 그룹 라벨이 행 제목(첫 줄)으로 시작하면 그 뒤의 구분 기호(- – — : ·)와 공백을 뗀 나머지
 * 2. 남은 것이 없거나 애초에 접두가 아니면 그룹 라벨 그대로
 * 3. 그룹 라벨이 비었으면 fallback(열 제목 등)
 */
export function resolveChoiceGroupSectionLabel(
  groupLabel: string | undefined,
  rowTitle: string | undefined,
  fallback = '',
): string {
  const label = (groupLabel ?? '').trim();
  if (!label) return fallback.trim();
  const title = (rowTitle ?? '').split('\n')[0]?.trim() ?? '';
  if (title && label.startsWith(title)) {
    const rest = label.slice(title.length).replace(/^[\s\-–—:·]+/, '').trim();
    if (rest) return rest;
  }
  return label;
}
