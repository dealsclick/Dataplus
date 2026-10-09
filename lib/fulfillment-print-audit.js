function text(value) {
  return String(value || "").trim()
}

function recordPrintJobCompletion(job = {}, detail = {}, now = new Date()) {
  const printedAt = now.toISOString()
  const attemptId = text(detail.attemptId || job.activePrintAttemptId) || `${text(job.id) || "print"}:${Number(job.printCount || 0) + 1}:${printedAt}`
  const history = Array.isArray(job.printHistory) ? job.printHistory : []
  const existing = history.find((entry) => text(entry.attemptId) === attemptId)
  if (existing) return { job, event: existing, recorded: false }
  const printedBy = text(detail.printedBy || detail.stationName || job.printedBy) || "DataPlus"
  const destination = text(detail.destination || (job.stationId ? "desktop" : "browser")) || "browser"
  const event = {
    attemptId,
    printedAt,
    printedBy,
    destination,
    stationId: destination === "browser" ? "" : text(detail.stationId || job.stationId),
    stationName: destination === "browser" ? "Browser" : text(detail.stationName || job.stationName) || "Warehouse print station",
    printerName: destination === "browser" ? "" : text(detail.printerName || job.printerName),
    printNumber: text(job.printNumber),
    batchId: text(job.batchId),
    batchNumber: text(job.batchNumber)
  }
  job.printHistory = [event, ...history].slice(0, 50)
  job.printCount = Number(job.printCount || 0) + 1
  job.printedAt = printedAt
  job.lastPrintedAt = printedAt
  job.printedBy = printedBy
  job.lastPrintedBy = printedBy
  job.lastPrintStation = event.stationName
  job.lastPrinterName = event.printerName
  job.lastPrintAttemptId = attemptId
  job.activePrintAttemptId = ""
  return { job, event, recorded: true }
}

function recordShipmentLabelPrint(shipment = {}, printJob = {}, actor = "Warehouse") {
  const printedAt = text(printJob.lastPrintedAt || printJob.printedAt) || new Date().toISOString()
  const attemptId = text(printJob.lastPrintAttemptId) || `${text(printJob.id) || "shipment"}:${Number(printJob.printCount || 1)}:${printedAt}`
  const history = Array.isArray(shipment.labelPrintHistory) ? shipment.labelPrintHistory : []
  const existing = history.find((entry) => text(entry.attemptId) === attemptId)
  if (existing) return { shipment, event: existing, recorded: false, firstPrint: false }
  const firstPrint = !text(shipment.labelPrintedAt)
  const baseline = Math.max(Number(shipment.labelPrintCount || 0), firstPrint ? 0 : 1, Math.max(0, Number(printJob.printCount || 1) - 1))
  const event = {
    attemptId,
    printedAt,
    printedBy: text(printJob.lastPrintedBy || printJob.printedBy || actor) || "Warehouse",
    destination: text(printJob.stationId ? "desktop" : "browser"),
    stationId: text(printJob.stationId),
    stationName: text(printJob.lastPrintStation || printJob.stationName) || (printJob.stationId ? "Warehouse print station" : "Browser"),
    printerName: text(printJob.lastPrinterName || printJob.printerName),
    printJobId: text(printJob.id),
    printNumber: text(printJob.printNumber),
    batchId: text(printJob.batchId),
    batchNumber: text(printJob.batchNumber)
  }
  shipment.labelPrintHistory = [event, ...history].slice(0, 50)
  shipment.labelPrintCount = baseline + 1
  shipment.labelPrintedAt = shipment.labelPrintedAt || printedAt
  shipment.labelPrintedBy = shipment.labelPrintedBy || event.printedBy
  shipment.labelLastPrintedAt = printedAt
  shipment.labelLastPrintedBy = event.printedBy
  shipment.labelLastPrintStation = event.stationName
  shipment.labelLastPrinterName = event.printerName
  return { shipment, event, recorded: true, firstPrint }
}

function recordBatchLabelPrint(batch = {}, printJob = {}) {
  if (!batch || !printJob?.batchId) return { batch, recorded: false }
  const event = (Array.isArray(printJob.printHistory) ? printJob.printHistory : [])[0]
  if (!event) return { batch, recorded: false }
  const history = Array.isArray(batch.labelPrintHistory) ? batch.labelPrintHistory : []
  if (history.some((entry) => text(entry.attemptId) === text(event.attemptId))) return { batch, recorded: false }
  batch.labelPrintHistory = [{ ...event }, ...history].slice(0, 50)
  batch.labelPrintCount = Math.max(Number(batch.labelPrintCount || 0) + 1, Number(printJob.printCount || 0))
  batch.labelLastPrintedAt = event.printedAt
  batch.labelLastPrintedBy = event.printedBy
  batch.labelLastPrintStation = event.stationName
  batch.labelLastPrinterName = event.printerName
  return { batch, recorded: true }
}

module.exports = { recordBatchLabelPrint, recordPrintJobCompletion, recordShipmentLabelPrint }
