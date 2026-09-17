import { describe, expect, it } from 'vitest';

import { extractVariableKeys } from '@/lib/mail/variable-extractor';

// ========================
// 변수 토큰 추출 — 배열 파라미터 계약
// ========================
// 대형 설문(목재이용실태조사급)의 토큰 경고 패널이 설문 전체 텍스트(수만 개 셀 content)를
// 함수 "인자로 spread" 하면서 V8 인자 상한에 걸려 RangeError(Maximum call stack size
// exceeded)로 편집 화면이 죽었다 (Sentry 7665334735). 소스 목록은 인자가 아니라 배열
// 하나로 받는다 — 입력 크기가 콜스택 여유에 좌우되지 않는 계약을 핀한다.

describe('extractVariableKeys', () => {
  it('배열 원소별로 추출한다 — 원소 경계를 넘는 가짜 토큰이 생기지 않는다', () => {
    // rest 파라미터 시절 배열을 그대로 넘기면 문자열 강제변환(join)으로
    // 'x{{' + ',' + 'p}}y' 에서 가짜 키 ',p' 가 나왔다.
    expect(extractVariableKeys(['x{{', 'p}}y'])).toEqual([]);
  });

  it('기존 추출 의미론 불변 — 중복 제거·trim', () => {
    expect(extractVariableKeys(['{{ name }} {{name}}', '본문 {{company}}'])).toEqual([
      'name',
      'company',
    ]);
  });

  it('설문 전체 규모(20만 소스)에서도 스택과 무관하게 동작한다 — 회귀 핀', () => {
    const sources = new Array(200_000).fill('셀 내용 {{k}}');
    expect(extractVariableKeys(sources)).toEqual(['k']);
  });
});
