/**
 * 페이저 칸 공통 모양 — 운영 콘솔 페이저(표 푸터 · 단체 메일 세 곳 · 위저드)와 페이지 이동 입력이 같이 쓴다.
 * 비활성 칸도 글자가 읽히게 투명도 대신 회색 글자·배경으로 그린다.
 */
const PAGER_BOX =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm tabular-nums';
export const PAGER_ITEM_CLASS = `${PAGER_BOX} border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50`;
export const PAGER_ITEM_DISABLED_CLASS = `${PAGER_BOX} cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400`;
export const PAGER_ITEM_CURRENT_CLASS = `${PAGER_BOX} border-blue-600 bg-blue-600 font-semibold text-white`;
export const PAGER_ELLIPSIS_CLASS = 'px-1 text-sm text-slate-500';
/** 페이저 왼쪽의 「현재 / 전체」 표기 */
export const PAGER_STATUS_CLASS = 'mr-1 text-sm text-slate-600 tabular-nums';
