export function journalBalances(lines: { debit: string; credit: string }[], scale: number | undefined) {
  if (scale === undefined) return null
  const parse = (value: string) => {
    const raw = value.trim() || "0"
    if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error("Invalid amount")
    const [whole, fraction = ""] = raw.split(".")
    if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) throw new Error("Invalid precision")
    const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.slice(0, scale).padEnd(scale, "0") || "0")
    if (result > 1000000000000n) throw new Error("Amount too large")
    return result
  }
  try {
    let debit = 0n, credit = 0n
    let validLines = lines.length >= 2
    for (const line of lines) {
      const dr = parse(line.debit), cr = parse(line.credit)
      if ((dr > 0n) === (cr > 0n)) validLines = false
      debit += dr; credit += cr
    }
    return { debit: Number(debit), credit: Number(credit), balanced: validLines && debit === credit && debit > 0n }
  } catch { return null }
}
