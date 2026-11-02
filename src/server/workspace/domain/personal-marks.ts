// 개인 표시 도메인 — 즐겨찾기 (설문 즐겨찾기·태그 티켓 06).
//
// client-safe — server-only·Node·DB 의존 없음. 계약은 shared/contracts 가 소유하고 여기는 그것을
// 다시 내보낸다(공유 설정·그룹 도메인과 같은 구조). 내 태그(티켓 07)의 이름 정규화·한도·색 배정
// 순수 함수가 이 파일에 더해진다.

export { SetFavoriteInput, SetFavoriteOutput } from '@/shared/contracts/workspace-io';
