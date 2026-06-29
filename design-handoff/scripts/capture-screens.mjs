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

const baseURL = process.env.TRIPPI_CAPTURE_BASE_URL || 'http://localhost:5173'
const backendPort = process.env.TRIPPI_CAPTURE_BACKEND_PORT || '3101'
const apiTarget = process.env.TRIPPI_API_TARGET || `http://localhost:${backendPort}`
const allowedOrigins = process.env.TRIPPI_CAPTURE_ALLOWED_ORIGINS
  || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://localhost:3101'
const email = process.env.TRIPPI_CAPTURE_EMAIL || 'admin@trippi.app'
const password = process.env.TRIPPI_CAPTURE_PASSWORD || 'admin12345'
const seededTripId = Number(process.env.TRIPPI_CAPTURE_TRIP_ID || 3)

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

async function dismissDemoBanner(page) {
  const banner = page.locator('div[style*="z-index: 99999"]').first()
  for (let i = 0; i < 4 && await banner.isVisible().catch(() => false); i++) {
    await banner.getByRole('button').last().click({ force: true, timeout: 2_000 }).catch(async () => {
      await page.mouse.click(20, 20).catch(() => {})
    })
    await page.waitForTimeout(350)
  }
}

async function clearBlockingOverlays(page) {
  await dismissDemoBanner(page)

  const presentationOverlay = page.locator('div[role="presentation"].fixed').first()
  for (let i = 0; i < 8 && await presentationOverlay.isVisible().catch(() => false); i++) {
    const primaryAction = presentationOverlay
      .getByRole('button', { name: /^(OK|Got it|Done|Close|Dismiss)$/i })
      .last()
    if (await primaryAction.isVisible().catch(() => false)) {
      await primaryAction.click({ force: true, timeout: 2_000 }).catch(() => {})
    } else {
      await page.keyboard.press('Escape').catch(() => {})
    }
    await page.waitForTimeout(350)
  }
}

async function waitForLeafletTiles(page) {
  await page.waitForFunction(
    () => {
      const tiles = Array.from(document.querySelectorAll('.leaflet-tile-loaded'))
      return tiles.some((tile) => {
        const img = tile
        return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
      })
    },
    null,
    { timeout: 45_000 }
  ).catch(() => {})
  await page.waitForTimeout(1200)
}

async function zoomPlannerMap(page, clicks = 3) {
  const zoomIn = page.locator('.leaflet-control-zoom-in').first()
  for (let i = 0; i < clicks; i++) {
    if (!await zoomIn.isVisible().catch(() => false)) return
    await zoomIn.click({ force: true, timeout: 2_000 }).catch(() => {})
    await waitForLeafletTiles(page)
  }
}

async function waitForHeroCover(page) {
  await page.waitForFunction(
    () => {
      const img = document.querySelector('.hero-trip img.bg')
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
    },
    null,
    { timeout: 30_000 }
  ).catch(() => {})
}

async function ensureNewYorkCover(page) {
  if (seededTripId !== 3) return
  await page.evaluate(async (tripId) => {
    const res = await fetch(`/api/trips/${tripId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cover_image: '/demo/new-york-cover.jpg' }),
    })
    if (!res.ok) throw new Error(`Failed to set New York cover: ${res.status} ${await res.text()}`)
  }, seededTripId)
}

async function screenshot(page, name, options = {}) {
  if (options.url) await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  if (options.waitFor) await page.locator(options.waitFor).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  if (options.waitForHeroCover) await waitForHeroCover(page)
  await clearBlockingOverlays(page)
  if (options.waitForMapTiles) await waitForLeafletTiles(page)
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

  const backend = spawnProcess('node', ['e2e/server-launch.mjs'], {
    cwd: clientDir,
    name: 'backend',
    env: {
      DEMO_MODE: 'true',
      DEMO_ADMIN_EMAIL: email,
      DEMO_ADMIN_PASS: password,
      DEMO_ADMIN_USER: 'admin',
      PORT: backendPort,
      ALLOWED_ORIGINS: allowedOrigins,
      TRIPPI_DISABLE_OVERLAYS: 'true',
    },
  })
  backend.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`Backend exited with ${code}`)
  })
  await waitForURL(`${apiTarget}/api/health`)

  const frontend = spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: clientDir,
    name: 'frontend',
    env: {
      TRIPPI_API_TARGET: apiTarget,
      VITE_TRIPPI_DISABLE_OVERLAYS: 'true',
    },
  })
  frontend.once('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`Frontend exited with ${code}`)
  })
  await waitForURL(baseURL)

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const manifest = {
    capturedAt: new Date().toISOString(),
    baseURL,
    seed: {
      mode: 'DEMO_MODE',
      email,
      tripId: seededTripId,
    },
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
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  await page.locator('.add-trip-card, .hero-trip').first().waitFor({ state: 'visible', timeout: 45_000 })

  await clearBlockingOverlays(page)
  await ensureNewYorkCover(page)

  const tokens = await extractTokens(page)
  await writeFile(path.join(tokensDir, 'runtime-tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`)

  await record('02-dashboard-demo-desktop', async () => {
    await screenshot(page, '02-dashboard-demo-desktop', {
      url: `${baseURL}/dashboard`,
      waitFor: '.hero-trip',
      waitForHeroCover: true,
    })
  })

  await page.goto(`${baseURL}/trips/${seededTripId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.leaflet-container').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  await clearBlockingOverlays(page)
  await waitForLeafletTiles(page)
  await zoomPlannerMap(page)
  const tripURL = page.url()

  await record('03-trip-planner-desktop', async () => {
    await clearBlockingOverlays(page)
    await waitForLeafletTiles(page)
    await page.screenshot({ path: path.join(screensDir, '03-trip-planner-desktop.png'), fullPage: true })
  })

  await record('04-trip-costs-desktop', async () => {
    await clearBlockingOverlays(page)
    await page.getByRole('button', { name: 'Costs' }).click()
    await page.getByText('Expenses').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
    await clearBlockingOverlays(page)
    await waitForLeafletTiles(page)
    await page.screenshot({ path: path.join(screensDir, '04-trip-costs-desktop.png'), fullPage: true })
  })

  await record('05-trip-files-desktop', async () => {
    await screenshot(page, '05-trip-files-desktop', { url: `${baseURL}/trips/${seededTripId}/files` })
  })

  await record('06-vacay-desktop', async () => {
    await screenshot(page, '06-vacay-desktop', { url: `${baseURL}/vacay`, waitFor: 'text=Vacay' })
  })

  await record('07-atlas-desktop', async () => {
    await screenshot(page, '07-atlas-desktop', { url: `${baseURL}/atlas`, waitFor: 'text=Search a country', waitForMapTiles: true })
  })

  await record('08-admin-desktop', async () => {
    await screenshot(page, '08-admin-desktop', { url: `${baseURL}/admin`, waitFor: 'text=Administration' })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await record('09-dashboard-mobile', async () => {
    await screenshot(page, '09-dashboard-mobile', {
      url: `${baseURL}/dashboard`,
      waitFor: '.hero-trip',
      waitForHeroCover: true,
    })
  })

  await record('10-trip-planner-mobile', async () => {
    await page.goto(tripURL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.locator('button[title="Plan"]').click({ timeout: 15_000 }).catch(() => {})
    await zoomPlannerMap(page, 2)
    await screenshot(page, '10-trip-planner-mobile', { waitFor: '.leaflet-container', waitForMapTiles: true })
  })

  await record('11-vacay-mobile', async () => {
    await screenshot(page, '11-vacay-mobile', { url: `${baseURL}/vacay`, waitFor: 'text=Vacay' })
  })

  await record('12-atlas-mobile', async () => {
    await screenshot(page, '12-atlas-mobile', { url: `${baseURL}/atlas`, waitFor: 'text=Search a country', waitForMapTiles: true })
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
