import type { TreeNode } from "../xmlExplorer";

export const btNamespaces = {
  ubl: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  rsm: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  udt: "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
  qdt: "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
} as const;

export const btTree: TreeNode = {
  id: "EN16931",
  title: "EN16931 Business Terms",
  xpaths: {
    ubl: "/ubl:Invoice",
    cii: "/rsm:CrossIndustryInvoice",
  },
  children: [
    {
      id: "BT-1",
      title: "Invoice number",
      xpaths: {
        cii: "/rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:ID",
      },
    },
    {
      id: "BT-2",
      title: "Invoice issue date",
      xpaths: {
        cii: "/rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString",
      },
    },
    {
      id: "BG-25",
      title: "INVOICE LINE",
      xpaths: {
        cii: "/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem",
      },
      children: [
        {
          id: "BT-126",
          title: "Invoice line identifier",
          xpaths: {
            cii: "/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument/ram:LineID",
          },
        },
        {
          id: "BT-131",
          title: "Invoice line net amount",
          xpaths: {
            cii: "/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount",
          },
        },
      ],
    },
  ],
};
