import { useCallback, useEffect, useRef, useState } from 'react';

import { createJoinFeed, type JoinCandidateState, type JoinFeed } from '../lib/chirpstack';
import { useSettings } from '../state/settings';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface UseJoinFeed {
  status: ConnectionStatus;
  error?: string;
  candidates: JoinCandidateState[];
  connect: () => void;
  disconnect: () => Promise<void>;
}

/**
 * React hook for the MQTT-backed live join feed.
 *
 * Reads the user's connection settings, creates a `JoinFeed` on `connect()`,
 * subscribes to the aggregator's `candidate` / `expired` events, and exposes
 * the deduplicated state as React state for rendering.
 *
 * Does NOT auto-connect on mount — wiring a tablet to MQTT-over-WSS on every
 * page load is bad UX. The caller decides when to open the socket.
 */
export const useJoinFeed = (): UseJoinFeed => {
  const settings = useSettings();
  const feedRef = useRef<JoinFeed | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [candidates, setCandidates] = useState<JoinCandidateState[]>([]);

  const disconnect = useCallback(async () => {
    if (feedRef.current) {
      await feedRef.current.stop();
      feedRef.current = null;
    }
    setStatus('closed');
    setError(undefined);
    setCandidates([]);
  }, []);

  const connect = useCallback(() => {
    if (feedRef.current) return;        // idempotent
    setStatus('connecting');
    setError(undefined);
    try {
      const feed = createJoinFeed({
        mqttUrl: settings.mqttUrl,
        mqttUsername: settings.mqttUsername,
        mqttPassword: settings.mqttPassword,
      });
      feedRef.current = feed;
      const refresh = () => setCandidates(feed.aggregator.list());
      feed.aggregator.on('candidate', refresh);
      feed.aggregator.on('expired', refresh);
      // Asynchronous MQTT failures (DNS, ECONNREFUSED, WSS handshake, auth)
      // surface here. Without this listener the poll below would report
      // `connecting` forever with no user-facing signal.
      feed.onError((err) => {
        setStatus('error');
        setError(err.message);
      });
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [settings.mqttUrl, settings.mqttUsername, settings.mqttPassword]);

  // Poll the underlying client's connected flag — mqtt.js doesn't expose a
  // React-friendly observable, and the watcher's 'connect' event fires before
  // the aggregator's first emit so we'd otherwise miss the transition.
  useEffect(() => {
    if (!feedRef.current) return undefined;
    const id = setInterval(() => {
      const feed = feedRef.current;
      if (!feed) return;
      const connected = feed.isConnected();
      setStatus((prev) => {
        if (connected && prev !== 'connected') return 'connected';
        if (!connected && prev === 'connected') return 'closed';
        return prev;
      });
    }, 500);
    return () => clearInterval(id);
  }, [status]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const feed = feedRef.current;
      if (feed) {
        feed.aggregator.stop();
        // Fire-and-forget; the socket close handler runs async.
        void feed.stop();
      }
    };
  }, []);

  return { status, error, candidates, connect, disconnect };
};
