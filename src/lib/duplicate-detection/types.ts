export interface ClientSignals {
  /** LocalStorage UUID. null이면 storage 차단 또는 시크릿 모드 */
  deviceId: string | null;
  /** "1920x1080" */
  screen: string;
  /** window.devicePixelRatio */
  dpr: number;
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

export type CheckResultBlocked = {
  blocked: true;
  reason: 'invalid_token' | 'token_already_used' | 'device_already_responded';
};

export type CheckResultPassed = {
  blocked: false;
  /** Track A 통과 시 매칭된 contact id */
  contactTargetId?: string;
};

export type CheckResult = CheckResultBlocked | CheckResultPassed;
