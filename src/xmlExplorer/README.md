# XML Explorer Handoff

This document captures the current architecture, behavior, and decisions for `XMLExplorer` so the component can be extracted into a standalone package.

## Goal and Intent

`XMLExplorer` provides bidirectional mapping between XML and a BT/BG business tree:

- Tree node click -> highlight matching XML.
- XML cursor/click (currently Ctrl-gated) -> resolve and select the correct contextual BT/BG node in the tree.
- Nested list contexts must resolve correctly (`0..n` inside `0..n`) without leaking across siblings.

## Current File Layout

- `XMLExplorer.tsx`: orchestration, UI layout, sync logic, selection/scrolling.
- `TreeView.tsx`: recursive tree renderer.
- `useXmlExplorerEngine.ts`: worker bridge, request/response lifecycle.
- `xmlExplorer.worker.ts`: XPath evaluation, cursor lookup, contextual match/count resolution.
- `xmlProtocol.ts`: worker message contracts.
- `btTree.ts`: static BT/BG tree model.
- `treeCatalog.ts`: runtime tree and mapping construction.

## Critical Architectural Decisions

1. `displayedTree` is generated from runtime tree + counts + expanded state.
2. Node keys carry context using `::N` occurrence suffixes, e.g.:
   - base: `EN16931:0.BG-25:33.BT-131:5`
   - contextual: `EN16931:0.BG-25:33::3.BT-131:5`
3. Context extraction uses `getContextFromKey`, and worker receives context for `GET_MATCHES`/`GET_COUNT`.
4. Context resolution in worker is sequential parent-first (`resolveContextNodes`) to prevent global-index mistakes in nested lists.
5. Cursor lookup includes closing-tag normalization (`adjustPathForClosingTag`) so clicking a parent closing tag does not wrongly map to a child.
6. Cursor request IDs are isolated from match/count request IDs:
   - cursor uses `latestCursorReqIdRef`
   - count/match use `rpcReqIdRef`
   This avoids stale cursor-result drops and off-by-one behavior under load.

## Matching Modes (UI Toggle)

Current toggle near `Clear highlight`:

- `Nearest fallback`:
  - If clicked XML node has no exact BT/BG mapping, nearest mapped ancestor is selected.
  - Status explains fallback mapping.
- `Strict exact`:
  - If no exact mapping, fallback is blocked.
  - Status explains strict rejection.

Exact vs fallback is determined via worker debug payload:

- exact if `absolutePath === matchedCursorXpath`
- fallback otherwise

## Ctrl-Gated XML Interaction

Current behavior in `XMLExplorer.tsx`:

- XML -> tree sync only runs when `Ctrl` is held (`handleCursorChange` early return when not pressed).
- Hover sync is currently not used (mouse-move hook removed in latest state).

## Known Important Behavior

1. Tree scrolling:
   - Selected key is auto-scrolled into view (`block: "center"`) with retry loop.
2. Occurrence expansion:
   - Ancestor expansion includes both base and occurrence ancestors.
   - Handles trailing occurrence segment correctly.
3. Contextual counts:
   - list expansion decisions use contextual count when context exists.
   - prevents cross-sibling leakage for nested BG/BT nodes.

## Debugging Aids

Enabled via localStorage:

- `localStorage.setItem("xmlExplorerDebug", "1")`

Useful logs:

- `[xml-explorer] cursor-change`
- `[xml-explorer] cursor-result`
- `[xml-explorer] editor->tree sync`

## Known Constraints / Risks

1. `xmlExplorer.worker.ts` still contains pre-existing `any` usage and fails strict lint rules in this repo (existing debt).
2. Monaco and worker behavior depend on bundler support for:
   - `new Worker(new URL("./xmlExplorer.worker.ts", import.meta.url), { type: "module" })`
3. XPath and line/column data quality depends on parser behavior (`xmldom`).

## Extraction Readiness

Component is close to extraction, but currently still coupled to:

- EN16931 tree definition (`btTree.ts`)
- static mapping generation (`treeCatalog.ts`)
- local UI styling

For npm packaging, make tree/mapping configurable so non-EN16931 consumers can plug in their own catalogs.

