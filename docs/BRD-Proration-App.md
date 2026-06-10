# Business Requirements Document — Sales Order Proration Accelerator (Lite)

**Version:** 0.1 (Draft)
**Owner:** RSM Presales — VIBE
**Companion Doc:** *Sales proration accelerator – Draft 2.docx* (full D365 F&SCM build)
**Scope of THIS document:** A lightweight, external "vibed" web application that consumes data from **Dynamics 365 Finance & Supply Chain Management (D365 F&SCM)**, lets a planner prorate constrained supply across customer demand, and pushes the resulting order changes back to D365 via **message queue** for batch processing.

---

## 1. Purpose

When supply is constrained (e.g., 135 units of strawberries arrive against 175 units of demand), planners need a fast, visual way to:

1. See **all open demand** for a constrained item, grouped by **commodity → item → site → warehouse**.
2. Apply a **proration strategy** (straight-line, weighted by customer priority, or history-aware) to fairly allocate available supply.
3. Review, adjust, approve the prorated allocation.
4. Push the **updated sales order quantities** back into D365 F&SCM in **batch** via a message queue.

The companion BRD covers the in-ERP build. This BRD covers only the **external app + D365 service surface** required to feed it.

---

## 2. In Scope

- New **X++ service classes** in D365 F&SCM exposing read APIs for commodities, items, sales-order demand, and customer priority.
- New **inbound contract** in D365 that consumes prorated allocation messages and updates sales order lines in batch.
- A standalone web app (React + .NET API) for planners.
- Message-queue integration (Azure Service Bus assumed; pluggable).
- Proration algorithms: **Straight-Line**, **Weighted (priority)**, and a **future** **History-Aware** mode.

## 3. Out of Scope

- Changes to D365 pricing, ATP, or MRP.
- Multi-currency / FX logic.
- Replacing existing allocation features in D365.
- Mobile-native UI.

---

## 4. Personas

| Persona | Need |
|---|---|
| Supply Planner | Allocate scarce supply across customers quickly and fairly. |
| Customer Service Rep | See what each customer is getting and why. |
| Sales Manager | Ensure strategic accounts are protected during shortages. |
| D365 Admin | Trust that updates back to D365 are auditable and idempotent. |

---

## 5. Functional Requirements

### 5.1 Landing Page — Commodities
- List all **commodities** (e.g., Strawberries, Blueberries, Lettuce) with:
  - Total open demand (units)
  - Total on-hand / inbound supply (units)
  - Fill rate % (supply ÷ demand)
  - Status chip: **OK / At Risk / Short**
- Click a commodity → Commodity Detail page.

### 5.2 Commodity Detail Page
- Header KPIs: total demand, available supply, gap.
- Table of **items** in the commodity.
- For each item, expandable rows showing **open sales-order demand** by:
  - Customer
  - Site
  - Warehouse
  - Requested ship date
  - Requested quantity
  - Customer priority (1–5, from D365 customer master extension)
- Action: **Run Proration** (opens algorithm picker).

### 5.3 Proration Algorithms

#### 5.3.1 Straight-Line (Pro-Rata)
Every demand line gets the same fill percentage.
$$\text{allocation}_i = \text{requested}_i \times \frac{\text{available}}{\sum \text{requested}}$$

#### 5.3.2 Weighted by Customer Priority
Higher-priority customers get a richer fill. Default priority weights:

| Priority | Weight |
|---|---|
| 1 (Strategic) | 1.50 |
| 2 (Key) | 1.25 |
| 3 (Standard) | 1.00 |
| 4 (Secondary) | 0.75 |
| 5 (Spot) | 0.50 |

$$\text{allocation}_i = \min\Bigl(\text{requested}_i, \ \text{requested}_i \times w_i \times k\Bigr)$$

where $k$ is solved so that $\sum \text{allocation}_i = \text{available}$ and no line exceeds its request.

#### 5.3.3 History-Aware (Future)
Adjusts the priority weight by a "debt" factor based on prior-period fill rates:
$$w_i' = w_i \times \bigl(1 + \alpha \cdot (1 - \overline{\text{fill}}_{i, t-n..t-1})\bigr)$$
Customers shorted recently float upward. Default $\alpha = 0.5$, lookback $n = 4$ weeks.

### 5.4 Review & Approve
- Editable allocation grid (planner can nudge a line; remainder re-balances).
- Validation: sum(allocations) ≤ available; no negative; ≤ requested.
- "Approve & Send to D365" button — publishes a single batch message.

### 5.5 Push Back to D365
- App publishes a **ProrationBatch** message to Service Bus topic `d365-proration-inbound`.
- D365 inbound service consumes batch, updates `SalesLine.SalesQty` (and confirms ship date), writes audit record, posts a **ProrationApplied** event back on topic `d365-proration-events`.
- Idempotency key = `BatchId` (GUID). Re-delivery is safe.

---

## 6. D365 F&SCM Service Surface (X++)

All under a new model **`RSM_SalesProration`**, namespace **`RSMProration`**.

### 6.1 Read Services (OData / Custom Service Group `RSMProrationReadSvcGrp`)

| Service Class | Operation | Returns |
|---|---|---|
| `RSMProrationCommodityService` | `getCommodities()` | List of commodities + roll-up totals |
| `RSMProrationCommodityService` | `getCommodityDetail(CommodityId)` | Items, supply, demand |
| `RSMProrationDemandService` | `getOpenDemand(ItemId, SiteId?, WarehouseId?)` | Open sales-order lines |
| `RSMProrationSupplyService` | `getAvailableSupply(ItemId, SiteId, WarehouseId)` | On-hand + inbound within horizon |
| `RSMProrationCustomerService` | `getCustomerPriority(CustomerIds)` | Priority + recent fill-rate history |

### 6.2 Write Service (Service Bus consumer)

| Class | Responsibility |
|---|---|
| `RSMProrationBatchConsumer` | Subscribes to `d365-proration-inbound`, validates, updates `SalesLine`, writes `RSMProrationAuditLog`, publishes `ProrationApplied`. |

### 6.3 New / Extended Tables

| Table | Purpose |
|---|---|
| `RSMCommodity` | Commodity master (Id, Name, Description). |
| `EcoResProduct` (extension) | Add `CommodityId` FK. |
| `CustTable` (extension) | Add `ProrationPriority` (1–5). |
| `RSMProrationBatch` | Header of an approved proration batch. |
| `RSMProrationBatchLine` | Per-sales-line allocation (old qty, new qty, reason). |
| `RSMProrationAuditLog` | Inbound message audit + result. |

---

## 7. Message Contracts

### 7.1 Inbound — `ProrationBatch` (App → D365)
```json
{
  "batchId": "guid",
  "createdUtc": "iso-8601",
  "createdBy": "upn",
  "strategy": "StraightLine | Weighted | HistoryAware",
  "commodityId": "STRAWBERRY",
  "lines": [
    {
      "salesId": "SO-0001234",
      "lineNum": 1.0,
      "itemId": "STR-CLAM-1LB",
      "siteId": "SITE-1",
      "warehouseId": "WH-A",
      "customerId": "C-WALMART",
      "originalQty": 100,
      "allocatedQty": 77,
      "reasonCode": "PRORATE-WEIGHTED"
    }
  ]
}
```

### 7.2 Outbound — `ProrationApplied` (D365 → App)
```json
{
  "batchId": "guid",
  "appliedUtc": "iso-8601",
  "status": "Applied | PartiallyApplied | Failed",
  "lineResults": [
    { "salesId": "SO-0001234", "lineNum": 1.0, "status": "Applied", "message": null }
  ]
}
```

---

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Landing loads ≤ 2s for 50 commodities; detail ≤ 3s for 5k demand lines. |
| Auth | Microsoft Entra ID SSO; planners require role `Proration.Planner`. |
| Audit | Every approved batch persisted in D365 `RSMProrationAuditLog` for 7 years. |
| Idempotency | Re-delivered batch with same `batchId` is a no-op. |
| Resilience | Service Bus dead-letter on validation failure; alert via Azure Monitor. |

---

## 9. High-Level Architecture

```
+--------------+         REST          +-----------------+      X++ Svc      +----------+
|  React SPA   |  <------------------> |  .NET 8 Web API |  <-------------->  |  D365    |
|  (planner)   |                       |  (BFF)          |   (OData/Custom)  |  F&SCM   |
+--------------+                       +-----------------+                    +----------+
                                              |    ^
                                              v    | (events)
                                       +-------------------+
                                       | Azure Service Bus |
                                       |  topics:          |
                                       |  - inbound        |
                                       |  - events         |
                                       +-------------------+
                                              ^
                                              |
                                       +-------------------+
                                       | D365 Batch Job    |
                                       | (RSMProrationBatch|
                                       |  Consumer)        |
                                       +-------------------+
```

---

## 10. Phasing

| Phase | Deliverable |
|---|---|
| 1 — Shell | This BRD + React/.NET shell + mock D365 data + Straight-Line + Weighted. |
| 2 — D365 Integration | X++ read services + inbound consumer + audit tables. |
| 3 — History-Aware | Historical fill-rate store + algorithm + tuning UI. |
| 4 — Hardening | RBAC, telemetry, perf, UAT. |

---

## 11. Open Questions

1. Confirm message bus: **Azure Service Bus** vs. **Event Grid** vs. **Dataverse events**?
2. Is `CommodityId` already modeled in D365, or must we add it as a product attribute?
3. Priority source of truth: `CustTable` extension or external CRM?
4. Lookback window and `α` for History-Aware mode — finance to sign off.
