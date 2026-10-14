import { httpsCallable } from 'firebase/functions';

import type {
  SessionUpdateChange,
  SessionUpdateField,
  SessionUpdateFields,
  SessionUpdateRequestStatus,
  SessionUpdateRequestSummary,
} from '@shared/types';
import { functions } from '../firebase';

export type {
  SessionUpdateChange,
  SessionUpdateField,
  SessionUpdateFields,
  SessionUpdateRequestStatus,
  SessionUpdateRequestSummary,
};

export const submitSessionUpdateRequest = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    proposed: SessionUpdateFields;
  },
  {
    ok: true;
    request: SessionUpdateRequestSummary;
  }
>(functions, 'submitSessionUpdateRequest');

export const cancelSessionUpdateRequest = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    requestId: string;
  },
  {
    ok: true;
    request: SessionUpdateRequestSummary;
  }
>(functions, 'cancelSessionUpdateRequest');

export const resolveSessionUpdateRequest = httpsCallable<
  {
    cfpId: string;
    proposalId: string;
    requestId: string;
    decision: 'approve' | 'reject';
    rejectionNote?: string;
  },
  {
    ok: true;
    request: SessionUpdateRequestSummary;
    scheduleNeedsAttention: boolean;
  }
>(functions, 'resolveSessionUpdateRequest');

export const listSessionUpdateRequests = httpsCallable<
  { cfpId: string },
  {
    ok: true;
    own: SessionUpdateRequestSummary[];
    admin: SessionUpdateRequestSummary[];
  }
>(functions, 'listSessionUpdateRequests');
