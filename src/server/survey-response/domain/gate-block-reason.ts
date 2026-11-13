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
 * 있는 정보를 줄일수록 좋고, 화면 문구도 하나면 충분하다. 예외는 전체 완료 목표 도달 하나 —
 * 쿼터 마감이 이미 드러내는 것과 같은 종류의 사실(모집 완료)이라 그 화면으로 보낸다.
 */
export function toGateBlockReason(reason: string): BlockReason | null {
  switch (reason) {
    case 'survey_paused':
      return 'survey_paused';
    case 'invite_required':
      return 'invalid_token';
    // 전체 완료 목표 도달 — 「모집 완료」 화면이 맞다. not_accepting 의 「링크가 맞는지 확인」은 끝까지
    // 채운 응답자에게 틀린 안내이고, 패널 설문의 종료 후 이동도 쿼터 마감 주소로 가야 한다.
    case 'max_responses_reached':
      return 'quota_closed';
    case 'status_not_published':
    case 'end_date_passed':
    case 'survey_not_found':
    case 'version_mismatch':
    case 'version_not_active':
      return 'not_accepting';
    default:
      return null;
  }
}
