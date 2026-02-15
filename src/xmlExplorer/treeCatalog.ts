import type { RuntimeTreeNode, TreeNode, XmlSyntax } from "./types";
import type { NodeMapping } from "./xmlProtocol";

function normalizeCursorXpath(xpath: string): string {
  return xpath.replace(/\/@[^/]+$/, "");
}

export function buildRuntimeTree(source: TreeNode): RuntimeTreeNode {
  const build = (node: TreeNode, key: string): RuntimeTreeNode => {
    const current: RuntimeTreeNode = {
      key,
      id: node.id,
      title: node.title,
      xpaths: node.xpaths,
    };
    if (node.children?.length) {
      current.children = node.children.map((child, index) =>
        build(child, `${key}.${child.id}:${index}`),
      );
    }
    return current;
  };

  return build(source, "EN16931:0");
}

export function buildMappingsForSyntax(
  root: RuntimeTreeNode,
  syntax: XmlSyntax,
): NodeMapping[] {
  const mappings: NodeMapping[] = [];
  const walk = (node: RuntimeTreeNode) => {
    const xpath = node.xpaths?.[syntax];
    if (xpath) {
      mappings.push({
        key: node.key,
        id: node.id,
        xpath,
        cursorXpath: normalizeCursorXpath(xpath),
      });
    }
    node.children?.forEach(walk);
  };
  walk(root);
  return mappings;
}
