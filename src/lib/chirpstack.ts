// Browser-side wrapper around chirpstack-join-watcher + join-aggregator.
//
// Connects to ChirpStack's Mosquitto WSS listener, parses gateway-level
// JoinRequests, and feeds them into the aggregator so the UI gets one row
// per DevEUI instead of a flood of retries.

import { watch, type JoinWatcher, type JoinEvent } from '@intelligent-farming/chirpstack-join-watcher';
import {
  createAggregator, type JoinAggregator, type JoinCandidateState,
} from '@intelligent-farming/chirpstack-join-aggregator';

import { ouiRegistry } from './oui';

export type { JoinCandidateState, JoinEvent };

export interface JoinFeedSettings {
  /** MQTT WebSocket URL — `ws://chirpstack.local:9001`. */
  mqttUrl: string;
  /** Optional MQTT username. */
  mqttUsername?: string;
  /** Optional MQTT password. */
  mqttPassword?: string;
  /**
   * Drop candidates that haven't been seen for this long (ms). Default 5 min —
   * a long-enough window to cover OTAA join backoff, short enough that the UI
   * doesn't accumulate stale rows.
   */
  ttlMs?: number;
}

export interface JoinFeed {
  /** The underlying aggregator — subscribe via `.on('candidate', …)`. */
  aggregator: JoinAggregator;
  /** Resolves once the MQTT client has disconnected and the sweep timer stopped. */
  stop(): Promise<void>;
  /** Returns `true` while the MQTT client is connected. */
  isConnected(): boolean;
  /**
   * Subscribe to asynchronous MQTT errors (DNS failure, ECONNREFUSED, WSS
   * handshake rejection, auth failure). Returns an unsubscribe function.
   * Without this, connection failures would be swallowed and the status
   * would be stuck on `connecting` indefinitely.
   */
  onError(listener: (err: Error) => void): () => void;
}

/**
 * Open a JoinWatcher against the configured MQTT broker, pipe it through a
 * JoinAggregator, and return both as a single handle.
 *
 * The OUI registry is the singleton bundled into the SPA build — vendor
 * identification happens locally with no extra network round-trip.
 */
export const createJoinFeed = (settings: JoinFeedSettings): JoinFeed => {
  let connected = false;
  const errorListeners = new Set<(err: Error) => void>();

  const watcher: JoinWatcher = watch({
    url: settings.mqttUrl,
    username: settings.mqttUsername,
    password: settings.mqttPassword,
    ouiRegistry,
  });
  watcher.on('connect', () => { connected = true; });
  watcher.on('close', () => { connected = false; });
  watcher.on('error', (err: Error) => {
    connected = false;
    for (const l of errorListeners) l(err);
  });

  const aggregator = createAggregator({
    source: watcher,
    ttlMs: settings.ttlMs ?? 5 * 60 * 1000,
  });

  return {
    aggregator,
    isConnected: () => connected,
    onError: (listener) => {
      errorListeners.add(listener);
      return () => { errorListeners.delete(listener); };
    },
    stop: async () => {
      errorListeners.clear();
      aggregator.stop();
      await watcher.stop();
    },
  };
};
