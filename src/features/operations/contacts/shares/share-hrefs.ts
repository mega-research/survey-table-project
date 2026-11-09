import { internalOperationsPaths } from '../../operations-paths';

// 외주 담당 범위는 내부 콘솔 전용 화면이다(링크 발급 권한자) — 외주 링크 콘솔에 주입받을 상대가 없어 스스로 조립한다.
export function sharesHref(surveyId: string): string {
  return internalOperationsPaths(surveyId).contactsShares;
}

export function shareEditHref(surveyId: string, linkId: string): string {
  return internalOperationsPaths(surveyId).contactsShare(linkId);
}
