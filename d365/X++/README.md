# D365 F&SCM Service-Class Stubs

These are **design-time stubs** that illustrate the X++ surface the external
proration app will call. Drop into a model named `RSM_SalesProration` and wire
into a Custom Service Group (`RSMProrationReadSvcGrp`) plus a Batch Job (for
the message-bus listener).

| File | Purpose |
|---|---|
| [RSMProrationCommodityService.xpp](RSMProrationCommodityService.xpp) | List commodities, roll-up demand/supply. |
| [RSMProrationSupplyService.xpp](RSMProrationSupplyService.xpp) | On-hand + inbound supply by item / site / warehouse. |
| [RSMProrationDemandService.xpp](RSMProrationDemandService.xpp) | Open backorder demand for an item with optional filters. |
| [RSMProrationCustomerService.xpp](RSMProrationCustomerService.xpp) | Customer master + proration priority + recent fill-rate history. |
| [RSMProrationFillRateHistory.xpp](RSMProrationFillRateHistory.xpp) | Weekly fill-rate rollup table + accessors for History-Aware mode. |
| [RSMProrationBatchConsumer.xpp](RSMProrationBatchConsumer.xpp) | Applies an inbound proration batch message (BatchId head + Records array) transactionally. Idempotent by `BatchId`. |
| [RSMProrationMessageBusListener.xpp](RSMProrationMessageBusListener.xpp) | Batch job that drains `d365-proration-inbound` and calls the consumer. |
| [RSMProrationMessageBusPublisher.xpp](RSMProrationMessageBusPublisher.xpp) | Publishes `ProrationApplied` events back to `d365-proration-events`. |
| [RSMProrationParameters.xpp](RSMProrationParameters.xpp) | Singleton config table (Service Bus FQDN, topic names, horizon, α). |
| [RSMProrationContracts.xpp](RSMProrationContracts.xpp) | All SysOperation `[DataContract]` classes (commodity, supply, demand, customer, batch, line, fill-rate point). |

## Extensions to existing tables

| Table | New Field | Purpose |
|---|---|---|
| `EcoResProduct` | `RSMCommodityId` | FK to `RSMCommodity`. |
| `CustTable` | `RSMProrationPriority` (int 1–5) | Used by Weighted strategy. |
| `CustTable` | `RSMIsDistributionCenter` (bool) | Lets UI group DCs under a parent retailer. |
| `CustTable` | `RSMParentCustomerId` | Optional rollup (e.g. all Costco DCs → Costco HQ). |

## New tables

- `RSMCommodity` — commodity master.
- `RSMProrationBatch` / `RSMProrationBatchLine` — what was applied and why.
- `RSMProrationAuditLog` — inbound message audit (correlation id, body hash, result).
- `RSMProrationFillRateHistory` — weekly rollup feeding the History-Aware algorithm.
- `RSMProrationParameters` — singleton config row.

## Message bus

- **Inbound (live path)** — the web app publishes one
  `SysMessageService.SendMessage` per approved batch to queue
  `rsmSalesProrateAccelerator` (type `rsmSalesProrateAcceleratorMessage`).
  `_messageContent` is a `RSMProrationBatchContract`: a `BatchId` head plus a
  `Records` array (`SalesOrderNumber`, `SalesLineNumber`, `ItemId`,
  `DeliveryReminder`) handed straight to
  [RSMProrationBatchConsumer.xpp](RSMProrationBatchConsumer.xpp) by the
  message processor.
- **Inbound topic** `d365-proration-inbound` — alternate Service Bus route,
  consumed by
  [RSMProrationMessageBusListener.xpp](RSMProrationMessageBusListener.xpp).
- **Outbound topic** `d365-proration-events` — published by
  [RSMProrationMessageBusPublisher.xpp](RSMProrationMessageBusPublisher.xpp).
- Auth uses the F&SCM **managed identity**; SAS keys are not stored in AOT.
- Idempotency: every batch has a `BatchId` GUID, unique-indexed on
  `RSMProrationAuditLog`.
- Failures dead-letter with a reason code; the audit log retains the raw body.

## Read-service group registration (AOT)

```
ServiceGroup RSMProrationReadSvcGrp
  Service RSMProrationCommodity     -> RSMProrationCommodityService
  Service RSMProrationSupply        -> RSMProrationSupplyService
  Service RSMProrationDemand        -> RSMProrationDemandService
  Service RSMProrationCustomer      -> RSMProrationCustomerService
```

The external app calls these via SOAP/JSON at
`https://<env>.dynamics.com/api/services/RSMProrationReadSvcGrp/...`
authenticated as a service principal with role
`RSMProration.PlannerReader`.
