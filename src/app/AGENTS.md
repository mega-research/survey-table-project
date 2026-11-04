# 앱 라우트 — src/app

> 루트 `AGENTS.md` 에서 떼어 낸 상세 참조다. 이 디렉터리 아래를 만질 때 읽는다.
> 공통 규칙(주의사항·코드 컨벤션·마이그레이션 번호·CI 게이트)은 루트 `AGENTS.md` 에 있다.
> `CLAUDE.md` 는 이 파일을 가리키는 심볼릭 링크다 — 수정은 이 파일에 한다.

## 운영 콘솔 라우트

```
/admin/surveys/[id]/operations/
├── overview                      # 응답 현황 (slice 1)
├── profiles                      # 응답 내역 (slice 2)
│   ├── [responseId]/edit         # 응답 상세/수정
│   └── columns                   # 응답 내역 컬럼 픽커
├── contacts                      # 조사 대상 = 컨택리스트 (slice 3)
│   ├── [contactId]               # 컨택 상세
│   ├── columns                   # 컬럼 스킴 편집
│   ├── new                       # 컨택 수동 추가
│   ├── result-codes              # 결과코드 설정
│   ├── assignments               # 컨택원 관리 (게스트 제외 — 미들웨어도 막는다) → [assignmentId] 컨택원 수정(교체 적용)
│   ├── prior-answers             # 이월 응답 임포트 (추적조사) — 아래 참조
│   ├── upload                    # 업로드 이력
│   └── upload/new                # 엑셀 업로드 마법사
├── report                        # 전시회/그룹별 진척률 리포트 (slice 4)
│   └── columns                   # 리포트 컬럼 픽커
├── quota                         # 쿼터 플랜 + 실시간 달성 현황
├── scale-mean                    # 척도 평균 — 「문항 선택」으로 고른 문항의 완료 응답 평균·응답수 (게스트 제외, 「실사 현황」 드롭다운 세 번째)
├── demand                        # 문항 수요 집계 (조사표가 붙은 설문에서만 탭이 나온다)
└── mail/                         # 메일 캠페인
    ├── templates                 # 템플릿 목록 → new, [mid]/edit
    └── campaigns                 # 캠페인 목록 → new, [cid]

/admin/billing/mail-cost          # 메일 비용 정산
/admin/file-cleanup               # R2 유예 삭제 큐 (대기/이력/취소)
```

응답 페이지 진입 경로: `/survey/[id]?invite=<uuid>` 또는 짧은 링크 `/i/<inviteCode>`. invite 해석 → contact_targets lookup → survey_responses.contactTargetId 매칭. 토큰 무효 시 안내 화면 + 익명 응답 폴백. **수신거부(unsubscribed_at)·부정 결과코드는 초대 링크 응답을 막지 않는다** (2026-09-01 결정 — 수신거부는 메일 채널 해지일 뿐; 단체 메일 제외·모수 제외는 각자 경로가 담당). 완료 응답이 있는 토큰만 `token_already_used` 로 차단. surveyId가 UUID인 경우 private_token fallback 필요. 빌더 미리보기는 `/preview/<previewToken>`. 관리자 「설문 보기」(`/admin/surveys/[id]/preview`, 저장본)는 그 파티션(콘솔과 같은 `loadOperationsDataScope`)에서 resid 가 가장 작은 조사 대상의 명단 값·이월 응답으로 연다(`server/contacts/services/preview-contact` — 개인정보 열은 설문이 읽는 열만, 2026-11-04). 외부 공유용 `/preview/<token>` 은 명단 값을 싣지 않는다.
