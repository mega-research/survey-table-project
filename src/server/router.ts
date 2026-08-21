import { analytics } from '@/server/analytics/procedures/analytics';
import { auth } from '@/server/auth/procedures/auth';
import { attempts } from '@/server/contacts/procedures/attempts';
import { attrs } from '@/server/contacts/procedures/attrs';
import { attrValues } from '@/server/contacts/procedures/attr-values';
import { columns } from '@/server/contacts/procedures/columns';
import { resultCodes } from '@/server/contacts/procedures/result-codes';
import { targets } from '@/server/contacts/procedures/targets';
import { uploads } from '@/server/contacts/procedures/uploads';
import { transfer } from '@/server/library/procedures/library-transfer';
import { questionCategories } from '@/server/library/procedures/question-categories';
import { savedCells } from '@/server/library/procedures/saved-cells';
import { savedLookups } from '@/server/library/procedures/saved-lookups';
import { savedQuestions } from '@/server/library/procedures/saved-questions';
import { groups } from '@/server/survey-builder/procedures/groups';
import { lookups } from '@/server/survey-builder/procedures/lookups';
import { publicRead } from '@/server/survey-builder/procedures/public-read';
import { publish } from '@/server/survey-builder/procedures/publish';
import { questions } from '@/server/survey-builder/procedures/questions';
import { read } from '@/server/survey-builder/procedures/read';
import { save } from '@/server/survey-builder/procedures/save';
import { surveys } from '@/server/survey-builder/procedures/surveys';
import { testSample } from '@/server/survey-builder/procedures/test-sample';
import { billing } from '@/server/mail/procedures/billing';
import { campaigns } from '@/server/mail/procedures/campaigns';
import { preview } from '@/server/mail/procedures/preview';
import { templates } from '@/server/mail/procedures/templates';
import { unsubscribe } from '@/server/mail/procedures/unsubscribe';
import { fileCleanup } from '@/server/media/procedures/file-cleanup';
import { media } from '@/server/media/procedures/media';
import { control } from '@/server/operations/procedures/control';
import { profileColumns } from '@/server/operations/procedures/profile-columns';
import { progress } from '@/server/operations/procedures/progress';
import { quota } from '@/server/quota/procedures/quota';
import { duplicate } from '@/server/survey-response/procedures/duplicate';
import { edit } from '@/server/survey-response/procedures/edit';
import { lifecycle } from '@/server/survey-response/procedures/lifecycle';
import { manage } from '@/server/survey-response/procedures/manage';
import { response } from '@/server/survey-response/procedures/response';

import { health } from '@/server/health';

export const router = {
  health,
  library: {
    savedQuestions,
    savedLookups,
    savedCells,
    questionCategories,
    transfer,
  },
  surveyBuilder: {
    surveys,
    save,
    publish,
    questions,
    groups,
    read,
    publicRead,
    lookups,
    testSample,
  },
  auth,
  media: {
    ...media,
    fileCleanup,
  },
  analytics,
  contacts: {
    targets,
    columns,
    uploads,
    attempts,
    resultCodes,
    attrs,
    attrValues,
  },
  mail: {
    templates,
    preview,
    campaigns,
    billing,
    unsubscribe,
  },
  surveyResponse: {
    response,
    lifecycle,
    duplicate,
    edit,
    manage,
  },
  operations: {
    progress,
    profileColumns,
    control,
  },
  quota,
};

export type AppRouter = typeof router;
