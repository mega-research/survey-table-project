// 운영 콘솔 경계 계약 — 응답 내역(profiles) read model 행.
// 같은 폴더의 operations.ts — DB 에 저장되는 JSONB 문서 어휘. 이 파일 — 서버와 UI 사이 경계를 건너는 모양.
// client-safe — server-only·Node·DB 의존 없음.
import type { Platform } from '@/lib/operations/parse-ua';

// RSC 가 SQL 로 뽑아 클라이언트 표에 props 로 넘기는 모양.
// 조회 자체는 server/operations/services/profiles.server 소관이고 여기는 모양만 둔다.
export interface ProfilesRow {
  id: string;
  /** ROW_NUMBER() — 표시용 순번 (started_at asc 기준 접수 번호, surveyId 단위 절대값) */
  idx: number;
  platform: Platform | null;
  browser: string | null;
  status: string;
  currentStepId: string | null;
  /** visible step 진척 (분기/표시조건 반영). 응답 페이지 저장값. 구 데이터·첫 답변 전 null. */
  visibleStepIndex: number | null;
  visibleStepTotal: number | null;
  startedAt: Date;
  completedAt: Date | null;
  totalSeconds: number | null;
  /** 매칭된 contact_targets.group_value (전시회명 국문 등). 익명/미매칭이면 null. */
  groupValue: string | null;
  /** 매칭된 contact_targets.resid (번호/systemID). 익명/미매칭이면 null. */
  resid: number | null;
  /** 매칭된 contact_targets.attrs — 컬럼 스킴의 attrs.* 표시용. 익명/미매칭이면 null. */
  attrs: Record<string, string> | null;
  /** 매칭된 contact_targets.id — pii.* 컬럼 복호화 조인 키. 익명/미매칭이면 null. */
  contactTargetId: string | null;
  /** 중복 감지용 ipHash. 표시는 formatIpHash 로 앞 8자만 노출한다. */
  ipHash: string | null;
  /** 현재 서버 scope에 속한 응답의 테스트 여부. real scope는 false, test scope는 true로 고정된다. */
  isTest: boolean;
}
