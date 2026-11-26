# 운영 콘솔 화면

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·CI 게이트)은 루트 `AGENTS.md` 에, 마이그레이션 번호는 `supabase/AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 필터 바 구조

**필터 바 구조**: `features/operations/filters/filter-bar-core.tsx` 의 `FilterBarCore` 는 제어형(`rows`/`onRowsChange`, router·searchParams 를 모른다, `as:'div'` 로 다른 폼 안에, `variant:'stack'` 은 조건 줄 전부 펼침)이고, 주소 직렬화·헤더 필터 상호배타·page 초기화는 `url-filter-bar.tsx` 의 `UrlFilterBar` 가 맡는다(조사 대상·응답 내역·단체 메일 위저드). 2,000개 넘는 ID 목록 토큰 변환은 `prepareContactClauseValue`(contacts-filter-bar)로 검색바와 컨택원 수정 화면이 같이 쓴다. 진척 보고 검색바(`progress-filter-bar`)는 별개 단일 검색바다.

## 응답 내역 — 응답 경로와 그룹 칸

- **응답 경로**(열 키 `sys.linkType`, 깔때기 source `linkType`)는 저장하는 값이 아니다. 응답이 조사 대상과 이어져 있으면 「개별링크」, 아니면 「공개링크」다 — 판정은 `lib/operations/profile-columns-format` 의 `responseLinkTypeOf`, 걸러 보기의 SQL(`server/operations/services/profiles-filters`)도 같은 기준(조인된 조사 대상 id 유무)이다. 명단을 지워 연결이 끊긴 응답은 공개링크로 보인다. 열은 시스템ID 열처럼 조사 대상이 있는 설문에만 그리고, 화면과 응답 내역 엑셀이 같은 규칙을 쓴다.
- **「조사 대상 그룹」 칸의 「공개링크」는 공개 링크 응답에만 적는다**(`profileGroupText`). 그룹 값은 명단 업로드의 대분류만 채우므로, 대분류 없이 올린 명단·한 명씩 추가한 대상의 응답은 그룹 값이 비어 있다 — 그 칸은 화면 「—」· 엑셀 빈칸이다. 그룹 값이 없다고 공개 링크로 적으면 개별 링크 응답이 공개 링크로 읽힌다.

## 척도 평균

- **척도 평균**: `scaleMeanEnabled`(radio·select·table, 기본 꺼짐) — 내부 운영 콘솔 「척도 평균」의 「문항 선택」이 켜고 끈다. **빌더는 이 값을 쓰지 않는다** — `CONSOLE_OWNED_QUESTION_FIELDS` 라 빌더 쓰기(`CompleteQuestionWrite`)에 실으면 컴파일 에러, 설문 복제만 `CompleteQuestionCopy` 로 옮긴다. 열·값은 내보내기(`generateSPSSColumns`·`buildDataRow`)를 그대로 타 화면 평균이 .sav 평균과 같다. 용어는 CONTEXT.md 「척도 평균」.
