import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import * as xpath from "xpath";
import type {
  MatchLocation,
  NodeMapping,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "./xmlProtocol";

const scope = self as unknown as Worker;

type XmlNode = Node & {
  lineNumber?: number;
  columnNumber?: number;
  localName?: string;
  tagName?: string;
  namespaceURI?: string | null;
  ownerElement?: XmlNode | null;
  parentNode: XmlNode | null;
  childNodes: ArrayLike<XmlNode>;
  toString: () => string;
};

type ElementRef = {
  line: number;
  column: number;
  absolutePath: string;
};

type WorkerContext = {
  xmlVersion: number;
  doc: Document | null;
  xmlLines: string[];
  mappings: NodeMapping[];
  mappingByKey: Map<string, NodeMapping>;
  sortedCursorMappings: NodeMapping[];
  elementIndex: ElementRef[];
  countByKey: Map<string, number>;
  matchesCache: Map<string, MatchLocation[]>;
  nodeCache: Map<string, XmlNode[]>;
  namespaces: Record<string, string>;
  namespaceUriToPrefix: Record<string, string>;
};

const ctx: WorkerContext = {
  xmlVersion: 0,
  doc: null,
  xmlLines: [],
  mappings: [],
  mappingByKey: new Map(),
  sortedCursorMappings: [],
  elementIndex: [],
  countByKey: new Map(),
  matchesCache: new Map(),
  nodeCache: new Map(),
  namespaces: {},
  namespaceUriToPrefix: {},
};

function post(msg: WorkerResponseMessage) {
  scope.postMessage(msg);
}

function comparePos(
  a: { line: number; column: number },
  b: { line: number; column: number },
): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

function isXmlNode(value: unknown): value is XmlNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof (value as { nodeType?: unknown }).nodeType === "number"
  );
}

function toXmlNodeArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value.filter(isXmlNode);
  return isXmlNode(value) ? [value] : [];
}

function getAbsoluteXPath(node: XmlNode): string {
  const parts: string[] = [];
  let current: XmlNode | null = node;
  while (current && current.nodeType === 1) {
    const ns = current.namespaceURI;
    const localName = current.localName || current.tagName || "unknown";
    const prefix = ns ? ctx.namespaceUriToPrefix[ns] : null;
    const name = prefix ? `${prefix}:${localName}` : (current.tagName ?? localName);
    parts.unshift(name);
    current = current.parentNode as XmlNode | null;
  }
  return parts.length ? `/${parts.join("/")}` : "";
}

function normalizeNodeForLocation(node: unknown): XmlNode | null {
  if (!isXmlNode(node)) return null;
  if (node.nodeType === 1) return node;
  if (node.nodeType === 2 && node.ownerElement) return node.ownerElement;
  return node.parentNode ?? null;
}

function toLocation(node: unknown): MatchLocation | null {
  const target = normalizeNodeForLocation(node);
  if (!target) return null;
  const line = typeof target.lineNumber === "number" ? target.lineNumber : 1;
  const column = typeof target.columnNumber === "number" ? target.columnNumber : 1;
  const nodeType = isXmlNode(node) ? node.nodeType : 1;
  const raw = typeof target.toString === "function" ? String(target.toString()) : "";
  const split = raw.split("\n");
  const endLine = line + Math.max(0, split.length - 1);
  const endColumn =
    split.length > 1
      ? (split[split.length - 1]?.length ?? 0) + 1
      : Math.max(column + Math.max(0, raw.length), column + 1);
  return { line, column, nodeType, endLine, endColumn };
}

function evaluateXPath(xpathExpr: string): XmlNode[] {
  if (!ctx.doc) return [];
  try {
    const select = xpath.useNamespaces(ctx.namespaces);
    const raw = select(xpathExpr, ctx.doc) as unknown;
    return toXmlNodeArray(raw);
  } catch {
    return [];
  }
}

function invertNamespaces(namespaces: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [prefix, uri] of Object.entries(namespaces)) {
    if (!result[uri]) result[uri] = prefix;
  }
  return result;
}

function isAncestorOrSelf(ancestor: XmlNode, node: XmlNode): boolean {
  let current: XmlNode | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parentNode as XmlNode | null;
  }
  return false;
}

function filterNodesByContext(
  nodes: XmlNode[],
  context?: Array<{ nodeKey: string; occurrenceIndex: number }>,
): XmlNode[] {
  if (!context?.length) return nodes;
  const resolvedContextNodes = resolveContextNodes(context);
  if (!resolvedContextNodes.length) return [];
  let filtered = nodes;
  for (const contextNode of resolvedContextNodes) {
    filtered = filtered.filter((node) => isAncestorOrSelf(contextNode, node));
  }
  return filtered;
}

function resolveContextNodes(
  context: Array<{ nodeKey: string; occurrenceIndex: number }>,
): XmlNode[] {
  const resolved: XmlNode[] = [];
  for (const ctxRef of context) {
    let contextNodes = getNodesForKey(ctxRef.nodeKey);
    for (const parentCtx of resolved) {
      contextNodes = contextNodes.filter((node) => isAncestorOrSelf(parentCtx, node));
    }
    const contextNode = contextNodes[ctxRef.occurrenceIndex];
    if (!contextNode) return [];
    resolved.push(contextNode);
  }
  return resolved;
}

function getNodesForKey(nodeKey: string): XmlNode[] {
  const cached = ctx.nodeCache.get(nodeKey);
  if (cached) return cached;
  const mapping = ctx.mappingByKey.get(nodeKey);
  if (!mapping) return [];
  const nodes = evaluateXPath(mapping.xpath);
  ctx.nodeCache.set(nodeKey, nodes);
  return nodes;
}

function adjustPathForClosingTag(path: string, lineText: string): string {
  if (!path || !lineText) return path;
  const closingMatch = lineText.match(/<\/\s*([A-Za-z_][\w.-]*(?::[\w.-]+)?)\s*>/);
  if (!closingMatch) return path;
  const closingTag = closingMatch[1];
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) return path;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] === closingTag) {
      return `/${segments.slice(0, i + 1).join("/")}`;
    }
  }
  return path;
}

function buildElementIndex(doc: Document, xmlVersion: number): ElementRef[] {
  const index: ElementRef[] = [];
  let scanned = 0;

  const walk = (node: XmlNode | null) => {
    if (!node) return;
    if (
      node.nodeType === 1 &&
      typeof node.lineNumber === "number" &&
      typeof node.columnNumber === "number"
    ) {
      scanned += 1;
      index.push({
        line: node.lineNumber,
        column: node.columnNumber,
        absolutePath: getAbsoluteXPath(node),
      });
      if (scanned % 5000 === 0) {
        post({
          type: "INIT_PROGRESS",
          xmlVersion,
          scannedElements: scanned,
        });
      }
    }
    const children = node.childNodes;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      walk(children[i]);
    }
  };

  walk(doc);
  index.sort((a, b) => comparePos(a, b));
  return index;
}

function computeCounts(xmlVersion: number) {
  const total = ctx.mappings.length;
  const batch: Array<{ key: string; count: number }> = [];
  for (let i = 0; i < total; i++) {
    const mapping = ctx.mappings[i];
    const count = evaluateXPath(mapping.xpath).length;
    ctx.countByKey.set(mapping.key, count);
    batch.push({ key: mapping.key, count });
    if (batch.length >= 25 || i === total - 1) {
      post({
        type: "COUNT_BATCH",
        xmlVersion,
        entries: [...batch],
        done: i + 1,
        total,
      });
      batch.length = 0;
    }
  }
}

function initContext(message: Extract<WorkerRequestMessage, { type: "INIT" }>) {
  ctx.xmlVersion = message.xmlVersion;
  ctx.xmlLines = message.xmlText.split(/\r?\n/);
  ctx.mappings = message.mappings;
  ctx.mappingByKey = new Map(message.mappings.map((m) => [m.key, m]));
  ctx.namespaces = message.namespaces;
  ctx.namespaceUriToPrefix = invertNamespaces(message.namespaces);
  ctx.sortedCursorMappings = [...message.mappings].sort(
    (a, b) => b.cursorXpath.length - a.cursorXpath.length,
  );
  ctx.countByKey.clear();
  ctx.matchesCache.clear();
  ctx.nodeCache.clear();

  const doc = new XmlDomParser().parseFromString(
    message.xmlText,
    "application/xml",
  );
  ctx.doc = doc;
  ctx.elementIndex = buildElementIndex(doc, message.xmlVersion);

  computeCounts(message.xmlVersion);

  post({
    type: "INIT_READY",
    xmlVersion: message.xmlVersion,
    scannedElements: ctx.elementIndex.length,
  });
}

function lookupCursor(
  message: Extract<WorkerRequestMessage, { type: "CURSOR_LOOKUP" }>,
) {
  if (message.xmlVersion !== ctx.xmlVersion || !ctx.elementIndex.length) {
    post({
      type: "CURSOR_RESULT",
      xmlVersion: message.xmlVersion,
      requestId: message.requestId,
      key: null,
    });
    return;
  }

  const target = { line: message.line, column: message.column };
  let lo = 0;
  let hi = ctx.elementIndex.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cmp = comparePos(
      { line: ctx.elementIndex[mid].line, column: ctx.elementIndex[mid].column },
      target,
    );
    if (cmp <= 0) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const path = best >= 0 ? ctx.elementIndex[best].absolutePath : "";
  const lineText =
    message.line >= 1 && message.line <= ctx.xmlLines.length
      ? ctx.xmlLines[message.line - 1]
      : "";
  const normalizedPath = adjustPathForClosingTag(path, lineText);
  let key: string | null = null;
  let matchedCursorXpath: string | null = null;
  for (const mapping of ctx.sortedCursorMappings) {
    if (normalizedPath.startsWith(mapping.cursorXpath)) {
      key = mapping.key;
      matchedCursorXpath = mapping.cursorXpath;
      break;
    }
  }

  post({
    type: "CURSOR_RESULT",
    xmlVersion: message.xmlVersion,
    requestId: message.requestId,
    key,
    debug: {
      targetLine: message.line,
      targetColumn: message.column,
      bestIndex: best,
      bestLine: best >= 0 ? ctx.elementIndex[best].line : null,
      bestColumn: best >= 0 ? ctx.elementIndex[best].column : null,
      absolutePath: normalizedPath,
      matchedCursorXpath,
    },
  });
}

function getMatches(message: Extract<WorkerRequestMessage, { type: "GET_MATCHES" }>) {
  if (message.xmlVersion !== ctx.xmlVersion) return;
  const mapping = ctx.mappingByKey.get(message.nodeKey);
  if (!mapping) {
    post({
      type: "MATCH_RESULT",
      xmlVersion: message.xmlVersion,
      requestId: message.requestId,
      nodeKey: message.nodeKey,
      total: 0,
      matches: [],
    });
    return;
  }

  if (!ctx.matchesCache.get(message.nodeKey)) {
    const nodes = getNodesForKey(message.nodeKey);
    const all = nodes
      .map((n) => toLocation(n))
      .filter((n): n is MatchLocation => Boolean(n));
    ctx.matchesCache.set(message.nodeKey, all);
  }

  const filteredNodes = filterNodesByContext(
    getNodesForKey(message.nodeKey),
    message.context,
  );

  const filteredLocations = filteredNodes
    .map((n) => toLocation(n))
    .filter((n): n is MatchLocation => Boolean(n));

  const start = Math.max(0, message.offset);
  const end = Math.max(start, start + Math.max(1, message.limit));
  const matches = filteredLocations.slice(start, end);
  post({
    type: "MATCH_RESULT",
    xmlVersion: message.xmlVersion,
    requestId: message.requestId,
    nodeKey: message.nodeKey,
    total: filteredLocations.length,
    matches,
  });
}

function getCount(message: Extract<WorkerRequestMessage, { type: "GET_COUNT" }>) {
  if (message.xmlVersion !== ctx.xmlVersion) return;
  const mapping = ctx.mappingByKey.get(message.nodeKey);
  if (!mapping) {
    post({
      type: "COUNT_RESULT",
      xmlVersion: message.xmlVersion,
      requestId: message.requestId,
      nodeKey: message.nodeKey,
      count: 0,
    });
    return;
  }

  const filteredNodes = filterNodesByContext(
    getNodesForKey(message.nodeKey),
    message.context,
  );
  post({
    type: "COUNT_RESULT",
    xmlVersion: message.xmlVersion,
    requestId: message.requestId,
    nodeKey: message.nodeKey,
    count: filteredNodes.length,
  });
}

scope.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  try {
    if (message.type === "INIT") {
      initContext(message);
      return;
    }
    if (message.type === "CURSOR_LOOKUP") {
      lookupCursor(message);
      return;
    }
    if (message.type === "GET_MATCHES") {
      getMatches(message);
      return;
    }
    if (message.type === "GET_COUNT") {
      getCount(message);
    }
  } catch (err) {
    post({
      type: "ERROR",
      xmlVersion: message.xmlVersion,
      requestId: "requestId" in message ? message.requestId : undefined,
      message: err instanceof Error ? err.message : "Unknown worker error",
    });
  }
};
