# 역할 모델 v2 배포 런북

> 작성: 2026-09-04 (티켓 29 최종 통합). 대상 브랜치 `mega-research/workspace-roles-v2`.
> **부분 배포 금지** — 인증·워크스페이스·공유·실사가 하나의 판정 코어를 공유해서, 절반만
> 올리면 관문이 통과하는데 화면이 없거나 그 반대가 된다(PRD 「운영 배포는 전 페이즈 통합
> + IDOR 스위트 통과 후 일괄」).

---

## 0. 지금 상태 (2026-09-04 실측)

| 항목 | 결과 |
|---|---|
| 단위·계약 스위트 `pnpm test` | 616 파일 6025건 GREEN |
| 실 DB 스위트 `pnpm test:integration` | 51 파일 589건 GREEN (검증 게이트 15·23·28 포함) |
| CI 3게이트 (audit·rls·journal) | GREEN (audit 는 `fast-uri@3 >= 3.1.6` 승격으로 해소) |
| `pnpm db:drift staging` | 실 DB 에만 있음 54건 — **전부 main 의 0084~0100**, 미등재 SQL 0건 (§5) |
| 시드·백필 리허설 | 로컬 재생 DB 에서 통과 (§4) |

**남은 차단**: 이 브랜치는 `origin/staging` 을 전부 담고 있지만 `origin/main` 이 111 커밋
앞서 있다(0084~0100 = contact_id_lists · contact_prior_answers · survey_documents ·
survey_document_anchors · notice_bg_color · prior 설정 컬럼 2종). **main 을 들여오기 전에는
배포하지 않는다** — §5 참조.

---

## 1. 마이그레이션 적용

수동 SQL 관행이다(AGENTS.md 주의사항 7). 적용 순서는 `manual-migrations.json` **배열 순서**이며
파일명 번호순이 아니다.

- **0111 은 적용 금지.** Better Auth 5테이블은 프로덕션·스테이징에 2026-07-14 선반영돼 있다.
  이 파일은 빈 DB 재생(`pnpm db:setup-test`)과 신규 환경 부트스트랩 전용이다.
- 적용 대상은 **0112~0122 열한 개**다.
- 0122(`survey_responses.fieldwork_user_id`)까지 끝난 뒤 앱을 배포한다. 컬럼 추가는 전부
  nullable 이라 구버전 앱이 도는 동안에도 INSERT 가 깨지지 않는다(주의사항 8 의 2단계 배포).
- `owner_user_id`·`created_by` 는 **아직 NOT NULL 이 아니다**. 라이브 후 별도 마이그레이션에서
  `SET NOT NULL` 을 건다 — 이 배포에서는 하지 않는다.

### 순서가 실제로 중요한 자리: 0116 백필

`0116_surveys_team_scoping.sql` 은 기존 설문 전부를 `team_id=NULL` +
`assignment_status='assignment_pending'` 으로 세우고 **소유자를 그 시점의 최초 active
슈퍼어드민으로** 채운다. 슈퍼어드민이 아직 없으면 `owner_user_id` 가 NULL 로 남는다.

- 프로덕션에는 계정이 이미 있으므로 정상 채워진다.
- 새 환경이거나 NULL 이 남았다면 §4 의 `pnpm workspace:seed:live` 가 메운다(소유자 컬럼만
  건드린다 — `assignment_status` 를 함께 손대면 이미 배치된 설문이 배치 대기로 되돌아간다).

---

## 2. Vercel 환경변수

### 새로 등록

| 키 | 값 | 비고 |
|---|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | 세션 서명 비밀키. **바뀌면 전 세션 무효** |
| `BETTER_AUTH_URL` | `https://dev.megaresearch.co.kr` | baseURL |
| `BETTER_AUTH_TRUSTED_ORIGINS` | 콤마 목록 | baseURL 은 자동 포함이라 보통 비워도 된다 |

### 은퇴 — 삭제할 것

| 키 | 사유 |
|---|---|
| `GUEST_SURVEY_GRANTS` | 게스트가 계정 모델이 됐다(티켓 21). 코드 참조 0건 |
| `ADMIN_USER_IDS` | 슈퍼어드민은 `users.is_superadmin` 컬럼이다 |

남겨두면 동작하지는 않지만 「설정이 권한을 준다」는 오해가 다음 사고의 입구가 된다.

### 재활성

- `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` — 미설정이면 레이트리밋이 no-op 이다.
  2026-08-11 수리 이후 재등록만 남아 있다(메모리 `rate-limit-complete-incident`).
  **로컬 `.env.local` 에서는 계속 주석 처리**한다(요청당 원격 왕복 지연).

### 확인만

- `CONTACT_PII_AES_KEY` · `CONTACT_PII_HMAC_KEY` — 실사 조사 대상 화면이 PII 를 **복호해
  평문으로** 그리므로 키가 프로덕션 값 그대로여야 한다.
- Vercel 리전은 **icn1 단독**을 유지한다(iad1 을 켜면 Inngest 발송이 미국에서 실행돼 건당
  5초가 된다 — 메모리 `vercel-region-icn1-only`).

---

## 3. 배포 순서

1. **백업** — Supabase 스냅샷(절차는 `docs/runbooks/disaster-recovery.md`). 롤백 리허설까지
   끝내고 시작한다(§6).
2. 마이그레이션 0112~0122 적용 (§1).
3. `main` 푸시 → Vercel 자동 배포.
4. **Inngest 수동 Resync** — 자동 sync 가 끊겨 있다(메모리 `inngest-manual-sync`). 잡 4종이
   갱신되지 않으면 캠페인 발송이 옛 코드로 돈다.
5. 시드 (§4).
6. 스모크 (§7).

---

## 4. 시드와 백필

```bash
# ① 슈퍼어드민 — 이미 있으면 승격만 한다(비밀번호 불변)
pnpm auth:seed <email> <name> <password>

# ② 계획 확인 (아무것도 쓰지 않는다)
pnpm workspace:seed

# ③ 적용 — 팀 5 + 실사 업체 1 + 소유자 NULL 보정
pnpm workspace:seed:live "<협력사 이름>"
```

- 만드는 팀: `연구1본부 - 1팀` · `연구2본부 - 3팀` · `연구3본부 - 5팀` · `연구3본부 - 6팀` ·
  `연구3본부 - 7팀`. 이름은 전체 조직 경로를 포함한다(0115 규약).
- **재실행이 안전하다** — 같은 이름의 활성 팀·업체가 있으면 건너뛴다. 판정은 순수 모듈
  `scripts/seed-workspace-plan.ts` 가 하고 `tests/repo/seed-workspace-plan.test.ts` 가 잰다.
- **LIVE 는 실사 업체 이름을 인자로 요구한다.** 기본 이름을 지어내지 않는 이유는 활성 업체
  이름이 UNIQUE 라 잘못 만들면 지우지 못하고 종료만 되기 때문이다(0120).
- 팀·업체 생성은 화면과 **같은 서비스**(`createTeam`·`createFieldworkOrg`)를 부른다 — order·
  감사 행·이름 중복 처리가 시드에서만 달라지지 않는다.
- 스크립트가 마지막에 설문 백필을 되짚는다.
  - **배치 상태와 팀 컬럼이 어긋나면 exit 1** — 0116 의 validated CHECK 와 같은 조건이라
    실 DB 에서는 원래 비어 있어야 하고, 차면 제약이 사라졌다는 뜻이다.
  - **소유자가 빈 설문은 시드 슈퍼어드민으로 채운다**(소유자 컬럼만).
  - 배치 대기 설문을 「시드 슈퍼어드민 소유(0116 백필)」와 「다른 소유자(해산 유래)」로 갈라
    센다 — 해산이 만드는 배치 대기는 원래 소유자를 그대로 들고 오므로 실패가 아니다.
- 스크립트는 `.env.local`(스테이징) > `.env` 순으로 읽는다. **대상 DB 호스트를 첫 줄에
  출력하므로 눈으로 확인하고 진행할 것.**

팀 배정은 시드가 하지 않는다. 계정을 팀에 넣는 것은 `/admin/teams/[teamId]` 의 「팀원 추가」이고,
배치 대기 설문을 팀에 붙이는 것은 `/admin/reassignment` 다.

---

## 5. 드리프트와 main 병합

`pnpm db:drift staging` / `pnpm db:drift prod` 는 **실 DB 에 있는데 레포에 없는 것**을 찾는다.
2026-09-04 실측 54건은 전부 아래 네 테이블과 세 컬럼에 속하며, 일곱 개 다 `origin/main` 의
마이그레이션이 정의한다(파일별 `grep` 실측).

| 실 DB 에만 있는 객체 | 정의 파일 (origin/main) |
|---|---|
| `contact_id_lists` | `0084_contact_id_lists.sql` |
| `contact_prior_answers` · `surveys.prior_wave_label` | `0094_contact_prior_answers.sql` |
| `surveys.prior_answer_import_config` | `0096_prior_answer_import_config.sql` |
| `survey_documents` | `0097_survey_documents.sql` |
| `survey_document_anchors` | `0098_survey_document_anchors.sql` |
| `questions.notice_bg_color` | `0099_notice_bg_color.sql` |

**즉 미등재 직접 적용 SQL 은 0건이다** — 드리프트의 정체는 브랜치 분기다. prod 에는 여기에
`contact_attempts.created_by` · `contact_uploads.uploaded_by` 의 `auth.users` FK 둘이 더
나와 56건이 되는데, 그것이 바로 이 브랜치의 `0121` 이 `public.users` 로 옮기는 대상이다
(적용 전이라 정상). 반대 방향 「레포에만 있음」 109건은 미적용 0112~0122 그대로다 — prod
대조에서만 함께 보고된다.

### 병합 순서

1. `origin/main` → `staging` (별도 워크트리에서 진행 중인 구조 병합).
2. 이 브랜치에 갱신된 `staging` 을 들여온다.
3. **`manual-migrations.json` 은 배열 끝에 append** — 재생 순서가 파일명이 아니라 배열이라,
   번호순으로 끼워 넣으면 재생이 깨진다(메모리 `shared-local-test-db`).
4. `pnpm db:setup-test` 재생 → `pnpm db:drift staging` **0건** 확인 → 그때 배포한다.

---

## 6. 백업과 롤백 리허설

- 스키마 롤백은 없다. 0112~0122 는 컬럼·테이블 **추가**라 앱만 되돌리면 이전 코드가 그대로
  돈다(새 컬럼을 읽지 않는다). 되돌린 뒤에도 남는 것은 `survey_participants` 등 새 테이블의
  행뿐이고 구버전 앱은 그것을 보지 않는다.
- 되돌릴 수 없는 것은 **세션**이다. Better Auth 로 갈아끼우면 기존 세션 쿠키가 전부 무효라,
  롤백해도 사용자는 다시 로그인해야 한다. 공지는 그래서 「배포 전」에 나가야 한다(§7).
- 리허설: 프로덕션 스냅샷을 스테이징에 복원 → 0112~0122 적용 → §4 시드 → §7 스모크.
  복원 절차는 `docs/runbooks/disaster-recovery.md`.

---

## 7. 공지와 스모크

### 배포 전 공지

- **전 사용자 재로그인 필요.** 인증이 Better Auth 로 바뀌어 기존 세션이 전부 끊긴다.
- **비밀번호 분실은 슈퍼어드민이 재설정한다.** 이메일 재설정 경로가 없다(ADR-0018).
- 공개 가입이 없다 — 신규 계정은 `/admin/users` 에서 직접 발급한다.

### 배포 후 스모크

| 확인 | 기대 |
|---|---|
| 슈퍼어드민 로그인 | `/admin/surveys` 로 착지, 사이드바에 팀 스위처 + 「메가리서치」 |
| 일반 내부 계정 | 자기 팀 설문만 보임. 시스템 전체 보기 요청은 FORBIDDEN |
| 팀 미배치 계정 | 사이드바에 프로필만. 설문 목록 조회 자체를 하지 않음 |
| 게스트 계정 | `/guest` 착지. `/admin/*` 은 자기 홈으로 리다이렉트 |
| 실사 계정 | `/fieldwork` 착지. 초대 설문의 조사 대상에서 **평문 연락처**가 보임 |
| 실사 대행 | 조사 대상의 「응답 대행」 → `?invite=…&fw=1`, 배너 한 줄, 저장 뒤 `fieldwork_user_id` 채워짐 |
| 응답자 경로 | `/survey/[id]?invite=…` 가 배너 없이 종전대로 (왕복 증가 0) |
| 메일 발송 | 회신 주소가 템플릿 값 → 없으면 소유자 이메일 |
| 배치 대기 설문 | `/admin/reassignment` 인박스에 뜸. 지표는 전체 수, 목록은 상위 200건 |

---

## 8. PRD 「완료 정의」 대조

| 항목 | 상태 |
|---|---|
| 전 페이즈 티켓 done + 검증 티켓 통과 | 01~28 done, 게이트 15·23·28 GREEN |
| cross-team + cross-type IDOR 음성 스위트 GREEN | `pnpm test:integration` 51 파일 GREEN |
| `db:setup-test` 재생 + `db:drift` 클린 + CI 3게이트 | 재생·CI GREEN, drift 는 **main 병합 후** (§5) |
| 시드: 팀 5 + 슈퍼어드민 + 실사 업체 | `pnpm workspace:seed:live` (§4) |
| 기존 설문 백필 | 0116 이 하고 시드가 검증·보정 (§1·§4) |
| AGENTS.md·CONTEXT.md 갱신 | 티켓 29 에서 완료 |
| 배포 체크리스트 | 이 문서 |
