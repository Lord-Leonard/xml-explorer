import { useState } from "react";
import { XMLExplorer } from "./xmlExplorer";
import { btNamespaces, btTree } from "./assets/btTree";
import "./App.css";

const demoXml = `<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>INV-2026-0001</ram:ID>
    <ram:IssueDateTime>
      <udt:DateTimeString>20260214</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>1</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedLineTradeSettlement>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>99.00</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>2</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedLineTradeSettlement>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>149.50</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

function App() {
  const [xml, setXml] = useState(demoXml);

  return (
    <div className="app-shell">
      <div className="controls">
        <label htmlFor="xml-input">Demo XML (edit to test parser/worker)</label>
        <textarea
          id="xml-input"
          value={xml}
          onChange={(event) => setXml(event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="explorer-host">
        <XMLExplorer xml={xml} syntax="cii" tree={btTree} namespaces={btNamespaces} />
      </div>
    </div>
  );
}

export default App;
