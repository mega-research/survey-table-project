/**
 * 배포 확인 창의 문구.
 *
 * 종료된 설문(ADR-0030)을 다시 배포하면 종료가 풀린다 — 새 응답을 다시 받고, 닫혀 있던 외부
 * 링크가 같은 주소·같은 비밀번호로 다시 열린다. 배포는 「이 설문을 다시 돌린다」는 뜻이라
 * 따로 막지 않고, 대신 그 사실을 **맨 앞에서** 말한다: 익숙한 확인 문구 뒤에 붙이면 읽지
 * 않고 누르고, 오탈자 하나 고치려던 배포가 닫아 둔 접근을 조용히 연다.
 */
export function publishConfirmMessage(input: {
  /** 새 버전으로 이어질 진행 중 응답 수 (ADR-0014). */
  migratableCount: number;
  isClosed: boolean;
}): string {
  const lines: string[] = [];
  if (input.isClosed) {
    lines.push(
      '이 설문은 종료된 상태입니다.',
      '배포하면 종료가 풀려 새 응답을 다시 받고, 외주 실사 링크와 클라이언트 링크가 다시 열립니다.',
      '',
    );
  }
  lines.push(
    '설문을 배포하시겠습니까?',
    '배포하면 현재 설문 상태가 스냅샷으로 저장되고, 응답자는 배포된 버전으로 응답하게 됩니다.',
  );
  if (input.migratableCount > 0) {
    lines.push(`진행 중 응답 ${input.migratableCount}건이 새 버전으로 이어집니다.`);
  }
  return lines.join('\n');
}
