import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const handoffDir = path.resolve(here, '..')
const repoRoot = path.resolve(handoffDir, '..')
const clientDir = path.join(repoRoot, 'client')
const screensDir = path.join(handoffDir, 'screens')
const tokensDir = path.join(handoffDir, 'tokens')

const baseURL = process.env.TRIPPI_CAPTURE_BASE_URL || 'http://127.0.0.1:5173'
const email = 'e2e@trippi.local'
const seedPassword = 'E2eTest12345!'
const changedPassword = 'E2eChanged12345!'

const children = []

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.stdio || 'pipe',
  })
  children.push(child)
  child.stdout?.on('data', (chunk) => process.stdout.write(`[${options.name || command}] ${chunk}`))
  child.stderr?.on('data', (chunk) => process.stderr.write(`[${options.name || command}] ${chunk}`))
  return child
}

async function waitForURL(url, timeoutMs = 180_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function stopChildren() {
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve()
    child.once('exit', resolve)
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      resolve()
    }, 5000).unref()
  })))
}

async function screenshot(page, name, options = {}) {
  if (options.url) await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  if (options.waitFor) await page.locator(options.waitFor).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(options.settleMs ?? 700)
  await page.screenshot({ path: path.join(screensDir, `${name}.png`), fullPage: true })
}

async function extractTokens(page) {
  return page.evaluate(() => {
    const readVars = () => {
      const styles = getComputedStyle(document.documentElement)
      const out = {}
      for (const name of [
        '--font-system',
        '--font-subtext',
        '--bg-primary',
        '--bg-secondary',
        '--bg-tertiary',
        '--bg-elevated',
        '--bg-card',
        '--bg-input',
        '--bg-hover',
        '--bg-selected',
        '--text-primary',
        '--text-secondary',
        '--text-muted',
        '--text-faint',
        '--border-primary',
        '--border-secondary',
        '--border-faint',
        '--accent',
        '--accent-text',
        '--nav-h',
        '--bottom-nav-h',
      ]) {
        out[name] = styles.getPropertyValue(name).trim()
      }
      return out
    }

    document.documentElement.classList.remove('dark')
    const light = readVars()
    document.documentElement.classList.add('dark')
    const dark = readVars()
    document.documentElement.classList.remove('dark')

    return {
      source: 'runtime getComputedStyle(document.documentElement)',
      capturedAt: new Date().toISOString(),
      fontFamily: getComputedStyle(document.body).fontFamily,
      light,
      dark,
    }
  })
}

async function main() {
  await rm(screensDir, { recursive: true, force: true })
  await mkdir(screensDir, { recursive: true })
  await mkdir(tokensDir, { recursive: true })

  const backend = spawnProcess('node', ['e2e/server-launch.mjs'], { cwd: clientDir, name: 'backend' })
  backend.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`Backend exited with ${code}`)
  })
  await waitForURL('http://localhost:3001/api/health')

  const frontend = spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], { cwd: clientDir, name: 'frontend' })
  frontend.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`Frontend exited with ${code}`)
  })
  await waitForURL(baseURL)

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const manifest = {
    capturedAt: new Date().toISOString(),
    baseURL,
    screens: [],
  }

  const record = async (name, fn) => {
    await fn()
    manifest.screens.push({ name, file: `screens/${name}.png` })
  }

  await record('01-login-desktop', async () => {
    await screenshot(page, '01-login-desktop', { url: `${baseURL}/login`, waitFor: 'input[type="email"]' })
  })

  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(seedPassword)
  await page.locator('button[type="submit"]').click()

  const passwords = page.locator('input[type="password"]')
  await Promise.race([
    page.locator('.add-trip-card').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => null),
    passwords.nth(1).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => null),
  ])

  if (await passwords.nth(1).isVisible().catch(() => false)) {
    await passwords.nth(0).fill(changedPassword)
    await passwords.nth(1).fill(changedPassword)
    await page.locator('button[type="submit"]').click()
  }

  await page.locator('.add-trip-card').waitFor({ state: 'visible', timeout: 45_000 })

  const ok = page.getByRole('button', { name: 'OK', exact: true })
  await ok.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  for (let i = 0; i < 8 && await ok.isVisible().catch(() => false); i++) {
    await ok.click()
    await page.waitForTimeout(400)
  }

  const tokens = await extractTokens(page)
  await writeFile(path.join(tokensDir, 'runtime-tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`)

  await record('02-dashboard-empty-desktop', async () => {
    await screenshot(page, '02-dashboard-empty-desktop', { url: `${baseURL}/dashboard`, waitFor: '.add-trip-card' })
  })

  const title = `Design Handoff ${Date.now()}`
  const createdTrip = await page.evaluate(async (tripTitle) => {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        title: tripTitle,
        description: 'Seeded trip for Figma design handoff captures.',
        start_date: '2026-07-01',
        end_date: '2026-07-05',
        currency: 'EUR',
        day_count: 5,
      }),
    })
    if (!res.ok) throw new Error(`Failed to create trip: ${res.status} ${await res.text()}`)
    return res.json()
  }, title)
  const tripId = createdTrip?.trip?.id
  if (!tripId) throw new Error(`Trip creation did not return trip.id: ${JSON.stringify(createdTrip)}`)

  await page.goto(`${baseURL}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.getByText(title).first().waitFor({ state: 'visible', timeout: 20_000 })

  await record('03-dashboard-with-trip-desktop', async () => {
    await page.screenshot({ path: path.join(screensDir, '03-dashboard-with-trip-desktop.png'), fullPage: true })
  })

  await page.goto(`${baseURL}/trips/${tripId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.leaflet-container').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  const tripURL = page.url()

  await record('04-trip-planner-desktop', async () => {
    await page.screenshot({ path: path.join(screensDir, '04-trip-planner-desktop.png'), fullPage: true })
  })

  await record('05-trip-files-desktop', async () => {
    await screenshot(page, '05-trip-files-desktop', { url: `${baseURL}/trips/${tripId}/files` })
  })

  await record('06-settings-desktop', async () => {
    await screenshot(page, '06-settings-desktop', { url: `${baseURL}/settings` })
  })

  await record('07-admin-desktop', async () => {
    await screenshot(page, '07-admin-desktop', { url: `${baseURL}/admin` })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await record('08-dashboard-mobile', async () => {
    await screenshot(page, '08-dashboard-mobile', { url: `${baseURL}/dashboard`, waitFor: '.add-trip-card' })
  })

  await record('09-trip-planner-mobile', async () => {
    await screenshot(page, '09-trip-planner-mobile', { url: tripURL, waitFor: '.leaflet-container' })
  })

  await writeFile(path.join(handoffDir, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await browser.close()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(stopChildren)
