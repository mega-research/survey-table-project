import { useEffect } from 'react';

/**
 * 조회 전용 화면의 입력칸 잠금 — 문서 안의 글자 입력칸(`input`·`textarea`)을 전부 `readOnly` 로 둔다.
 *
 * 값 쓰기는 응답 흐름이 따로 받지 않는다(조회 전용의 `handleResponse`). 이 훅은 그 위에서 **치는
 * 글자가 칸에 잠깐 보이는 것**을 막는다 — 숫자·형식 칸처럼 친 글자를 칸이 먼저 들고 있는 입력이 있다.
 * `disabled` 가 아니라 `readOnly` 인 이유: 답을 긁어 복사할 수 있고 글자가 흐려지지 않으며,
 * 답을 보려고 눌러야 하는 버튼(접어 둔 문항·드릴다운·이미지 크게 보기)이 죽지 않는다.
 *
 * 나중에 그려지는 칸(쪽 넘김·드릴다운·문서 밖에 그리는 창)도 잡도록 문서 전체를 지켜본다.
 * 체크박스·라디오는 `readOnly` 가 듣지 않는다 — 그쪽은 값 쓰기를 받지 않는 것으로 그대로 남는다.
 */
export function useReadOnlyInputs(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const lock = () => {
      document
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input:not([readonly]), textarea:not([readonly])',
        )
        .forEach((el) => {
          el.readOnly = true;
        });
    };
    lock();
    const observer = new MutationObserver(lock);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled]);
}
