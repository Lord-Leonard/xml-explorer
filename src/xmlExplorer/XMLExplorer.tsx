import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import type { RuntimeTreeNode, TreeNode, XmlNamespaces, XmlSyntax } from "./types";
import { buildMappingsForSyntax, buildRuntimeTree } from "./treeCatalog";
import TreeView from "./TreeView";
import { useXmlExplorerEngine } from "./useXmlExplorerEngine";
import type { MatchLocation } from "./xmlProtocol";

interface XMLExplorerProps {
  xml: string;
  syntax?: XmlSyntax;
  tree: TreeNode;
  namespaces: XmlNamespaces;
}

const CURSOR_DEBOUNCE_MS = 120;
const MAX_OCCURRENCES_PER_NODE = 500;

function isXmlExplorerDebugEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem("xmlExplorerDebug") === "1"
  );
}

export default function XMLExplorer({
  xml,
  syntax = "cii",
  tree,
  namespaces,
}: XMLExplorerProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const cursorDebounceTimerRef = useRef<number | null>(null);
  const pendingContextCountRef = useRef(new Set<string>());
  const workerStateRef = useRef<"idle" | "indexing" | "ready" | "error">(
    "idle",
  );
  const ctrlPressedRef = useRef(false);
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  const lastHandledCursorSyncTokenRef = useRef<string | null>(null);
  const displayedTreeRef = useRef<RuntimeTreeNode | null>(null);

  const [status, setStatus] = useState<string>("");
  const [treeSearch, setTreeSearch] = useState("");
  const [xmlMatchMode, setXmlMatchMode] = useState<"nearest" | "strict">(
    "nearest",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [occurrenceIndexByKey, setOccurrenceIndexByKey] = useState<
    Record<string, number>
  >({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [contextualCountByKey, setContextualCountByKey] = useState<
    Record<string, number | undefined>
  >({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOccurrenceIndexByKey({});
    setSelectedKey(null);
    setContextualCountByKey({});
    pendingContextCountRef.current.clear();
  }, [xml]);

  const runtimeTree = useMemo(() => buildRuntimeTree(tree), [tree]);
  const mappings = useMemo(
    () => buildMappingsForSyntax(runtimeTree, syntax),
    [runtimeTree, syntax],
  );

  const {
    workerState,
    error,
    countByKey,
    countProgress,
    cursorMatchKey,
    cursorLookupDebug,
    lookupCursor,
    requestMatches,
    requestCount,
  } = useXmlExplorerEngine({
    xmlText: xml,
    syntax,
    mappings,
    namespaces,
  });

  useEffect(() => {
    workerStateRef.current = workerState;
  }, [workerState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") ctrlPressedRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") ctrlPressedRef.current = false;
    };
    const onBlur = () => {
      ctrlPressedRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(error);
  }, [error]);

  const getNodeXpath = (node: RuntimeTreeNode) => node.xpaths?.[syntax];
  const clearHighlight = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      [],
    );
  }, []);

  const highlightAtPosition = useCallback(
    (match: MatchLocation, label: string, occurrence: number, total: number) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;

      const safeStartLine = Math.min(
        Math.max(1, match.line),
        model.getLineCount(),
      );
      const startLineMax = model.getLineMaxColumn(safeStartLine);
      const safeStartColumn = Math.min(Math.max(1, match.column), startLineMax);

      const targetEndLine = match.endLine ?? safeStartLine;
      const safeEndLine = Math.min(
        Math.max(safeStartLine, targetEndLine),
        model.getLineCount(),
      );
      const endLineMax = model.getLineMaxColumn(safeEndLine);
      const targetEndColumn = match.endColumn ?? endLineMax;
      const safeEndColumn = Math.min(Math.max(1, targetEndColumn), endLineMax);

      const range = new monaco.Range(
        safeStartLine,
        safeStartColumn,
        safeEndLine,
        safeEndColumn,
      );

      editor.revealRangeInCenter(range);
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
        {
          range,
          options: {
            inlineClassName: "xml-xpath-highlight",
          },
        },
      ]);

      setStatus(
        total > 1
          ? `Highlighted ${label}: ${occurrence + 1}/${total}`
          : `Highlighted ${label}`,
      );
    },
    [],
  );

  const displayedTree = useMemo(() => {
    const build = (node: RuntimeTreeNode): RuntimeTreeNode => {
      const children = node.children ?? [];
      const context = getContextFromKey(node.key);
      const contextualCount =
        context.length > 0 ? contextualCountByKey[node.key] : undefined;
      const count =
        typeof contextualCount === "number"
          ? contextualCount
          : context.length > 0
            ? undefined
            : (countByKey[getBaseKey(node.key)] ?? 0);

      if (
        typeof count === "number" &&
        count > 1 &&
        children.length > 0 &&
        expanded[node.key]
      ) {
        const occCount = Math.min(count, MAX_OCCURRENCES_PER_NODE);
        return {
          ...node,
          children: Array.from({ length: occCount }, (_, i) => {
            const occNum = i + 1;
            const occKey = `${node.key}::${occNum}`;
            return {
              key: occKey,
              id: node.id,
              title: `${node.title} [${occNum}]`,
              xpaths: node.xpaths,
              isOccurrence: true,
              children: children.map((child, childIndex) => {
                const childKey = buildChildKey(occKey, child.id, childIndex);
                return build({ ...child, key: childKey });
              }),
            } as RuntimeTreeNode;
          }),
        };
      }

      return {
        ...node,
        children: children.map((child, childIndex) =>
          build({
            ...child,
            key: buildChildKey(node.key, child.id, childIndex),
          }),
        ),
      };
    };

    return build(runtimeTree);
  }, [runtimeTree, countByKey, contextualCountByKey, expanded]);

  const visibleContextualNodes = useMemo(
    () => collectVisibleContextualNodes(displayedTree, expanded),
    [displayedTree, expanded],
  );
  const trimmedTreeSearch = treeSearch.trim().toLowerCase();
  const filteredTree = useMemo(() => {
    if (!trimmedTreeSearch) return displayedTree;
    return filterTreeByQuery(displayedTree, trimmedTreeSearch) ?? displayedTree;
  }, [displayedTree, trimmedTreeSearch]);
  const effectiveExpanded = useMemo(() => {
    if (!trimmedTreeSearch) return expanded;
    return buildExpandedMap(filteredTree);
  }, [trimmedTreeSearch, expanded, filteredTree]);

  useEffect(() => {
    displayedTreeRef.current = displayedTree;
  }, [displayedTree]);

  useEffect(() => {
    if (!selectedKey) return;
    requestAnimationFrame(() => {
      scrollTreeItemIntoViewWithRetry(treeScrollRef.current, selectedKey);
    });
  }, [selectedKey, displayedTree, expanded]);

  useEffect(() => {
    if (!cursorMatchKey) return;
    const token = `${cursorMatchKey}|${cursorLookupDebug?.bestLine ?? ""}|${cursorLookupDebug?.bestColumn ?? ""}`;
    if (lastHandledCursorSyncTokenRef.current === token) return;
    lastHandledCursorSyncTokenRef.current = token;
    let canceled = false;

    const syncSelection = async () => {
      const line = cursorLookupDebug?.bestLine;
      const column = cursorLookupDebug?.bestColumn;
      const exactMapping = isExactCursorMapping(cursorLookupDebug);
      const clickedTag = formatXmlTagFromPath(cursorLookupDebug?.absolutePath);
      const mappedTag = formatXmlTagFromPath(cursorLookupDebug?.matchedCursorXpath);

      if (!exactMapping && xmlMatchMode === "strict") {
        clearHighlight();
        setStatus(
          `No exact BT/BG for ${clickedTag}. Strict mode blocks fallback${
            mappedTag ? ` (nearest: ${mappedTag})` : ""
          }.`,
        );
        return;
      }

      let resolvedKey = cursorMatchKey;
      if (typeof line === "number" && typeof column === "number") {
        resolvedKey = await resolveContextualKeyFromCursor(
          cursorMatchKey,
          line,
          column,
          runtimeTree,
          requestCount,
          requestMatches,
        );
      }

      if (isXmlExplorerDebugEnabled()) {
        console.debug("[xml-explorer] editor->tree sync", {
          cursorMatchKey,
          resolvedKey,
          depth: getContextFromKey(resolvedKey).length,
          cursor: { line, column },
        });
      }

      if (canceled) return;
      clearHighlight();
      setSelectedKey((prev) => (prev === resolvedKey ? prev : resolvedKey));
      expandParents(resolvedKey, setExpanded);

      const selectedNode = displayedTreeRef.current
        ? findNodeByKey(displayedTreeRef.current, resolvedKey)
        : null;
      const nodeTitle = selectedNode?.title ?? resolvedKey;
      const baseKey = getBaseKey(resolvedKey);
      const context = getContextFromKey(resolvedKey);
      try {
        const totalHint =
          context.length > 0 ? 10 : Math.min(50, countByKey[baseKey] ?? 1);
        const result = await requestMatches(
          baseKey,
          0,
          Math.max(1, totalHint),
          context,
        );
        const first =
          typeof line === "number" && typeof column === "number"
            ? result.matches[getBestMatchIndexForCursor(result.matches, line, column)]
            : result.matches[0];
        if (!first) return;
        if (canceled) return;
        highlightAtPosition(first, nodeTitle, 0, result.total);
        if (!exactMapping) {
          setStatus(
            `No exact BT/BG for ${clickedTag}. Mapped to nearest: ${mappedTag}.`,
          );
        }
        setOccurrenceIndexByKey((prev) => ({ ...prev, [resolvedKey]: 0 }));
      } catch {
        // Keep cursor sync resilient if highlighting lookup fails.
      }
    };

    void syncSelection();
    return () => {
      canceled = true;
    };
  }, [
    cursorMatchKey,
    cursorLookupDebug,
    runtimeTree,
    requestMatches,
    requestCount,
    countByKey,
    xmlMatchMode,
    clearHighlight,
    highlightAtPosition,
  ]);

  useEffect(() => {
    if (workerState !== "ready") return;
    for (const node of visibleContextualNodes) {
      if (typeof contextualCountByKey[node.key] === "number") continue;
      if (pendingContextCountRef.current.has(node.key)) continue;
      pendingContextCountRef.current.add(node.key);
      requestCount(node.baseKey, node.context)
        .then((count) => {
          setContextualCountByKey((prev) => ({ ...prev, [node.key]: count }));
        })
        .catch(() => {
          // Keep UI responsive if single count lookup fails.
        })
        .finally(() => {
          pendingContextCountRef.current.delete(node.key);
        });
    }
  }, [workerState, visibleContextualNodes, contextualCountByKey, requestCount]);

  function toggleExpand(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function onClickNode(node: RuntimeTreeNode) {
    setSelectedKey(node.key);

    const baseKey = getBaseKey(node.key);
    const context = getContextFromKey(node.key);
    const total = node.isOccurrence
      ? 1
      : context.length
        ? undefined
        : (countByKey[baseKey] ?? 0);
    const nodeXpath = getNodeXpath(node);
    if (!nodeXpath) {
      clearHighlight();
      return;
    }

    if (total === 0) {
      setStatus(`${node.id}: no match found in XML. (${nodeXpath})`);
      clearHighlight();
    } else {
      const prevIdx = occurrenceIndexByKey[node.key] ?? -1;
      const nextIdx = node.isOccurrence
        ? 0
        : selectedKey === node.key && typeof total === "number" && total > 1
          ? (prevIdx + 1) % total
          : 0;
      try {
        const result = await requestMatches(baseKey, nextIdx, 1, context);
        const first = result.matches[0];
        if (!first) {
          setStatus(`${node.id}: no match found in XML.`);
          clearHighlight();
        } else {
          highlightAtPosition(
            first,
            node.title,
            node.isOccurrence ? 0 : nextIdx,
            result.total,
          );
          setOccurrenceIndexByKey((prev) => ({
            ...prev,
            [node.key]: node.isOccurrence ? 0 : nextIdx,
          }));
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to resolve match";
        setStatus(msg);
      }
    }

    if (node.children?.length) {
      toggleExpand(node.key);
    }
  }

  function handleCursorChange(e: monaco.editor.ICursorPositionChangedEvent) {
    if (workerStateRef.current !== "ready") return;
    if (!ctrlPressedRef.current) return;
    if (cursorDebounceTimerRef.current != null) {
      window.clearTimeout(cursorDebounceTimerRef.current);
    }
    const pos = e.position;
    if (isXmlExplorerDebugEnabled()) {
      console.debug("[xml-explorer] cursor-change", {
        line: pos.lineNumber,
        column: pos.column,
      });
    }
    cursorDebounceTimerRef.current = window.setTimeout(() => {
      lookupCursor(pos.lineNumber, pos.column);
    }, CURSOR_DEBOUNCE_MS);
  }

  return (
    <div
      style={{
        height: "100%",
        maxHeight: "100%",
        minHeight: 0,
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        width: "100%",
      }}
    >
      <div
        style={{
          padding: 10,
          borderBottom: "1px solid #ddd",
          display: "flex",
          gap: 12,
          alignItems: "center",
          fontFamily: "system-ui, sans-serif",
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <button onClick={clearHighlight} style={{ padding: "6px 10px" }}>
          Clear highlight
        </button>
        <button
          onClick={() =>
            setXmlMatchMode((prev) => (prev === "nearest" ? "strict" : "nearest"))
          }
          style={{ padding: "6px 10px" }}
          title="Toggle mapping mode for XML clicks"
        >
          Mode: {xmlMatchMode === "nearest" ? "Nearest fallback" : "Strict exact"}
        </button>
        <span style={{ color: "#374151", fontSize: 12 }}>
          Worker:{" "}
          {workerState === "indexing"
            ? "indexing XML..."
            : workerState === "ready"
              ? "ready"
              : workerState}
        </span>
        <span style={{ color: "#374151", fontSize: 12 }}>
          Counts:{" "}
          {countProgress
            ? `${countProgress.done}/${countProgress.total}`
            : "ready"}
        </span>
        <span
          style={{
            fontFamily: "monospace",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={status}
        >
          {status}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          width: "100%",
        }}
      >
        <div style={{ minWidth: 0, minHeight: 0, width: "100%" }}>
          <Editor
            height="100%"
            defaultLanguage="xml"
            value={xml}
            onMount={(editor) => {
              editorRef.current = editor;
              editor.onDidChangeCursorPosition(handleCursorChange);
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>

        <div
          style={{
            borderLeft: "1px solid #ddd",
            padding: 10,
            overflow: "hidden",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            fontFamily: "system-ui, sans-serif",
            background: "#fafafa",
          }}
        >
          <input
            type="search"
            placeholder="Search BT/BG by id or title..."
            value={treeSearch}
            onChange={(event) => setTreeSearch(event.target.value)}
            style={{
              marginBottom: 8,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "7px 9px",
              fontSize: 12,
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          <div
            ref={treeScrollRef}
            style={{ flex: 1, minHeight: 0, overflow: "auto" }}
          >
            <TreeView
              root={filteredTree}
              expanded={effectiveExpanded}
              selectedKey={selectedKey}
              onToggle={trimmedTreeSearch ? () => {} : toggleExpand}
              onClickNode={onClickNode}
              getNodeXpath={getNodeXpath}
              getMatchCount={(node) => {
                if (node.isOccurrence) return 1;
                const contextual = contextualCountByKey[node.key];
                if (typeof contextual === "number") return contextual;
                if (getContextFromKey(node.key).length > 0) return undefined;
                const baseKey = getBaseKey(node.key);
                return countByKey[baseKey];
              }}
            />
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "#444" }}>
            Cursor sync and count calculation run in a worker thread.
          </div>
        </div>
      </div>

      <style>
        {`
          .xml-xpath-highlight {
            background: rgba(255, 230, 0, 0.35);
            border-bottom: 1px solid rgba(255, 180, 0, 0.9);
          }
        `}
      </style>
    </div>
  );
}

function expandParents(
  targetKey: string,
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>,
) {
  const path = getAncestorKeys(targetKey);
  if (!path.length) return;
  setExpanded((prev) => {
    let changed = false;
    const next = { ...prev };
    for (const key of path) {
      if (!next[key]) {
        next[key] = true;
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}

function stripOccurrenceFromSegment(segment: string): string {
  const idx = segment.indexOf("::");
  return idx >= 0 ? segment.slice(0, idx) : segment;
}

function getBaseKey(key: string): string {
  return key.split(".").map(stripOccurrenceFromSegment).join(".");
}

function getContextFromKey(
  key: string,
): Array<{ nodeKey: string; occurrenceIndex: number }> {
  const context: Array<{ nodeKey: string; occurrenceIndex: number }> = [];
  const parts = key.split(".");
  const baseParts: string[] = [];

  for (const part of parts) {
    const marker = part.indexOf("::");
    if (marker >= 0) {
      const rawIndex = Number(part.slice(marker + 2));
      const occurrenceIndex = Number.isFinite(rawIndex)
        ? Math.max(0, rawIndex - 1)
        : 0;
      const baseSegment = part.slice(0, marker);
      baseParts.push(baseSegment);
      context.push({ nodeKey: baseParts.join("."), occurrenceIndex });
    } else {
      baseParts.push(part);
    }
  }

  return context;
}

function collectVisibleContextualNodes(
  root: RuntimeTreeNode,
  expanded: Record<string, boolean>,
): Array<{
  key: string;
  baseKey: string;
  context: Array<{ nodeKey: string; occurrenceIndex: number }>;
}> {
  const result: Array<{
    key: string;
    baseKey: string;
    context: Array<{ nodeKey: string; occurrenceIndex: number }>;
  }> = [];

  const walk = (node: RuntimeTreeNode) => {
    const context = getContextFromKey(node.key);
    if (context.length > 0 && node.xpaths) {
      result.push({
        key: node.key,
        baseKey: getBaseKey(node.key),
        context,
      });
    }
    if (!node.children?.length) return;
    if (!expanded[node.key]) return;
    for (const child of node.children) walk(child);
  };

  walk(root);
  return result;
}

function getAncestorKeys(key: string): string[] {
  const parts = key.split(".");
  const ancestors: string[] = [];
  const path: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const marker = part.indexOf("::");
    if (marker >= 0) {
      const basePart = part.slice(0, marker);
      path.push(basePart);
      ancestors.push(path.join("."));
      path[path.length - 1] = part;
      ancestors.push(path.join("."));
    } else {
      path.push(part);
      ancestors.push(path.join("."));
    }
  }
  const lastPart = parts[parts.length - 1];
  const lastMarker = lastPart.indexOf("::");
  if (lastMarker >= 0) {
    const baseLastPart = lastPart.slice(0, lastMarker);
    ancestors.push([...path, baseLastPart].join("."));
  }
  return Array.from(new Set(ancestors));
}

function buildChildKey(
  parentKey: string,
  childId: string,
  childIndex: number,
): string {
  return `${parentKey}.${childId}:${childIndex}`;
}

function findNodeByKey(
  root: RuntimeTreeNode,
  key: string,
): RuntimeTreeNode | null {
  if (root.key === key) return root;
  if (!root.children?.length) return null;
  for (const child of root.children) {
    const found = findNodeByKey(child, key);
    if (found) return found;
  }
  return null;
}

function scrollTreeItemIntoView(container: HTMLDivElement | null, key: string) {
  if (!container) return false;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(key)
      : key.replace(/["\\]/g, "\\$&");
  const target = container.querySelector<HTMLElement>(
    `[data-tree-key="${escaped}"]`,
  );
  if (!target) return false;
  target.scrollIntoView({ block: "center", inline: "nearest" });
  return true;
}

function scrollTreeItemIntoViewWithRetry(
  container: HTMLDivElement | null,
  key: string,
  attempts = 12,
) {
  if (scrollTreeItemIntoView(container, key)) return;
  if (attempts <= 0) return;
  requestAnimationFrame(() => {
    scrollTreeItemIntoViewWithRetry(container, key, attempts - 1);
  });
}

function getClosestMatchIndex(
  matches: MatchLocation[],
  line: number,
  column: number,
): number {
  if (!matches.length) return -1;
  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const score = Math.abs(m.line - line) * 1000 + Math.abs(m.column - column);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function isPositionWithinMatch(
  match: MatchLocation,
  line: number,
  column: number,
): boolean {
  const startLine = match.line;
  const startColumn = match.column;
  const endLine = match.endLine ?? startLine;
  const endColumn = match.endColumn ?? startColumn;

  if (line < startLine || line > endLine) return false;
  if (line === startLine && column < startColumn) return false;
  if (line === endLine && column > endColumn) return false;
  return true;
}

function getBestMatchIndexForCursor(
  matches: MatchLocation[],
  line: number,
  column: number,
): number {
  for (let i = 0; i < matches.length; i++) {
    if (isPositionWithinMatch(matches[i], line, column)) return i;
  }
  return getClosestMatchIndex(matches, line, column);
}

function isExactCursorMapping(
  debug:
    | {
        absolutePath: string;
        matchedCursorXpath: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!debug?.absolutePath) return true;
  if (!debug.matchedCursorXpath) return false;
  return debug.absolutePath === debug.matchedCursorXpath;
}

function formatXmlTagFromPath(path: string | null | undefined): string {
  if (!path) return "unknown element";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "unknown element";
}

async function resolveContextualKeyFromCursor(
  baseKey: string,
  line: number,
  column: number,
  runtimeTree: RuntimeTreeNode,
  requestCount: (
    nodeKey: string,
    context?: Array<{ nodeKey: string; occurrenceIndex: number }>,
  ) => Promise<number>,
  requestMatches: (
    nodeKey: string,
    offset: number,
    limit?: number,
    context?: Array<{ nodeKey: string; occurrenceIndex: number }>,
  ) => Promise<{ total: number; matches: MatchLocation[] }>,
): Promise<string> {
  const parts = baseKey.split(".");
  const resolvedParts = [...parts];
  const context: Array<{ nodeKey: string; occurrenceIndex: number }> = [];

  for (let i = 0; i < parts.length; i++) {
    const currentBaseKey = parts.slice(0, i + 1).join(".");
    const node = findNodeByKey(runtimeTree, currentBaseKey);
    if (!node?.children?.length) continue;

    let count = 0;
    try {
      count = await requestCount(currentBaseKey, context);
    } catch {
      continue;
    }
    if (count <= 1) continue;

    try {
      const result = await requestMatches(
        currentBaseKey,
        0,
        Math.min(count, MAX_OCCURRENCES_PER_NODE),
        context,
      );
      const occIdx = getBestMatchIndexForCursor(result.matches, line, column);
      if (occIdx < 0) continue;
      resolvedParts[i] = `${parts[i]}::${occIdx + 1}`;
      context.push({ nodeKey: currentBaseKey, occurrenceIndex: occIdx });
    } catch {
      // Keep cursor sync resilient if one hierarchical level fails.
    }
  }

  return resolvedParts.join(".");
}

function filterTreeByQuery(
  node: RuntimeTreeNode,
  query: string,
): RuntimeTreeNode | null {
  const idMatch = node.id.toLowerCase().includes(query);
  const titleMatch = node.title.toLowerCase().includes(query);
  const children = node.children ?? [];
  const matchedChildren = children
    .map((child) => filterTreeByQuery(child, query))
    .filter((child): child is RuntimeTreeNode => Boolean(child));

  if (!idMatch && !titleMatch && matchedChildren.length === 0) return null;
  return { ...node, children: matchedChildren };
}

function buildExpandedMap(root: RuntimeTreeNode): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  const walk = (node: RuntimeTreeNode) => {
    if (!node.children?.length) return;
    next[node.key] = true;
    for (const child of node.children) walk(child);
  };
  walk(root);
  return next;
}
