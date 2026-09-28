import JsBarcode from "jsbarcode"

export type BinLabel = { code: string; name?: string; active?: boolean }
export const binLabelFormats = [
  { id: "full", name: "Full page — 8.5 × 11 in", width: 7.5, height: 10, margin: .5 },
  { id: "half", name: "Half page — 7.5 × 5 in", width: 7.5, height: 5, margin: .5 },
  { id: "quarter", name: "Quarter page — 3.75 × 5 in", width: 3.75, height: 5, margin: .5 },
  { id: "4x2", name: "Labels — 4 × 2 in", width: 4, height: 2, margin: .25 },
  { id: "2x1", name: "Labels — 2 × 1 in", width: 2, height: 1, margin: .25 },
  { id: "1.5x1", name: "Labels — 1.5 × 1 in", width: 1.5, height: 1, margin: .5 },
] as const
export type BinLabelLayout = { width: number; height: number; left: number; top: number; gapX: number; gapY: number }
export function binLabelGrid(layout: BinLabelLayout) {
  const { width, height, left, top, gapX, gapY } = layout
  if (![width, height, left, top, gapX, gapY].every(Number.isFinite) || width <= 0 || height <= 0 || Math.min(left, top, gapX, gapY) < 0) throw new Error("Enter valid dimensions and non-negative margins in inches.")
  const columns = Math.floor((8.5 - 2 * left + gapX + .00001) / (width + gapX))
  const rows = Math.floor((11 - 2 * top + gapY + .00001) / (height + gapY))
  if (columns < 1 || rows < 1) throw new Error("These labels and margins do not fit on an 8.5 × 11-inch sheet.")
  return { columns, rows, perPage: columns * rows }
}
const escape = (text: string) => text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!)
export function buildBinLabelDocument(bins: BinLabel[], warehouse: string, layout: BinLabelLayout, copies: number) {
  const grid = binLabelGrid(layout)
  if (!bins.length) throw new Error("Select at least one bin.")
  if (!Number.isInteger(copies) || copies < 1 || copies > 100 || bins.length * copies > 2000) throw new Error("Choose 1–100 copies per bin, up to 2,000 labels per print job.")
  const labels = bins.flatMap(bin => {
    if (!/^[\x20-\x7e]+$/.test(bin.code)) throw new Error(`Bin ${bin.code} needs an ASCII code to print a Code 128 barcode.`)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    JsBarcode(svg, bin.code, { format: "CODE128", width: 1, height: 60, displayValue: false, margin: 10, background: "#fff", lineColor: "#000" })
    const modules = parseFloat(svg.getAttribute("width") || "0")
    if ((layout.width - .16) / modules < .0075) throw new Error(`Bin ${bin.code} is too long for this label size. Choose a larger format for a readable barcode.`)
    svg.setAttribute("viewBox", `0 0 ${modules} ${parseFloat(svg.getAttribute("height") || "80")}`)
    svg.setAttribute("preserveAspectRatio", "none")
    svg.removeAttribute("width"); svg.removeAttribute("height")
    const label = `<section class="label"><div class="warehouse">${escape(warehouse)}</div><strong>${escape(bin.code)}</strong>${svg.outerHTML}${bin.name ? `<div class="name">${escape(bin.name)}</div>` : ""}</section>`
    return Array.from({ length: copies }, () => label)
  })
  const pages: string[] = []
  for (let i = 0; i < labels.length; i += grid.perPage) pages.push(`<main class="page">${labels.slice(i, i + grid.perPage).join("")}</main>`)
  const small = layout.height <= 1
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bin labels — ${escape(warehouse)}</title><style>
@page{size:letter portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#ddd;color:#000;font-family:Arial,sans-serif}.page{width:8.5in;height:11in;padding:${layout.top}in ${layout.left}in;display:grid;grid-template-columns:repeat(${grid.columns},${layout.width}in);grid-template-rows:repeat(${grid.rows},${layout.height}in);gap:${layout.gapY}in ${layout.gapX}in;background:white;margin:16px auto;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.label{width:${layout.width}in;height:${layout.height}in;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:.06in .08in;overflow:hidden;break-inside:avoid}.label strong{font-size:${small ? 11 : Math.min(42, layout.height * 12)}pt;line-height:1.1;max-width:100%;overflow-wrap:anywhere}.warehouse,.name{font-size:${small ? 6 : 10}pt;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label svg{display:block;width:100%;height:${small ? .48 : Math.min(layout.height * .5, 3)}in;flex-shrink:0}.toolbar{padding:16px;background:white;font:14px Arial}.toolbar button{padding:10px 18px;margin-right:16px}@media print{body{background:white}.page{margin:0}.toolbar{display:none}}
</style></head><body><div class="toolbar"><button onclick="window.print()">Print labels</button>Letter 8.5 × 11 in · Print at 100% / Actual size · Turn off headers and footers</div>${pages.join("")}</body></html>`
}
