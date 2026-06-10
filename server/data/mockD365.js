// Mock data simulating what D365 F&SCM service classes will return.
// Shapes here are the contract the .NET BFF / SPA can rely on.

const commodities = [
  { id: 'STRAWBERRY', name: 'Strawberries', description: 'Fresh strawberries (clamshell)' },
  { id: 'BLUEBERRY',  name: 'Blueberries',  description: 'Fresh blueberries' },
  { id: 'LETTUCE',    name: 'Lettuce',      description: 'Romaine and iceberg' },
  { id: 'AVOCADO',    name: 'Avocados',     description: 'Hass avocados — bulk & bagged' },
  { id: 'CITRUS',     name: 'Citrus',       description: 'Oranges, lemons, limes, grapefruit' },
  { id: 'STONEFRUIT', name: 'Stone Fruit',  description: 'Peaches, plums, nectarines, cherries' },
];

const items = [
  // Strawberries
  { itemId: 'STR-CLAM-1LB',  commodityId: 'STRAWBERRY', name: 'Strawberry clamshell 1lb',  uom: 'EA' },
  { itemId: 'STR-CLAM-2LB',  commodityId: 'STRAWBERRY', name: 'Strawberry clamshell 2lb',  uom: 'EA' },
  { itemId: 'STR-ORG-1LB',   commodityId: 'STRAWBERRY', name: 'Organic strawberry 1lb',    uom: 'EA' },
  { itemId: 'STR-FLAT-8CT',  commodityId: 'STRAWBERRY', name: 'Strawberry flat 8ct',       uom: 'CS' },

  // Blueberries
  { itemId: 'BLU-PINT',      commodityId: 'BLUEBERRY',  name: 'Blueberry pint',            uom: 'EA' },
  { itemId: 'BLU-6OZ',       commodityId: 'BLUEBERRY',  name: 'Blueberry 6oz clam',        uom: 'EA' },
  { itemId: 'BLU-ORG-PINT',  commodityId: 'BLUEBERRY',  name: 'Organic blueberry pint',    uom: 'EA' },

  // Lettuce
  { itemId: 'LET-ROM-24CT',  commodityId: 'LETTUCE',    name: 'Romaine 24ct case',         uom: 'CS' },
  { itemId: 'LET-ICE-24CT',  commodityId: 'LETTUCE',    name: 'Iceberg 24ct case',         uom: 'CS' },
  { itemId: 'LET-MIX-3LB',   commodityId: 'LETTUCE',    name: 'Spring mix 3lb bag',        uom: 'EA' },
  { itemId: 'LET-HRT-12CT',  commodityId: 'LETTUCE',    name: 'Romaine hearts 12ct',       uom: 'CS' },

  // Avocados
  { itemId: 'AVO-HASS-48',   commodityId: 'AVOCADO',    name: 'Hass avocado 48ct case',    uom: 'CS' },
  { itemId: 'AVO-HASS-60',   commodityId: 'AVOCADO',    name: 'Hass avocado 60ct case',    uom: 'CS' },
  { itemId: 'AVO-BAG-5CT',   commodityId: 'AVOCADO',    name: 'Hass avocado 5ct bag',      uom: 'EA' },
  { itemId: 'AVO-ORG-48',    commodityId: 'AVOCADO',    name: 'Organic Hass 48ct',         uom: 'CS' },
  { itemId: 'AVO-GUAC-2LB',  commodityId: 'AVOCADO',    name: 'Guacamole 2lb tub',         uom: 'EA' },

  // Citrus
  { itemId: 'CIT-NAV-40',     commodityId: 'CITRUS',    name: 'Navel orange 40lb',         uom: 'CS' },
  { itemId: 'CIT-LEM-40',     commodityId: 'CITRUS',    name: 'Lemon 40lb',                uom: 'CS' },
  { itemId: 'CIT-LIM-40',     commodityId: 'CITRUS',    name: 'Lime 40lb',                 uom: 'CS' },
  { itemId: 'CIT-GFT-40',     commodityId: 'CITRUS',    name: 'Grapefruit 40lb',           uom: 'CS' },
  { itemId: 'CIT-MAN-5LB',    commodityId: 'CITRUS',    name: 'Mandarin 5lb bag',          uom: 'EA' },
  { itemId: 'CIT-ORG-NAV-40', commodityId: 'CITRUS',    name: 'Organic navel 40lb',        uom: 'CS' },

  // Stone Fruit
  { itemId: 'STN-PCH-25',    commodityId: 'STONEFRUIT', name: 'Yellow peach 25lb',         uom: 'CS' },
  { itemId: 'STN-NCT-25',    commodityId: 'STONEFRUIT', name: 'Nectarine 25lb',            uom: 'CS' },
  { itemId: 'STN-PLM-28',    commodityId: 'STONEFRUIT', name: 'Black plum 28lb',           uom: 'CS' },
  { itemId: 'STN-CHR-18',    commodityId: 'STONEFRUIT', name: 'Bing cherry 18lb',          uom: 'CS' },
  { itemId: 'STN-APR-20',    commodityId: 'STONEFRUIT', name: 'Apricot 20lb',              uom: 'CS' },
];

// Customer master extension fields (priority 1=Strategic ... 5=Spot).
// Big-box retailers and their distribution centers are modeled as individual
// ship-to customers so allocations can be set per DC.
const customers = [
  { customerId: 'C-WALMART',         name: 'Walmart',                        priority: 1 },
  { customerId: 'C-TARGET',          name: 'Target',                         priority: 2 },
  { customerId: 'C-KROGER',          name: 'Kroger',                         priority: 2 },
  { customerId: 'C-LOCAL',           name: 'Local Grocer',                   priority: 4 },

  { customerId: 'C-COSTCO-HQ',       name: 'Costco Wholesale',               priority: 1 },
  { customerId: 'C-COSTCO-DC-MIRA',  name: 'Costco DC — Mira Loma, CA',      priority: 1 },
  { customerId: 'C-COSTCO-DC-MONR',  name: 'Costco DC — Monroe Township, NJ',priority: 1 },

  { customerId: 'C-SAMS-HQ',         name: "Sam's Club",                     priority: 1 },
  { customerId: 'C-SAMS-DC-ARC',     name: "Sam's Club DC — Archibald, LA",  priority: 1 },

  { customerId: 'C-WMT-DC-BENT',     name: 'Walmart DC — Bentonville, AR',   priority: 1 },
  { customerId: 'C-WMT-DC-CASA',     name: 'Walmart DC — Casa Grande, AZ',   priority: 1 },

  { customerId: 'C-TGT-DC-LAKE',     name: 'Target DC — Lake City, FL',      priority: 2 },
  { customerId: 'C-TGT-DC-CEDA',     name: 'Target DC — Cedar Falls, IA',    priority: 2 },

  { customerId: 'C-PUBLIX',          name: 'Publix Super Markets',           priority: 2 },
  { customerId: 'C-PUBLIX-DC-LAKE',  name: 'Publix DC — Lakeland, FL',       priority: 2 },

  { customerId: 'C-HEB',             name: 'H-E-B',                          priority: 2 },
  { customerId: 'C-HEB-DC-SANANT',   name: 'H-E-B DC — San Antonio, TX',     priority: 2 },

  { customerId: 'C-ALBERT',          name: 'Albertsons / Safeway',           priority: 3 },
  { customerId: 'C-ALBERT-DC-TRAC',  name: 'Albertsons DC — Tracy, CA',      priority: 3 },

  { customerId: 'C-WHOLE',           name: 'Whole Foods Market',             priority: 2 },
  { customerId: 'C-WHOLE-DC-LAND',   name: 'Whole Foods DC — Landover, MD',  priority: 2 },

  { customerId: 'C-ALDI',            name: 'Aldi US',                        priority: 3 },
  { customerId: 'C-ALDI-DC-DWN',     name: 'Aldi DC — Dwight, IL',           priority: 3 },

  { customerId: 'C-MEIJER',          name: 'Meijer',                         priority: 3 },
  { customerId: 'C-MEIJER-DC-LAN',   name: 'Meijer DC — Lansing, MI',        priority: 3 },
];

// Open sales-order demand lines
const demand = [
  // --- Strawberries ----------------------------------------------------------
  { salesId: 'SO-1001', lineNum: 1, itemId: 'STR-CLAM-1LB', customerId: 'C-WALMART',         siteId: 'SITE-1', warehouseId: 'WH-A', requestedQty: 100, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1002', lineNum: 1, itemId: 'STR-CLAM-1LB', customerId: 'C-TARGET',          siteId: 'SITE-1', warehouseId: 'WH-A', requestedQty:  75, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1003', lineNum: 1, itemId: 'STR-CLAM-1LB', customerId: 'C-COSTCO-DC-MIRA',  siteId: 'SITE-1', warehouseId: 'WH-A', requestedQty: 120, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1004', lineNum: 1, itemId: 'STR-CLAM-1LB', customerId: 'C-SAMS-DC-ARC',     siteId: 'SITE-1', warehouseId: 'WH-A', requestedQty:  80, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1005', lineNum: 1, itemId: 'STR-CLAM-2LB', customerId: 'C-KROGER',          siteId: 'SITE-1', warehouseId: 'WH-B', requestedQty:  60, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1006', lineNum: 1, itemId: 'STR-CLAM-2LB', customerId: 'C-LOCAL',           siteId: 'SITE-1', warehouseId: 'WH-B', requestedQty:  20, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1007', lineNum: 1, itemId: 'STR-CLAM-2LB', customerId: 'C-PUBLIX-DC-LAKE',  siteId: 'SITE-1', warehouseId: 'WH-B', requestedQty:  90, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1008', lineNum: 1, itemId: 'STR-ORG-1LB',  customerId: 'C-WHOLE-DC-LAND',   siteId: 'SITE-1', warehouseId: 'WH-A', requestedQty:  85, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1009', lineNum: 1, itemId: 'STR-ORG-1LB',  customerId: 'C-COSTCO-DC-MONR',  siteId: 'SITE-1', warehouseId: 'WH-A', requestedQty:  60, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1010', lineNum: 1, itemId: 'STR-FLAT-8CT', customerId: 'C-WMT-DC-BENT',     siteId: 'SITE-1', warehouseId: 'WH-B', requestedQty:  40, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1011', lineNum: 1, itemId: 'STR-FLAT-8CT', customerId: 'C-TGT-DC-LAKE',     siteId: 'SITE-1', warehouseId: 'WH-B', requestedQty:  30, requestedShipDate: '2026-05-25' },
  // Same items shipping from the East coast site too
  { salesId: 'SO-1012', lineNum: 1, itemId: 'STR-CLAM-1LB', customerId: 'C-PUBLIX-DC-LAKE',  siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty:  90, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1013', lineNum: 1, itemId: 'STR-CLAM-1LB', customerId: 'C-WHOLE-DC-LAND',   siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty:  70, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1014', lineNum: 1, itemId: 'STR-CLAM-2LB', customerId: 'C-TGT-DC-LAKE',     siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty:  45, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1015', lineNum: 1, itemId: 'STR-ORG-1LB',  customerId: 'C-PUBLIX-DC-LAKE',  siteId: 'SITE-7', warehouseId: 'WH-M', requestedQty:  40, requestedShipDate: '2026-05-24' },

  // --- Blueberries -----------------------------------------------------------
  { salesId: 'SO-1100', lineNum: 1, itemId: 'BLU-PINT',     customerId: 'C-WALMART',         siteId: 'SITE-2', warehouseId: 'WH-C', requestedQty: 200, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1101', lineNum: 1, itemId: 'BLU-PINT',     customerId: 'C-TARGET',          siteId: 'SITE-2', warehouseId: 'WH-C', requestedQty: 150, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1102', lineNum: 1, itemId: 'BLU-PINT',     customerId: 'C-COSTCO-DC-MIRA',  siteId: 'SITE-2', warehouseId: 'WH-C', requestedQty: 180, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1103', lineNum: 1, itemId: 'BLU-6OZ',      customerId: 'C-ALDI-DC-DWN',     siteId: 'SITE-2', warehouseId: 'WH-C', requestedQty: 220, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1104', lineNum: 1, itemId: 'BLU-6OZ',      customerId: 'C-MEIJER-DC-LAN',   siteId: 'SITE-2', warehouseId: 'WH-C', requestedQty: 140, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1105', lineNum: 1, itemId: 'BLU-ORG-PINT', customerId: 'C-WHOLE-DC-LAND',   siteId: 'SITE-2', warehouseId: 'WH-C', requestedQty: 110, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1106', lineNum: 1, itemId: 'BLU-ORG-PINT', customerId: 'C-PUBLIX-DC-LAKE',  siteId: 'SITE-2', warehouseId: 'WH-C', requestedQty:  90, requestedShipDate: '2026-05-25' },
  // East-coast site
  { salesId: 'SO-1107', lineNum: 1, itemId: 'BLU-PINT',     customerId: 'C-PUBLIX-DC-LAKE',  siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty: 160, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1108', lineNum: 1, itemId: 'BLU-PINT',     customerId: 'C-WHOLE-DC-LAND',   siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty: 130, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1109', lineNum: 1, itemId: 'BLU-6OZ',      customerId: 'C-TGT-DC-LAKE',     siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty: 110, requestedShipDate: '2026-05-24' },

  // --- Lettuce ---------------------------------------------------------------
  { salesId: 'SO-1200', lineNum: 1, itemId: 'LET-ROM-24CT', customerId: 'C-KROGER',          siteId: 'SITE-3', warehouseId: 'WH-D', requestedQty:  40, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1201', lineNum: 1, itemId: 'LET-ROM-24CT', customerId: 'C-HEB-DC-SANANT',   siteId: 'SITE-3', warehouseId: 'WH-D', requestedQty:  60, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1202', lineNum: 1, itemId: 'LET-ICE-24CT', customerId: 'C-WMT-DC-CASA',     siteId: 'SITE-3', warehouseId: 'WH-D', requestedQty: 120, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1203', lineNum: 1, itemId: 'LET-ICE-24CT', customerId: 'C-ALBERT-DC-TRAC',  siteId: 'SITE-3', warehouseId: 'WH-D', requestedQty:  80, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1204', lineNum: 1, itemId: 'LET-MIX-3LB',  customerId: 'C-COSTCO-DC-MIRA',  siteId: 'SITE-3', warehouseId: 'WH-E', requestedQty: 250, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1205', lineNum: 1, itemId: 'LET-MIX-3LB',  customerId: 'C-SAMS-DC-ARC',     siteId: 'SITE-3', warehouseId: 'WH-E', requestedQty: 180, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1206', lineNum: 1, itemId: 'LET-HRT-12CT', customerId: 'C-PUBLIX-DC-LAKE',  siteId: 'SITE-3', warehouseId: 'WH-D', requestedQty:  70, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1207', lineNum: 1, itemId: 'LET-HRT-12CT', customerId: 'C-TGT-DC-CEDA',     siteId: 'SITE-3', warehouseId: 'WH-D', requestedQty:  55, requestedShipDate: '2026-05-25' },
  // Midwest site
  { salesId: 'SO-1208', lineNum: 1, itemId: 'LET-ROM-24CT', customerId: 'C-MEIJER-DC-LAN',   siteId: 'SITE-8', warehouseId: 'WH-N', requestedQty:  85, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1209', lineNum: 1, itemId: 'LET-ROM-24CT', customerId: 'C-ALDI-DC-DWN',     siteId: 'SITE-8', warehouseId: 'WH-N', requestedQty:  70, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1210', lineNum: 1, itemId: 'LET-MIX-3LB',  customerId: 'C-MEIJER-DC-LAN',   siteId: 'SITE-8', warehouseId: 'WH-N', requestedQty: 130, requestedShipDate: '2026-05-25' },

  // --- Avocados --------------------------------------------------------------
  { salesId: 'SO-1300', lineNum: 1, itemId: 'AVO-HASS-48',  customerId: 'C-WMT-DC-CASA',     siteId: 'SITE-4', warehouseId: 'WH-F', requestedQty: 300, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1301', lineNum: 1, itemId: 'AVO-HASS-48',  customerId: 'C-COSTCO-DC-MIRA',  siteId: 'SITE-4', warehouseId: 'WH-F', requestedQty: 250, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1302', lineNum: 1, itemId: 'AVO-HASS-60',  customerId: 'C-HEB-DC-SANANT',   siteId: 'SITE-4', warehouseId: 'WH-F', requestedQty: 180, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1303', lineNum: 1, itemId: 'AVO-HASS-60',  customerId: 'C-KROGER',          siteId: 'SITE-4', warehouseId: 'WH-F', requestedQty: 220, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1304', lineNum: 1, itemId: 'AVO-BAG-5CT',  customerId: 'C-SAMS-DC-ARC',     siteId: 'SITE-4', warehouseId: 'WH-G', requestedQty: 400, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1305', lineNum: 1, itemId: 'AVO-BAG-5CT',  customerId: 'C-ALDI-DC-DWN',     siteId: 'SITE-4', warehouseId: 'WH-G', requestedQty: 300, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1306', lineNum: 1, itemId: 'AVO-ORG-48',   customerId: 'C-WHOLE-DC-LAND',   siteId: 'SITE-4', warehouseId: 'WH-F', requestedQty: 120, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1307', lineNum: 1, itemId: 'AVO-GUAC-2LB', customerId: 'C-MEIJER-DC-LAN',   siteId: 'SITE-4', warehouseId: 'WH-G', requestedQty: 160, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1308', lineNum: 1, itemId: 'AVO-GUAC-2LB', customerId: 'C-PUBLIX-DC-LAKE',  siteId: 'SITE-4', warehouseId: 'WH-G', requestedQty: 140, requestedShipDate: '2026-05-25' },
  // Texas site
  { salesId: 'SO-1309', lineNum: 1, itemId: 'AVO-HASS-48',  customerId: 'C-HEB-DC-SANANT',   siteId: 'SITE-9', warehouseId: 'WH-O', requestedQty: 200, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1310', lineNum: 1, itemId: 'AVO-HASS-48',  customerId: 'C-WMT-DC-BENT',     siteId: 'SITE-9', warehouseId: 'WH-O', requestedQty: 180, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1311', lineNum: 1, itemId: 'AVO-BAG-5CT',  customerId: 'C-HEB-DC-SANANT',   siteId: 'SITE-9', warehouseId: 'WH-P', requestedQty: 250, requestedShipDate: '2026-05-23' },

  // --- Citrus ----------------------------------------------------------------
  { salesId: 'SO-1400', lineNum: 1, itemId: 'CIT-NAV-40',     customerId: 'C-COSTCO-DC-MONR', siteId: 'SITE-5', warehouseId: 'WH-H', requestedQty: 200, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1401', lineNum: 1, itemId: 'CIT-NAV-40',     customerId: 'C-WMT-DC-BENT',    siteId: 'SITE-5', warehouseId: 'WH-H', requestedQty: 180, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1402', lineNum: 1, itemId: 'CIT-LEM-40',     customerId: 'C-TGT-DC-LAKE',    siteId: 'SITE-5', warehouseId: 'WH-H', requestedQty: 100, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1403', lineNum: 1, itemId: 'CIT-LEM-40',     customerId: 'C-HEB-DC-SANANT',  siteId: 'SITE-5', warehouseId: 'WH-H', requestedQty: 120, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1404', lineNum: 1, itemId: 'CIT-LIM-40',     customerId: 'C-PUBLIX-DC-LAKE', siteId: 'SITE-5', warehouseId: 'WH-H', requestedQty:  90, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1405', lineNum: 1, itemId: 'CIT-LIM-40',     customerId: 'C-KROGER',         siteId: 'SITE-5', warehouseId: 'WH-H', requestedQty:  70, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1406', lineNum: 1, itemId: 'CIT-GFT-40',     customerId: 'C-ALBERT-DC-TRAC', siteId: 'SITE-5', warehouseId: 'WH-I', requestedQty:  80, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1407', lineNum: 1, itemId: 'CIT-MAN-5LB',    customerId: 'C-ALDI-DC-DWN',    siteId: 'SITE-5', warehouseId: 'WH-I', requestedQty: 220, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1408', lineNum: 1, itemId: 'CIT-MAN-5LB',    customerId: 'C-MEIJER-DC-LAN',  siteId: 'SITE-5', warehouseId: 'WH-I', requestedQty: 160, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1409', lineNum: 1, itemId: 'CIT-ORG-NAV-40', customerId: 'C-WHOLE-DC-LAND',  siteId: 'SITE-5', warehouseId: 'WH-H', requestedQty: 110, requestedShipDate: '2026-05-25' },
  // Florida site for east-coast citrus
  { salesId: 'SO-1410', lineNum: 1, itemId: 'CIT-NAV-40',     customerId: 'C-PUBLIX-DC-LAKE', siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty: 150, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1411', lineNum: 1, itemId: 'CIT-LEM-40',     customerId: 'C-PUBLIX-DC-LAKE', siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty:  80, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1412', lineNum: 1, itemId: 'CIT-LIM-40',     customerId: 'C-WHOLE-DC-LAND',  siteId: 'SITE-7', warehouseId: 'WH-L', requestedQty:  60, requestedShipDate: '2026-05-24' },

  // --- Stone fruit -----------------------------------------------------------
  { salesId: 'SO-1500', lineNum: 1, itemId: 'STN-PCH-25',   customerId: 'C-WMT-DC-BENT',     siteId: 'SITE-6', warehouseId: 'WH-J', requestedQty: 140, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1501', lineNum: 1, itemId: 'STN-PCH-25',   customerId: 'C-KROGER',          siteId: 'SITE-6', warehouseId: 'WH-J', requestedQty: 120, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1502', lineNum: 1, itemId: 'STN-PCH-25',   customerId: 'C-COSTCO-DC-MIRA',  siteId: 'SITE-6', warehouseId: 'WH-J', requestedQty: 160, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1503', lineNum: 1, itemId: 'STN-NCT-25',   customerId: 'C-TGT-DC-CEDA',     siteId: 'SITE-6', warehouseId: 'WH-J', requestedQty:  90, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1504', lineNum: 1, itemId: 'STN-PLM-28',   customerId: 'C-HEB-DC-SANANT',   siteId: 'SITE-6', warehouseId: 'WH-K', requestedQty: 110, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1505', lineNum: 1, itemId: 'STN-PLM-28',   customerId: 'C-ALBERT-DC-TRAC',  siteId: 'SITE-6', warehouseId: 'WH-K', requestedQty:  75, requestedShipDate: '2026-05-25' },
  { salesId: 'SO-1506', lineNum: 1, itemId: 'STN-CHR-18',   customerId: 'C-COSTCO-DC-MONR',  siteId: 'SITE-6', warehouseId: 'WH-K', requestedQty: 100, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1507', lineNum: 1, itemId: 'STN-CHR-18',   customerId: 'C-SAMS-DC-ARC',     siteId: 'SITE-6', warehouseId: 'WH-K', requestedQty:  80, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1508', lineNum: 1, itemId: 'STN-APR-20',   customerId: 'C-WHOLE-DC-LAND',   siteId: 'SITE-6', warehouseId: 'WH-K', requestedQty:  60, requestedShipDate: '2026-05-25' },
  // Midwest site
  { salesId: 'SO-1509', lineNum: 1, itemId: 'STN-PCH-25',   customerId: 'C-MEIJER-DC-LAN',   siteId: 'SITE-8', warehouseId: 'WH-N', requestedQty:  95, requestedShipDate: '2026-05-23' },
  { salesId: 'SO-1510', lineNum: 1, itemId: 'STN-PCH-25',   customerId: 'C-ALDI-DC-DWN',     siteId: 'SITE-8', warehouseId: 'WH-N', requestedQty:  80, requestedShipDate: '2026-05-24' },
  { salesId: 'SO-1511', lineNum: 1, itemId: 'STN-CHR-18',   customerId: 'C-MEIJER-DC-LAN',   siteId: 'SITE-8', warehouseId: 'WH-N', requestedQty:  70, requestedShipDate: '2026-05-25' },
];

// Available supply per item / site / warehouse (on-hand + inbound within horizon).
// Intentionally short of demand so the proration strategies have something to do.
const supply = [
  // Strawberries
  { itemId: 'STR-CLAM-1LB', siteId: 'SITE-1', warehouseId: 'WH-A', availableQty: 280 },  // demand 375
  { itemId: 'STR-CLAM-2LB', siteId: 'SITE-1', warehouseId: 'WH-B', availableQty: 130 },  // demand 170
  { itemId: 'STR-ORG-1LB',  siteId: 'SITE-1', warehouseId: 'WH-A', availableQty: 100 },  // demand 145
  { itemId: 'STR-FLAT-8CT', siteId: 'SITE-1', warehouseId: 'WH-B', availableQty:  55 },  // demand  70

  // Blueberries
  { itemId: 'BLU-PINT',     siteId: 'SITE-2', warehouseId: 'WH-C', availableQty: 400 },  // demand 530
  { itemId: 'BLU-6OZ',      siteId: 'SITE-2', warehouseId: 'WH-C', availableQty: 250 },  // demand 360
  { itemId: 'BLU-ORG-PINT', siteId: 'SITE-2', warehouseId: 'WH-C', availableQty: 160 },  // demand 200

  // Lettuce
  { itemId: 'LET-ROM-24CT', siteId: 'SITE-3', warehouseId: 'WH-D', availableQty:  75 },  // demand 100
  { itemId: 'LET-ICE-24CT', siteId: 'SITE-3', warehouseId: 'WH-D', availableQty: 140 },  // demand 200
  { itemId: 'LET-MIX-3LB',  siteId: 'SITE-3', warehouseId: 'WH-E', availableQty: 320 },  // demand 430
  { itemId: 'LET-HRT-12CT', siteId: 'SITE-3', warehouseId: 'WH-D', availableQty: 100 },  // demand 125

  // Avocados
  { itemId: 'AVO-HASS-48',  siteId: 'SITE-4', warehouseId: 'WH-F', availableQty: 420 },  // demand 550
  { itemId: 'AVO-HASS-60',  siteId: 'SITE-4', warehouseId: 'WH-F', availableQty: 300 },  // demand 400
  { itemId: 'AVO-BAG-5CT',  siteId: 'SITE-4', warehouseId: 'WH-G', availableQty: 550 },  // demand 700
  { itemId: 'AVO-ORG-48',   siteId: 'SITE-4', warehouseId: 'WH-F', availableQty: 100 },  // demand 120
  { itemId: 'AVO-GUAC-2LB', siteId: 'SITE-4', warehouseId: 'WH-G', availableQty: 240 },  // demand 300

  // Citrus
  { itemId: 'CIT-NAV-40',     siteId: 'SITE-5', warehouseId: 'WH-H', availableQty: 300 }, // demand 380
  { itemId: 'CIT-LEM-40',     siteId: 'SITE-5', warehouseId: 'WH-H', availableQty: 170 }, // demand 220
  { itemId: 'CIT-LIM-40',     siteId: 'SITE-5', warehouseId: 'WH-H', availableQty: 130 }, // demand 160
  { itemId: 'CIT-GFT-40',     siteId: 'SITE-5', warehouseId: 'WH-I', availableQty:  80 }, // demand  80 (OK)
  { itemId: 'CIT-MAN-5LB',    siteId: 'SITE-5', warehouseId: 'WH-I', availableQty: 300 }, // demand 380
  { itemId: 'CIT-ORG-NAV-40', siteId: 'SITE-5', warehouseId: 'WH-H', availableQty:  90 }, // demand 110

  // Stone fruit
  { itemId: 'STN-PCH-25',   siteId: 'SITE-6', warehouseId: 'WH-J', availableQty: 320 },  // demand 420
  { itemId: 'STN-NCT-25',   siteId: 'SITE-6', warehouseId: 'WH-J', availableQty:  90 },  // demand  90 (OK)
  { itemId: 'STN-PLM-28',   siteId: 'SITE-6', warehouseId: 'WH-K', availableQty: 150 },  // demand 185
  { itemId: 'STN-CHR-18',   siteId: 'SITE-6', warehouseId: 'WH-K', availableQty: 140 },  // demand 180
  { itemId: 'STN-APR-20',   siteId: 'SITE-6', warehouseId: 'WH-K', availableQty:  60 },  // demand  60 (OK)

  // East-coast (Florida) - strawberries, blueberries, citrus
  { itemId: 'STR-CLAM-1LB', siteId: 'SITE-7', warehouseId: 'WH-L', availableQty: 130 }, // demand 160
  { itemId: 'STR-CLAM-2LB', siteId: 'SITE-7', warehouseId: 'WH-L', availableQty:  35 }, // demand  45
  { itemId: 'STR-ORG-1LB',  siteId: 'SITE-7', warehouseId: 'WH-M', availableQty:  30 }, // demand  40
  { itemId: 'BLU-PINT',     siteId: 'SITE-7', warehouseId: 'WH-L', availableQty: 240 }, // demand 290
  { itemId: 'BLU-6OZ',      siteId: 'SITE-7', warehouseId: 'WH-L', availableQty:  90 }, // demand 110
  { itemId: 'CIT-NAV-40',   siteId: 'SITE-7', warehouseId: 'WH-L', availableQty: 120 }, // demand 150
  { itemId: 'CIT-LEM-40',   siteId: 'SITE-7', warehouseId: 'WH-L', availableQty:  60 }, // demand  80
  { itemId: 'CIT-LIM-40',   siteId: 'SITE-7', warehouseId: 'WH-L', availableQty:  50 }, // demand  60

  // Midwest (Chicago) - lettuce, stone fruit
  { itemId: 'LET-ROM-24CT', siteId: 'SITE-8', warehouseId: 'WH-N', availableQty: 120 }, // demand 155
  { itemId: 'LET-MIX-3LB',  siteId: 'SITE-8', warehouseId: 'WH-N', availableQty: 100 }, // demand 130
  { itemId: 'STN-PCH-25',   siteId: 'SITE-8', warehouseId: 'WH-N', availableQty: 140 }, // demand 175
  { itemId: 'STN-CHR-18',   siteId: 'SITE-8', warehouseId: 'WH-N', availableQty:  55 }, // demand  70

  // Texas - avocados
  { itemId: 'AVO-HASS-48',  siteId: 'SITE-9', warehouseId: 'WH-O', availableQty: 300 }, // demand 380
  { itemId: 'AVO-BAG-5CT',  siteId: 'SITE-9', warehouseId: 'WH-P', availableQty: 200 }, // demand 250
];

// Site master (with friendly names for display)
const sites = [
  { siteId: 'SITE-1', name: 'Salinas, CA (West HQ)' },
  { siteId: 'SITE-2', name: 'Watsonville, CA' },
  { siteId: 'SITE-3', name: 'Yuma, AZ' },
  { siteId: 'SITE-4', name: 'Oxnard, CA' },
  { siteId: 'SITE-5', name: 'Bakersfield, CA' },
  { siteId: 'SITE-6', name: 'Fresno, CA' },
  { siteId: 'SITE-7', name: 'Plant City, FL (East)' },
  { siteId: 'SITE-8', name: 'Chicago, IL (Midwest)' },
  { siteId: 'SITE-9', name: 'McAllen, TX (South)' },
];

// Historical fill-rate per customer (for History-Aware algorithm).
// Average fill rate over last 4 weeks (0..1). Lower = shorted more recently.
const customerFillHistory = {
  'C-WALMART':         0.95,
  'C-TARGET':          0.70,
  'C-KROGER':          0.85,
  'C-LOCAL':           0.90,
  'C-COSTCO-HQ':       0.92,
  'C-COSTCO-DC-MIRA':  0.78,
  'C-COSTCO-DC-MONR':  0.88,
  'C-SAMS-HQ':         0.90,
  'C-SAMS-DC-ARC':     0.82,
  'C-WMT-DC-BENT':     0.96,
  'C-WMT-DC-CASA':     0.91,
  'C-TGT-DC-LAKE':     0.65,   // shorted hard — expect biggest bump
  'C-TGT-DC-CEDA':     0.74,
  'C-PUBLIX':          0.88,
  'C-PUBLIX-DC-LAKE':  0.83,
  'C-HEB':             0.89,
  'C-HEB-DC-SANANT':   0.86,
  'C-ALBERT':          0.84,
  'C-ALBERT-DC-TRAC':  0.79,
  'C-WHOLE':           0.93,
  'C-WHOLE-DC-LAND':   0.81,
  'C-ALDI':            0.87,
  'C-ALDI-DC-DWN':     0.76,
  'C-MEIJER':          0.85,
  'C-MEIJER-DC-LAN':   0.80,
};

module.exports = { commodities, items, customers, demand, supply, sites, customerFillHistory };
