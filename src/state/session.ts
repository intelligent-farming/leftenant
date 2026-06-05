import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * The "locked constants" for an onboarding session — the model, region,
 * application, and profile that every device added during the session will
 * inherit. Pick once at the start; iterate device-by-device after.
 */
export interface ActiveSession {
  /** TTN catalog vendor slug, e.g. `"dragino"`. */
  vendor: string;
  /** TTN catalog device slug, e.g. `"lds02"`. */
  device: string;
  /** TTN region identifier passed to `toChirpStack`, e.g. `"US902-928"`. */
  region: string;
  /** Friendly product name from the TTN catalog — for the session header. */
  modelName: string;
  /** ChirpStack application UUID. */
  applicationId: string;
  /** Application name — for the session header. */
  applicationName: string;
  /** ChirpStack device-profile UUID. */
  deviceProfileId: string;
  /** Device-profile name — for the session header. */
  deviceProfileName: string;
  /**
   * LoRaWAN MAC version (e.g. `"LORAWAN_1_0_3"`, `"LORAWAN_1_1_0"`). The
   * Session page reads this to decide whether to collect a single root key
   * (1.0.x — sent as `nwkKey`) or two separate keys (1.1.x — `nwkKey` for
   * the network path and `appKey` for the data path). Optional so old
   * localStorage-persisted sessions still load.
   */
  macVersion?: string;
  /** Session start time. ISO string (Zustand persist serializes Dates poorly). */
  startedAt: string;
}

/**
 * Submission lifecycle:
 * - `pending`  — gRPC `createDevice` in flight.
 * - `created`  — gRPC returned OK; device record + keys live in ChirpStack,
 *                but we haven't seen its next OTAA join yet.
 * - `verified` — Live join feed observed a JoinRequest for this DevEUI after
 *                provisioning. The device is actively talking to the network.
 *                (Set by Phase 6 wiring, not by `createDevice` itself.)
 * - `failed`   — gRPC error, with details in {@link Submission.error}.
 */
export type SubmissionStatus = 'pending' | 'created' | 'verified' | 'failed';

/** One device submission within an active session. */
export interface Submission {
  devEui: string;
  status: SubmissionStatus;
  submittedAt: string;
  /** Populated when `status === 'failed'`. */
  error?: string;
  /** Verifying happens by waiting for ChirpStack's join-accept event. */
  verifiedAt?: string;
}

interface SessionState {
  active?: ActiveSession;
  /** Submissions for the current session. Cleared on `endSession()`. */
  submissions: Submission[];

  startSession: (s: Omit<ActiveSession, 'startedAt'>) => void;
  endSession: () => void;
  recordSubmission: (devEui: string) => void;
  markCreated: (devEui: string) => void;
  markVerified: (devEui: string) => void;
  markFailed: (devEui: string, error: string) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      active: undefined,
      submissions: [],

      startSession: (s) => set({
        active: { ...s, startedAt: new Date().toISOString() },
        submissions: [],
      }),

      endSession: () => set({ active: undefined, submissions: [] }),

      recordSubmission: (devEui) => set((state) => ({
        submissions: [
          { devEui, status: 'pending', submittedAt: new Date().toISOString() },
          ...state.submissions.filter((s) => s.devEui !== devEui),
        ],
      })),

      markCreated: (devEui) => set((state) => ({
        submissions: state.submissions.map((s) =>
          s.devEui === devEui ? { ...s, status: 'created' } : s,
        ),
      })),

      markVerified: (devEui) => set((state) => ({
        submissions: state.submissions.map((s) =>
          s.devEui === devEui ? { ...s, status: 'verified', verifiedAt: new Date().toISOString() } : s,
        ),
      })),

      markFailed: (devEui, error) => set((state) => ({
        submissions: state.submissions.map((s) =>
          s.devEui === devEui ? { ...s, status: 'failed', error } : s,
        ),
      })),
    }),
    {
      name: 'leftenant.session',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * Useful read-only selectors. Components can also call `useSession((s) => ...)`
 * directly, but having named selectors here keeps the call sites tidy.
 */
export const selectActiveSession = (s: SessionState): ActiveSession | undefined => s.active;
export const selectSessionStats = (s: SessionState): {
  total: number; pending: number; created: number; verified: number; failed: number;
} => {
  const counts = { total: s.submissions.length, pending: 0, created: 0, verified: 0, failed: 0 };
  for (const sub of s.submissions) counts[sub.status]++;
  return counts;
};
