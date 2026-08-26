/**
 * 워크스페이스 화면의 폼 필드 클래스 — 사용자 관리 모달 3종과 프로필이 함께 쓴다.
 *
 * .pen 이 정한 치수(라벨 12.5px·입력 높이 36px·힌트 10.5px)와 색을 그대로 옮긴 값이다.
 * 사본이 셋이 되는 순간 한 모달만 고쳐지고 나머지가 어긋나기 시작하므로 한 자리에 모은다.
 */
export const FIELD_LABEL = 'text-[12.5px] font-semibold text-[#374151]';

export const FIELD_INPUT =
  'h-9 rounded-lg border-[#D1D5DB] text-[13px] placeholder:text-[#9CA3AF] focus-visible:ring-[#2E4FCE]';

/** 필드 아래 보조 설명. */
export const FIELD_HINT = 'text-[10.5px] text-[#9CA3AF]';
