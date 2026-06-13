# WS-3: 저위험 위생 — 설계 스펙

- 일자: 2026-06-13
- 상태: 승인됨 (구현 대기)
- 브랜치: `feat/ws3-low-risk-hardening`
- 출처: `claudedocs/owasp-security-audit-2026-06-13.md` (OWASP 전수 감사)
- 선행: WS-1 공개 표면 하드닝 + WS-2 IDOR 구조 봉인 (둘 다 main 머지 완료)

## 배경

OWASP 전수 감사 30 발견 중 WS-1(공개 표면 9건)·WS-2(IDOR 구조 6건)를 처리했고, 남은 **저위험 위생 군**을 WS-3 로 마감한다. WS-1/WS-2 가 일부를 이미 흡수했다: #22 의 rate limit 부재는 WS-1 이 `withRateLimit('lookup')` 부착으로 해결(잔여는 attrs 필드 화이트리스트만), #24 의 version published 검사는 WS-1 가용성 게이트가 일부 수행(잔여는 versionId-surveyId 소속 매칭), #26 공급망은 WS-1 overrides 가 대부분 처리(dormant 잔여만).

본 스펙은 데이터 보호·입력 위생·RLS 이중화의 잔여 7 발견을 다룬다. 전부 LOW(단 #8 은 MED)이며 현재 단일관리자 가정 하에서 즉시 악용 위험은 낮으나, 방어심층과 PII 노출면 축소를 위해 마감한다.

## 범위 (In Scope) — 7 발견

| # | 심각도 | 항목 | OWASP | 슬라이스 |
|---|--------|------|-------|----------|
| 13 | LOW | 미인증 unsubscribe lookup 이 암호화 이메일을 평문 복호화 반환 | A02 | lookup-pii-min |
| 22 | LOW | attrs.lookup 이 컨택 attrs 전체 반환 (rate limit 은 WS-1 완료) | A07 | lookup-pii-min |
| 21 | LOW | image upload 가 파일명 확장자 무검증 보간 + SVG 256KB 부분 스캔 | A03 | upload-filename |
| 24 | LOW | startResponse 가 versionId 의 surveyId 소속/유효성 미검증 | A08 | response-versionid |
| 25 | LOW | generatePrivateToken 의 Math.random 폴백 | A02 | crypto-token |
| 8 | MED | contact_pii/contact_targets authenticated permissive RLS 정책 | A01 | rls-hardening |
| 19 | LOW | Drizzle 신규 테이블 RLS-off + anon GRANT 강제 가드 부재 | A05 | rls-hardening |

## 목표 / 비목표

**목표**
- 미인증 채널의 PII 평문 노출면을 축소한다(unsubscribe 이메일 마스킹, attrs 최소 필드).
- 업로드 파일명/SVG 입력 위생을 형제 라우트와 대칭화한다.
- 응답-버전 무결성(versionId 소속)과 비공개 토큰 난수 품질을 보강한다.
- PII 테이블의 PostgREST 직접 접근 채널을 닫고(#8), 신규 테이블 RLS 누락을 강제 가드로 전환한다(#19).

**비목표 (Out of Scope)**
- #16 응답 mutation 세션 소유권 바인딩 — responseId UUIDv4 추측난해 + WS-1 in_progress status 가드로 부분 완화. 서버 세션토큰/쿠키 도입은 익명 응답 흐름 전반 변경 + UX 영향, LOW 위협(대역외 responseId 입수 필요). YAGNI. 멀티유저/실제 위협 시 별도.
- #26 dormant 공급망(protobufjs 7.5.7/grpc-js/tar/pretext) — WS-1 overrides 가 대부분 처리, 잔여는 도달 경로 없는 dormant. 정기 갱신 사안.
- surveys.ownerUserId per-user 소유권(WS-2 비목표 유지).

## 확정 설계 결정 (브레인스토밍 결과)

1. **#16 제외(YAGNI)**, #26 제외(WS-1 흡수).
2. **#8 방향**: DROP POLICY + REVOKE GRANT. 앱은 PII 를 oRPC(DATABASE_URL BYPASSRLS / service-role)로만 접근하므로 contact_targets/contact_pii 의 authenticated permissive 정책을 제거하고 anon/authenticated 테이블 GRANT 를 회수해 0035 deny-all 과 일관 봉인. **마이그레이션 SQL 작성까지만 — prod DB 적용은 사용자(Supabase MCP apply_migration). 워크플로우는 DB 미적용.**
3. **#22**: attrs.lookup 화이트리스트는 prefill(substituteTokens) 을 깨지 않는 선에서 — 설문 정의 토큰이 참조하는 키 또는 명시 표시 필드만 반환. 화이트리스트가 prefill 을 깨면 #22 는 보류하고 #13 만 진행(구현 시 소비처 확인).
4. **#24**: versionId 가 해당 surveyId 의 survey_versions 에 속하고 유효(published/현재)한지 검증, 불일치 시 거부 또는 surveys.currentVersionId 폴백. WS-1 가용성 게이트와 연계.
5. **#25**: Math.random 폴백 제거(crypto.randomUUID 만, 미지원 시 fail-fast). private_token 은 DB defaultRandom 이 이미 권위 소스.

## 상세 설계

### 슬라이스 1 — lookup-pii-min (#13 #22)

- **#13**: `src/features/mail/server/services/mail-unsubscribe.service.ts` `lookupContactByToken`(~62-74행)이 `decryptPii(cipher)` 로 평문 이메일을 반환(~64행). 평문 대신 `maskEmail(email)`(`src/lib/crypto/mask-hint.ts`) 반환으로 교체. 소비처(unsubscribe page)는 표시용 문자열만 필요. 복호화 실패 분기 동작 보존.
- **#22**: `src/features/contacts/server/services/contact-attrs.service.ts`(~25-44행) attrs.lookup 이 attrs 전체(Record<string,string>)를 반환 → 최소 필드만. **먼저 소비처(substituteTokens prefill, 응답 페이지)를 확인**: prefill 토큰이 참조하는 키만 반환하거나 명시 표시 필드 화이트리스트. 화이트리스트가 prefill 을 깨면 #22 는 deviations 에 보류 기록하고 #13 만 완료(가용성 우선).
- TDD: maskEmail 반환 단언(평문 미노출), 복호화 실패 시 email null. attrs 화이트리스트는 prefill 비파괴 확인 후 케이스 추가.

### 슬라이스 2 — upload-filename (#21)

- `src/app/api/upload/image/route.ts`(~150-198행): 변환 스킵 경로의 `file.name.split('.').pop()` 무검증 보간을 형제 mail/notice-attachment 라우트와 대칭화 — `validateFilename(file.name)` + `safeExt = ext.replace(/[^a-zA-Z0-9]/g,'').slice(0,16) || 'bin'`, 가능하면 `detectImageKind` 결과로 확장자 결정(파일명 의존 제거).
- SVG: 본문 스크립트 가드가 앞 256KB 만 검사하는 갭(SVG 최대 10MB) → 전체 본문 sanitize 또는 sharp 래스터화(PNG/WebP)로 스크립트 제거. 서빙 시 `Content-Disposition: attachment` 검토.
- TDD: 악성 파일명(traversal/특수문자) → 안전 키; 256KB 이후 `<script>` 든 SVG → 차단/래스터화. 정상 업로드 비파괴.

### 슬라이스 3 — response-versionid (#24)

- `src/features/survey-response/server/services/response.service.ts` startResponse(~141-157)/createResponseWithFirstAnswer/createBlankResponse: 클라 제공 versionId 가 해당 surveyId 의 survey_versions 에 속하고 유효(published 또는 현재 활성)한지 검증. 불일치 시 거부, 또는 surveys.currentVersionId 로 서버가 강제 결정(클라 신뢰 제거). 기존 loadVersionGateRow/WS-1 assertSurveyAcceptingResponses 패턴과 일관.
- TDD(tests/integration): 타 설문/미존재/비published versionId → 거부 또는 폴백; 정상 versionId → 통과.

### 슬라이스 4 — crypto-token (#25)

- `src/lib/survey-url.ts` generatePrivateToken(~132-144): Math.random 기반 수동 UUID 폴백(~140행) 제거 → `crypto.randomUUID()` 만 사용, 미지원 환경은 fail-fast(throw). private_token 은 surveys.private_token 의 DB defaultRandom(gen_random_uuid)이 이미 권위 소스이므로 서버 기본값/서버 생성값 SoT 유지. (~211행 다른 용도 Math.random 은 private_token 무관이면 범위 외 — 구현 시 확인.)
- TDD(tests/unit): crypto.randomUUID 사용 확인 + 폴백 분기 제거 검증.

### 슬라이스 5 — rls-hardening (#8 #19)

- **#8**: contact_targets/contact_pii 의 authenticated permissive 정책(`contact_targets_owner_all`·`contact_pii_owner_all`, FOR ALL TO authenticated)을 `DROP POLICY` + anon/authenticated 의 두 테이블 GRANT `REVOKE`. 0035 deny-all 과 일관. **신규 마이그레이션 SQL 파일 작성(supabase/migrations/)까지만 — prod 적용은 사용자(Supabase MCP apply_migration). 워크플로우는 DB 미적용.** 정확한 정책 이름/현황은 마이그레이션 파일 + supabase MCP pg_policies 로 확인.
- **#19**: 신규 테이블 RLS 강제 — `ALTER DEFAULT PRIVILEGES ... REVOKE`(anon/authenticated 기본 GRANT 차단) 마이그레이션 + `supabase/config.toml` 의 신규 테이블 자동 노출 비활성(auto_expose_new_tables=false 또는 동등 설정) + 가능 범위 CI 단언(RLS-off/anon GRANT 잔존 public 테이블 탐지). CI 라이브 쿼리가 환경상 어려우면 config + ALTER DEFAULT PRIVILEGES 로 한정하고 CI 단언은 deviations 에 기록.
- 앱 PII 접근이 service-role(DATABASE_URL BYPASSRLS) 전용임을 코드로 재확인(supabase client 는 anon key 로 auth/세션만).
- 검증 전용(SQL/config 는 단위테스트 부적합): 적대 리뷰가 SQL 정합성 + service-role 전용 + REVOKE 후 앱 동작 무영향을 검증.

## 테스트 전략

**TDD (red → green)** — 슬라이스 1~4. service 모킹은 `tests/integration` 패턴.
- #13: maskEmail 반환(평문 미노출), 복호화 실패 null.
- #22: attrs 화이트리스트(prefill 비파괴 — 토큰 참조 키 보존).
- #21: 악성 파일명 → 안전 키, SVG 256KB+ 스크립트 차단.
- #24: 타 설문/미존재/비published versionId 거부/폴백, 정상 통과.
- #25: crypto.randomUUID 사용, Math.random 폴백 제거.

**검증 전용** — 슬라이스 5(#8 #19): SQL 정합성 리뷰 + 앱 PII 접근 service-role 전용 확인 + REVOKE 후 oRPC 경로 무영향. DB 미적용이라 마이그레이션 실행 검증은 사용자 후속.

## 실행 순서 / 슬라이스 (각 독립 커밋)

1. lookup-pii-min (#13 #22) — mail-unsubscribe + contact-attrs service. 독립.
2. upload-filename (#21) — image route. 독립.
3. response-versionid (#24) — response.service.ts. 독립.
4. crypto-token (#25) — survey-url.ts. 독립.
5. rls-hardening (#8 #19) — 마이그레이션 SQL + config + CI. DB 미적용. 독립.

- 5슬라이스 전부 다른 파일 → 독립. 순차 다이나믹 워크플로우 + 슬라이스별 security-engineer 적대적 리뷰 + 통합 게이트(WS-1/WS-2 동일 패턴).

## 롤아웃 / 운영 노트

- **#8/#19 마이그레이션은 워크플로우가 DB 에 적용하지 않는다.** SQL 파일 작성 후 사용자가 Supabase MCP apply_migration 또는 직접 SQL 로 prod 적용. 적용 전 라이브 pg_policies 로 정책 이름 확정 권장. `TRUNCATE CASCADE` 금지 규약 준수(DROP POLICY/REVOKE 는 데이터 무관).
- #8 적용 후 oRPC PII 경로(컨택 상세/메일)가 정상 동작하는지 스모크 확인(service-role 전용이라 무영향 예상).
- #21 SVG 래스터화 선택 시 기존 SVG 업로드 사용처 영향 확인.

## 미해결 질문

- 없음. (#22 화이트리스트의 prefill 비파괴 여부, #24 거부 vs 폴백, #19 CI 단언 가능 범위는 구현 시 소비처/환경 확인으로 확정.)
