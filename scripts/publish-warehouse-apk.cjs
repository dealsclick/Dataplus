const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const input = path.resolve(String(process.argv[2] || 'android/warehouse/app-release-signed.apk'))
const version = String(process.argv[3] || '2.0.0').trim()
if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
  console.error(`APK not found: ${input}`)
  process.exit(1)
}
const header = fs.readFileSync(input).subarray(0, 4)
if (header.toString('hex') !== '504b0304') {
  console.error('The selected file is not an Android APK/ZIP package.')
  process.exit(1)
}
const destinationDir = path.resolve('release-assets/warehouse')
const destination = path.join(destinationDir, 'dataplus-warehouse.apk')
fs.mkdirSync(destinationDir, { recursive: true })
fs.copyFileSync(input, destination)
const bytes = fs.readFileSync(destination)
const metadata = {
  version,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  publishedAt: new Date().toISOString(),
  sourceFile: path.basename(input),
}
fs.writeFileSync(path.join(destinationDir, 'dataplus-warehouse.json'), `${JSON.stringify(metadata, null, 2)}\n`)
console.log(JSON.stringify({ destination, ...metadata }, null, 2))
