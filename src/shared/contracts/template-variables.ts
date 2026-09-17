// 템플릿 변수 계약 — 메일 본문·설문 prefill 토큰({{key}})이 참조하는 변수 정의. 목록 생성은 server/read-models/variable-catalog.

export interface VariableDef {
  key: string;
  label: string;
  category: 'attrs' | 'system';
  description?: string;
}
