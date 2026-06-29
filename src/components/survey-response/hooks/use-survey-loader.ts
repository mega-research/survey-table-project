import { useEffect, useState } from 'react';

import { client } from '@/shared/lib/rpc';
import { normalizeQuestions } from '@/lib/question';
import { parsesurveyIdentifier } from '@/lib/survey-url';
import type { SurveyVersionSnapshot } from '@/db/schema';
import type { QuestionGroup, Survey } from '@/types/survey';
import type { SaveAdminEditPayload } from '@/features/survey-response/domain/response-edit';

type ResponsesMap = Record<string, unknown>;

/**
 * survey-response-flow 의 admin-edit 전용 컨텍스트.
 * 컴포넌트 props 의 adminContext 와 동일 형태.
 */
interface AdminContext {
  responseId: string;
  surveyId: string;
  initialResponses: ResponsesMap;
  versionSnapshot: SurveyVersionSnapshot | null;
  initialContactAttrs: Record<string, string>;
  onSubmit: (payload: SaveAdminEditPayload) => Promise<void>;
}

interface PreviewContext {
  survey: Survey;
  versionId: string | null;
}

interface UseSurveyLoaderArgs {
  identifier: string;
  isAdminEdit: boolean;
  isPreview?: boolean;
  adminContext: AdminContext | undefined;
  previewContext?: PreviewContext | undefined;
  inviteToken: string | null;
  /**
   * 응답값 prefill 용 세터. responses state 는 컴포넌트가 소유하며
   * (handleResponse/handleSubmit 도 갱신하므로) 여기서는 admin-edit 초기 prefill
   * 시점에만 호출한다 — 원본 loadSurvey effect 의 setResponses(adminContext.initialResponses) 와 동일.
   */
  setResponses: (responses: ResponsesMap) => void;
}

interface UseSurveyLoaderResult {
  isLoading: boolean;
  loadedSurvey: Survey | null;
  loadError: string | null;
  contactAttrs: Record<string, string>;
  showInviteRequired: boolean;
  versionId: string | null;
}

/**
 * URL 식별자 → 설문 로딩 effect 를 캡슐화한 훅.
 *
 * survey-response-flow.tsx 의 첫 useEffect(설문 로딩) 와 관련 6개 state
 * (isLoading/loadedSurvey/loadError/contactAttrs/showInviteRequired/versionId) 를 그대로 이관했다.
 * 이 6개 state 의 세터는 원본에서 loadSurvey effect 내부에서만 호출되므로 훅이 소유한다.
 *
 * 동작 보존 핵심:
 * - effect 본문(3-way URL 분기 + snapshot 복원 + requireInviteToken + attrs lookup) 라인 단위 동일.
 * - deps 는 [identifier, isAdminEdit] 그대로 (adminContext/inviteToken 는 원본대로 미포함, eslint-disable 유지).
 * - admin-edit 초기 응답 prefill 은 setResponses 로 위임 (responses 소유권은 컴포넌트).
 */
export function useSurveyLoader({
  identifier,
  isAdminEdit,
  isPreview = false,
  adminContext,
  previewContext,
  inviteToken,
  setResponses,
}: UseSurveyLoaderArgs): UseSurveyLoaderResult {
  const [isLoading, setIsLoading] = useState(true);
  const [loadedSurvey, setLoadedSurvey] = useState<Survey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // attrs 토큰 prefill — invite 매칭 시 contact_targets.attrs 로드
  const [contactAttrs, setContactAttrs] = useState<Record<string, string>>({});
  // requireInviteToken=true 설문에 invite 없이 접근 시 차단
  const [showInviteRequired, setShowInviteRequired] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);

  // URL 식별자로 설문 조회
  useEffect(() => {
    const loadSurvey = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        // admin-edit 분기 (1/8) — survey 로드: versionSnapshot 우선, fallback DB 조회.
        // invite/requireInviteToken/attrs lookup 도 모두 건너뜀.
        if (isAdminEdit && adminContext) {
          const snapshot = adminContext.versionSnapshot;
          if (snapshot) {
            // snapshot 으로 직접 Survey 구성. lookups 는 T17 이후 snapshot 에 포함되므로 복원한다.
            // T17 이전 publish 본은 snapshot.lookups 가 undefined → 빈 배열 (해당 시점 lookups 복원 불가, known limitation).
            const builtSurvey: Survey = {
              id: adminContext.surveyId,
              title: snapshot.title,
              ...(snapshot.description !== undefined
                ? { description: snapshot.description }
                : {}),
              groups: snapshot.groups as QuestionGroup[],
              // 세대별 키셋이 다른 스냅샷 질문은 읽기 경계 정규화(보존 모드)로 수렴 —
              // 기존 단언과 거동 동일, 알 수 없는 형태만 관측 로그.
              questions: normalizeQuestions(snapshot.questions),
              settings: {
                isPublic: snapshot.settings.isPublic,
                allowMultipleResponses: snapshot.settings.allowMultipleResponses,
                showProgressBar: snapshot.settings.showProgressBar,
                shuffleQuestions: snapshot.settings.shuffleQuestions,
                requireLogin: snapshot.settings.requireLogin,
                ...(snapshot.settings.endDate
                  ? { endDate: new Date(snapshot.settings.endDate) }
                  : {}),
                ...(snapshot.settings.maxResponses !== undefined ? { maxResponses: snapshot.settings.maxResponses } : {}),
                thankYouMessage: snapshot.settings.thankYouMessage,
                ...(snapshot.settings.requireInviteToken !== undefined ? { requireInviteToken: snapshot.settings.requireInviteToken } : {}),
              },
              lookups: (snapshot as { lookups?: Survey['lookups'] }).lookups ?? [],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            setLoadedSurvey(builtSurvey);
            setVersionId(null);
          } else {
            // snapshot 미존재 (published 이전 응답) → 현재 surveys 행 직접 사용.
            const result = await client.surveyBuilder.publicRead.forResponse({
              surveyId: adminContext.surveyId,
            });
            if (!result) {
              setLoadError('요청하신 설문을 찾을 수 없습니다.');
              setLoadedSurvey(null);
            } else {
              setLoadedSurvey(result.survey);
              setVersionId(result.versionId);
            }
          }
          // 초기 응답값 prefill — DB INSERT 없이 state 만 세팅.
          setResponses(adminContext.initialResponses);
          // 응답 당시 contact attrs 복원 — 조건/토큰 표시 평가에 사용.
          setContactAttrs(adminContext.initialContactAttrs ?? {});
          return;
        }

        if (isPreview) {
          if (!previewContext) {
            setLoadError('미리보기 설문 데이터를 찾을 수 없습니다.');
            setLoadedSurvey(null);
            return;
          }
          setLoadedSurvey(previewContext.survey);
          setVersionId(previewContext.versionId);
          setResponses({});
          setContactAttrs({});
          setShowInviteRequired(false);
          return;
        }

        const { type, value } = parsesurveyIdentifier(identifier);

        let surveyId: string | null = null;

        switch (type) {
          case 'slug': {
            const dbSurvey = await client.surveyBuilder.publicRead.bySlug({ slug: value });
            if (dbSurvey) surveyId = dbSurvey.id;
            break;
          }
          case 'privateToken': {
            const dbSurvey = await client.surveyBuilder.publicRead.byPrivateToken({ token: value });
            if (dbSurvey) {
              surveyId = dbSurvey.id;
            } else {
              // UUID 형태지만 private_token 매칭 실패 — surveys.id 로 직접 시도.
              // 단체 메일/컨택 응답 링크가 surveys.id 직접 URL을 사용하므로 호환 필요.
              surveyId = value;
            }
            break;
          }
          case 'id':
            surveyId = value;
            break;
        }

        if (!surveyId) {
          setLoadError('요청하신 설문을 찾을 수 없습니다.');
          setLoadedSurvey(null);
          return;
        }

        const result = await client.surveyBuilder.publicRead.forResponse({ surveyId });

        if (!result) {
          setLoadError('요청하신 설문을 찾을 수 없습니다.');
          setLoadedSurvey(null);
        } else if (!result.survey.settings.isPublic && type === 'slug') {
          setLoadError('이 설문은 비공개 설문입니다. 올바른 링크로 접근해주세요.');
          setLoadedSurvey(null);
        } else {
          setLoadedSurvey(result.survey);
          setVersionId(result.versionId);

          // requireInviteToken 체크 + attrs 로드
          if (result.survey.settings.requireInviteToken && !inviteToken) {
            setShowInviteRequired(true);
          } else if (inviteToken) {
            // attrs lookup 은 fail-open. 일시적 RPC/네트워크/복호화 오류가 throw 돼도
            // 이미 로드된 설문을 통째로 에러 화면으로 막지 않고, 빈 attrs 익명 응답으로 강등한다.
            // (service 는 무효 토큰을 null 로 흡수하지만 DB/transport 예외는 여기서 throw 될 수 있다.)
            let attrs: Record<string, string> | null = null;
            try {
              attrs = await client.contacts.attrs.lookup({ surveyId, inviteToken });
            } catch (attrsError) {
              console.error('contact attrs 조회 오류 (익명 폴백):', attrsError);
            }
            if (attrs) {
              setContactAttrs(attrs);
            } else if (result.survey.settings.requireInviteToken) {
              // 토큰 무효 + requireInviteToken → 차단
              setShowInviteRequired(true);
            }
            // 토큰 무효 + requireInviteToken=false → 기존 amber alert (inviteIsInvalid)
            // 만 노출. attrs 는 빈 Record 유지.
          }
        }
      } catch (error) {
        console.error('설문 로딩 오류:', error);
        setLoadError('설문을 불러오는 중 오류가 발생했습니다.');
        setLoadedSurvey(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadSurvey();
    // adminContext/previewContext 는 페이지 수명 동안 안정적 (부모에서 한 번만 생성) — deps 미포함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier, isAdminEdit, isPreview]);

  return { isLoading, loadedSurvey, loadError, contactAttrs, showInviteRequired, versionId };
}
