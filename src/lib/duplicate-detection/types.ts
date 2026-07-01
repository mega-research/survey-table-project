export interface ClientSignals {
  /** LocalStorage UUID. null이면 storage 차단 또는 시크릿 모드 */
  deviceId: string | null;
  /** "1920x1080" */
  screen: string;
  /** "Asia/Seoul" */
  tz: string;
  /** "ko-KR" */
  lang: string;
  /** navigator.platform */
  platform: string;
}

export interface ServerSignals {
  ipHash: string | null;
  fpHash: string | null;
  deviceId: string | null;
}

/**
 * 응답 차단 사유. 응답 페이지·차단 화면·server action 결과 등에서 공통 사용.
 *
 * - invalid_token: 존재하지 않는 invite_token 으로 진입
 * - token_already_used: 동일 invite_token 으로 이미 응답 완료
 * - device_already_responded: 같은 device/fp+IP 로 이미 응답 완료
 * - excluded_from_population: 부정 결과코드 마킹 / unsubscribed_at 으로 모집단 제외됨
 */
export type BlockReason =
  | 'invalid_token'
  | 'token_already_used'
  | 'device_already_responded'
  | 'excluded_from_population'
  | 'quota_closed';

export type CheckResult =
  | { blocked: true; reason: BlockReason }
  | {
      blocked: false;
      /** Track A 통과 시 매칭된 contact id */
      contactTargetId?: string;
    };
