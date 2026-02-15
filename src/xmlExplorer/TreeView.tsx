import type { RuntimeTreeNode } from "./types";

export default function TreeView(props: {
  root: RuntimeTreeNode;
  expanded: Record<string, boolean>;
  selectedKey: string | null;
  onToggle: (key: string) => void;
  onClickNode: (node: RuntimeTreeNode) => void | Promise<void>;
  getNodeXpath: (node: RuntimeTreeNode) => string | undefined;
  getMatchCount: (node: RuntimeTreeNode) => number | undefined;
}) {
  const { root } = props;
  return (
    <div>
      <TreeItem node={root} depth={0} {...props} />
    </div>
  );
}

function TreeItem(props: {
  node: RuntimeTreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  selectedKey: string | null;
  onToggle: (key: string) => void;
  onClickNode: (node: RuntimeTreeNode) => void | Promise<void>;
  getNodeXpath: (node: RuntimeTreeNode) => string | undefined;
  getMatchCount: (node: RuntimeTreeNode) => number | undefined;
}) {
  const {
    node,
    depth,
    expanded,
    selectedKey,
    onClickNode,
    getNodeXpath,
    getMatchCount,
  } = props;
  const isFolder = !!node.children?.length;
  const isOpen = expanded[node.key] ?? false;
  const isSelected = selectedKey === node.key;
  const nodeXpath = getNodeXpath(node);
  const matchCount = getMatchCount(node);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        data-tree-key={node.key}
        onClick={() => onClickNode(node)}
        onKeyDown={(e) => e.key === "Enter" && onClickNode(node)}
        style={{
          color: "black",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          paddingLeft: depth * 12 + 8,
          borderRadius: 6,
          cursor: "pointer",
          background: isSelected ? "rgba(0,0,0,0.06)" : "transparent",
          userSelect: "none",
        }}
        title={nodeXpath ? nodeXpath : node.key}
      >
        <span
          style={{ width: 16, display: "inline-block", textAlign: "center" }}
        >
          {isFolder ? (isOpen ? "▾" : "▸") : "•"}
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.85 }}>
          {node.id}
        </span>
        <span style={{ fontSize: 13 }}>{node.title}</span>
        {nodeXpath && (
          <>
            {typeof matchCount === "number" && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: matchCount === 0 ? "#b91c1c" : "#1f2937",
                  background: matchCount === 0 ? "#fee2e2" : "#e5e7eb",
                  borderRadius: 999,
                  padding: "1px 7px",
                }}
              >
                {matchCount}
              </span>
            )}
          </>
        )}
      </div>

      {isFolder && isOpen && (
        <div>
          {node.children!.map((c) => (
            <TreeItem key={c.key} {...props} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
