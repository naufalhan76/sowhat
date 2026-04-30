import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "A:/Solofleet/outputs/truck_order_bi";
const dataPath = `${outputDir}/dashboard_data.json`;
const outputPath = `${outputDir}/truck_order_bi_dashboard.xlsx`;

const payload = JSON.parse(await fs.readFile(dataPath, "utf8"));
const workbook = Workbook.create();

const colors = {
  navy: "#18344A",
  blue: "#2E75B6",
  teal: "#009C9A",
  green: "#4F9D69",
  amber: "#F2A541",
  red: "#C74747",
  surface: "#F6F8FA",
  paleBlue: "#EAF2F8",
  paleGreen: "#EAF6EF",
  paleAmber: "#FFF3D8",
  grid: "#D7DEE8",
  text: "#22313F",
  white: "#FFFFFF",
};

function excelDate(value) {
  if (!value || typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value ?? null;
  }
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function matrix(rows, mapper) {
  return rows.map(mapper);
}

function addr(col, row) {
  return `${col}${row}`;
}

function writeCard(sheet, leftCol, topRow, title, formula, options = {}) {
  const labelRange = `${leftCol}${topRow}:${String.fromCharCode(leftCol.charCodeAt(0) + 1)}${topRow}`;
  const valueRange = `${leftCol}${topRow + 1}:${String.fromCharCode(leftCol.charCodeAt(0) + 1)}${topRow + 2}`;
  sheet.getRange(labelRange).merge();
  sheet.getRange(valueRange).merge();
  sheet.getRange(addr(leftCol, topRow)).values = [[title]];
  sheet.getRange(addr(leftCol, topRow + 1)).formulas = [[formula]];
  sheet.getRange(labelRange).format = {
    fill: options.fill ?? colors.paleBlue,
    font: { bold: true, color: colors.navy, size: 10 },
    horizontalAlignment: "center",
  };
  sheet.getRange(valueRange).format = {
    fill: colors.white,
    font: { bold: true, color: options.valueColor ?? colors.navy, size: 18 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { outline: { color: colors.grid, style: "continuous" } },
  };
  if (options.numberFormat) {
    sheet.getRange(valueRange).format.numberFormat = options.numberFormat;
  }
}

function styleHeader(range) {
  range.format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
}

function setWidths(sheet, widths) {
  for (const [col, px] of Object.entries(widths)) {
    sheet.getRange(`${col}:${col}`).format.columnWidthPx = px;
  }
}

function chartLabel(value, max = 18) {
  if (!value) {
    return "";
  }
  const cleaned = String(value)
    .replace(/^PT\.?\s+/i, "PT ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1).trim()}...`;
}

function customerChartLabel(value) {
  const raw = String(value ?? "").toUpperCase();
  if (raw.includes("ASTRO")) return "ASTRO";
  if (raw.includes("SEBASTIAN") || raw.includes("ROTI O")) return "Roti O";
  if (raw.includes("GLOBAL DAIRI")) return "Global";
  if (raw.includes("PANDURASA")) return "Pandurasa";
  if (raw.includes("TRIEKA")) return "Trieka";
  if (raw.includes("EMADOS")) return "Emados";
  if (raw.includes("TAMI")) return "TAMI";
  if (raw.includes("BELEAF")) return "BELEAF";
  if (raw.includes("HAVI")) return raw.startsWith("PT") ? "PT HAVI" : "HAVI";
  return chartLabel(value, 9);
}

function generateMonthSeries(startMonth, count) {
  const [year, month] = startMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(year, month - 1 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function padRows(values, length) {
  return Array.from({ length }, (_, i) => [values[i] ?? null]);
}

const dashboard = workbook.worksheets.add("Dashboard");
const ordersSheet = workbook.worksheets.add("Orders");
const assetsSheet = workbook.worksheets.add("Fleet Assets");
const slaSheet = workbook.worksheets.add("SLA Routes");
const notesSheet = workbook.worksheets.add("Data Notes");

for (const sheet of [dashboard, ordersSheet, assetsSheet, slaSheet, notesSheet]) {
  sheet.showGridLines = false;
}

const orderHeaders = [
  "Order Type",
  "Source Row",
  "No",
  "Order Date",
  "Customer",
  "Plate",
  "Truck Type",
  "Asset",
  "Temp Req",
  "Load Date",
  "Load Time",
  "Origin",
  "Destination",
  "SLA Days",
  "Unit Confirmed",
  "Driver Confirmed",
  "Driver",
  "Phone",
  "Vendor Driver",
  "DO No",
  "Drop Point",
  "Actual Load Done",
  "Actual POD Arrived",
  "Actual Unload Done",
  "Month",
  "Completion Status",
  "Lead Time Days",
  "SLA Status",
  "Plate Key",
];

ordersSheet.getRange("A1:AC1").values = [orderHeaders];
ordersSheet.getRange(`A2:AC${payload.orders.length + 1}`).values = matrix(payload.orders, (o) => [
  o.order_type,
  o.source_row,
  o.no,
  excelDate(o.order_date),
  o.customer,
  o.plate,
  o.truck_type,
  o.asset,
  o.temp_req,
  excelDate(o.load_date),
  o.load_time,
  o.origin,
  o.destination,
  o.sla_days,
  o.unit_confirmed,
  o.driver_confirmed,
  o.driver,
  o.phone,
  o.vendor_driver,
  o.do_no,
  o.drop_point,
  o.actual_load_done,
  o.actual_pod_arrived,
  o.actual_unload_done,
  null,
  null,
  null,
  null,
  o.plate_key,
]);

const orderLastRow = payload.orders.length + 1;
const activeOrderLastRow = 10000;
const orderTypeRange = `Orders!$A$2:$A$${activeOrderLastRow}`;
const orderDateRange = `Orders!$D$2:$D$${activeOrderLastRow}`;
const customerRange = `Orders!$E$2:$E$${activeOrderLastRow}`;
const truckTypeRange = `Orders!$G$2:$G$${activeOrderLastRow}`;
const slaRange = `Orders!$N$2:$N$${activeOrderLastRow}`;
const monthRange = `Orders!$Y$2:$Y$${activeOrderLastRow}`;
const statusRange = `Orders!$Z$2:$Z$${activeOrderLastRow}`;
const leadTimeRange = `Orders!$AA$2:$AA$${activeOrderLastRow}`;
const plateKeyRange = `Orders!$AC$2:$AC$${activeOrderLastRow}`;
ordersSheet.getRange("Y2:AB2").formulas = [[
  '=IF(AND(A2="",D2="",J2=""),"",IF(J2<>"",TEXT(J2,"yyyy-mm"),IF(D2<>"",TEXT(D2,"yyyy-mm"),"")))',
  '=IF(A2="","",IF(A2="Dedicated",IF(O2="YES","Confirmed","Open"),IF(X2<>"","Completed",IF(OR(V2<>"",W2<>""),"In Transit",IF(OR(O2="YES",P2="YES"),"Confirmed","Open")))))',
  '=IFERROR(IF(AND(ISNUMBER(D2),ISNUMBER(J2)),J2-D2,""),"")',
  '=IF(A2="","",IF(N2="","No SLA",IF(AA2="","Pending",IF(AA2<=N2,"Within SLA","Late"))))',
]];
ordersSheet.getRange(`Y2:AB${activeOrderLastRow}`).fillDown();
styleHeader(ordersSheet.getRange("A1:AC1"));
ordersSheet.getRange(`A1:AC${activeOrderLastRow}`).format = {
  borders: { insideHorizontal: { color: colors.grid, style: "continuous" } },
};
ordersSheet.getRange(`D2:D${activeOrderLastRow}`).format.numberFormat = "yyyy-mm-dd";
ordersSheet.getRange(`J2:J${activeOrderLastRow}`).format.numberFormat = "yyyy-mm-dd";
ordersSheet.getRange(`N2:N${activeOrderLastRow}`).format.numberFormat = "0.0";
ordersSheet.getRange(`AA2:AA${activeOrderLastRow}`).format.numberFormat = "0.0";
ordersSheet.tables.add(`A1:AC${activeOrderLastRow}`, true, "OrdersTable");
ordersSheet.freezePanes.freezeRows(1);
setWidths(ordersSheet, {
  A: 105,
  B: 72,
  C: 54,
  D: 96,
  E: 210,
  F: 112,
  G: 92,
  H: 105,
  I: 110,
  J: 96,
  K: 84,
  L: 120,
  M: 150,
  N: 76,
  O: 110,
  P: 118,
  Q: 180,
  R: 125,
  S: 115,
  T: 104,
  U: 105,
  V: 120,
  W: 130,
  X: 136,
  Y: 82,
  Z: 120,
  AA: 110,
  AB: 96,
  AC: 96,
});

const assetHeaders = ["No", "Plate", "Asset", "Truck Type", "Type Truck", "Capacity Kg", "Capacity CBM", "Plate Key"];
assetsSheet.getRange("A1:H1").values = [assetHeaders];
assetsSheet.getRange(`A2:H${payload.assets.length + 1}`).values = matrix(payload.assets, (a) => [
  a.no,
  a.plate,
  a.asset,
  a.truck_type,
  a.type_truck,
  a.capacity_kg,
  a.capacity_cbm,
  a.plate_key,
]);
styleHeader(assetsSheet.getRange("A1:H1"));
assetsSheet.tables.add(`A1:H${payload.assets.length + 1}`, true, "FleetAssetsTable");
assetsSheet.freezePanes.freezeRows(1);
assetsSheet.getRange(`F2:G${payload.assets.length + 1}`).format.numberFormat = "#,##0";
setWidths(assetsSheet, { A: 60, B: 118, C: 112, D: 100, E: 130, F: 105, G: 110, H: 96 });

const routeHeaders = ["No", "Origin", "Destination", "SLA Days"];
slaSheet.getRange("A1:D1").values = [routeHeaders];
slaSheet.getRange(`A2:D${payload.sla_routes.length + 1}`).values = matrix(payload.sla_routes, (r) => [
  r.no,
  r.origin,
  r.destination,
  r.sla_days,
]);
styleHeader(slaSheet.getRange("A1:D1"));
slaSheet.tables.add(`A1:D${payload.sla_routes.length + 1}`, true, "SLARoutesTable");
slaSheet.freezePanes.freezeRows(1);
slaSheet.getRange(`D2:D${payload.sla_routes.length + 1}`).format.numberFormat = "0.0";
setWidths(slaSheet, { A: 60, B: 155, C: 190, D: 90 });

notesSheet.getRange("A1:D1").values = [["Truck Order BI Dashboard", null, null, null]];
notesSheet.getRange("A1:D1").merge();
notesSheet.getRange("A3:B9").values = [
  ["Source Workbook", "D:/Download/Copy of TRUCK ORDER MANAGEMENT.xlsx"],
  ["Orders Included", payload.summary.total_orders],
  ["Dedicated Source", "Dedicated sheet"],
  ["On Call Source", "On Call sheet"],
  ["Fleet Source", "ASSET sheet"],
  ["SLA Source", "SLA DELIVERY sheet"],
  ["Active Dashboard Note", "Add new order rows inside the Orders table up to row 10,000. Dashboard filters, KPIs, and charts update from formulas."],
];
notesSheet.getRange("A1:D1").format = {
  fill: colors.navy,
  font: { bold: true, color: colors.white, size: 16 },
  horizontalAlignment: "center",
};
notesSheet.getRange("A3:A9").format = { fill: colors.paleBlue, font: { bold: true, color: colors.navy } };
notesSheet.getRange("B3:B9").format = { fill: colors.white, font: { color: colors.text }, wrapText: true };
setWidths(notesSheet, { A: 150, B: 480, C: 120, D: 120 });

function countFormula({ month = 'IF($A$6="All","*",$A$6)', type = 'IF($C$6="All","*",$C$6)', customer = 'IF($E$6="All","*",$E$6)', truck = 'IF($G$6="All","*",$G$6)', status = 'IF($I$6="All","*",$I$6)' } = {}) {
  return `COUNTIFS(${orderTypeRange},"<>",${orderTypeRange},${type},${monthRange},${month},${customerRange},${customer},${truckTypeRange},${truck},${statusRange},${status})`;
}

function sumSlaFormula() {
  return `SUMIFS(${slaRange},${orderTypeRange},"<>",${orderTypeRange},IF($C$6="All","*",$C$6),${monthRange},IF($A$6="All","*",$A$6),${customerRange},IF($E$6="All","*",$E$6),${truckTypeRange},IF($G$6="All","*",$G$6),${statusRange},IF($I$6="All","*",$I$6),${slaRange},"<>")`;
}

function countSlaFormula() {
  return `COUNTIFS(${orderTypeRange},"<>",${orderTypeRange},IF($C$6="All","*",$C$6),${monthRange},IF($A$6="All","*",$A$6),${customerRange},IF($E$6="All","*",$E$6),${truckTypeRange},IF($G$6="All","*",$G$6),${statusRange},IF($I$6="All","*",$I$6),${slaRange},"<>")`;
}

const filteredOrderCount = countFormula();
const monthSeries = generateMonthSeries(payload.summary.months[0], 24);

dashboard.getRange("A1:J1").values = [["Truck Order Management Active Dashboard", null, null, null, null, null, null, null, null, null]];
dashboard.getRange("A1:J1").merge();
dashboard.getRange("A1:J1").format = {
  fill: colors.navy,
  font: { bold: true, color: colors.white, size: 18 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
};
dashboard.getRange("A2:J2").values = [[`Use the filter cells below. Dashboard formulas are tied to OrdersTable, so appended table rows update KPIs and charts.`, null, null, null, null, null, null, null, null, null]];
dashboard.getRange("A2:J2").merge();
dashboard.getRange("A2:J2").format = {
  fill: colors.surface,
  font: { color: colors.text, italic: true },
  horizontalAlignment: "center",
};
dashboard.getRange("A1:J2").format.rowHeightPx = 30;

dashboard.getRange("A4:J4").values = [["Filters", null, null, null, null, null, null, null, null, null]];
dashboard.getRange("A4:J4").merge();
dashboard.getRange("A4:J4").format = {
  fill: colors.navy,
  font: { bold: true, color: colors.white, size: 11 },
  horizontalAlignment: "center",
};
dashboard.getRange("A5:J5").values = [["Month", null, "Order Type", null, "Customer", null, "Truck Type", null, "Status", null]];
dashboard.getRange("A6:J6").values = [["All", null, "All", null, "All", null, "All", null, "All", null]];
for (const range of ["A5:B5", "C5:D5", "E5:F5", "G5:H5", "I5:J5", "A6:B6", "C6:D6", "E6:F6", "G6:H6", "I6:J6"]) {
  dashboard.getRange(range).merge();
}
dashboard.getRange("A5:J5").format = {
  fill: colors.paleBlue,
  font: { bold: true, color: colors.navy },
  horizontalAlignment: "center",
};
dashboard.getRange("A6:J6").format = {
  fill: colors.white,
  font: { bold: true, color: colors.text },
  horizontalAlignment: "center",
  borders: { outline: { color: colors.grid, style: "continuous" } },
};

writeCard(dashboard, "A", 8, "Filtered Orders", `=IFERROR(${filteredOrderCount},0)`, { fill: colors.paleBlue });
writeCard(dashboard, "C", 8, "On Call", `=IF($C$6="Dedicated",0,IFERROR(${countFormula({ type: '"On Call"' })},0))`, { fill: colors.paleGreen, valueColor: colors.green });
writeCard(dashboard, "E", 8, "Dedicated", `=IF($C$6="On Call",0,IFERROR(${countFormula({ type: '"Dedicated"' })},0))`, { fill: colors.paleAmber, valueColor: colors.amber });
writeCard(dashboard, "G", 8, "Truck Records", `=IFERROR(COUNTIFS(${plateKeyRange},"<>",${orderTypeRange},IF($C$6="All","*",$C$6),${monthRange},IF($A$6="All","*",$A$6),${customerRange},IF($E$6="All","*",$E$6),${truckTypeRange},IF($G$6="All","*",$G$6),${statusRange},IF($I$6="All","*",$I$6)),0)`, { fill: colors.paleBlue });
writeCard(dashboard, "I", 8, "Confirmed Rate", `=IFERROR((${countFormula({ status: '"Confirmed"' })}+${countFormula({ status: '"Completed"' })}+${countFormula({ status: '"In Transit"' })})/${filteredOrderCount},0)`, { fill: colors.paleGreen, numberFormat: "0.0%", valueColor: colors.green });
writeCard(dashboard, "A", 12, "Customer Records", `=IFERROR(COUNTIFS(${customerRange},"<>",${orderTypeRange},IF($C$6="All","*",$C$6),${monthRange},IF($A$6="All","*",$A$6),${customerRange},IF($E$6="All","*",$E$6),${truckTypeRange},IF($G$6="All","*",$G$6),${statusRange},IF($I$6="All","*",$I$6)),0)`, { fill: colors.paleBlue });
writeCard(dashboard, "C", 12, "Fleet Units", `=COUNTA('Fleet Assets'!$H$2:$H$1000)`, { fill: colors.paleBlue });
writeCard(dashboard, "E", 12, "Fleet Used", `=IFERROR(COUNTIFS(${plateKeyRange},"<>",${orderTypeRange},IF($C$6="All","*",$C$6),${monthRange},IF($A$6="All","*",$A$6),${customerRange},IF($E$6="All","*",$E$6),${truckTypeRange},IF($G$6="All","*",$G$6),${statusRange},IF($I$6="All","*",$I$6)),0)`, { fill: colors.paleBlue });
writeCard(dashboard, "G", 12, "Avg SLA Days", `=IFERROR(${sumSlaFormula()}/${countSlaFormula()},0)`, { fill: colors.paleAmber, numberFormat: "0.0" });
writeCard(dashboard, "I", 12, "Completion Rate", `=IFERROR(${countFormula({ status: '"Completed"' })}/${filteredOrderCount},0)`, { fill: colors.paleGreen, numberFormat: "0.0%", valueColor: colors.green });

setWidths(dashboard, { A: 90, B: 90, C: 90, D: 90, E: 90, F: 90, G: 90, H: 90, I: 90, J: 90, K: 18, L: 18, M: 100, N: 80, O: 18, P: 95, Q: 80, R: 18, S: 180, T: 110, U: 80, V: 125, W: 95, X: 80, Y: 115, Z: 80, AB: 120, AC: 120, AD: 220, AE: 120, AF: 120 });

dashboard.getRange("M2:N26").values = [["Month", "Orders"], ...monthSeries.map((m) => [m, null])];
dashboard.getRange("N3:N26").formulas = Array.from({ length: 24 }, (_, i) => [`=IF(AND($A$6<>"All",M${i + 3}<>$A$6),"",${countFormula({ month: `M${i + 3}` })})`]);
styleHeader(dashboard.getRange("M2:N2"));

dashboard.getRange("P2:Q4").values = [["Source", "Orders"], ["On Call", null], ["Dedicated", null]];
dashboard.getRange("Q3:Q4").formulas = [[`=IF(AND($C$6<>"All",$C$6<>P3),0,${countFormula({ type: "P3" })})`], [`=IF(AND($C$6<>"All",$C$6<>P4),0,${countFormula({ type: "P4" })})`]];
styleHeader(dashboard.getRange("P2:Q2"));

const activeTopCustomers = payload.summary.top_customers.map(([label]) => label);
dashboard.getRange("S2:U12").values = [["Full Customer", "Customer", "Orders"], ...activeTopCustomers.map((label) => [label, chartLabel(label, 12), null])];
dashboard.getRange("S3:S3").formulas = [[`=IF($E$6="All","${activeTopCustomers[0].replaceAll('"', '""')}",$E$6)`]];
dashboard.getRange("T3:T12").formulas = Array.from({ length: 10 }, (_, i) => [`=IF(S${i + 3}="","",IF(LEN(S${i + 3})>12,LEFT(S${i + 3},11)&"...",S${i + 3}))`]);
dashboard.getRange("U3:U12").formulas = Array.from({ length: 10 }, (_, i) => [`=IF(S${i + 3}="","",${countFormula({ customer: `S${i + 3}` })})`]);
styleHeader(dashboard.getRange("S2:U2"));

const activeTopTrucks = payload.summary.top_truck_types.map(([label]) => label);
dashboard.getRange("V2:X12").values = [["Full Truck Type", "Truck Type", "Orders"], ...activeTopTrucks.map((label) => [label, chartLabel(label, 12), null])];
dashboard.getRange("V3:V3").formulas = [[`=IF($G$6="All","${activeTopTrucks[0].replaceAll('"', '""')}",$G$6)`]];
dashboard.getRange("W3:W12").formulas = Array.from({ length: 10 }, (_, i) => [`=IF(V${i + 3}="","",IF(LEN(V${i + 3})>12,LEFT(V${i + 3},11)&"...",V${i + 3}))`]);
dashboard.getRange("X3:X12").formulas = Array.from({ length: 10 }, (_, i) => [`=IF(V${i + 3}="","",${countFormula({ truck: `V${i + 3}` })})`]);
styleHeader(dashboard.getRange("V2:X2"));

dashboard.getRange("Y2:Z6").values = [["Status", "Orders"], ["Confirmed", null], ["Completed", null], ["Open", null], ["In Transit", null]];
dashboard.getRange("Z3:Z6").formulas = Array.from({ length: 4 }, (_, i) => [`=${countFormula({ status: `Y${i + 3}` })}`]);
styleHeader(dashboard.getRange("Y2:Z2"));

dashboard.getRange("AB2:AF2").values = [["Month Filter", "Source Filter", "Customer Filter", "Truck Filter", "Status Filter"]];
styleHeader(dashboard.getRange("AB2:AF2"));
dashboard.getRange("AB3:AB63").values = padRows(["All", ...monthSeries], 61);
dashboard.getRange("AC3:AC20").values = padRows(["All", ...payload.summary.source_counts.map(([label]) => label)], 18);
dashboard.getRange("AD3:AD180").values = padRows(["All", ...Array.from(new Set(payload.orders.map((o) => o.customer).filter(Boolean))).sort()], 178);
dashboard.getRange("AE3:AE80").values = padRows(["All", ...Array.from(new Set(payload.orders.map((o) => o.truck_type).filter(Boolean))).sort()], 78);
dashboard.getRange("AF3:AF20").values = padRows(["All", "Confirmed", "Completed", "Open", "In Transit"], 18);

dashboard.getRange("A6").dataValidation = { rule: { type: "list", formula1: "Dashboard!$AB$3:$AB$63" } };
dashboard.getRange("C6").dataValidation = { rule: { type: "list", formula1: "Dashboard!$AC$3:$AC$20" } };
dashboard.getRange("E6").dataValidation = { rule: { type: "list", formula1: "Dashboard!$AD$3:$AD$180" } };
dashboard.getRange("G6").dataValidation = { rule: { type: "list", formula1: "Dashboard!$AE$3:$AE$80" } };
dashboard.getRange("I6").dataValidation = { rule: { type: "list", formula1: "Dashboard!$AF$3:$AF$20" } };

const monthlyChart = dashboard.charts.add("line", dashboard.getRange("M2:N26"));
monthlyChart.title = "Monthly Order Trend";
monthlyChart.hasLegend = false;
monthlyChart.xAxis = { axisType: "textAxis", tickLabelInterval: 2 };
monthlyChart.yAxis = { numberFormatCode: "#,##0" };
monthlyChart.setPosition("A16", "E32");

const sourceChart = dashboard.charts.add("bar", dashboard.getRange("P2:Q4"));
sourceChart.title = "Orders by Source";
sourceChart.hasLegend = false;
sourceChart.yAxis = { numberFormatCode: "#,##0" };
sourceChart.setPosition("F16", "J32");

const customerChart = dashboard.charts.add("bar", dashboard.getRange("T2:U12"));
customerChart.title = "Top Customers by Orders";
customerChart.hasLegend = false;
customerChart.yAxis = { numberFormatCode: "#,##0" };
customerChart.setPosition("A34", "E51");

const truckChart = dashboard.charts.add("bar", dashboard.getRange("W2:X12"));
truckChart.title = "Truck Type Mix";
truckChart.hasLegend = false;
truckChart.yAxis = { numberFormatCode: "#,##0" };
truckChart.setPosition("F34", "J51");

dashboard.getRange("M:AF").format.font = { color: "#666666", size: 9 };
dashboard.freezePanes.freezeRows(6);

const dashboardCheck = await workbook.inspect({
  kind: "table",
  range: "Dashboard!A1:J10",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 12,
});
console.log(dashboardCheck.ndjson);

const helperCheck = await workbook.inspect({
  kind: "table",
  range: "Dashboard!S2:X12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 6,
});
console.log(helperCheck.ndjson);

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

const previewRanges = {
  Dashboard: "A1:J56",
  Orders: "A1:AC30",
  "Fleet Assets": "A1:H30",
  "SLA Routes": "A1:D30",
  "Data Notes": "A1:D10",
};

for (const [sheetName, range] of Object.entries(previewRanges)) {
  const preview = await workbook.render({
    sheetName,
    range,
    scale: 1,
    format: "png",
  });
  await fs.writeFile(`${outputDir}/${sheetName.replaceAll(" ", "_").toLowerCase()}_preview.png`, new Uint8Array(await preview.arrayBuffer()));
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`Saved ${outputPath}`);
