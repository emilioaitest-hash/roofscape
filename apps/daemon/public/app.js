/**
 * The dashboard.
 *
 * Two screens: the skyline, and one building. Everything else is a panel inside
 * the second one. No framework — the whole thing is a few hundred lines against
 * a JSON API, and a build step for the page would mean the daemon could no
 * longer serve it straight off disk.
 *
 * The city is drawn by the daemon and arrives as SVG. This file never invents a
 * building; it puts the drawing on the screen, notices which one was clicked,
 * and turns work on and off inside it by toggling classes. Redrawing is for
 * when a building actually changes shape.
 */

// ── talking to the daemon ──────────────────────────────────────────────────

const params = new URLSearchParams(location.search)
const token = params.get('token') ?? sessionStorage.getItem('roofscape-token') ?? ''
if (params.get('token')) {
  sessionStorage.setItem('roofscape-token', params.get('token'))
  history.replaceState(null, '', location.pathname)
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? response.statusText)
  return body
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

// ── small helpers ──────────────────────────────────────────────────────────

const el = (id) => document.getElementById(id)
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`

function toast(text, kind = '') {
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = text
  el('toasts').append(node)
  setTimeout(() => node.remove(), 3600)
}

const oops = (error) => {
  toast(error.message, 'bad')
  say(`— ${error.message}`, 'bad')
}

function say(text, kind = '') {
  const feed = el('log')
  if (!feed) return
  const div = document.createElement('div')
  div.className = kind
  div.textContent = text
  feed.prepend(div)
  while (feed.childElementCount > 200) feed.lastElementChild.remove()
}

/** Ago, in the units a person would actually use. */
function ago(iso) {
  if (!iso) return ''
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

const tokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n ?? 0))

// ── where we are ───────────────────────────────────────────────────────────

const view = { screen: 'city', building: null, tab: 'floors' }
/** The last skyline we drew, so we know when it needs drawing again. */
let drawnShape = ''

function show(screen) {
  view.screen = screen
  el('screenCity').classList.toggle('hidden', screen !== 'city')
  el('screenBuilding').classList.toggle('hidden', screen !== 'building')
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function openBuilding(id) {
  view.building = id
  view.tab = 'floors'
  selectTab('floors')
  show('building')
  refreshBuilding().catch(oops)
}

function goHome() {
  view.building = null
  show('city')
  crumbs()
  refreshCity().catch(oops)
}

function crumbs() {
  el('crumbs').innerHTML =
    view.screen === 'building' && current
      ? `<span class="sep">/</span><span class="here">${esc(current.name)}</span>`
      : ''
}

// ── the skyline ────────────────────────────────────────────────────────────

let skyline = []

/** The size of the hole the drawing has to fill, in CSS pixels. */
function cityBox() {
  const frame = el('cityScroll').getBoundingClientRect()
  return {
    width: Math.max(760, Math.round(frame.width)),
    height: Math.max(320, Math.round(frame.height)),
  }
}

/**
 * What form each building was in last time we looked.
 *
 * Empty on first load on purpose: opening the app is not an occasion, and a
 * congratulation for something that happened last week is worse than silence.
 */
const knownForms = new Map()

async function refreshCity() {
  const box = cityBox()
  const { svg, buildings } = await api(`/api/skyline/city?width=${box.width}&height=${box.height}`)
  skyline = buildings

  const grew = []
  for (const building of buildings) {
    const was = knownForms.get(building.id)
    if (was !== undefined && was !== building.tier) grew.push({ ...building, was })
    knownForms.set(building.id, building.tier)
  }

  // Redraw only when the shape of the city changed. A goal starting is a class
  // toggle; a hire is a new storey and needs the daemon to draw it again.
  const shape = [box.width, box.height, ...buildings.map((b) => `${b.id}:${b.headcount}:${b.waiting}`)].join('|')
  if (shape !== drawnShape) {
    el('cityArt').innerHTML = svg
    drawnShape = shape
    wireCity()
  }
  paintCityState()
  paintTallies()
  for (const building of grew) itGrew(building)
  // Telling somebody to click a building when there are none is the sort of
  // small dishonesty that makes a first run feel unfinished.
  el('cityHint').textContent = buildings.length
    ? 'Click a building to go inside it.'
    : 'Nothing built yet. Break ground on the empty lot to start your first company.'
}

/**
 * Depth, on mouse move.
 *
 * The backdrop is anonymous city that exists so your buildings have somewhere to
 * stand. Moving it a little behind them — the far layer least, the near layer
 * most, the stars barely at all — is what turns a printed picture into a place
 * you are standing in front of. Your own buildings never move: they are the
 * content, and content that slides under the pointer is a toy.
 */
function wireParallax() {
  const frame = el('cityScroll')
  let queued = false
  let at = { x: 0, y: 0 }

  const apply = () => {
    queued = false
    const svg = frame.querySelector('svg')
    if (!svg) return
    const shift = (selector, amount) => {
      const layer = svg.querySelector(selector)
      if (layer) layer.style.transform = `translate(${(at.x * amount).toFixed(1)}px, ${(at.y * amount * 0.4).toFixed(1)}px)`
    }
    shift('.rs-stars', -6)
    shift('.rs-far', -16)
    shift('.rs-mid', -30)
  }

  frame.addEventListener('mousemove', (event) => {
    const box = frame.getBoundingClientRect()
    at = {
      x: (event.clientX - box.left) / box.width - 0.5,
      y: (event.clientY - box.top) / box.height - 0.5,
    }
    // One update per frame however fast the pointer moves.
    if (!queued) { queued = true; requestAnimationFrame(apply) }
  })

  // Settle back when the pointer leaves, rather than freezing mid-lean.
  frame.addEventListener('mouseleave', () => { at = { x: 0, y: 0 }; apply() })
}

/**
 * A building has changed form. This is the moment the ladder exists for.
 *
 * Watching a shack become a walk-up because the work justified two more hires
 * is, per decision 0009, most of the reason anybody comes back — and until now
 * it happened in a silent repaint you would only notice if you were staring at
 * the right part of the screen. So it gets a beat: the new building is scrolled
 * into view and lit, and it is said out loud what it has become.
 */
function itGrew(building) {
  const plot = el('cityArt').querySelector(`[data-building="${CSS.escape(building.id)}"]`)
  if (plot) {
    plot.classList.add('rs-grew')
    plot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    setTimeout(() => plot.classList.remove('rs-grew'), 2600)
  }
  const article = /^[aeiou]/i.test(building.tier) ? 'an' : 'a'
  toast(`${building.name} is ${article} ${building.tier} now.`, 'good')
}

function wireCity() {
  for (const plot of el('cityArt').querySelectorAll('[data-building]')) {
    const id = plot.getAttribute('data-building')
    plot.addEventListener('click', () => openBuilding(id))
    plot.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBuilding(id) }
    })
  }
  for (const lot of el('cityArt').querySelectorAll('[data-lot]')) {
    lot.addEventListener('click', breakGround)
    lot.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); breakGround() }
    })
  }
}

/**
 * Light the windows for work in hand, without asking for a new drawing.
 *
 * The daemon already drew every window and marked which floor each belongs to,
 * so starting a goal is a class change rather than a round trip and a repaint.
 */
function paintCityState() {
  for (const building of skyline) {
    const plot = el('cityArt').querySelector(`[data-building="${CSS.escape(building.id)}"]`)
    if (!plot) continue
    const floors = building.headcount || 1
    const firstLit = floors - Math.min(floors, building.working)
    for (const window of plot.querySelectorAll('.rs-w[data-floor]')) {
      const floor = Number(window.getAttribute('data-floor'))
      window.classList.toggle('rs-busy', floor >= firstLit && building.working > 0)
    }
  }
}

function paintTallies() {
  const staff = skyline.reduce((n, b) => n + b.headcount, 0)
  const inHand = skyline.reduce((n, b) => n + b.open, 0)
  const waiting = skyline.reduce((n, b) => n + b.pendingApprovals, 0)
  const tally = (label, value, kind = '') =>
    `<div class="${kind}"><dt>${label}</dt><dd>${value}</dd></div>`
  el('tallies').innerHTML =
    tally('Buildings', skyline.length) +
    tally('On staff', staff) +
    tally('In hand', inHand, inHand ? 'accent' : '') +
    tally('Waiting on you', waiting, waiting ? 'warn' : '')
}

// ── one building ───────────────────────────────────────────────────────────

let current = null

async function refreshBuilding() {
  if (!view.building) return
  const building = await api(`/api/buildings/${encodeURIComponent(view.building)}`)
  current = building
  crumbs()

  el('portrait').innerHTML = building.portrait
  el('bName').textContent = building.name
  el('bTier').textContent = building.tier
  el('bCharter').textContent = building.charter === building.name ? '' : building.charter

  const waiting = building.approvals.length
  const inHand = building.open.filter((t) => t.state === 'queued' || t.state === 'working').length
  el('bVitals').innerHTML = [
    vital(plural(building.headcount, 'floor'), 'on staff'),
    inHand ? vital(String(inHand), 'in hand', 'lit') : '',
    waiting ? vital(String(waiting), waiting === 1 ? 'waiting on you' : 'waiting on you', 'warn') : '',
    vital(tokens(building.spentThisMonth), 'tokens this month'),
    vital(String(building.archives.total), 'in the archives'),
  ].join('')

  el('goalGo').disabled = building.working
  el('goalGo').textContent = building.working ? 'Working…' : 'Send'
  el('goalText').disabled = building.working
  showWorking(building.working)

  // A badge counts what its tab actually contains, or it is a small lie you
  // notice the moment you click it. `inHand` is the narrower figure — queued
  // and working — and stays on the vitals pill beside the headcount, where it
  // is labelled.
  badge('badgeWork', building.open.length, 'quiet')
  badge('badgeDesk', waiting)

  paintCutaway(building)
  paintWork(building)
  paintApprovals(building)
  paintNextForm(building)
  await Promise.all([paintSchedules(), paintArchives(), paintMail()])
}

const vital = (value, label, kind = '') =>
  `<span class="vital ${kind}"><b>${esc(value)}</b><span>${esc(label)}</span></span>`

function badge(id, count, kind = '') {
  const node = el(id)
  node.className = `badge ${kind}`
  node.textContent = String(count)
  node.classList.toggle('hidden', count === 0)
}

/**
 * The building in section: one floor per agent, the manager on top, the lobby
 * at street level and the archives below it.
 *
 * This is the org chart, drawn as the thing it actually describes. A list of
 * names sorted by role would carry the same facts and none of the meaning.
 */
function paintCutaway(building) {
  // The order the store hands them back is already top-down, with the manager
  // forced to the front — it holds the top floor and rides up as the building
  // grows. Re-sorting by the stored level here put it in the basement, which is
  // the opposite of what the building means.
  const staff = building.staff
  const top = staff[0]

  const said = {
    working: 'working',
    next: 'next up',
    review: 'in review',
    blocked: 'blocked',
    idle: 'on a break',
  }

  const floors = staff.length
    ? staff
        .map(
          (floor, index) => `
      <div class="floor ${floor.state === 'working' ? 'is-working' : ''} ${floor === top ? 'top-floor' : ''}"
           data-floor="${esc(floor.id)}">
        <div class="floor-no">${staff.length - index}</div>
        <div class="floor-who">
          <div class="floor-name">${esc(floor.name)} <span class="cut-role">${esc(floor.role)}</span></div>
          ${floor.on
            ? `<div class="floor-on">${esc(clip(floor.on.goal, 78))}</div>`
            : `<div class="floor-model"><button type="button" data-repost="${esc(floor.id)}"
                 title="Move them to another model">${esc(floor.describes)}</button></div>`}
        </div>
        <div class="floor-right">
          <span class="state s-${esc(floor.state)}"><i></i>${esc(said[floor.state] ?? floor.state)}</span>
        </div>
      </div>`,
        )
        .join('')
    : `<div class="empty-floors">Nobody in it yet. Take somebody on and the building grows a storey.</div>`

  el('cutaway').innerHTML = `
    <div class="cut-roof"></div>
    ${floors}
    <div class="cut-band street">
      <div>
        <div class="cut-role">Lobby</div>
        <div class="cut-band-what">Where you walk in. The approval desk is here.</div>
      </div>
      ${building.approvals.length
        // Not `plural`: "waiting" is already the right word for any number of
        // them, and pluralising it produced "2 waitings".
        ? `<span class="pill warn">${building.approvals.length} waiting on you</span>`
        : ''}
    </div>
    <div class="cut-band below">
      <div>
        <div class="cut-role">Archives</div>
        <div class="cut-band-what">Everything it remembers. The curator works nights.</div>
      </div>
      <span class="pill">${plural(building.archives.total, 'note')}</span>
    </div>`

  for (const button of el('cutaway').querySelectorAll('[data-repost]')) {
    button.onclick = () => repost(button.getAttribute('data-repost'))
  }
}

function paintWork(building) {
  const open = building.open
  const state = { queued: 'queued', working: 'working', 'awaiting-review': 'in review', 'awaiting-approval': 'needs you', escalated: 'blocked' }
  const kind = { working: 'lit', escalated: 'bad' }

  el('workOpen').innerHTML = open.length
    ? open
        .map(
          (task) => `<div class="task ${task.state === 'working' ? 'is-working' : ''}">
            <div class="task-head">
              <div class="task-goal">${esc(task.goal)}</div>
              <span class="pill ${kind[task.state] ?? ''}">${esc(state[task.state] ?? task.state)}</span>
            </div>
            <div class="task-who">${who(building, task.assignedTo)} · ${ago(task.createdAt)}</div>
            ${
              // Every task carries how it will be judged, agreed before anybody
              // started — which is most of what stops a hand-off going in a
              // circle, and it was not on any screen.
              (task.acceptance ?? []).length
                ? `<ul class="task-accept">${task.acceptance
                    .map((line) => `<li>${esc(clip(line, 120))}</li>`)
                    .join('')}</ul>`
                : ''
            }
          </div>`,
        )
        .join('')
    : `<p class="empty">Nothing on. Put a goal to it and the manager will break it into work.</p>`

  el('workDone').innerHTML = building.recent.length
    ? building.recent
        .map((task) => {
          const branch = (task.result?.artifacts ?? []).find((a) => a.startsWith('branch:'))
          return `<div class="row"><div class="row-main">
            <div class="row-title">${esc(clip(task.goal, 62))}</div>
            <div class="row-sub">${who(building, task.assignedTo)} · ${ago(task.settledAt)}</div>
          </div><div class="row-right">
            ${branch ? `<span class="pill branch">${esc(branch.slice(7))}</span>` : ''}
            <span class="pill ${task.state === 'done' ? 'good' : 'bad'}">${esc(task.state)}</span>
          </div></div>`
        })
        .join('')
    : '<p class="empty">Nothing finished yet.</p>'
}

const who = (building, floorId) =>
  esc(building.staff.find((f) => f.id === floorId)?.name ?? 'somebody who has left')

/**
 * The approval desk, as a desk.
 *
 * Each of these is a docket somebody left for you, and the decision is the only
 * thing on the screen that cannot be undone — so it gets room, its own edge in
 * the colour that means *you*, and the two answers side by side rather than a
 * row you might click through by accident.
 */
function paintApprovals(building) {
  // What granting it actually does, said in the fewest ordinary words.
  const consequence = {
    hire: 'Somebody joins, and the building grows a storey.',
    publish: 'This leaves the building.',
    send: 'This goes to somebody outside.',
    deploy: 'This reaches the world.',
    spend: 'This costs money.',
    merge: 'This lands on main.',
  }

  el('approvals').innerHTML = building.approvals.length
    ? building.approvals
        .map(
          (approval) => `<div class="docket">
            <div class="docket-head">
              <span class="kind k-${esc(approval.kind)}">${esc(approval.kind)}</span>
              <span class="docket-when">${who(building, approval.requestedBy)} asked ${ago(approval.createdAt)}</span>
            </div>
            <p class="docket-intent">${esc(approval.intent)}</p>
            <p class="docket-if">${esc(consequence[approval.kind] ?? 'This reaches outside the building.')}</p>
            <div class="docket-answer">
              <button class="ghost" data-no="${esc(approval.id)}">Refuse</button>
              <button class="solid" data-yes="${esc(approval.id)}">Allow</button>
            </div>
          </div>`,
        )
        .join('')
    : `<div class="desk-clear">
         <p>The desk is clear.</p>
         <p class="dim">Anything that reaches outside the building — publishing, sending,
            deploying, spending, merging to main, hiring — stops here first.</p>
       </div>`

  for (const node of el('approvals').querySelectorAll('[data-yes]')) {
    node.onclick = () => decide(node.getAttribute('data-yes'), true)
  }
  for (const node of el('approvals').querySelectorAll('[data-no]')) {
    node.onclick = () => decide(node.getAttribute('data-no'), false)
  }
}

function paintNextForm(building) {
  el('nextForm').innerHTML = building.nextTierAt
    ? `Another ${plural(building.nextTierAt - building.headcount, 'hire')} and it changes form.`
    : 'It has taken every form there is.'
}

async function paintSchedules() {
  const { schedules } = await api('/api/schedules')
  const mine = schedules.filter((s) => s.building === view.building)
  el('schedules').innerHTML = mine.length
    ? mine
        .map(
          (order) => `<div class="order ${order.enabled ? '' : 'paused'}">
            <div class="order-main">
              <div class="order-goal">${esc(order.goal)}</div>
              <div class="order-when">${esc(order.reads)}${
                order.lastRunAt ? ` · last ran ${ago(order.lastRunAt)}` : ' · not run yet'
              }${order.enabled ? '' : ' · paused'}</div>
            </div>
            <div class="order-right">
              <button class="ghost" data-toggle="${esc(order.id)}">${order.enabled ? 'Pause' : 'Start'}</button>
              <button class="ghost" data-drop="${esc(order.id)}">Drop</button>
            </div>
          </div>`,
        )
        .join('')
    : `<div class="desk-clear">
         <p>Nothing recurring.</p>
         <p class="dim">A standing order runs whether or not anybody is watching — at 3am, on a
            machine you left on. Checked every thirty seconds, and caught up once rather than
            seven times after a laptop has been asleep.</p>
       </div>`

  for (const node of el('schedules').querySelectorAll('[data-toggle]')) {
    node.onclick = () => changeSchedule(node.getAttribute('data-toggle'), { enabled: node.textContent === 'Start' })
  }
  for (const node of el('schedules').querySelectorAll('[data-drop]')) {
    node.onclick = () => changeSchedule(node.getAttribute('data-drop'), { remove: true })
  }
}

async function paintArchives(query) {
  const path = `/api/buildings/${encodeURIComponent(view.building)}/archives${query ? `?q=${encodeURIComponent(query)}` : ''}`
  const { stats, notes } = await api(path)
  el('archives').innerHTML =
    `<div class="archive-shelf">
      <div class="archive-stats">
        <span><b>${stats.total}</b> notes</span>
        <span><b>${stats.pinned}</b> pinned</span>
        <span><b>${stats.expired}</b> expired</span>
      </div>` +
    (notes.length
      ? notes
          .slice(0, 20)
          .map((note) => `<div class="note-row"><span class="pill">${esc(note.layer)}</span><p>${esc(clip(note.text, 240))}</p></div>`)
          .join('')
      : `<p class="empty">${query ? 'Nothing found down here.' : 'Nothing written down yet. Agents record what turned out to be true as they work.'}</p>`) +
    '</div>'
}

// ── the mailroom ───────────────────────────────────────────────────────────

/**
 * The correspondence, drawn as a channel.
 *
 * It reads like chat and is not: every line is a typed, durable record with a
 * sender, a recipient and a kind, which is the whole of decision 0002. The kind
 * stays visible on every row so that never stops being obvious.
 */
async function paintMail() {
  if (!view.building) return
  const { messages, unread, staff } = await api(`/api/buildings/${encodeURIComponent(view.building)}/mail`)

  badge('badgeMail', unread.owner ?? 0)

  const stuck = el('thread').scrollTop + el('thread').clientHeight >= el('thread').scrollHeight - 40
  el('thread').innerHTML = messages.length
    ? messages
        .map((message) => {
          const owner = message.from.id === null
          return `<div class="post ${owner ? 'from-owner' : ''} ${!message.readAt && !owner ? 'unread' : ''}">
            <div class="post-who">${esc(initials(message.from.name))}</div>
            <div>
              <div class="post-top">
                <span class="post-name">${esc(message.from.name)}</span>
                <span class="kind k-${esc(message.kind)}">${esc(message.kind.replace('_', ' '))}</span>
                <span class="post-to">to ${esc(message.to.name)}</span>
                <span class="post-when">${ago(message.createdAt)}</span>
              </div>
              <div class="post-body">${esc(message.body)}</div>
            </div>
          </div>`
        })
        .join('')
    : `<p class="empty" style="padding:22px 16px">Nothing has been said yet. Write to somebody — it lands in their
       inbox and they read it the next time they are set to work.</p>`

  // Follow the conversation only if they were already at the bottom of it.
  if (stuck) el('thread').scrollTop = el('thread').scrollHeight

  const previous = el('mailTo').value
  el('mailTo').innerHTML = staff
    .map((floor) => `<option value="${esc(floor.id)}">${esc(floor.name)} — ${esc(floor.role)}</option>`)
    .join('')
  if (previous && staff.some((f) => f.id === previous)) el('mailTo').value = previous

  paintBridge()
}

const initials = (name) => {
  const words = String(name ?? '?').split(/[\s\-_]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

el('mailForm').onsubmit = async (event) => {
  event.preventDefault()
  const body = el('mailBody').value.trim()
  if (!body || !view.building) return
  el('mailBody').value = ''
  try {
    const sent = await post(`/api/buildings/${encodeURIComponent(view.building)}/mail`, {
      to: el('mailTo').value,
      body,
    })
    toast(`Left for ${sent.toName}.`, 'good')
    await paintMail()
    el('thread').scrollTop = el('thread').scrollHeight
  } catch (error) { oops(error) }
}

// ── where the models come from ─────────────────────────────────────────────

/**
 * Every provider and whether it can actually answer.
 *
 * The daemon probes rather than guesses — "needs no key" and "is running" are
 * different claims — so this shows what is genuinely reachable right now, and
 * the exact thing to type for the ones that are not.
 */
async function paintProviders() {
  el('providerList').innerHTML = '<p class="empty">Asking each of them…</p>'
  try {
    const { providers, claudeCode } = await api('/api/providers')
    el('providerList').innerHTML =
      (claudeCode
        ? `<p class="dim pane-sub">Claude Code is installed, so Anthropic can be reached on your
             subscription rather than metered billing.</p>`
        : '') +
      providers
        .map(
          (p) => `<div class="provider ${p.status.ok ? 'ok' : ''}">
            <span class="lamp"></span>
            <div>
              <div class="provider-name">${esc(p.label)}</div>
              <div class="provider-why">${esc(p.status.ok ? (p.note ?? 'Reachable.') : (p.status.reason ?? 'Not set up.'))}</div>
              ${p.status.ok || !p.status.remedy ? '' : `<div class="provider-fix">${esc(p.status.remedy)}</div>`}
            </div>
            <div class="provider-models">${(p.suggested ?? []).slice(0, 3).map(esc).join('<br>')}</div>
          </div>`,
        )
        .join('')
  } catch (error) {
    el('providerList').innerHTML = `<p class="empty">${esc(error.message)}</p>`
  }
}

el('openSettings').onclick = () => {
  el('settingsDialog').showModal()
  paintProviders().catch(oops)
}
el('settingsRefresh').onclick = () => paintProviders().catch(oops)

// ── the Discord bridge ─────────────────────────────────────────────────────

let bridge = null

/**
 * How the post is getting out, shown where the post is.
 *
 * The state is the daemon's, not the page's: a gateway that keeps dropping
 * should say so here rather than looking connected because the settings are
 * filled in.
 */
async function paintBridge() {
  try {
    bridge = await api('/api/bridge')
  } catch {
    el('mailBridge').innerHTML = ''
    return
  }
  const wired = bridge.wired.find((w) => w.building === view.building)
  const live = bridge.status.state === 'live' && wired
  const said =
    !bridge.connected ? 'Discord not set up'
    : !wired ? 'not wired to a channel'
    : bridge.status.state === 'live' ? `carried to Discord${bridge.status.as ? ` as ${bridge.status.as}` : ''}`
    : bridge.status.state === 'refused' ? 'Discord refused the token'
    : bridge.status.detail ?? bridge.status.state

  el('mailBridge').className = `mail-bridge ${live ? 'on' : ''}`
  el('mailBridge').innerHTML =
    `<span class="dot"></span><span>${esc(said)}</span>
     <button class="ghost" id="bridgeOpen" type="button">${wired ? 'Change' : 'Connect Discord'}</button>`
  el('bridgeOpen').onclick = openBridge
}

async function openBridge() {
  el('dToken').value = ''
  el('dTokenNote').textContent = bridge?.token ? `Currently ${bridge.token}. Leave blank to keep it.` : 'Not set yet.'
  el('dMirrorAll').checked = Boolean(bridge?.mirrorAll)
  el('dAuthors').value = (bridge?.allowedAuthors ?? []).join(', ')
  el('bridgeDialog').showModal()
  await loadPlaces()
}

/** Ask Discord what the bot can see, so nobody has to hunt for an id. */
async function loadPlaces() {
  el('dPlacesNote').textContent = 'Asking Discord…'
  try {
    const places = await api('/api/bridge/places')
    el('dGuild').innerHTML = places.guilds
      .map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`)
      .join('')
    if (places.guild) el('dGuild').value = places.guild
    el('dChannel').innerHTML = places.channels
      .map((c) => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`)
      .join('')
    const wired = bridge?.wired.find((w) => w.building === view.building)
    if (wired) el('dChannel').value = wired.channel
    el('dPlacesNote').textContent = places.channels.length
      ? 'Pick the channel this building should use.'
      : 'That server has no text channel the bot can see.'
  } catch (error) {
    el('dGuild').innerHTML = ''
    el('dChannel').innerHTML = ''
    el('dPlacesNote').textContent = error.message
  }
}

el('dGuild').onchange = async () => {
  try {
    await post('/api/bridge', { guild: el('dGuild').value })
    await loadPlaces()
  } catch (error) { oops(error) }
}

el('dCancel').onclick = () => el('bridgeDialog').close()

el('dUnwire').onclick = async () => {
  try {
    await post('/api/bridge', { wire: { building: view.building, channel: null } })
    el('bridgeDialog').close()
    toast('Disconnected from Discord.')
    await paintBridge()
  } catch (error) { oops(error) }
}

el('bridgeForm').onsubmit = async (event) => {
  event.preventDefault()
  const typed = el('dToken').value.trim()
  const body = {
    mirrorAll: el('dMirrorAll').checked,
    enabled: true,
    allowedAuthors: el('dAuthors').value.split(/[\s,]+/).filter(Boolean),
  }
  if (typed) {
    // "env:NAME" keeps the secret out of the database, the same way a provider
    // credential can.
    const asEnv = typed.startsWith('env:')
    body.token = asEnv ? typed.slice(4).trim() : typed
    body.tokenKind = asEnv ? 'env' : 'literal'
  }
  if (el('dGuild').value) body.guild = el('dGuild').value
  if (el('dChannel').value) body.wire = { building: view.building, channel: el('dChannel').value }

  try {
    await post('/api/bridge', body)
    el('bridgeDialog').close()
    el('dToken').value = ''
    toast('Saved. Connecting to Discord…', 'good')
    setTimeout(() => paintBridge().catch(() => {}), 1500)
  } catch (error) { oops(error) }
}

/**
 * That something is happening, said where you are looking.
 *
 * A goal takes minutes and the only sign of it used to be a greyed-out button
 * and a feed at the bottom of another tab. This is the one thing on the screen
 * that is genuinely live, so it gets the lamp — the same amber as a lit window,
 * because it means the same thing.
 */
/**
 * When the goal we are watching started — or null, if we did not see it start.
 *
 * The daemon does not report when the current goal began, so opening the page
 * midway through one would have counted from the moment you arrived and called
 * it "so far". A blank is honest; a confident wrong number is not.
 */
let workingSince = null

function showWorking(on) {
  el('working').classList.toggle('hidden', !on)
  if (!on) {
    workingSince = null
    el('workingLine').textContent = 'Working…'
  }
  tickWorking()
}

function tickWorking() {
  if (workingSince === null) {
    el('workingSince').textContent = ''
    return
  }
  const seconds = Math.round((Date.now() - workingSince) / 1000)
  el('workingSince').textContent =
    seconds < 60 ? `${seconds}s so far` : `${Math.floor(seconds / 60)}m ${seconds % 60}s so far`
}
setInterval(tickWorking, 1000)

// ── things you can do ──────────────────────────────────────────────────────

async function decide(id, granted) {
  try {
    const result = await post(`/api/approvals/${encodeURIComponent(id)}`, { granted })
    toast(result.hired ? `${result.hired.name} joins.` : granted ? 'Approved.' : 'Refused.', granted ? 'good' : '')
    await refreshBuilding()
    drawnShape = ''
  } catch (error) { oops(error) }
}

async function changeSchedule(id, body) {
  try {
    await post(`/api/schedules/${encodeURIComponent(id)}`, body)
    toast(body.remove ? 'Dropped.' : body.enabled ? 'Started.' : 'Paused.')
    await paintSchedules()
  } catch (error) { oops(error) }
}

/** Which floor the posting dialog is about, and what it can be moved to. */
let moving = { floorId: null, providers: [] }

async function repost(floorId) {
  const floor = current?.staff.find((f) => f.id === floorId)
  moving = { floorId, providers: [] }
  el('postingWho').textContent = floor ? `Move ${floor.name} to another model` : 'Move somebody'
  el('pProvider').innerHTML = '<option>Looking…</option>'
  el('pModel').value = ''
  el('pNote').textContent = ''
  el('postingDialog').showModal()

  try {
    const { providers, claudeCode } = await api('/api/providers')
    moving.providers = providers
    // Reachable first, and the rest still listed — somebody may be about to set
    // one up, and hiding it makes the app look like it has fewer options.
    const sorted = [...providers].sort((a, b) => Number(b.status.ok) - Number(a.status.ok))
    el('pProvider').innerHTML = sorted
      .map((p) => `<option value="${esc(p.name)}"${p.status.ok ? '' : ' data-cold="1"'}>${esc(p.label)}${p.status.ok ? '' : ' — not set up'}</option>`)
      .join('')
    if (floor) {
      const currentProvider = sorted.find((p) => p.name === floor.posting.provider)
      if (currentProvider) el('pProvider').value = currentProvider.name
      el('pModel').value = floor.posting.model ?? ''
    }
    el('pNote').dataset.claudeCode = String(Boolean(claudeCode))
    paintModels()
  } catch (error) {
    el('pProvider').innerHTML = ''
    el('pNote').textContent = error.message
  }
}

/** Suggestions for the chosen provider, and whether it can answer at all. */
function paintModels() {
  const spec = moving.providers.find((p) => p.name === el('pProvider').value)
  el('pModels').innerHTML = (spec?.suggested ?? [])
    .map((m) => `<option value="${esc(m)}"></option>`)
    .join('')
  if (!el('pModel').value && spec?.suggested?.[0]) el('pModel').value = spec.suggested[0]

  const viaClaudeCode = spec?.name === 'anthropic' && el('pNote').dataset.claudeCode === 'true'
  el('pNote').textContent = !spec
    ? ''
    : !spec.status.ok
      ? `${spec.label} is not reachable yet — ${spec.note ?? 'no credential set up'}.`
      : viaClaudeCode
        ? 'Runs through your Claude Code install, so it draws on that subscription rather than metered billing.'
        : spec.note ?? ''
}

el('pProvider').onchange = () => { el('pModel').value = ''; paintModels() }
el('pCancel').onclick = () => el('postingDialog').close()

el('postingForm').onsubmit = async (event) => {
  event.preventDefault()
  const provider = el('pProvider').value
  const model = el('pModel').value.trim()
  if (!provider || !model || !moving.floorId) return
  const spec = moving.providers.find((p) => p.name === provider)
  try {
    await post(
      `/api/buildings/${encodeURIComponent(view.building)}/floors/${encodeURIComponent(moving.floorId)}/posting`,
      // The daemon refuses claude-agent-sdk when Claude Code is not installed,
      // so asking for it is safe: the worst case is an ordinary direct call.
      { provider, model, engine: provider === 'anthropic' ? 'claude-agent-sdk' : 'direct' },
    )
    el('postingDialog').close()
    toast(`Moved to ${spec?.label ?? provider}.`, 'good')
    await refreshBuilding()
  } catch (error) { oops(error) }
}

function breakGround() {
  el('groundDialog').showModal()
  el('gName').focus()
}

// ── wiring ─────────────────────────────────────────────────────────────────

el('goHome').onclick = goHome

// Escape steps back outside. Not while a dialog is open — that is the dialog's.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (document.querySelector('dialog[open]')) return
  if (view.screen === 'building') goHome()
})

function selectTab(name) {
  view.tab = name
  // Opening your post is reading it.
  if (name === 'mail' && view.building) {
    post(`/api/buildings/${encodeURIComponent(view.building)}/mail/read`)
      .then(() => badge('badgeMail', 0))
      .catch(() => {})
  }
  for (const tab of el('tabs').querySelectorAll('.tab')) {
    tab.classList.toggle('on', tab.dataset.tab === name)
  }
  for (const pane of document.querySelectorAll('.pane')) {
    pane.classList.toggle('hidden', pane.dataset.pane !== name)
  }
}
for (const tab of el('tabs').querySelectorAll('.tab')) {
  tab.onclick = () => selectTab(tab.dataset.tab)
}

el('groundCancel').onclick = () => el('groundDialog').close()
el('groundForm').onsubmit = async (event) => {
  event.preventDefault()
  try {
    const building = await post('/api/buildings', {
      name: el('gName').value.trim(),
      workspace: el('gPath').value.trim(),
      charter: el('gCharter').value.trim() || undefined,
    })
    el('groundDialog').close()
    el('groundForm').reset()
    if (building.warning) toast(building.warning, 'bad')
    else toast(`${building.name} — ground broken.`, 'good')
    drawnShape = ''
    await refreshCity()
    openBuilding(building.id)
  } catch (error) { oops(error) }
}

el('hireForm').onsubmit = async (event) => {
  event.preventDefault()
  try {
    const floor = await post(`/api/buildings/${encodeURIComponent(view.building)}/hire`, {
      role: el('hRole').value,
      name: el('hName').value.trim() || undefined,
    })
    el('hName').value = ''
    toast(`${floor.name} joins as ${floor.role}.`, 'good')
    drawnShape = ''
    await refreshBuilding()
  } catch (error) { oops(error) }
}

el('goalForm').onsubmit = async (event) => {
  event.preventDefault()
  const goal = el('goalText').value.trim()
  if (!goal || !view.building) return
  el('goalText').value = ''
  selectTab('work')
  try {
    await post(`/api/buildings/${encodeURIComponent(view.building)}/goal`, { goal })
  } catch (error) { oops(error) }
}

/**
 * What the concierge is doing while you wait.
 *
 * It reads buildings one at a time and can take a while. An input that greys
 * out and says nothing for twenty seconds looks broken; naming each building as
 * it is opened is both honest and the most interesting part — you can see it
 * has no idea what is in there until it looks.
 */
let looking = []

el('askForm').onsubmit = async (event) => {
  event.preventDefault()
  const question = el('askText').value.trim()
  if (!question) return

  looking = []
  el('askGo').disabled = true
  el('askGo').textContent = 'Looking…'
  el('answer').classList.remove('hidden')
  el('answer').innerHTML = `<p class="asked">${esc(question)}</p>
    <p class="answering"><span class="spin"></span>Reading the skyline…</p>`

  try {
    const result = await post('/api/ask', { question })
    el('answer').innerHTML =
      `<p class="asked">${esc(question)}</p>
       <div class="said">${esc(result.answer)}</div>` +
      (result.toolsUsed?.length
        ? `<p class="consulted">Looked at ${result.toolsUsed.map(esc).join(', ')} ·
             ${tokens(result.tokensSpent ?? 0)} tokens</p>`
        : '')
    el('askText').value = ''
  } catch (error) {
    el('answer').innerHTML = `<p class="asked">${esc(question)}</p>
      <div class="said bad">${esc(error.message)}</div>`
    toast(error.message, 'bad')
  } finally {
    el('askGo').disabled = false
    el('askGo').textContent = 'Ask'
  }
}

el('showSchedule').onclick = () => el('scheduleForm').classList.toggle('hidden')

el('scheduleForm').onsubmit = async (event) => {
  event.preventDefault()
  try {
    await post(`/api/buildings/${encodeURIComponent(view.building)}/schedules`, {
      goal: el('sGoal').value.trim(),
      every: el('sEvery').value.trim() || 'daily',
      at: el('sAt').value.trim() || undefined,
    })
    el('sGoal').value = ''
    el('scheduleForm').classList.add('hidden')
    toast('Standing order set.', 'good')
    await paintSchedules()
  } catch (error) { oops(error) }
}

el('searchForm').onsubmit = (event) => {
  event.preventDefault()
  paintArchives(el('searchText').value.trim() || undefined).catch(oops)
}

el('curateGo').onclick = async () => {
  const button = el('curateGo')
  button.disabled = true
  button.textContent = 'Reading…'
  try {
    const result = await post(`/api/buildings/${encodeURIComponent(view.building)}/curate`)
    toast(`${result.before} notes → ${result.after}.`, 'good')
  } catch (error) {
    oops(error)
  } finally {
    button.disabled = false
    button.textContent = 'Send the curator down'
    paintArchives().catch(oops)
  }
}

api('/api/roles')
  .then(({ roles }) => {
    el('hRole').innerHTML = roles
      .map((role) => `<option value="${esc(role.role)}">${esc(role.role)} — ${esc(role.summary)}</option>`)
      .join('')
  })
  .catch(oops)

// ── the live stream ────────────────────────────────────────────────────────

const LOUD = new Set(['goal-started', 'goal-finished', 'hired', 'ground-broken', 'curated', 'decided'])
/** Events that mean the drawing itself is now wrong, not just the numbers. */
const RESHAPES = new Set(['hired', 'ground-broken'])

const stream = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
stream.onopen = () => { el('live').className = 'live on'; el('live').lastElementChild.textContent = 'live' }
stream.onerror = () => { el('live').className = 'live off'; el('live').lastElementChild.textContent = 'reconnecting' }

stream.onmessage = (message) => {
  const event = JSON.parse(message.data)

  if (event.kind === 'tool') say(`  · ${event.detail}`, 'tool')
  else say(`${event.kind}${event.detail ? `: ${event.detail}` : ''}`,
           event.kind === 'goal-failed' ? 'bad' : LOUD.has(event.kind) ? 'hi' : 'lit')

  // The concierge says what it is opening as it goes.
  if (event.kind === 'looking' && el('askGo').disabled) {
    const step = String(event.detail ?? '').replace(/_/g, ' ')
    if (step && looking.at(-1) !== step) looking.push(step)
    const line = el('answer').querySelector('.answering')
    if (line) line.innerHTML = `<span class="spin"></span>${esc(looking.slice(-3).join(' · '))}`
  }

  if (event.kind === 'goal-finished') toast('Finished.', 'good')
  if (event.kind === 'goal-failed') toast(event.detail ?? 'That goal failed.', 'bad')
  if (event.kind === 'asked') toast('Something needs your say-so.')

  // What the building is doing right now, in its own words.
  if (view.screen === 'building' && event.building === view.building) {
    if (event.kind === 'progress' || event.kind === 'step') {
      el('workingLine').textContent = clip(event.detail ?? 'Working…', 90)
    }
    if (event.kind === 'tool') el('workingLine').textContent = `Using ${clip(event.detail ?? '', 40)}`
    // Seeing it start is the only way we can honestly count from it.
    if (event.kind === 'goal-started') { workingSince = Date.now(); showWorking(true) }
    if (event.kind === 'goal-finished' || event.kind === 'goal-failed') showWorking(false)
  }

  if (event.kind === 'posted' && view.screen === 'building') paintMail().catch(() => {})
  if (event.kind === 'bridge' || event.kind === 'bridge-changed') paintBridge().catch(() => {})
  if (RESHAPES.has(event.kind)) drawnShape = ''
  // Tool chatter arrives many times a second; refreshing on it would mean a
  // request per tool call and a page that never settles.
  if (event.kind === 'tool' || event.kind === 'step') return

  if (view.screen === 'city') refreshCity().catch(() => {})
  else if (!event.building || event.building === view.building) refreshBuilding().catch(() => {})
}

// A resized window is a differently-shaped hole, and the drawing was cut to fit
// the old one. Debounced: a drag fires this a hundred times.
let resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (view.screen === 'city') refreshCity().catch(() => {})
  }, 220)
})

// A slow poll behind the stream, because a dropped connection should not leave
// the numbers frozen until somebody clicks something.
setInterval(() => {
  if (document.hidden) return
  if (view.screen === 'city') refreshCity().catch(() => {})
  else refreshBuilding().catch(() => {})
}, 25000)

// ── updates, when this page is inside the desktop app ──────────────────────

const desktop = window.roofscape
if (desktop) {
  const button = el('update')
  const offer = (text, enabled) => {
    button.textContent = text
    button.disabled = !enabled
    button.classList.remove('hidden')
  }
  // What the button does depends on what this platform can actually do.
  let act = () => desktop.restartToUpdate()

  desktop.onUpdate((state) => {
    if (state.phase === 'ready') {
      act = () => desktop.restartToUpdate()
      offer(`Restart to update to ${state.version}`, true)
    } else if (state.phase === 'manual') {
      // macOS, until these builds carry a real certificate: Squirrel will not
      // install an update whose signature it cannot verify, so offering a
      // restart here would be offering something that fails. Offer the download.
      act = () => desktop.openDownload?.()
      offer(`Version ${state.version} is out — get it`, true)
    } else if (state.phase === 'downloading') {
      offer(`Downloading update… ${state.percent ?? 0}%`, false)
    } else if (state.phase === 'available') {
      offer('Update found…', false)
    } else {
      button.classList.add('hidden')
    }
  })
  // Downloading happens on its own; the restart is the only part that is ours
  // to choose, because nothing should be replaced under somebody mid-goal.
  button.onclick = () => { if (!button.disabled) act() }
}

wireParallax()
goHome()
