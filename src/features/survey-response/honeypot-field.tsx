import { forwardRef } from 'react';

/**
 * 봇 방어 허니팟 필드.
 *
 * 화면과 스크린리더 양쪽에서 숨겨진 입력이라 실제 사용자는 인지/입력하지 못해 항상 빈 값이다.
 * 폼을 자동으로 채우는 봇만 값을 넣고, 서버(createResponseWithFirstAnswer/createBlankResponse)가
 * 비어있지 않으면 응답을 차단한다.
 *
 * display:none 대신 off-screen 기법을 쓴다 — 일부 봇은 display:none 필드를 건너뛰므로
 * "보이지만 사람 눈엔 안 보이는" 상태로 둬야 더 많은 봇을 유인한다. tabIndex -1 +
 * aria-hidden + autoComplete off 로 키보드 이동/스크린리더/브라우저 자동완성도 차단한다.
 */
export const HoneypotField = forwardRef<HTMLInputElement>(function HoneypotField(_props, ref) {
  return (
    <input
      ref={ref}
      type="text"
      name="url"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      defaultValue=""
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
});
