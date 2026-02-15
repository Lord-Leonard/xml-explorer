import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { XmlNamespaces, XmlSyntax } from "./types";
import XMLExplorerWorker from "./xmlExplorer.worker?worker&inline";
import type {
  MatchLocation,
  NodeMapping,
  WorkerCursorResultMessage,
  WorkerGetCountMessage,
  WorkerGetMatchesMessage,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "./xmlProtocol";

type WorkerState = "idle" | "indexing" | "ready" | "error";

function isXmlExplorerDebugEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem("xmlExplorerDebug") === "1"
  );
}

export function useXmlExplorerEngine(params: {
  xmlText: string;
  syntax: XmlSyntax;
  mappings: NodeMapping[];
  namespaces: XmlNamespaces;
}) {
  const { xmlText, syntax, mappings, namespaces } = params;

  const workerRef = useRef<Worker | null>(null);
  const xmlVersionRef = useRef(0);
  const latestCursorReqIdRef = useRef(0);
  const pendingMatchReqRef = useRef(
    new Map<number, { resolve: (v: { total: number; matches: MatchLocation[] }) => void; reject: (reason?: unknown) => void }>(),
  );
  const pendingCountReqRef = useRef(
    new Map<number, { resolve: (v: number) => void; reject: (reason?: unknown) => void }>(),
  );
  const pendingCursorLineRef = useRef<number | null>(null);
  const pendingCursorColumnRef = useRef<number | null>(null);
  const workerStateRef = useRef<WorkerState>("idle");

  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [countByKey, setCountByKey] = useState<Record<string, number>>({});
  const [countProgress, setCountProgress] = useState<{ done: number; total: number } | null>(null);
  const [cursorMatchKey, setCursorMatchKey] = useState<string | null>(null);
  const [cursorLookupDebug, setCursorLookupDebug] =
    useState<WorkerCursorResultMessage["debug"] | null>(null);

  useEffect(() => {
    workerStateRef.current = workerState;
  }, [workerState]);

  const mappingsSignature = useMemo(
    () => mappings.map((m) => `${m.key}|${m.xpath}`).join("||"),
    [mappings],
  );

  useEffect(() => {
    const worker = new XMLExplorerWorker();
    const pendingMatchReq = pendingMatchReqRef.current;
    const pendingCountReq = pendingCountReqRef.current;
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const msg = event.data;
      if (msg.xmlVersion !== xmlVersionRef.current) return;

      switch (msg.type) {
        case "INIT_PROGRESS":
          setWorkerState("indexing");
          return;
        case "INIT_READY":
          setWorkerState("ready");
          setCountProgress((prev) => (prev?.total ? prev : null));
          return;
        case "COUNT_BATCH":
          setCountByKey((prev) => {
            const next = { ...prev };
            for (const entry of msg.entries) {
              next[entry.key] = entry.count;
            }
            return next;
          });
          setCountProgress({ done: msg.done, total: msg.total });
          if (msg.done >= msg.total) setCountProgress(null);
          return;
        case "CURSOR_RESULT":
          if (msg.requestId !== latestCursorReqIdRef.current) return;
          if (isXmlExplorerDebugEnabled()) {
            console.debug("[xml-explorer] cursor-result", {
              requestId: msg.requestId,
              key: msg.key,
              debug: msg.debug,
            });
          }
          setCursorMatchKey(msg.key);
          setCursorLookupDebug(msg.debug ?? null);
          return;
        case "MATCH_RESULT": {
          const pending = pendingMatchReqRef.current.get(msg.requestId);
          if (pending) {
            pendingMatchReqRef.current.delete(msg.requestId);
            pending.resolve({ total: msg.total, matches: msg.matches });
          }
          return;
        }
        case "COUNT_RESULT": {
          const pending = pendingCountReqRef.current.get(msg.requestId);
          if (pending) {
            pendingCountReqRef.current.delete(msg.requestId);
            pending.resolve(msg.count);
          }
          return;
        }
        case "ERROR": {
          setWorkerState("error");
          setError(msg.message);
          if (typeof msg.requestId === "number") {
            const pending = pendingMatchReqRef.current.get(msg.requestId);
            if (pending) {
              pendingMatchReqRef.current.delete(msg.requestId);
              pending.reject(new Error(msg.message));
            }
            const pendingCount = pendingCountReqRef.current.get(msg.requestId);
            if (pendingCount) {
              pendingCountReqRef.current.delete(msg.requestId);
              pendingCount.reject(new Error(msg.message));
            }
          }
        }
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingMatchReq.forEach((p) =>
        p.reject(new Error("Worker terminated")),
      );
      pendingMatchReq.clear();
      pendingCountReq.forEach((p) =>
        p.reject(new Error("Worker terminated")),
      );
      pendingCountReq.clear();
    };
  }, []);

  useEffect(() => {
    xmlVersionRef.current += 1;
    const xmlVersion = xmlVersionRef.current;
    latestCursorReqIdRef.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCursorMatchKey(null);
    setError(null);
    setWorkerState("indexing");
    setCountByKey({});
    setCountProgress(mappings.length ? { done: 0, total: mappings.length } : null);
    setCursorLookupDebug(null);

    pendingMatchReqRef.current.forEach((p) =>
      p.reject(new Error("Canceled due to new XML version")),
    );
    pendingMatchReqRef.current.clear();
    pendingCountReqRef.current.forEach((p) =>
      p.reject(new Error("Canceled due to new XML version")),
    );
    pendingCountReqRef.current.clear();

    const message: WorkerRequestMessage = {
      type: "INIT",
      xmlVersion,
      xmlText,
      syntax,
      mappings,
      namespaces,
    };
    workerRef.current?.postMessage(message);
  }, [xmlText, syntax, mappingsSignature, mappings, namespaces]);

  const lookupCursor = useCallback((line: number, column: number) => {
    if (workerStateRef.current !== "ready") return;
    if (pendingCursorLineRef.current === line && pendingCursorColumnRef.current === column) {
      return;
    }
    pendingCursorLineRef.current = line;
    pendingCursorColumnRef.current = column;

    const requestId = ++latestCursorReqIdRef.current;
    const message: WorkerRequestMessage = {
      type: "CURSOR_LOOKUP",
      xmlVersion: xmlVersionRef.current,
      requestId,
      line,
      column,
    };
    workerRef.current?.postMessage(message);
  }, []);

  const requestMatches = useCallback(
    (
      nodeKey: string,
      offset: number,
      limit = 1,
      context?: Array<{ nodeKey: string; occurrenceIndex: number }>,
    ) =>
      new Promise<{ total: number; matches: MatchLocation[] }>((resolve, reject) => {
        const requestId = ++latestCursorReqIdRef.current;
        const message: WorkerGetMatchesMessage = {
          type: "GET_MATCHES",
          xmlVersion: xmlVersionRef.current,
          requestId,
          nodeKey,
          offset,
          limit,
          context,
        };
        pendingMatchReqRef.current.set(requestId, { resolve, reject });
        workerRef.current?.postMessage(message);
      }),
    [],
  );

  const requestCount = useCallback(
    (
      nodeKey: string,
      context?: Array<{ nodeKey: string; occurrenceIndex: number }>,
    ) =>
      new Promise<number>((resolve, reject) => {
        const requestId = ++latestCursorReqIdRef.current;
        const message: WorkerGetCountMessage = {
          type: "GET_COUNT",
          xmlVersion: xmlVersionRef.current,
          requestId,
          nodeKey,
          context,
        };
        pendingCountReqRef.current.set(requestId, { resolve, reject });
        workerRef.current?.postMessage(message as WorkerRequestMessage);
      }),
    [],
  );

  return {
    workerState,
    error,
    countByKey,
    countProgress,
    cursorMatchKey,
    cursorLookupDebug,
    lookupCursor,
    requestMatches,
    requestCount,
  };
}
