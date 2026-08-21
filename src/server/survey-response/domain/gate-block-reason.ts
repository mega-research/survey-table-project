import type { BlockReason } from '@/lib/duplicate-detection/types';

/**
 * 가용성 게이트 위반 사유(SurveyNotAcceptingResponsesError.reason)를 응답자 화면이
 * 이해하는 BlockReason 으로 접는다.
 *
 * 게이트 위반은 예상 가능한 도메인 상태인데 그동안 untyped Error 로 던져져 500 으로 샜다.
 * 응답자는 "Internal server error" 만 보고 이유를 알 수 없었고, 클라이언트도 차단을
 * 인지하지 못해 답을 고를 때마다 무의미한 INSERT 를 다시 쐈다.
 *
 * 반환 null 은 "접지 않는다" — 호출측이 원래 에러를 그대로 던져야 한다. 가용성과 무관한
 * 변조 가드(answer_value_too_large)나 미지의 사유가 여기에 해당한다.
 *
 * 내부 사유를 응답자에게 세분해 노출하지 않는다. pub 엔드포인트라 설문 상태를 추측할 수
 * 있는 정보를 줄일수록 좋고, 화면 문구도 하나면 충분하다.
 */
export function toGateBlockReason(reason: string): BlockReason | null {
  switch (reason) {
    case 'survey_paused':
      return 'survey_paused';
    case 'invite_required':
      return 'invalid_token';
    case 'status_not_published':
    case 'end_date_passed':
    case 'max_responses_reached':
    case 'survey_not_found':
    case 'version_mismatch':
    case 'version_not_active':
      return 'not_accepting';
    default:
      return null;
  }
}
