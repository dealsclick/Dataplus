const assert = require("assert")
const fs = require("node:fs")
const path = require("node:path")
const { recordBatchLabelPdfSave, recordBatchLabelPrint, recordPrintJobCompletion, recordPrintJobPdfSave, recordShipmentLabelPrint } = require("../lib/fulfillment-print-audit")

const job = { id: "print-1", batchId: "batch-1", batchNumber: "BATCH-1001", printNumber: "PRINT-1001-001", activePrintAttemptId: "attempt-1", stationId: "station-1", stationName: "Packing desk", printerName: "Zebra" }
let completion = recordPrintJobCompletion(job, { printedBy: "Luis", destination: "desktop" }, new Date("2026-10-09T12:00:00Z"))
assert.equal(completion.recorded, true)
assert.equal(job.printCount, 1)
completion = recordPrintJobCompletion(job, { attemptId: "attempt-1", printedBy: "Luis" }, new Date("2026-10-09T12:00:01Z"))
assert.equal(completion.recorded, false)
assert.equal(job.printCount, 1)

const shipment = {}
let shipmentPrint = recordShipmentLabelPrint(shipment, job, "Luis")
assert.equal(shipmentPrint.firstPrint, true)
assert.equal(shipment.labelPrintCount, 1)
shipmentPrint = recordShipmentLabelPrint(shipment, job, "Luis")
assert.equal(shipmentPrint.recorded, false)
assert.equal(shipment.labelPrintCount, 1)

job.activePrintAttemptId = "attempt-2"
recordPrintJobCompletion(job, { printedBy: "Maria", destination: "browser", stationName: "Browser" }, new Date("2026-10-09T12:05:00Z"))
assert.equal(job.printHistory[0].stationName, "Browser")
assert.equal(job.printHistory[0].printerName, "")
shipmentPrint = recordShipmentLabelPrint(shipment, job, "Maria")
assert.equal(shipmentPrint.firstPrint, false)
assert.equal(shipment.labelPrintCount, 2)
assert.equal(shipment.labelLastPrintedBy, "Maria")
assert.equal(shipment.labelPrintHistory.length, 2)

const batch = { id: "batch-1" }
assert.equal(recordBatchLabelPrint(batch, job).recorded, true)
assert.equal(batch.labelPrintCount, 2)
assert.equal(recordBatchLabelPrint(batch, job).recorded, false)
assert.equal(batch.labelPrintCount, 2)

const pdfSave = recordPrintJobPdfSave(job, { saveId: "pdf-1", savedBy: "Luis" }, new Date("2026-10-09T12:10:00Z"))
assert.equal(pdfSave.recorded, true)
assert.equal(job.savedPdfCount, 1)
assert.equal(job.printCount, 2)
assert.equal(job.lastOutputAction, "saved_pdf")
assert.equal(recordPrintJobPdfSave(job, { saveId: "pdf-1", savedBy: "Luis" }).recorded, false)
assert.equal(job.savedPdfCount, 1)
assert.equal(recordBatchLabelPdfSave(batch, job).recorded, true)
assert.equal(batch.labelPdfSaveCount, 1)
assert.equal(batch.labelPrintCount, 2)
assert.equal(batch.lastOutputAction, "saved_pdf")

const appSource = ["App.tsx", "components/fulfillment-route.tsx"].map((file) => fs.readFileSync(path.join(__dirname, "..", "web", "src", ...file.split("/")), "utf8")).join("\n")
assert.doesNotMatch(appSource, /finishDirectBatchPrint|printBatchWithoutPreview/, "shipping batches must not bypass the print modal")
assert.match(appSource, /filteredPrintableBatchJobs\.map[\s\S]*openPrintPreview\(job\)/, "selecting a batch must open the print modal")
assert.match(appSource, /Warehouse batch status/, "the print modal must show the separate physical handling status")
assert.doesNotMatch(appSource, /Did the labels print successfully\?|browserPrintConfirmation|printConfirmationJob/, "browser printing must not show a redundant success-confirmation dialog")
assert.match(appSource, /const printInBrowser = async \(\) => \{[\s\S]*\/printed`/, "browser printing must record the document print action directly")

console.log("Fulfillment print audit tests passed.")
