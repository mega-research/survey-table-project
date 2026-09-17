/**
 * 객체에서 키 하나를 뺀 얕은 사본. `const { [key]: _, ...rest } = obj` 와 같다.
 *
 * React Compiler 는 computed 키가 든 ObjectPattern 을 낮추지 못해 그 컴포넌트 전체를 건너뛴다.
 * 모듈 최상위 함수는 판정 대상이 아니므로 구조 분해를 여기 한 곳에 가둔다.
 */
export function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  const { [key]: _omitted, ...rest } = obj;
  return rest as T;
}
