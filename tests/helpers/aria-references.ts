/**
 * `aria-labelledby` · `aria-describedby` 가 가리키는 요소를 문서에서 찾는다.
 *
 * 접근성 이름 계산(testing-library 의 `name` 옵션 · `toHaveAccessibleName`)은 없는 id 를 조용히 건너뛴다 —
 * 가리키는 요소 둘 중 하나가 사라져도 남은 하나로 이름이 서서 테스트가 통과한다. 끊어진 참조를 잡으려면
 * id 를 하나씩 문서에서 찾아야 한다.
 */

type AriaReferenceAttribute = 'aria-labelledby' | 'aria-describedby';

/** 속성에 적힌 id 목록(적힌 순서). 속성이 없으면 빈 배열 */
export function ariaReferenceIds(element: Element, attribute: AriaReferenceAttribute): string[] {
  return (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
}

/**
 * 속성이 가리키는 요소들(적힌 순서) — 문서에 없는 id 가 하나라도 있으면 던진다. 같은 id 가 문서에 둘 이상
 * 있어도 던진다(낭독기는 첫 요소만 읽어 다른 줄의 제목이 이름이 된다).
 */
export function resolveAriaReferences(
  element: Element,
  attribute: AriaReferenceAttribute,
): HTMLElement[] {
  const root = element.ownerDocument;
  return ariaReferenceIds(element, attribute).map((id) => {
    const matches = [...root.querySelectorAll<HTMLElement>('[id]')].filter((node) => node.id === id);
    if (matches.length === 0) {
      throw new Error(`${attribute} 가 문서에 없는 id 를 가리킨다: ${id}`);
    }
    if (matches.length > 1) {
      throw new Error(`${attribute} 가 가리키는 id 가 문서에 ${matches.length}개다: ${id}`);
    }
    return matches[0]!;
  });
}

/** 속성이 가리키는 요소들의 글자 — 요소마다 공백을 접어 적힌 순서로 */
export function ariaReferenceTexts(
  element: Element,
  attribute: AriaReferenceAttribute,
): string[] {
  return resolveAriaReferences(element, attribute).map((node) =>
    (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}
