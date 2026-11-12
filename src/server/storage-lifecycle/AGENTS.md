# R2 파일 수명주기

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·CI 게이트)은 루트 `AGENTS.md` 에, 마이그레이션 번호는 `supabase/AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## R2 파일 수명주기

R2 영구 객체 삭제의 유일한 경로는 유예 삭제 큐다 (`server/storage-lifecycle/`).

- `r2_deletion_candidates` — 등록 후 7일 유예, cron 집행자가 장부·전역 참조를 재확인한 키만 삭제.
- `r2_sent_keys` — 발송된 메일 콘텐츠에서 추출한 키의 append-only 장부. **장부에 오른 키는 참조 유무와 무관하게 영구 보존** (수신함 참조는 DB로 복원 불가).
- `r2_key_refs` — 참조 인덱스. 유지가 아니라 **재생성** 구조(불변 소스는 삽입 시 1회, 가변 소스는 주기 전량 재추출)이며 집행 판정에서 삭제 권한이 없는 사전 필터다.

관리 UI는 `/admin/file-cleanup`. 결정 배경은 `docs/adr/0015-r2-deferred-deletion-and-sent-ledger.md`.

> **JS 로 R2 객체를 읽는 표면은 버킷 CORS 가 필요하다.** 기존 사용처는 전부 `<img>`·메일 HTML 이라
> CORS 없이 동작했고, 그래서 버킷에 정책이 없어도 아무도 몰랐다. 조사표 뷰어(pdf.js)가 `fetch` 로
> 읽는 첫 표면이고, 정책이 없으면 브라우저가 `Failed to fetch` 한 줄만 남긴 채 막는다 —
> 서버에서 `curl` 하면 200 이라 파일 문제로 오해하기 쉽다. 새 버킷·새 공개 도메인을 붙일 때는
> `AllowedMethods: GET/HEAD`, `AllowedHeaders: range`, `ExposeHeaders: content-range·accept-ranges`
> 를 함께 넣을 것 (pdf.js 는 부분 요청을 쓴다).
