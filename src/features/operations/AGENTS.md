# 운영 콘솔 화면

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 필터 바 구조

**필터 바 구조**: `features/operations/filters/filter-bar-core.tsx` 의 `FilterBarCore` 는 제어형(`rows`/`onRowsChange`, router·searchParams 를 모른다, `as:'div'` 로 다른 폼 안에, `variant:'stack'` 은 조건 줄 전부 펼침)이고, 주소 직렬화·헤더 필터 상호배타·page 초기화는 `url-filter-bar.tsx` 의 `UrlFilterBar` 가 맡는다(조사 대상·응답 내역·단체 메일 위저드). 2,000개 넘는 ID 목록 토큰 변환은 `prepareContactClauseValue`(contacts-filter-bar)로 검색바와 컨택원 수정 화면이 같이 쓴다. 진척 보고 검색바(`progress-filter-bar`)는 별개 단일 검색바다.
