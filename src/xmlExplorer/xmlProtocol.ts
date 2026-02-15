import type { XmlNamespaces, XmlSyntax } from "./types";

export type NodeMapping = {
  key: string;
  id: string;
  xpath: string;
  cursorXpath: string;
};

export type MatchLocation = {
  line: number;
  column: number;
  nodeType: number;
  endLine?: number;
  endColumn?: number;
};

export type WorkerInitMessage = {
  type: "INIT";
  xmlVersion: number;
  xmlText: string;
  syntax: XmlSyntax;
  mappings: NodeMapping[];
  namespaces: XmlNamespaces;
};

export type WorkerCursorLookupMessage = {
  type: "CURSOR_LOOKUP";
  xmlVersion: number;
  requestId: number;
  line: number;
  column: number;
};

export type WorkerGetMatchesMessage = {
  type: "GET_MATCHES";
  xmlVersion: number;
  requestId: number;
  nodeKey: string;
  offset: number;
  limit: number;
  context?: Array<{ nodeKey: string; occurrenceIndex: number }>;
};

export type WorkerGetCountMessage = {
  type: "GET_COUNT";
  xmlVersion: number;
  requestId: number;
  nodeKey: string;
  context?: Array<{ nodeKey: string; occurrenceIndex: number }>;
};

export type WorkerRequestMessage =
  | WorkerInitMessage
  | WorkerCursorLookupMessage
  | WorkerGetMatchesMessage
  | WorkerGetCountMessage;

export type WorkerProgressMessage = {
  type: "INIT_PROGRESS";
  xmlVersion: number;
  scannedElements: number;
};

export type WorkerInitReadyMessage = {
  type: "INIT_READY";
  xmlVersion: number;
  scannedElements: number;
};

export type WorkerCountBatchMessage = {
  type: "COUNT_BATCH";
  xmlVersion: number;
  entries: Array<{ key: string; count: number }>;
  done: number;
  total: number;
};

export type WorkerCursorResultMessage = {
  type: "CURSOR_RESULT";
  xmlVersion: number;
  requestId: number;
  key: string | null;
  debug?: {
    targetLine: number;
    targetColumn: number;
    bestIndex: number;
    bestLine: number | null;
    bestColumn: number | null;
    absolutePath: string;
    matchedCursorXpath: string | null;
  };
};

export type WorkerMatchResultMessage = {
  type: "MATCH_RESULT";
  xmlVersion: number;
  requestId: number;
  nodeKey: string;
  total: number;
  matches: MatchLocation[];
};

export type WorkerCountResultMessage = {
  type: "COUNT_RESULT";
  xmlVersion: number;
  requestId: number;
  nodeKey: string;
  count: number;
};

export type WorkerErrorMessage = {
  type: "ERROR";
  xmlVersion: number;
  requestId?: number;
  message: string;
};

export type WorkerResponseMessage =
  | WorkerProgressMessage
  | WorkerInitReadyMessage
  | WorkerCountBatchMessage
  | WorkerCursorResultMessage
  | WorkerMatchResultMessage
  | WorkerCountResultMessage
  | WorkerErrorMessage;
