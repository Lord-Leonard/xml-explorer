export type XmlSyntax = "ubl" | "cii";
export type XmlNamespaces = Record<string, string>;

export type TreeNode = {
  id: string;
  title: string;
  xpaths?: Partial<Record<XmlSyntax, string>>;
  children?: TreeNode[];
};

export type RuntimeTreeNode = {
  key: string;
  id: string;
  title: string;
  xpaths?: Partial<Record<XmlSyntax, string>>;
  children?: RuntimeTreeNode[];
  matchedNodes?: unknown[];
  matchCount?: number;
  isOccurrence?: boolean;
};
