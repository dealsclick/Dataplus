const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8')
const start = source.indexOf('function warehouseApkMetadata()')
const end = source.indexOf('\nfunction ', start + 1)
assert.ok(start > 0 && end > start, 'warehouseApkMetadata helper must exist')

function metadataWith({ apk = false, release = null } = {}) {
  const apkPath = path.resolve('release-assets/warehouse/dataplus-warehouse.apk')
  const releasePath = path.resolve('release-assets/warehouse/dataplus-warehouse.json')
  const fakeFs = {
    existsSync(file) {
      if (path.resolve(file) === apkPath) return apk
      if (path.resolve(file) === releasePath) return release !== null
      return false
    },
    statSync(file) {
      assert.equal(path.resolve(file), apkPath)
      return { isFile: () => true, size: 1039222, mtime: new Date('2026-11-24T21:43:00-05:00') }
    },
    readFileSync(file) {
      assert.equal(path.resolve(file), releasePath)
      return JSON.stringify(release)
    },
  }
  const fn = vm.runInNewContext(`(${source.slice(start, end)})`, {
    fs: fakeFs,
    path,
    process: { env: {} },
    WAREHOUSE_APK_FILE: apkPath,
  })
  return fn()
}

const missing = metadataWith()
assert.equal(missing.available, false)
assert.equal(missing.downloadUrl, '/api/mobile/warehouse-apk')

const available = metadataWith({ apk: true, release: { version: '1.0.0', sha256: 'abc123', publishedAt: '2026-11-25T02:44:33.751Z' } })
assert.equal(available.available, true)
assert.equal(available.version, '1.0.0')
assert.equal(available.bytes, 1039222)
assert.equal(available.sha256, 'abc123')

assert.ok(source.includes('if (/^\\/api\\/mobile\\/warehouse-apk(?:\\/|$)/.test(pathname)) return "warehouse";'))
assert.match(source, /url\.pathname === "\/api\/mobile\/warehouse-apk\/status"/)
assert.match(source, /"Content-Type": "application\/vnd\.android\.package-archive"/)
assert.ok(source.indexOf('const authUser = currentAuthUser') < source.indexOf('url.pathname === "/api/mobile/warehouse-apk/status"'), 'APK routes must stay behind authentication')

const appSource = fs.readFileSync(path.join(__dirname, '../web/src/App.tsx'), 'utf8')
assert.match(appSource, /function WarehouseApkInstallMenuItem\(\)/)
assert.match(appSource, /Install Warehouse APK/)

const warehouseUi = fs.readFileSync(path.join(__dirname, '../web/src/components/warehouse-mobile.tsx'), 'utf8')
assert.match(warehouseUi, /warehouse\.webmanifest/)
assert.match(warehouseUi, /Offline — scans and updates cannot be saved/)

const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8')
assert.match(dockerfile, /COPY release-assets \.\/release-assets/)

const assetLinks = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/public/.well-known/assetlinks.json'), 'utf8'))
assert.equal(assetLinks[0].target.package_name, 'com.dataplus.warehouse')
assert.match(assetLinks[0].target.sha256_cert_fingerprints[0], /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/)

console.log('Warehouse APK metadata, authenticated download route, install menu, mobile status UI, deployment asset, and Digital Asset Links checks passed.')
