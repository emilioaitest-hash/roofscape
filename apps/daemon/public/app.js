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

async function refreshCity() {
  const box = cityBox()
  const { svg, buildings } = await api(`/api/skyline/city?width=${box.width}&height=${box.height}`)
  skyline = buildings

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
  el('cityHint').classList.toggle('hidden', buildings.length === 0)
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

  badge('badgeWork', inHand, 'quiet')
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
          <span class="state ${floor.state}"><i></i>${said[floor.state] ?? floor.state}</span>
        </div>
      </div>`,
        )
        .join('')
    : `<div class="empty-floors">Nobody in it yet. Take somebody on and the building grows a storey.</div>`

  el('cutaway').innerHTML = `
    <div class="cut-roof"></div>
    ${floors}
    <div class="cut-band">
      <div>
        <div class="cut-role">Lobby</div>
        <div class="cut-band-what">Where you walk in. The approval desk is here.</div>
      </div>
      ${building.approvals.length ? `<span class="pill lit">${plural(building.approvals.length, 'waiting')}</span>` : ''}
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
          (task) => `<div class="row"><div class="row-main">
            <div class="row-title">${esc(clip(task.goal, 74))}</div>
            <div class="row-sub">${who(building, task.assignedTo)} · ${ago(task.createdAt)}</div>
          </div><div class="row-right">
            <span class="pill ${kind[task.state] ?? ''}">${state[task.state] ?? task.state}</span>
          </div></div>`,
        )
        .join('')
    : '<p class="empty">Nothing on. Put a goal to it.</p>'

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

function paintApprovals(building) {
  el('approvals').innerHTML = building.approvals.length
    ? building.approvals
        .map(
          (approval) => `<div class="row"><div class="row-main">
            <div class="row-title">${esc(approval.intent)}</div>
            <div class="row-sub">${esc(approval.kind)} · asked ${ago(approval.createdAt)}</div>
          </div><div class="row-right">
            <button class="ghost" data-no="${esc(approval.id)}">Refuse</button>
            <button class="solid" data-yes="${esc(approval.id)}">Allow</button>
          </div></div>`,
        )
        .join('')
    : '<p class="empty">Nothing waiting on you.</p>'

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
          (order) => `<div class="row"><div class="row-main">
            <div class="row-title">${order.enabled ? '' : '<span class="pill">paused</span> '}${esc(clip(order.goal, 64))}</div>
            <div class="row-sub">${esc(order.reads)}${order.lastRunAt ? ` · last ran ${ago(order.lastRunAt)}` : ''}</div>
          </div><div class="row-right">
            <button class="ghost" data-toggle="${esc(order.id)}">${order.enabled ? 'Pause' : 'Start'}</button>
            <button class="ghost" data-drop="${esc(order.id)}">Drop</button>
          </div></div>`,
        )
        .join('')
    : '<p class="empty">Nothing recurring. Standing orders run whether or not anybody is watching.</p>'

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
    `<p class="dim pane-sub">${stats.total} notes · ${stats.pinned} pinned · ${stats.expired} expired</p>` +
    (notes.length
      ? notes
          .slice(0, 20)
          .map((note) => `<div class="note-row"><span class="pill">${esc(note.layer)}</span><p>${esc(clip(note.text, 240))}</p></div>`)
          .join('')
      : '<p class="empty">Nothing found.</p>')
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
  const body = { mirrorAll: el('dMirrorAll').checked, enabled: true }
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

async function repost(floorId) {
  try {
    const { providers } = await api('/api/providers')
    const reachable = providers.filter((p) => p.status.ok)
    const provider = prompt(`Which provider?\n\nReachable: ${reachable.map((p) => p.name).join(', ') || 'none set up'}`)
    if (!provider) return
    const spec = providers.find((p) => p.name === provider)
    const model = prompt(`Which model on ${provider}?`, spec?.suggested?.[0] ?? '')
    if (!model) return
    await post(`/api/buildings/${encodeURIComponent(view.building)}/floors/${encodeURIComponent(floorId)}/posting`, {
      provider, model, engine: provider === 'anthropic' ? 'claude-agent-sdk' : 'direct',
    })
    toast('Moved.')
    await refreshBuilding()
  } catch (error) { oops(error) }
}

function breakGround() {
  el('groundDialog').showModal()
  el('gName').focus()
}

// ── wiring ─────────────────────────────────────────────────────────────────

el('goHome').onclick = goHome

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
    toast(`${building.name} — ground broken.`, 'good')
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

el('askForm').onsubmit = async (event) => {
  event.preventDefault()
  const question = el('askText').value.trim()
  if (!question) return
  el('askGo').disabled = true
  el('askGo').textContent = 'Looking…'
  el('answer').classList.add('hidden')
  try {
    const result = await post('/api/ask', { question })
    el('answer').textContent = result.answer
    el('answer').classList.remove('hidden')
    el('askText').value = ''
  } catch (error) {
    oops(error)
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

  if (event.kind === 'goal-finished') toast('Finished.', 'good')
  if (event.kind === 'goal-failed') toast(event.detail ?? 'That goal failed.', 'bad')
  if (event.kind === 'asked') toast('Something needs your say-so.')

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
  desktop.onUpdate((state) => {
    if (state.phase === 'ready') offer(`Restart to update to ${state.version}`, true)
    else if (state.phase === 'downloading') offer(`Downloading update… ${state.percent ?? 0}%`, false)
    else if (state.phase === 'available') offer('Update found…', false)
    else button.classList.add('hidden')
  })
  // Downloading happens on its own; the restart is the only part that is ours
  // to choose, because nothing should be replaced under somebody mid-goal.
  button.onclick = () => { if (!button.disabled) desktop.restartToUpdate() }
}

goHome()
