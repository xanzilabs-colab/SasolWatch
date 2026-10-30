"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NODE_ID, supabase } from "./supabase";
import type { AlertRow, EventRow, NodeRow, ReadingRow, SourceRow } from "./types";

export interface LiveNodeState {
  node: NodeRow | null;
  sources: SourceRow[];
  readings: ReadingRow[];
  events: EventRow[];
  alerts: AlertRow[];
  loading: boolean;
  error: string | null;
  polling: boolean;
  refresh: () => Promise<void>;
  activeEvent: EventRow | null;
  latest: ReadingRow | null;
}

export function useLiveNode(enabled = true): LiveNodeState {
  const [node, setNode] = useState<NodeRow | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [readings, setReadings] = useState<ReadingRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const readingCursor = useRef("");
  const lastAuxiliaryPoll = useRef(0);
  const pollInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || !supabase) {
      if (!enabled) return;
      setLoading(false);
      return;
    }
    try {
      const [nodeResult, sourceResult, readingResult, eventResult, openEventResult, alertResult] =
        await Promise.all([
          supabase.from("nodes").select("*").eq("id", NODE_ID).maybeSingle(),
          supabase.from("sources").select("*"),
          supabase.from("readings").select("*").eq("node_id", NODE_ID).order("ts", { ascending: false }).limit(300),
          supabase.from("events").select("*").eq("node_id", NODE_ID).order("started_at", { ascending: false }).limit(10),
          supabase.from("events").select("*").eq("node_id", NODE_ID).eq("status", "open").order("started_at", { ascending: false }).limit(1),
          supabase.from("alerts").select("*").eq("node_id", NODE_ID).order("created_at", { ascending: false }).limit(30),
        ]);
      const failure = [nodeResult, sourceResult, readingResult, eventResult, openEventResult, alertResult]
        .find((result) => result.error);
      if (failure?.error) throw failure.error;

      setNode((nodeResult.data as NodeRow | null) ?? null);
      setSources((sourceResult.data as SourceRow[] | null) ?? []);
      const initialReadings = ((readingResult.data as ReadingRow[] | null) ?? []).reverse();
      const newestInitialReading = initialReadings.at(-1);
      if (newestInitialReading && Date.parse(newestInitialReading.ts) > Date.parse(readingCursor.current || "1970-01-01")) {
        readingCursor.current = newestInitialReading.ts;
      }
      setReadings((current) => {
        const initialIds = new Set(initialReadings.map((reading) => reading.id));
        return [...current.filter((reading) => !initialIds.has(reading.id)), ...initialReadings]
          .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-300);
      });
      const recentEvents = (eventResult.data as EventRow[] | null) ?? [];
      const openEvent = (openEventResult.data as EventRow[] | null)?.[0];
      const initialEvents = openEvent && !recentEvents.some((event) => event.id === openEvent.id)
        ? [openEvent, ...recentEvents].slice(0, 10)
        : recentEvents;
      setEvents((current) => {
        const incomingIds = new Set(initialEvents.map((event) => event.id));
        return [...initialEvents, ...current.filter((event) => !incomingIds.has(event.id))]
          .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 10);
      });
      const initialAlerts = (alertResult.data as AlertRow[] | null) ?? [];
      setAlerts((current) => {
        const incomingIds = new Set(initialAlerts.map((alert) => alert.id));
        return [...initialAlerts, ...current.filter((alert) => !incomingIds.has(alert.id))]
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 30);
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const pollLatest = useCallback(async () => {
    if (!enabled || !supabase || pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const cursor = readingCursor.current;
      const readingResult = cursor
        ? await supabase.from("readings").select("*").eq("node_id", NODE_ID)
          .gte("ts", new Date(Math.max(0, Date.parse(cursor) - 3000)).toISOString())
          .order("ts", { ascending: true }).limit(20)
        : await supabase.from("readings").select("*").eq("node_id", NODE_ID)
          .order("ts", { ascending: false }).limit(1);
      if (readingResult.error) throw readingResult.error;
      const incomingReadings = (readingResult.data as ReadingRow[] | null) ?? [];
      if (incomingReadings.length) {
        const newest = incomingReadings.reduce((latest, reading) =>
          Date.parse(reading.ts) > Date.parse(latest.ts) ? reading : latest
        );
        if (Date.parse(newest.ts) > Date.parse(readingCursor.current || "1970-01-01")) {
          readingCursor.current = newest.ts;
        }
        setReadings((current) => {
          const incomingIds = new Set(incomingReadings.map((reading) => reading.id));
          return [...current.filter((reading) => !incomingIds.has(reading.id)), ...incomingReadings]
            .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-300);
        });
      }

      if (Date.now() - lastAuxiliaryPoll.current >= 5000) {
        const [eventResult, openEventResult, alertResult] = await Promise.all([
          supabase.from("events").select("*").eq("node_id", NODE_ID).order("started_at", { ascending: false }).limit(10),
          supabase.from("events").select("*").eq("node_id", NODE_ID).eq("status", "open").order("started_at", { ascending: false }).limit(1),
          supabase.from("alerts").select("*").eq("node_id", NODE_ID).order("created_at", { ascending: false }).limit(30),
        ]);
        const failure = [eventResult, openEventResult, alertResult].find((result) => result.error);
        if (failure?.error) throw failure.error;
        const recentEvents = (eventResult.data as EventRow[] | null) ?? [];
        const openEvent = (openEventResult.data as EventRow[] | null)?.[0];
        const incomingEvents = openEvent && !recentEvents.some((event) => event.id === openEvent.id)
          ? [openEvent, ...recentEvents].slice(0, 10)
          : recentEvents;
        setEvents((current) => {
          const incomingIds = new Set(incomingEvents.map((event) => event.id));
          return [...incomingEvents, ...current.filter((event) => !incomingIds.has(event.id))]
            .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 10);
        });
        const incomingAlerts = (alertResult.data as AlertRow[] | null) ?? [];
        setAlerts((current) => {
          const incomingIds = new Set(incomingAlerts.map((alert) => alert.id));
          return [...incomingAlerts, ...current.filter((alert) => !incomingIds.has(alert.id))]
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 30);
        });
        lastAuxiliaryPoll.current = Date.now();
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update live dashboard data.");
    } finally {
      pollInFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !supabase) return;
    let subscribed = false;
    const subscriptionTimeout = window.setTimeout(() => {
      if (!subscribed) setPolling(true);
    }, 5000);
    const upsertEvent = (incoming: EventRow) => {
      setEvents((current) => [incoming, ...current.filter((event) => event.id !== incoming.id)]
        .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 10));
    };

    const channel = supabase
      .channel(`dashboard-${NODE_ID}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "readings", filter: `node_id=eq.${NODE_ID}` }, (payload) => {
        const incoming = payload.new as ReadingRow;
        if (Date.parse(incoming.ts) > Date.parse(readingCursor.current || "1970-01-01")) readingCursor.current = incoming.ts;
        setReadings((current) => [...current.filter((row) => row.id !== incoming.id), incoming]
          .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-300));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `node_id=eq.${NODE_ID}` }, (payload) => {
        if (payload.eventType === "DELETE") {
          const removed = payload.old as EventRow;
          setEvents((current) => current.filter((event) => event.id !== removed.id));
          return;
        }
        upsertEvent(payload.new as EventRow);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts", filter: `node_id=eq.${NODE_ID}` }, (payload) => {
        const incoming = payload.new as AlertRow;
        setAlerts((current) => [incoming, ...current.filter((alert) => alert.id !== incoming.id)].slice(0, 30));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribed = true;
          window.clearTimeout(subscriptionTimeout);
          setPolling(false);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          subscribed = false;
          setPolling(true);
        }
      });

    return () => {
      window.clearTimeout(subscriptionTimeout);
      void supabase?.removeChannel(channel);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !polling) return;
    const timer = window.setInterval(() => void pollLatest(), 1000);
    return () => window.clearInterval(timer);
  }, [enabled, pollLatest, polling]);

  const activeEvent = useMemo(() => events.find((event) => event.status === "open") ?? null, [events]);
  const latest = readings[readings.length - 1] ?? null;

  return { node, sources, readings, events, alerts, loading, error, polling, refresh, activeEvent, latest };
}
