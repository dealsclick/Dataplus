const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const project = path.join(root, 'android', 'warehouse')
const isWindows = process.platform === 'win32'
const gradle = path.join(project, isWindows ? 'gradlew.bat' : 'gradlew')
const userHome = os.homedir()

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || ''
}

function run(command, args, options = {}) {
  const batchFile = isWindows && /\.(?:bat|cmd)$/i.test(command)
  const commandLine = batchFile
    ? [command, ...args].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(' ')
    : command
  const result = spawnSync(commandLine, batchFile ? [] : args, {
    cwd: options.cwd || project,
    env: options.env || process.env,
    shell: batchFile,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function latestBuildTool(sdkRoot, executable) {
  const directory = path.join(sdkRoot, 'build-tools')
  if (!fs.existsSync(directory)) return ''
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map((version) => path.join(directory, version, executable))
    .find((candidate) => fs.existsSync(candidate)) || ''
}

const javaHome = firstExisting([
  process.env.JAVA_HOME,
  path.join(userHome, '.bubblewrap', 'jdk', 'jdk-17.0.11+9'),
])
const androidHome = firstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(userHome, '.bubblewrap', 'android_sdk'),
])

if (!javaHome) throw new Error('Set JAVA_HOME to JDK 17 or install the Bubblewrap JDK.')
if (!androidHome) throw new Error('Set ANDROID_HOME to an Android SDK with API 36 installed.')

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
}

run(gradle, ['assembleRelease'], { env })

const outputDirectory = path.join(project, 'app', 'build', 'outputs', 'apk', 'release')
const unsignedApk = path.join(outputDirectory, 'app-release-unsigned.apk')
if (!fs.existsSync(unsignedApk)) throw new Error(`Gradle did not create ${unsignedApk}`)

const keystore = path.resolve(process.env.WAREHOUSE_ANDROID_KEYSTORE || path.join(project, 'android.keystore'))
const storePasswordVariable = 'WAREHOUSE_ANDROID_KEYSTORE_PASSWORD'
const keyPasswordVariable = process.env.WAREHOUSE_ANDROID_KEY_PASSWORD
  ? 'WAREHOUSE_ANDROID_KEY_PASSWORD'
  : storePasswordVariable

if (!fs.existsSync(keystore) || !process.env[storePasswordVariable]) {
  console.log(`Unsigned release built: ${unsignedApk}`)
  console.log('Set WAREHOUSE_ANDROID_KEYSTORE_PASSWORD (and optionally WAREHOUSE_ANDROID_KEYSTORE) to create the update-ready signed APK.')
  process.exit(0)
}

const zipalign = latestBuildTool(androidHome, isWindows ? 'zipalign.exe' : 'zipalign')
const apksigner = latestBuildTool(androidHome, isWindows ? 'apksigner.bat' : 'apksigner')
if (!zipalign || !apksigner) throw new Error('Android build-tools must include zipalign and apksigner.')

const alignedApk = path.join(outputDirectory, 'app-release-aligned.apk')
const signedApk = path.join(project, 'app-release-signed.apk')
run(zipalign, ['-f', '-p', '4', unsignedApk, alignedApk], { env })
run(apksigner, [
  'sign',
  '--ks', keystore,
  '--ks-key-alias', process.env.WAREHOUSE_ANDROID_KEY_ALIAS || 'datapluswarehouse',
  '--ks-pass', `env:${storePasswordVariable}`,
  '--key-pass', `env:${keyPasswordVariable}`,
  '--out', signedApk,
  alignedApk,
], { env })
run(apksigner, ['verify', '--verbose', '--print-certs', signedApk], { env })
console.log(`Signed release built: ${signedApk}`)
