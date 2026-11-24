# AOT metadata scaffolds — RSM_SalesProration

Design-time XML scaffolds for the **Option 1 substitution whitelist**. They
mirror the shapes Visual Studio generates; create the objects in a VS D365
project (model `RSM_SalesProration`) and use these as the spec — or drop them
into the model's metadata folders and fix up any boilerplate VS expects.

| Object | Type | Purpose |
|---|---|---|
| `RSMSubstitutionDirection` | Enum | One way (From → To) vs Bidirectional |
| `RSMSubstitutionRank` | EDT (int) | Preference order, 1 first |
| `RSMItemSubstitutionGroup` | Table | Interchangeable group: name, equivalence unit, price basis, validity. The default substitutes for every Standard-policy customer, used after explicit rules. `match()` returns the group, ratio and price basis for an (ordered, substitute) pair. Deleting a group cascades to its members. |
| `RSMItemSubstitutionGroupMember` | Table | Group item: equivalent qty per case and preference sequence. Unique on (Group, Item). |
| `RSMSubstitutionPriceBasis` | Enum | Bill the substitute at the ordered item's price or its own |
| `RSMSubstitutionPolicy` | Enum | Customer policy: Standard / Customer rules only / Never substitute |
| `CustTable.RSM_SalesProration` | Table extension | `RSMSubstitutionPolicy` + `RSMSubstitutionNote` on the customer |
| `RSMSubstitutionQtyRatio` | EDT (real) | Pack-size conversion: substitute units per 1 original unit |
| `RSMItemSubstitution` | Table | The whitelist: From/To item, direction, rank, ratio, optional customer scope, validity dates, price basis, rule id, note. Unique on (From, To, Customer). Includes `findActive()` (customer row wins), `findForCustomer()` (honours the customer's policy and two-way rules), `ratioFrom()`, `activeSubstitutesFor()` and `validateWrite()` guards. |
| `RSMItemSubstitution` | Form | Simple List grid with quick filter |
| `RSMItemSubstitution` | Display menu item | Opens the form |
| `ProductInformationManagement.RSM_SalesProration` | Menu extension | Surfaces it under Product information management > Setup |
| `RSMItemSubstitutionMaintain` | Privilege | Full CRUD on the form (add to your planner duty/role) |

Field notes:
- **CustAccount blank = global rule**; a customer-specific row wins over a
  blank one (`findActive` prefers exact match) — customer spec sheets decide
  substitutability in produce.
- **QtyRatio** converts quantities (4 lb case → 1 lb clamshell = 4.00).
- **Direction = Bidirectional** makes the rule apply both ways;
  `activeSubstitutesFor()` already honors it.

The read service exposes this table to the web app — see
[../X++/RSMProrationSubstitutionService.xpp](../X++/RSMProrationSubstitutionService.xpp)
and the `substitutions` collection notes in [../X++/README.md](../X++/README.md).
