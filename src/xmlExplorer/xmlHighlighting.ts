import { XMLSerializer as XmlDomSerializer } from "@xmldom/xmldom";
import type { TreeNode } from "./types";

type Offsets = { start: number; end: number };
type XmlNode = Node & {
  lineNumber?: number;
  columnNumber?: number;
  tagName?: string;
  localName?: string;
  namespaceURI?: string | null;
  textContent?: string | null;
  childNodes: ArrayLike<XmlNode>;
  parentNode: XmlNode | null;
};

function asXmlNode(node: unknown): XmlNode | null {
  return typeof node === "object" && node !== null
    ? (node as XmlNode)
    : null;
}

export function findNodeRangeInSource(
  xmlText: string,
  node: unknown,
): Offsets | null {
  const xmlNode = asXmlNode(node);
  if (!xmlNode) return null;

  // 1) Try using xmldom's lineNumber/columnNumber if available
  if (
    typeof xmlNode.lineNumber === "number" &&
    typeof xmlNode.columnNumber === "number"
  ) {
    const lines = xmlText.split(/\r?\n/);
    let startOffset = 0;
    for (let i = 0; i < xmlNode.lineNumber - 1; i++) {
      startOffset += lines[i].length + 1; // +1 for the newline
    }
    startOffset += xmlNode.columnNumber - 1;

    // Now we need the end offset. We can try to find the end of the node's serialization
    // starting from this offset.
    const serializer = new XmlDomSerializer();
    const snippet = serializer.serializeToString(xmlNode);

    // The snippet from serializer might not EXACTLY match the source (whitespace/attributes)
    // But it gives us a hint. For simple elements, we can just look for the end tag.
    if (xmlNode.nodeType === 1 /* ELEMENT_NODE */) {
      const tag = xmlNode.tagName;
      // Search for the closing tag </tag> after startOffset
      const closingTag = `</${tag}>`;
      const closeIdx = xmlText.indexOf(closingTag, startOffset);
      if (closeIdx >= 0) {
        return { start: startOffset, end: closeIdx + closingTag.length };
      }
      // Self-closing? <tag ... />
      const selfCloseIdx = xmlText.indexOf("/>", startOffset);
      const nextOpenIdx = xmlText.indexOf("<", startOffset + 1);
      if (
        selfCloseIdx >= 0 &&
        (nextOpenIdx < 0 || selfCloseIdx < nextOpenIdx)
      ) {
        return { start: startOffset, end: selfCloseIdx + 2 };
      }
    }

    // Fallback to snippet search if it's not a simple element or tag search failed
    const snippetIdx = xmlText.indexOf(snippet, startOffset);
    if (snippetIdx >= 0) {
      return { start: snippetIdx, end: snippetIdx + snippet.length };
    }

    // If we have a start offset but couldn't find a clean end,
    // at least we can highlight SOMETHING (e.g., 20 chars or until next tag)
    return { start: startOffset, end: startOffset + (snippet.length || 10) };
  }

  // 2) Fallback to global search
  const serializer = new XmlDomSerializer();
  const snippet = serializer.serializeToString(xmlNode);
  const direct = xmlText.indexOf(snippet);
  if (direct >= 0) return { start: direct, end: direct + snippet.length };

  if (xmlNode.nodeType === 1 /* ELEMENT_NODE */) {
    const tagName: string = xmlNode.tagName ?? "";
    const textContent: string = (xmlNode.textContent ?? "").trim();

    const escapedText = escapeRegExp(textContent);
    const tagEsc = escapeRegExp(tagName);

    const re = new RegExp(
      `<${tagEsc}(\\s[^>]*)?>\\s*${escapedText}\\s*<\\/${tagEsc}>`,
      "m",
    );
    const m = re.exec(xmlText);
    if (m?.index != null) return { start: m.index, end: m.index + m[0].length };
  }

  return null;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findNodeAtPosition(
  doc: Document,
  line: number,
  col: number,
): XmlNode | null {
  let bestMatch: XmlNode | null = null;

  function walk(node: XmlNode) {
    if ((node.lineNumber ?? 0) <= line) {
      // Check if this node starts before or at the cursor
      // and ends after or at the cursor
      // Note: xmldom doesn't give endLineNumber easily, so we check start of next nodes
      if (node.nodeType === 1) {
        // Element
        if (
          !bestMatch ||
          (node.lineNumber ?? 0) > (bestMatch.lineNumber ?? 0) ||
          ((node.lineNumber ?? 0) === (bestMatch.lineNumber ?? 0) &&
            (node.columnNumber ?? 0) <= col)
        ) {
          bestMatch = node;
        }
      }
    }

    if (node.childNodes) {
      for (let i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i]);
      }
    }
  }

  walk(doc as XmlNode);
  return bestMatch;
}

export function getAbsoluteXPath(node: XmlNode): string {
  const parts: string[] = [];
  let current: XmlNode | null = node;

  const nsMap: Record<string, string> = {
    "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2": "ubl",
    "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2":
      "cac",
    "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2":
      "cbc",
    "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100": "rsm",
    "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100":
      "ram",
    "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100": "udt",
    "urn:un:unece:uncefact:data:standard:QualifiedDataType:100": "qdt",
  };

  while (current && current.nodeType === 1) {
    let name = current.tagName ?? "unknown";
    const ns = current.namespaceURI;
    if (ns && nsMap[ns]) {
      name = nsMap[ns] + ":" + (current.localName ?? name);
    }
    parts.unshift(name);
    current = current.parentNode as XmlNode | null;
  }

  return parts.length ? "/" + parts.join("/") : "";
}

export function findTreeNodeByXPath(
  root: TreeNode,
  targetXpath: string,
  getNodeXpath: (node: TreeNode) => string | undefined,
): TreeNode | null {
  // Try to find the node that matches exactly, or its closest ancestor that has an xpath mapping
  let currentMatch: TreeNode | null = null;

  function walk(node: TreeNode) {
    const nodeXpath = getNodeXpath(node);
    if (nodeXpath && targetXpath.startsWith(nodeXpath)) {
      // If we found a mapping that is a prefix of our target xpath,
      // it's a potential match. We want the most specific one (longest).
      if (
        !currentMatch ||
        nodeXpath.length > (getNodeXpath(currentMatch)?.length ?? 0)
      ) {
        currentMatch = node;
      }
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return currentMatch;
}
