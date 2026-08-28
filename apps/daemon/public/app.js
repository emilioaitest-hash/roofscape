/**
 * The dashboard.
 *
 * Three screens: the skyline, one building, and the one you land on when this
 * tab has no token. Everything else is a panel inside the second one. No
 * framework — the whole thing is a few hundred lines against a JSON API, and a
 * build step for the page would mean the daemon could no longer serve it
 * straight off disk.
 *
 * The city is drawn by the daemon and arrives as SVG. This file never invents a
 * building; it puts the drawing on the screen, notices which one was clicked,
 * and turns work on and off inside it by toggling classes. Redrawing is for
 * when a building actually changes shape.
 *
 * Two rules this file is responsible for keeping:
 *
 *   The strip always names the single next action. Never a row of zeros.
 *   A failure lands somewhere it can still be read a minute later.
 */

// ── talking to the daemon ──────────────────────────────────────────────────

const params = new URLSearchParams(location.search)
/** Not a const: a locked-out tab can be given a new one without a reload. */
let token = params.get('token') ?? sessionStorage.getItem('roofscape-token') ?? ''
if (params.get('token')) {
  sessionStorage.setItem('roofscape-token', params.get('token'))
  history.replaceState(null, '', location.pathname)
}

/**
 * A failure with the daemon's own advice still attached.
 *
 * `main.ts` sends a `remedy` with every 401 — where the token is kept — and the
 * page used to throw it away and toast "Unauthorized." for three seconds over a
 * permanently empty city. The remedy is the most useful part of that response,
 * so it is carried all the way to the screen.
 */
class Trouble extends Error {
  constructor(message, remedy, status) {
    super(message)
    this.remedy = remedy
    this.status = status
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Trouble(body.error ?? response.statusText, body.remedy, response.status)
    if (response.status === 401) lockedOut(error)
    throw error
  }
  return body
}

const post = async (path, body) => {
  const result = await api(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
  // Something the owner asked for has just worked, so whatever failed before it
  // is now history rather than news.
  clearNotice()
  return result
}

// ── small helpers ──────────────────────────────────────────────────────────

const el = (id) => document.getElementById(id)
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`

/** The value that turns up most often, ignoring empty ones. Ties go to the first. */
function commonest(values) {
  const tally = new Map()
  for (const value of values) if (value) tally.set(value, (tally.get(value) ?? 0) + 1)
  let best = ''
  let most = 0
  for (const [value, count] of tally) if (count > most) { best = value; most = count }
  return best
}

/**
 * "Anthropic · claude-opus-5 (via Claude Code)" → "Anthropic (via Claude Code)".
 *
 * The provider's own label is only ever built in one place, on the server, and
 * this takes the model back out of it rather than rebuilding it from parts — a
 * second recipe for the same sentence is a second recipe to keep in step.
 */
function withoutModel(describes, model) {
  const said = String(describes ?? '')
  if (!model) return said
  return said.replace(` · ${model}`, '').trim() || said
}

function toast(text, kind = '') {
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = text
  el('toasts').append(node)
  setTimeout(() => node.remove(), 3600)
}

/**
 * Where a failure lives until somebody has read it.
 *
 * A toast is three and a half seconds long and the feed is inside a tab that is
 * shut most of the time and hidden entirely for a building that has never done
 * anything — so every error a new owner could hit was gone before they could
 * act on it. This is under the bar on every screen, it carries the daemon's own
 * remedy, it counts repeats rather than stacking them, and it stays put until
 * it is dismissed or until something the owner asked for has worked.
 */
let noticeSaid = ''
let noticeCount = 0

function notice(label, what, fix) {
  if (what === noticeSaid) noticeCount += 1
  else { noticeSaid = what; noticeCount = 1 }

  el('noticeLabel').textContent = label
  el('noticeWhat').textContent = what
  el('noticeFix').textContent = fix ?? ''
  el('noticeFix').classList.toggle('hidden', !fix)
  el('noticeAgain').textContent = noticeCount > 1 ? `${noticeCount} times now.` : ''
  el('noticeAgain').classList.toggle('hidden', noticeCount < 2)
  el('notice').classList.remove('hidden')
}

/**
 * Turn the notice's button from "Dismiss" into the thing that would fix it.
 *
 * A remedy the owner has to go and find is a remedy in name only. When a goal
 * stopped because nothing could answer it, the fix is one dialog away, so the
 * bar offers the dialog instead of offering to go away.
 */
function offerProviders() {
  el('noticeGo').textContent = 'Connect a model'
  el('noticeGo').classList.add('solid')
  el('noticeGo').classList.remove('ghost')
  el('noticeGo').onclick = () => { clearNotice(); openProviders() }
}

function clearNotice() {
  noticeSaid = ''
  noticeCount = 0
  el('notice').classList.add('hidden')
  // Back to a plain dismissal, or the next unrelated failure inherits an offer
  // that has nothing to do with it.
  el('noticeGo').textContent = 'Dismiss'
  el('noticeGo').classList.add('ghost')
  el('noticeGo').classList.remove('solid')
  el('noticeGo').onclick = clearNotice
}

el('noticeGo').onclick = clearNotice

/** Anything that threw, said in all three places it is worth saying. */
const oops = (error) => {
  // Except when the tab has no token: everything in flight fails at once, and
  // a stack of "Unauthorized." over a screen that already explains it is noise.
  if (blocked) return
  el('notice').classList.remove('quiet')
  notice('That did not work', error.message, error.remedy)
  toast(error.message, 'bad')
  say(`— ${error.message}`, 'bad')
}

/** The wall clock, to the minute. A log with no times is a log you cannot place. */
function clock(iso) {
  const at = new Date(iso ?? Date.now())
  if (Number.isNaN(at.getTime())) return ''
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function say(text, kind = '', at) {
  const feed = el('log')
  if (!feed) return
  const line = document.createElement('div')
  line.className = kind

  const when = document.createElement('span')
  when.className = 'feed-when'
  when.textContent = clock(at)
  const what = document.createElement('span')
  what.textContent = text
  line.append(when, what)

  feed.prepend(line)
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

/**
 * A number, in words.
 *
 * The tallies keep their numerals, because a tally is meant to be counted. The
 * one sentence set at display size is meant to be *read*, and "4 things are
 * waiting on your say-so" reads like a system report where "Four dockets are
 * waiting in your lobbies" reads like somebody telling you.
 */
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
                 'nine', 'ten', 'eleven', 'twelve']
const spell = (n) => NUMBERS[n] ?? String(n)
const Spell = (n) => { const word = spell(n); return word[0].toUpperCase() + word.slice(1) }

// ── where we are ───────────────────────────────────────────────────────────

const view = { screen: 'city', building: null, tab: 'floors' }
/** The last skyline we drew, so we know when it needs drawing again. */
let drawnShape = ''
/** True once a 401 has been seen. Everything else stands down while it is. */
let blocked = false

const SCREENS = { city: 'screenCity', building: 'screenBuilding', blocked: 'screenBlocked' }

function show(screen) {
  view.screen = screen
  el('screenCity').classList.toggle('hidden', screen !== 'city')
  el('screenBuilding').classList.toggle('hidden', screen !== 'building')
  el('screenBlocked').classList.toggle('hidden', screen !== 'blocked')
  // Walking into a building is a change of place, so the keyboard goes with
  // you. Focus used to be dropped on <body> at every screen change: the next
  // Tab started again from the top bar, and anybody listening rather than
  // looking was told nothing had happened at all.
  //
  // Scrolled to the top *after* focusing, not before. `preventScroll` is
  // ignored here — a screen is taller than the window, and the browser brings
  // what it just focused into view whatever it was asked — so putting the
  // scroll last is the only order that lands where a new screen should.
  el(SCREENS[screen])?.focus({ preventScroll: true })
  window.scrollTo({ top: 0, behavior: 'instant' })
}

/**
 * No token, and a designed way out of it.
 *
 * The token lives in `sessionStorage` and is stripped from the address bar, so
 * a bookmark, a second window or a restarted daemon arrives with nothing and
 * every call 401s. The old page showed an empty city and a toast that had
 * already gone, while the stream — which will never come back after a 401 —
 * still claimed to be reconnecting. This says what happened, prints where the
 * token is kept, and takes it.
 */
function lockedOut(error) {
  if (blocked) return
  blocked = true
  stream?.close()
  live('blocked', 'no token')
  el('blockedWhere').textContent = error.remedy ?? 'Restart Roofscape and open the address it prints.'
  clearNotice()
  show('blocked')
}

el('blockedForm').onsubmit = (event) => {
  event.preventDefault()
  const typed = el('blockedToken').value.trim()
  if (!typed) return
  token = typed
  sessionStorage.setItem('roofscape-token', typed)
  el('blockedToken').value = ''
  blocked = false
  live('', 'connecting')
  openStream()
  goHome()
}

/**
 * Walk into a building. `then` is what you came in to do — the strip out on the
 * street offers one specific action, and arriving on the right screen with the
 * cursor somewhere else would be most of the way to not offering it.
 */
function openBuilding(id, then) {
  view.building = id
  // Walk in at the door unless the reason for walking in is somewhere else.
  const tab = then === 'work' ? 'work' : then === 'desk' ? 'desk' : 'floors'
  view.tab = tab
  selectTab(tab)
  show('building')
  refreshBuilding()
    .then(() => {
      if (then === 'hire') el('hRole').focus()
      if (then === 'goal') { el('goalText').focus(); el('goalText').select() }
    })
    .catch(oops)
}

function goHome() {
  view.building = null
  show('city')
  crumbs()
  refreshCity().catch(oops)
}

function crumbs() {
  el('crumbs').innerHTML =
    view.screen === 'building' && current ? `<span class="here">${esc(current.name)}</span>` : ''
}

// ── the ladder of forms, which the page had never once asked for ───────────

/**
 * Every form a building can take, in order, each with the daemon's own blurb.
 *
 * `GET /api/tiers` has been returning "It has a spire. People give directions
 * by it." since the first commit and nothing ever called it. The ladder is most
 * of the reason anybody comes back, so a building says what it is and what it
 * is about to become, rather than "2 more hires".
 */
let ladder = []
const blurbOf = (name) => ladder.find((t) => t.name === name)?.blurb ?? ''
const afterTier = (name) => ladder[ladder.findIndex((t) => t.name === name) + 1] ?? null

// ── the skyline ────────────────────────────────────────────────────────────

let skyline = []

/**
 * The size of the hole the drawing has to fill, in CSS pixels.
 *
 * The width has a floor well above any narrow window on purpose. The daemon
 * scales the city to the height it is given, so asking for a wider canvas than
 * the frame does not shrink anything — it draws the same street longer, and the
 * part that does not fit hangs off the side where the scroll can reach it. That
 * is the difference between a narrow window that crops and one that shrinks six
 * buildings until every ornament, every window state and the whole register
 * conceit is below the resolution of the screen.
 */
function cityBox() {
  const frame = el('cityScroll').getBoundingClientRect()
  return {
    width: Math.max(1040, Math.round(frame.width)),
    height: Math.max(360, Math.round(frame.height)),
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
  if (blocked) return
  const box = cityBox()
  // `next` is the daemon's, and it is kept. It is computed where every building
  // is visible at once, which is the only place it can be computed honestly.
  const { svg, buildings, boardedUp, next } = await api(`/api/skyline/city?width=${box.width}&height=${box.height}`)
  skyline = buildings
  paintBoarded(boardedUp)

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
  setSlip()
  paintCityState()
  paintTallies()
  paintNext(next)
  for (const building of grew) itGrew(building)
}

/**
 * How far out of register the colour plate lands, in the drawing's own units.
 *
 * A press misregisters by a fixed distance on the paper, not by a fraction of
 * whatever it is printing. The drawing carries the *direction* as a fraction per
 * building; this supplies the distance, worked back through the scale the page
 * is actually rendering at so the slip is the same size on every screen.
 *
 * It used to be baked in drawing units and so shrank with the city: measured on
 * a real home screen it came to between 0.44 and 0.98 CSS pixels — half a pixel
 * at the low end, which on a one-times display is nothing at all. The signature
 * of the whole visual language was below the resolution of the screen.
 *
 * Clamped at both ends: a portrait is drawn much larger than a street, and an
 * unclamped slip there would read as a printing fault rather than a print.
 */
function setSlip() {
  const svg = el('cityArt').querySelector('svg')
  if (!svg) return
  /*
   * Measured on a *plot*, not on the svg.
   *
   * The svg's own CTM carries only the page's fit — 0.85 on the screen this was
   * first measured on. Everything inside a plot is scaled again by that plot's
   * `scale(zoom)`, which was 0.72, so the real number is 0.61 and using the
   * svg's put every screen-sized thing out by a third. That is the whole reason
   * the misprint was still under a pixel after being "fixed" once.
   */
  const plot = svg.querySelector('.rs-plot') ?? svg
  if (!plot.getScreenCTM) return
  const ctm = plot.getScreenCTM()
  // No layout yet, or a detached node: leave the drawing's own fallbacks alone
  // rather than dividing by zero and sending everything to nowhere.
  if (!ctm || !ctm.a) return
  // Clamped: a portrait is drawn far larger than a street, and an unclamped
  // slip there reads as a printing fault rather than as a print.
  const unit = Math.min(2.4, Math.max(0.6, 1 / ctm.a))
  svg.style.setProperty('--rs-px', `${unit.toFixed(3)}px`)
}

/**
 * Depth, on mouse move.
 *
 * The backdrop is anonymous city that exists so your buildings have somewhere
 * to stand. Moving it a little behind them — the far layer least, the near
 * layer most, the dust in the paper barely at all — is what turns a printed
 * picture into a place you are standing in front of. Your own buildings never
 * move: they are the content, and content that slides under the pointer is a
 * toy.
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
    shift('.rs-stars', -5)
    shift('.rs-far', -14)
    shift('.rs-mid', -26)
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
 * The ladder of forms is the best joke in the product — a shack becomes a
 * walk-up becomes a cast-iron block becomes something with a spire that people
 * give directions by — and it was never once celebrated. "One more hire and it
 * becomes a landmark" was 13.5px of grey in a sidebar, and on the day the
 * promise was kept the app said so in a toast that was gone in three and a half
 * seconds.
 *
 * So it gets a beat, on the street, beside the building it is about: the
 * building settles onto its new storey on a spring, and what it has become is
 * printed in the display voice with the daemon's own blurb under it. It is also
 * the way in, because the first thing anybody wants after being told is to go
 * and look.
 */
function itGrew(building) {
  const plot = el('cityArt').querySelector(`[data-building="${CSS.escape(building.id)}"]`)
  if (plot) {
    plot.classList.add('rs-grew')
    plot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    setTimeout(() => plot.classList.remove('rs-grew'), 1400)
  }

  const frame = el('cityScroll').closest('.city-frame')
  if (!frame) return
  const article = /^[aeiou]/i.test(building.tier) ? 'an' : 'a'
  const blurb = blurbOf(building.tier)

  // One at a time. Two hires in a row is one announcement about the second.
  frame.querySelector('.grew')?.remove()
  const card = document.createElement('div')
  card.className = 'grew'
  // A status rather than an alert: it is good news and it interrupts nothing.
  card.setAttribute('role', 'status')
  card.innerHTML = `
    <p class="eyebrow">${esc(building.name)} is now</p>
    <p class="grew-name">${esc(article)} ${esc(building.tier)}</p>
    ${blurb ? `<p class="grew-blurb">${esc(blurb)}</p>` : ''}
    <p class="grew-in"><button class="ghost" type="button">Go and look inside</button></p>`
  card.querySelector('button').onclick = () => { card.remove(); openBuilding(building.id) }
  frame.append(card)
  setTimeout(() => card.remove(), 12000)
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
    // Both classes, from live data. Toggling only `rs-busy` left `rs-on` where
    // it was baked, and `rs-on` fills marigold by itself — so a building that
    // finished its work kept its lights on until a redraw the page never asked
    // for. A light that cannot go out is not a light, it is a painted window.
    for (const window of plot.querySelectorAll('.rs-w[data-floor]')) {
      const floor = Number(window.getAttribute('data-floor'))
      const lit = floor >= firstLit && building.working > 0
      window.classList.toggle('rs-on', lit)
      // Somebody actually at the desk, rather than a light left on for work
      // that is waiting to be picked up.
      window.classList.toggle('rs-busy', lit && Boolean(building.busy))
    }
  }
}

/**
 * The numbers, and only the ones with something to say.
 *
 * `BUILDINGS 0 / ON STAFF 0 / IN HAND 0 / WAITING ON YOU 0` was the first thing
 * a new owner saw. A tally of nothing is worse than no tally: it spends the most
 * valuable space on the screen saying nothing happened. So a count of zero is
 * not drawn at all, and the sentence above these is what carries the strip.
 */
function paintTallies() {
  const staff = skyline.reduce((n, b) => n + b.headcount, 0)
  const inHand = skyline.reduce((n, b) => n + b.open, 0)
  const waiting = skyline.reduce((n, b) => n + b.pendingApprovals, 0)

  const tally = (label, value, kind = '') =>
    value ? `<div class="tally ${kind}"><span class="tally-n">${value}</span><span class="tally-l">${label}</span></div>` : ''

  // The one tally that is about you is also the only one you can do anything
  // about, so it is the only one that is a control. A number that counts your
  // own unanswered post and cannot be pressed is a number that has told you
  // about a chore and then hidden it in four different lobbies.
  const round = waiting
    ? `<button type="button" class="tallies-round" data-round aria-expanded="false"
               title="Open every lobby's desk at once">
         <span class="tally-n">${waiting}</span>
         <span class="tally-l">Waiting on you</span>
       </button>`
    : ''

  el('tallies').innerHTML =
    tally('Buildings', skyline.length) +
    tally('On staff', staff) +
    tally('In hand', inHand, 'lit') +
    round
  el('tallies').classList.toggle('hidden', skyline.length === 0)

  el('tallies').querySelector('[data-round]')?.addEventListener('click', () => toggleRound())
  // Nothing left to answer closes it rather than leaving an empty desk open.
  if (!waiting) el('round').classList.add('hidden')
}

/**
 * The single next action, said well.
 *
 * *Which* action it is is not decided here. `/api/skyline/city` returns
 * `next: { do, say, building }`, computed in the one place that can see every
 * building at once — and the page used to destructure around it and reimplement
 * a worse copy, missing the `connect-provider` branch, which is the state every
 * brand-new install is actually in. So the daemon decides and the page does the
 * two things it is better at: choosing the words, and knowing what pressing the
 * button should open.
 */
let nextAction = null

function paintNext(next) {
  const inHand = skyline.reduce((n, b) => n + b.open, 0)
  const waiting = skyline.reduce((n, b) => n + b.pendingApprovals, 0)
  const where = next?.building ? skyline.find((b) => b.id === next.building) : null
  const named = where?.name ?? ''

  const set = ({ label, say, why = '', act = '', note = '', run = null }) => {
    el('nextLabel').textContent = label
    el('nextSay').textContent = say
    el('nextWhy').textContent = why
    el('nextWhy').classList.toggle('hidden', !why)
    el('nextGo').textContent = act
    el('nextGo').classList.toggle('hidden', !act)
    el('nextNote').textContent = note
    nextAction = run
  }

  // The street reads buildings one at a time. With none to read, asking it
  // anything spends a turn to be told so.
  el('askForm').classList.toggle('hidden', skyline.length === 0)

  switch (next?.do) {
    // The state a fresh install is in, and the reason its owner gave up: no
    // credential anywhere, so hiring is impossible and nothing else on this
    // screen can be done first.
    case 'connect-provider':
      return set({
        label: 'Before anything else',
        say: 'No model is connected, so nobody can be hired.',
        why: 'Roofscape holds no subscription on your behalf — it works from credentials you already own. If Claude Code is installed on this machine, that is one of them and there is nothing to paste.',
        act: 'Connect a model',
        note: 'A key, the name of a variable holding one, or an installed Claude Code.',
        run: openProviders,
      })

    case 'break-ground':
      return set({
        label: 'An empty skyline',
        say: 'Nothing built yet. Break ground and you have a company.',
        why: 'Every project is its own building — its own staff, its own memory, its own money, its own workspace, and it shares none of them with its neighbours. Take somebody on and it grows a storey. A side project that has quietly reached eleven floors is telling you something a list of project names never would.',
        act: 'Break ground',
        note: 'Or press n, or click the empty lot out on the street.',
        run: breakGround,
      })

    case 'hire':
      return set({
        label: 'Next',
        say: skyline.length === 1
          ? 'One building, nobody in it yet. Take somebody on and it grows a storey.'
          : `Nobody in ${named} yet. Take somebody on and it grows a storey.`,
        why: 'A hire is a floor, and a floor is somebody a goal can be given to. Until there is one, there is nobody to give it to.',
        act: named ? `Take somebody on in ${named}` : 'Take somebody on',
        note: 'A manager breaks goals into work. A coder does it.',
        run: where ? () => openBuilding(where.id, 'hire') : null,
      })

    // Dockets, held in lobbies. They were "things", which is the vaguest noun
    // available, at display size, in an app that names everything else.
    case 'decide':
      return set({
        label: 'Next',
        say: waiting === 1
          ? `One docket is waiting in the lobby at ${named}.`
          : `${Spell(waiting)} dockets are waiting in your lobbies.`,
        why: 'Anything that would reach outside a building stops in its lobby until you answer. Whoever left it is standing still until then.',
        act: 'Answer them',
        note: 'Every lobby at once, without walking into each.',
        run: () => toggleRound(true),
      })

    case 'set-goal':
      return set({
        label: 'Next',
        say: `${named} is staffed and has never been asked for anything.`,
        why: 'One sentence is enough. The top floor breaks it into tasks, and somebody picks the first one up.',
        act: named ? `Put a goal to ${named}` : 'Put a goal to it',
        note: 'The way you would say it to somebody on their first morning.',
        run: where ? () => openBuilding(where.id, 'goal') : null,
      })

    /*
     * Work that came back and nobody has read.
     *
     * The daemon has computed this state since the run that made a building of
     * a manager and a coder able to finish anything at all, and the page had no
     * branch for it — so it fell to the default below, which printed the
     * daemon's sentence ("finished something nobody read. Say whether it holds.")
     * with no button under it and a `why` line about lit windows that had
     * nothing to do with it. The one screen whose stated rule is that it always
     * names the single next action was naming an action the app gave you no way
     * to take.
     */
    case 'read-work':
      return set({
        label: 'Next',
        say: named ? `${named} finished something and nobody has read it.` : 'Something finished and nobody has read it.',
        why: 'Work goes back to whoever asked for it. Until somebody says whether it holds, it is done but not settled.',
        act: named ? `Read what ${named} sent back` : 'Read what came back',
        note: 'The branch is waiting; nothing has been merged.',
        run: where ? () => openBuilding(where.id, 'work') : null,
      })

    default:
      return set({
        label: 'On the street',
        say: next?.say ?? 'Nothing needs you. Go and do something else.',
        why: inHand
          ? `${plural(inHand, 'task')} in hand. The lit windows are the floors working on them.`
          : 'Quiet. Put a goal to a building and somebody will pick it up.',
        note: 'Press a number to walk into that building.',
      })
  }
}

el('nextGo').onclick = () => nextAction?.()

// ── one building ───────────────────────────────────────────────────────────

let current = null

async function refreshBuilding() {
  if (!view.building || blocked) return
  const id = view.building
  const building = await api(`/api/buildings/${encodeURIComponent(id)}`)
  // They may have walked back out to the street while this was in the air.
  if (view.building !== id) return
  current = building
  crumbs()

  el('portrait').innerHTML = building.portrait
  cropPortrait()
  el('bName').textContent = building.name
  el('bTier').textContent = building.tier
  el('bBlurb').textContent = blurbOf(building.tier)
  el('bCharter').textContent = building.charter === building.name ? '' : building.charter

  // A vital is shown when it has something to say. A row of pills reading
  // "0 in hand · 0 waiting on you · 0 tokens this month · 0 in the archives" is
  // four facts a new building already implies, and it crowds out the one that
  // is actually true of it. Headcount is always there because a building always
  // has one, and it is the number the whole product is built on.
  const waiting = building.approvals.length
  const inHand = building.open.filter((t) => t.state === 'queued' || t.state === 'working').length
  // "6 floors on staff" was a contradiction in three words once a curator was
  // in the building: six is how tall it is, and the seventh person works below
  // ground. The label says which number this is.
  const below = building.staff.filter((floor) => floor.role === 'curator').length
  el('bVitals').innerHTML = [
    building.headcount
      ? vital(plural(building.headcount, 'floor'), below ? 'above ground' : 'on staff')
      : vital('Nobody in yet', ''),
    below ? vital(String(below), 'below ground') : '',
    inHand ? vital(String(inHand), 'in hand', 'lit') : '',
    waiting ? vital(String(waiting), 'waiting on you', 'warn') : '',
    building.spentThisMonth ? vital(tokens(building.spentThisMonth), 'tokens this month') : '',
    building.archives.total ? vital(String(building.archives.total), 'in the archives') : '',
  ].join('')

  // Not while a goal we are sending is still in the air: the answer to that one
  // has not come back yet, and this would re-enable the button underneath it.
  if (!sendingGoal) {
    el('goalGo').disabled = building.working
    el('goalText').disabled = building.working
  }
  showWorking(building.working, building)

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

/**
 * Crop the portrait onto the building it is a portrait of.
 *
 * The drawing arrives on a full city canvas — sky above, street either side —
 * so one building sat in the middle of its own card at roughly a quarter of it,
 * on the screen whose entire job is to introduce that building. Nothing about
 * the drawing is changed: the viewBox is pulled in onto what is actually drawn,
 * which is a crop rather than a zoom, and the card's fixed shape then lets a
 * tower fill the height and a shack fill the width.
 *
 * Measured off the rendered boxes rather than `getBBox`, because the plot
 * carries its own transform and this wants the answer in the root's own units.
 */
function cropPortrait() {
  const svg = el('portrait').querySelector('svg')
  const plot = svg?.querySelector('[data-building]')
  if (!svg || !plot) return
  const view = svg.viewBox?.baseVal
  const frame = svg.getBoundingClientRect()
  const drawn = plot.getBoundingClientRect()
  if (!view?.width || !frame.width || !frame.height || !drawn.width || !drawn.height) return

  const perX = view.width / frame.width
  const perY = view.height / frame.height
  // Enough air for the drawing to sit in rather than be trimmed by. The pin and
  // the ornaments are already inside the plot's own box.
  const air = 10
  const x = view.x + (drawn.left - frame.left) * perX - air
  const y = view.y + (drawn.top - frame.top) * perY - air
  const width = drawn.width * perX + air * 2
  const height = drawn.height * perY + air * 2

  svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`)
  // The attributes would otherwise keep the old canvas's aspect, and the crop
  // would letterbox back to exactly where it started.
  svg.removeAttribute('width')
  svg.removeAttribute('height')
}

const vital = (value, label, kind = '') =>
  `<span class="vital ${kind}"><b>${esc(value)}</b>${label ? `<span>${esc(label)}</span>` : ''}</span>`

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
  //
  // The curator is the exception, and it is the store's own rule: `headcount()`
  // leaves it out, because a building should not appear to grow because it
  // started tidying up.
  const staff = building.staff.filter((floor) => floor.role !== 'curator')
  const nightShift = building.staff.filter((floor) => floor.role === 'curator')
  const top = staff[0]

  // "On a break" was charming once and wrong immediately: with three tasks
  // queued and every floor idle, nobody is on a break — the building simply is
  // not running. Which of the two it is depends on whether there is work
  // waiting, so the word does too.
  const queued = building.open.some((task) => task.state === 'queued')
  const said = {
    working: 'working',
    next: 'next up',
    review: 'in review',
    blocked: 'stuck',
    idle: queued ? 'waiting for work' : 'nothing assigned',
  }

  /**
   * What the building is doing, said once.
   *
   * "waiting for work" ran seven times down the right-hand edge of a
   * seven-floor building — the same three words, in a column, where the reader
   * was looking for the one row that differed. A fact that is true of every
   * floor belongs above the floors; a row only speaks when it has something of
   * its own to say.
   */
  const mood = commonest(staff.map((floor) => floor.state))
  const same = staff.filter((floor) => floor.state === mood).length
  const chorus = staff.length >= 3 && same > staff.length / 2 ? mood : ''
  const moodLine = chorus
    ? same === staff.length
      ? `Every floor is ${said[chorus] ?? chorus}.`
      : `${Spell(same)} of ${spell(staff.length)} floors are ${said[chorus] ?? chorus}.`
    : ''

  /**
   * A building runs on one supply, the way a real one runs on one grid, and
   * printing "Anthropic · claude-opus-5 (via Claude Code)" on all seven floors
   * said that thirty-five-character fact seven times — loudly, in mono, under a
   * link's underline — until it outweighed the names of the people on them.
   *
   * So the supply is named once, above the floors, and a floor carries only its
   * model. A floor somewhere else is the fact worth having, and now it is the
   * only one on the row that is spelt out.
   */
  // Two floors share a supply when they share both the provider and the engine
  // that reaches it: Anthropic on a key and Anthropic through Claude Code are
  // billed differently and fail differently, so they are not the same supply.
  const supplyOf = (floor) => (floor.posting ? `${floor.posting.provider}|${floor.posting.engine}` : '')
  const supply = commonest(building.staff.map(supplyOf))

  const runsOn = (floor) =>
    !floor.posting || supplyOf(floor) !== supply ? floor.describes : floor.posting.model

  /** One storey. `plate` is what goes on the lift button beside it. */
  const storey = (floor, plate, extra = '') => `
      <div class="floor ${extra} ${floor.state === 'working' ? 'is-working' : ''}"
           data-floor="${esc(floor.id)}">
        <div class="floor-no">${esc(plate)}</div>
        <div class="floor-who">
          <div class="floor-name">${esc(floor.name)} <span class="cut-role">${esc(floor.role)}</span></div>
          ${floor.on
            ? `<div class="floor-on">${esc(clip(floor.on.goal, 78))}</div>`
            : `<div class="floor-model"><button type="button" data-repost="${esc(floor.id)}"
                 title="${esc(floor.describes)} — click to move them">${esc(runsOn(floor))}</button></div>`}
        </div>
        <div class="floor-right">
          ${floor.state === chorus
            ? ''
            : `<span class="state s-${esc(floor.state)}"><i></i>${esc(said[floor.state] ?? floor.state)}</span>`}
        </div>
      </div>`

  const floors = staff.length
    ? staff.map((floor, index) => storey(floor, staff.length - index, floor === top ? 'top-floor' : '')).join('')
    : `<div class="empty-floors">Nobody in yet. Take somebody on and the building grows a storey.</div>`

  // The label is already in the floor's own description — "Anthropic ·
  // claude-opus-5 (via Claude Code)" — so the supply line is that string with
  // the model taken out of the middle of it, rather than a second source of
  // truth about what a provider is called.
  const onSupply = building.staff.find((floor) => supplyOf(floor) === supply)
  const supplyLabel = onSupply ? withoutModel(onSupply.describes, onSupply.posting?.model) : ''

  el('cutaway').innerHTML = `
    <div class="cut-roof"></div>
    ${moodLine ? `<div class="cut-mood">${esc(moodLine)}</div>` : ''}
    ${supplyLabel
      ? `<div class="cut-supply">
           <span class="cut-role">Runs on</span>
           <span class="cut-supply-who">${esc(supplyLabel)}</span>
         </div>`
      : ''}
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
        <div class="cut-band-what">Everything it remembers${nightShift.length ? '' : '. Nobody is looking after them yet'}.</div>
      </div>
      <span class="pill">${plural(building.archives.total, 'note')}</span>
    </div>
    ${nightShift.map((floor) => storey(floor, 'B', 'below')).join('')}`

  for (const button of el('cutaway').querySelectorAll('[data-repost]')) {
    button.onclick = () => repost(button.getAttribute('data-repost'))
  }
}

/**
 * What a task's state is called out loud.
 *
 * The rows used to print the raw enum — `awaiting-review`, `awaiting-approval`,
 * `escalated` — which are identifiers this code passes between its own
 * functions. Worse: a building with no reviewer in it cannot mark anything
 * done, so the *normal successful outcome* reached the owner as a red pill
 * reading `awaiting-review`.
 */
const TASK_SAID = {
  // The rare states were translated beautifully and the two commonest were
  // passed straight through, which is the wrong way round: `queued` and
  // `working` are what almost every row says, almost all of the time.
  queued: 'not picked up yet',
  working: 'under way',
  'awaiting-review': 'waiting to be read',
  'awaiting-approval': 'waiting on you',
  done: 'it held',
  escalated: 'stuck',
  abandoned: 'given up on',
}
const TASK_TONE = {
  working: 'lit',
  escalated: 'bad',
  abandoned: 'bad',
  done: 'good',
  'awaiting-approval': 'warn',
}
const saidState = (state) => TASK_SAID[state] ?? String(state ?? '').replace(/-/g, ' ')

function paintWork(building) {
  const open = building.open

  // A building that has never done anything gets the riser instead of two
  // empty columns over a silent feed. The moment there is one real task, the
  // explanation has been replaced by the thing it was explaining.
  const untouched = open.length === 0 && building.recent.length === 0
  el('riser').classList.toggle('hidden', !untouched)
  el('workCols').classList.toggle('hidden', untouched)
  el('feedBox').classList.toggle('hidden', untouched)

  el('workOpen').innerHTML = open.length
    ? open
        .map(
          (task) => `<div class="task ${task.state === 'working' ? 'is-working' : ''}">
            <div class="task-head">
              <div class="task-goal">${esc(task.goal)}</div>
              <span class="pill ${TASK_TONE[task.state] ?? ''}">${esc(saidState(task.state))}</span>
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
    : `<p class="empty">Quiet. Put a goal to it and somebody will pick it up.</p>`

  el('workDone').innerHTML = building.recent.length
    ? building.recent.map((task) => settled(building, task)).join('')
    : `<p class="empty">Nothing has come back yet. What does lands here — what it did, what it
       produced, and what it cost.</p>`
}

/**
 * A task that has come back, and what came back with it.
 *
 * Every result carries a summary in the worker's own words, whatever it
 * produced, and what it spent — and none of it was on any screen. The row said
 * a branch name and a raw state, which tells you that something happened and
 * nothing whatever about what.
 *
 * Shut by default, because the column is for scanning and this is one press
 * away. A <details> rather than a click handler: it opens from the keyboard,
 * announces itself, and survives a redraw without anything remembering it.
 */
function settled(building, task) {
  const artifacts = task.result?.artifacts ?? []
  const branch = artifacts.find((line) => line.startsWith('branch:'))
  const held = task.state === 'done'
  const rest = artifacts.filter((line) => line !== branch)

  return `<details class="settled">
    <summary>
      <div class="row-main">
        <div class="row-title">${esc(clip(task.goal, 62))}</div>
        <div class="row-sub">${who(building, task.assignedTo)} · ${ago(task.settledAt)}</div>
      </div>
      <div class="row-right">
        ${branch ? `<span class="pill branch">${esc(branch.slice(7))}</span>` : ''}
        <span class="pill ${TASK_TONE[task.state] ?? ''}">${esc(saidState(task.state))}</span>
      </div>
    </summary>
    <div class="settled-what">
      ${task.result?.summary
        ? `<p class="settled-said">${esc(task.result.summary)}</p>`
        : `<p class="empty">It settled without saying anything.</p>`}
      ${(task.acceptance ?? []).length
        ? `<ul class="task-accept ${held ? 'met' : ''}">${task.acceptance
            .map((line) => `<li>${esc(clip(line, 160))}</li>`)
            .join('')}</ul>`
        : ''}
      ${rest.length || task.result?.tokensSpent
        ? `<div class="settled-left">
             ${rest.map((line) => `<span class="pill">${esc(clip(line.replace(/^\w+:/, ''), 52))}</span>`).join('')}
             ${task.result?.tokensSpent
               ? `<span class="settled-cost">${tokens(task.result.tokensSpent)} tokens</span>`
               : ''}
           </div>`
        : ''}
    </div>
  </details>`
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
/**
 * What granting it actually does, said in the fewest ordinary words.
 *
 * `shell` was missing, and `shell` is the commonest kind by a long way — every
 * unfamiliar command a coder wants to run comes here. So the fallback ran on
 * most cards, and every docket on the screen read "This reaches outside the
 * building" over two thirds of an empty card.
 */
const CONSEQUENCE = {
  hire: 'Somebody joins, and the building grows a storey.',
  publish: 'This leaves the building.',
  send: 'This goes to somebody outside.',
  deploy: 'This reaches the world.',
  spend: 'This costs money.',
  merge: 'This lands on main.',
  shell: 'This runs in your workspace, on your files, as you.',
}

/**
 * The command itself, out of the intent.
 *
 * A shell escalation's intent is literally `Run: <command>` — the command was
 * on the card all along, buried in a sentence and set as prose. It is the whole
 * of what you are deciding about, so it goes in the void, in the plate this app
 * already uses for things meant to be copied rather than read.
 */
const commandIn = (intent) => {
  const found = /^Run:\s*([\s\S]+)$/.exec(String(intent ?? ''))
  return found ? found[1].trim() : ''
}

/**
 * One docket. `asked` is the line above it, which differs by where you read it:
 * at the desk you already know the building, and on the round you do not.
 */
const docket = (approval, asked) => {
  const command = commandIn(approval.intent)
  return `<div class="docket">
  <div class="docket-head">
    <span class="kind k-${esc(approval.kind)}">${esc(approval.kind)}</span>
    <span class="docket-when">${asked}</span>
  </div>
  ${command
    ? `<p class="docket-intent">Run this in the workspace.</p>
       <div class="docket-command">${esc(command)}</div>`
    : `<p class="docket-intent">${esc(approval.intent)}</p>`}
  <p class="docket-if">${esc(CONSEQUENCE[approval.kind] ?? 'This reaches outside the building.')}</p>
  <div class="docket-answer">
    <button class="ghost" data-no="${esc(approval.id)}">Refuse</button>
    <button class="solid" data-yes="${esc(approval.id)}">Allow</button>
  </div>
</div>`
}

/** Both answers on every docket in a container, wired to the same decision. */
function wireDockets(node, after) {
  for (const button of node.querySelectorAll('[data-yes]')) {
    button.onclick = () => decide(button.getAttribute('data-yes'), true, after)
  }
  for (const button of node.querySelectorAll('[data-no]')) {
    button.onclick = () => decide(button.getAttribute('data-no'), false, after)
  }
}

function paintApprovals(building) {
  el('approvals').innerHTML = building.approvals.length
    ? building.approvals
        .map((approval) =>
          docket(approval, `${who(building, approval.requestedBy)} asked ${ago(approval.createdAt)}`))
        .join('')
    : `<div class="desk-clear">
         <p>Nothing needs you. Go and do something else.</p>
         <p class="dim">Anything that reaches outside the building — publishing, sending,
            deploying, spending, merging to main, hiring — stops here first.</p>
       </div>`

  wireDockets(el('approvals'), refreshBuilding)
}

/**
 * The round: everything waiting on you, in every building, from the street.
 *
 * Each building's desk is in its own lobby, which is right — a building shares
 * nothing with its neighbours, and that includes its post. But the person the
 * dockets are addressed to has all of them, and the skyline was already
 * counting them while giving nobody anywhere to answer. You had to guess which
 * buildings and walk into each.
 *
 * The count on the street is the way in now. This is the same docket as the one
 * in the lobby, decided down the same route — the daemon finds the building the
 * approval belongs to, so nothing here has to know.
 */
async function paintRound() {
  const box = el('round')
  if (box.classList.contains('hidden')) return
  try {
    const { pending } = await api('/api/approvals')
    if (pending.length === 0) {
      box.innerHTML = `<div class="desk-clear">
          <p>Nothing needs you. Go and do something else.</p>
          <p class="dim">Anything that would reach outside a building stops in its lobby until
             you say so. This is where all of them stop at once.</p>
        </div>`
      return
    }
    box.innerHTML =
      `<h3 class="pane-title">Waiting on you${
        pending.length > 1 ? ` <span class="pill warn">${pending.length}</span>` : ''
      }</h3>` +
      pending
        .map((approval) =>
          docket(approval, `<b class="docket-where">${esc(approval.buildingName)}</b> · asked ${ago(approval.createdAt)}`))
        .join('')
    wireDockets(box, refreshCity)
  } catch (error) { oops(error) }
}

/** Open or shut the round, and remember which it is. */
function toggleRound(open) {
  const box = el('round')
  const want = open ?? box.classList.contains('hidden')
  box.classList.toggle('hidden', !want)
  el('tallies').querySelector('[data-round]')?.setAttribute('aria-expanded', String(want))
  if (want) {
    box.innerHTML = '<p class="empty">Reading every lobby…</p>'
    paintRound()
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

/**
 * What it becomes next, and what that is worth.
 *
 * "Another 2 hires and it changes form" was true and said nothing. The daemon
 * has been computing a blurb for every rung of the ladder since the first
 * commit — "It has a spire. People give directions by it." — and the page never
 * asked for it. The ladder is the reason to come back.
 */
function paintNextForm(building) {
  if (!building.nextTierAt) {
    el('nextForm').textContent = 'It has taken every form there is.'
    return
  }
  // `plural` was right for the count and wrong for the sentence: "Another 1
  // hire and it changes form" is a number where a person would use a word.
  const away = building.nextTierAt - building.headcount
  const many = away === 1 ? 'One more hire' : `Another ${away} hires`
  const becomes = afterTier(building.tier)
  el('nextForm').innerHTML = becomes
    ? `${many} and it becomes a <b>${esc(becomes.name)}</b>. ${esc(becomes.blurb)}`
    : `${many} and it changes form.`
}

async function paintSchedules() {
  const id = view.building
  const { schedules } = await api('/api/schedules')
  if (view.building !== id) return
  const mine = schedules.filter((s) => s.building === id)
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
  // Checked before the request and again after it. `goHome()` nulls the
  // building synchronously, so a fast click out of a building used to build
  // `/api/buildings/null/archives` and toast a raw 404 at somebody who was
  // already looking at the street.
  const id = view.building
  if (!id) return
  const path = `/api/buildings/${encodeURIComponent(id)}/archives${query ? `?q=${encodeURIComponent(query)}` : ''}`
  const { stats, notes } = await api(path)
  if (view.building !== id) return
  el('archives').innerHTML =
    `<div class="archive-shelf">` +
    // Three zeros above "Nothing written down yet" is the same fact told twice,
    // the second time in a way that says nothing.
    (stats.total
      ? `<div class="archive-stats">
           <span><b>${stats.total}</b> notes</span>
           <span><b>${stats.pinned}</b> pinned</span>
           <span><b>${stats.expired}</b> expired</span>
         </div>`
      : '') +
    (notes.length
      ? notes
          .slice(0, 20)
          .map((note) => `<div class="note-row"><span class="pill">${esc(note.layer)}</span><p>${esc(clip(note.text, 240))}</p></div>`)
          .join('')
      : `<p class="empty">${query ? 'Nothing down here matches that. Try a shorter word.' : 'Nothing written down yet. Agents record what turned out to be true as they work.'}</p>`) +
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
  const id = view.building
  if (!id) return
  const { messages, unread, staff } = await api(`/api/buildings/${encodeURIComponent(id)}/mail`)
  if (view.building !== id) return

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
    : `<p class="empty">Nothing has been said yet. Write to somebody — it lands in their
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
  try {
    const sent = await post(`/api/buildings/${encodeURIComponent(view.building)}/mail`, {
      to: el('mailTo').value,
      body,
    })
    // Cleared once it is genuinely somewhere else. A refused message that has
    // also been wiped out of the box is a message you have to write twice.
    el('mailBody').value = ''
    toast(`Left for ${sent.toName}.`, 'good')
    await paintMail()
    el('thread').scrollTop = el('thread').scrollHeight
  } catch (error) { oops(error) }
}

// ── where the models come from ─────────────────────────────────────────────

/**
 * Every provider, whether it can answer, and a way to connect it from here.
 *
 * This list was read-only. `POST /api/providers` was complete — branched for a
 * pasted key, for the name of a variable, and for one already sitting in the
 * daemon's environment, with a re-probe and carefully written refusals — and it
 * was tested, and the page called neither of the two. So the only remedy the
 * dialog could offer a stuck owner was a terminal command that the desktop app
 * does not ship, under a README promising there was nothing to install first.
 * That is the exact fault this app was abandoned over.
 *
 * The daemon probes rather than guesses, so "needs no key" and "is answering"
 * stay different claims, and a row repaints from its own answer rather than
 * from a reload.
 */
let providers = []

/** How a provider's row looks right now, given what the daemon last said. */
function providerRow(p) {
  const ok = p.status?.ok
  const models = (p.suggested ?? []).slice(0, 3).map(esc).join(' · ')
  return `
    <span class="lamp"></span>
    <div>
      <div class="provider-top">
        <div class="provider-name">${esc(p.label)}</div>
        <div class="provider-models">${models}</div>
      </div>
      <div class="provider-why">${esc(ok ? (p.note ?? 'Reachable.') : (p.status?.reason ?? 'Not set up.'))}</div>
      ${p.viaClaudeCode
        ? `<p class="provider-none">Reached through Claude Code. No key needed.</p>`
        : ''}
      ${ok ? '' : `
        <form class="provider-connect" data-connect="${esc(p.name)}">
          <input type="password" autocomplete="off" spellcheck="false"
                 aria-label="A key for ${esc(p.label)}, or the name of a variable holding one"
                 placeholder="Paste a key${p.envVar ? `, or type ${esc(p.envVar)}` : ''}">
          <button class="solid" type="submit">Connect</button>
          <span class="field-note dim">${p.envVar
            ? `Naming a variable keeps the secret out of Roofscape's database. Leave it empty and it will look for <code>${esc(p.envVar)}</code> in its own environment.`
            : 'Pasted keys are held in this install and nowhere else.'}</span>
          <p class="provider-said hidden" role="status"></p>
        </form>
        ${p.status?.remedy ? `<div class="provider-fix">Or, in a terminal: ${esc(p.status.remedy)}</div>` : ''}`}
    </div>`
}

/** Redraw one row where it stands, without disturbing the rest of the list. */
function repaintProvider(name) {
  const row = el('providerList').querySelector(`[data-provider="${CSS.escape(name)}"]`)
  const provider = providers.find((p) => p.name === name)
  if (!row || !provider) return
  row.className = `provider ${provider.status?.ok ? 'ok' : ''}`
  row.innerHTML = providerRow(provider)
}

async function paintProviders() {
  el('providerList').innerHTML = '<p class="empty">Asking each of them…</p>'
  try {
    const answer = await api('/api/providers')
    providers = answer.providers
    // Said at the top rather than left to be inferred from a tick further down:
    // an installed Claude Code is the one way to finish setup without going off
    // to buy metered billing first, which makes it the most useful sentence in
    // this dialog for the people most likely to be stuck in it.
    const free = providers.find((p) => p.viaClaudeCode)
    el('providerList').innerHTML =
      (free
        ? `<div class="provider-free">
             <b>You are ready.</b>
             <span>Claude Code is installed, so ${esc(free.label)} answers on your own
               subscription rather than on metered billing. Nothing to paste.</span>
           </div>`
        : '') +
      providers
        .map((p) => `<div class="provider ${p.status?.ok ? 'ok' : ''}" data-provider="${esc(p.name)}">${providerRow(p)}</div>`)
        .join('')
  } catch (error) {
    el('providerList').innerHTML = `<p class="empty">${esc(error.message)}</p>`
  }
}

/**
 * What was typed into a provider's box, and which of the two things it is.
 *
 * A shouted name with underscores is a variable and never a key — no provider
 * issues credentials that look like `OPENAI_API_KEY` — so the common slip of
 * pasting the variable name instead of its value does the right thing rather
 * than being stored as a key that will never work. `env:` says it outright.
 * Empty means "it is already in your environment; go and look".
 */
function credential(typed) {
  const said = typed.trim()
  if (!said) return {}
  if (/^env:/i.test(said)) return { env: said.slice(4).trim() }
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(said)) return { env: said }
  return { key: said }
}

// One handler for the whole list: a row that has just connected is redrawn,
// and a listener bound to the old markup would go with it.
el('providerList').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-connect]')
  if (!form) return
  event.preventDefault()

  const name = form.getAttribute('data-connect')
  const field = form.querySelector('input')
  const button = form.querySelector('button')
  const said = form.querySelector('.provider-said')

  const tell = (text, held = false) => {
    said.textContent = text
    said.className = `provider-said ${held ? 'held' : ''}`
    said.classList.toggle('hidden', !text)
  }

  button.disabled = true
  button.textContent = 'Trying…'
  tell('')
  try {
    const answer = await post('/api/providers', { name, ...credential(field.value) })
    const provider = providers.find((p) => p.name === name)
    if (provider) {
      provider.status = answer.status
      provider.configured = true
      // A key of its own supersedes the subscription route, and the daemon says
      // so on the next look; until then the row must not claim both.
      if (answer.status?.ok) provider.viaClaudeCode = false
    }
    if (answer.status?.ok) {
      toast(`${answer.label} is connected.`, 'good')
      // The strip is a state machine over whether a model can be reached at
      // all, so connecting one changes what the whole home screen says.
      refreshCity().catch(() => {})
    }
    repaintProvider(name)
    // Saved, and still not answering: the row now says why, and the warning is
    // the one thing the row cannot know — that the variable is not set here.
    if (!answer.status?.ok || answer.warning) {
      const row = el('providerList').querySelector(`[data-provider="${CSS.escape(name)}"] .provider-said`)
      if (row) {
        row.textContent = answer.warning ?? answer.status?.reason ?? 'Saved, but it does not answer yet.'
        row.classList.remove('hidden')
      }
    }
  } catch (error) {
    // Under the field that caused it, and nowhere else. The daemon's 422 for
    // this says exactly what to type, which is worth more than a toast.
    tell(error.message)
    field.focus()
  } finally {
    button.disabled = false
    button.textContent = 'Connect'
  }
})

function openProviders() {
  el('settingsDialog').showModal()
  paintProviders().catch(oops)
}

el('openSettings').onclick = openProviders
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
  const on = bridge.status.state === 'live' && wired
  const said =
    !bridge.connected ? 'Discord not set up'
    : !wired ? 'not wired to a channel'
    : bridge.status.state === 'live' ? `carried to Discord${bridge.status.as ? ` as ${bridge.status.as}` : ''}`
    : bridge.status.state === 'refused' ? 'Discord refused the token'
    : bridge.status.detail ?? bridge.status.state

  el('mailBridge').className = `mail-bridge ${on ? 'on' : ''}`
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
 * That something is happening, said where you are looking, in somebody's name.
 *
 * A goal takes minutes and the only sign of it used to be a greyed-out button,
 * a feed at the bottom of another tab, and the word "Working…" — which is the
 * app describing itself rather than saying what is going on. Somebody in this
 * building is doing it, and they have a name.
 *
 * `workingSince` is null unless we watched it start. The daemon does not report
 * when the current goal began, so opening the page midway through one would
 * count from the moment you arrived and call it "so far". A blank is honest; a
 * confident wrong number is not.
 */
let workingSince = null
let workingWho = ''
let workingDetail = ''

/**
 * Who, and what they are doing, in one line.
 *
 * Kept as two pieces rather than one string because they arrive from different
 * places at different rates: the name comes from a refresh, the detail comes
 * from the stream several times a second. Writing the whole line from a refresh
 * would rub out the more specific half a moment after it appeared.
 */
function sayWorking() {
  const said = workingWho || 'Somebody'
  el('workingLine').textContent = workingDetail ? `${said} — ${workingDetail}` : `${said}'s on it`
}

function showWorking(on, building) {
  el('working').classList.toggle('hidden', !on)
  if (!on) {
    workingSince = null
    workingWho = ''
    workingDetail = ''
    el('workingLine').textContent = ''
    tickWorking()
    return
  }
  const busy = building?.staff.find((floor) => floor.state === 'working')
  const name = busy?.name ?? ''
  // Between tasks no floor is flagged; the last person to be working is still
  // the truest thing we can say, so the name is kept until somebody else takes
  // over — and only then is their line thrown away with them.
  if (name && name !== workingWho) { workingWho = name; workingDetail = '' }
  sayWorking()
  tickWorking()
}

/** Progress from the stream, kept under the name of whoever is making it. */
function workingSays(detail) {
  const said = clip(detail ?? '', 90)
  if (!said) return
  workingDetail = said
  sayWorking()
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

/**
 * Answer a docket. `after` is what to redraw, because the same decision is
 * offered from two places: the building's own desk, and the round on the
 * street. The daemon finds the building the approval belongs to either way.
 */
async function decide(id, granted, after = refreshBuilding) {
  try {
    const result = await post(`/api/approvals/${encodeURIComponent(id)}`, { granted })
    toast(result.hired ? `${result.hired.name} joins.` : granted ? 'Allowed.' : 'Refused.', granted ? 'good' : '')
    // A hire is a new storey, so the drawing is now wrong rather than just out
    // of date. Cleared before the redraw, or the redraw reuses the old shape.
    drawnShape = ''
    await after()
    if (!el('round').classList.contains('hidden')) await paintRound()
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
  clearGroundErrors()
  el('groundDialog').showModal()
  el('gName').focus()
}

// ── wiring ─────────────────────────────────────────────────────────────────

el('goHome').onclick = goHome

/**
 * The keyboard.
 *
 * Where you are decides what a key does, because the two screens are two
 * places: on the street a number is a building, inside one it is a floor's
 * tab. That is the same rule the rest of the app follows, and it means the
 * whole map is six keys rather than sixteen.
 *
 * Nothing here fires while a person is typing, and nothing here fires while a
 * dialog is open — a dialog is a room with its own door, and Escape is how you
 * leave it.
 */
const TABS = ['floors', 'work', 'desk', 'mail', 'orders', 'archives']

/** True when the keystroke belongs to whatever is being typed into. */
function typing(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Put the cursor where the main thing you write on this screen is written. */
function focusTheBox() {
  const box = view.screen === 'building' ? el('goalText') : el('askText')
  if (box.disabled || box.closest('.hidden')) return
  box.focus()
  box.select()
}

document.addEventListener('keydown', (event) => {
  const open = document.querySelector('dialog[open]')

  // Escape steps back outside. Not while a dialog is open — that is the
  // dialog's own, and the browser already handles it.
  if (event.key === 'Escape') {
    if (!open && view.screen === 'building') goHome()
    return
  }

  // `?` is the one key that works from inside a dialog, because the moment you
  // most want the map is the moment you are somewhere you did not mean to be.
  if (event.key === '?' && !typing(event.target)) {
    event.preventDefault()
    open?.close()
    el('keysDialog').showModal()
    return
  }

  if (open || typing(event.target)) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  // Nothing here reaches anything while the app cannot be talked to.
  if (view.screen === 'blocked') return

  // `/` reaches for the box you write in, wherever you are. Prevented, or the
  // slash arrives in the box you just focused.
  if (event.key === '/') {
    event.preventDefault()
    focusTheBox()
    return
  }

  if (view.screen === 'building') {
    const tab = TABS[Number(event.key) - 1]
    if (tab) { event.preventDefault(); selectTab(tab) }
    else if (event.key === 'g') { event.preventDefault(); goHome() }
    return
  }

  // On the street, left to right, the way they are standing.
  if (event.key === 'n') { event.preventDefault(); breakGround(); return }
  const nth = skyline[Number(event.key) - 1]
  if (nth) { event.preventDefault(); openBuilding(nth.id) }
})

el('openKeys').onclick = () => el('keysDialog').showModal()

/**
 * Boarding a building up, and bringing one back.
 *
 * Breaking ground was one typo away from a building nobody could remove. The
 * store has been able to mothball one since the first commit and nothing ever
 * called it — so a skyline could only ever grow, and the only way out was to
 * edit the database by hand.
 *
 * It is not a delete and the dialog says so: one column changes, and the
 * floors, archives, post and workspace are untouched. That is also why it can
 * be undone from the street with one press.
 */
el('boardUp').onclick = () => {
  if (!current) return
  el('boardWho').textContent = `Board up ${current.name}?`
  el('boardDialog').showModal()
}
el('boardCancel').onclick = () => el('boardDialog').close()
el('boardForm').onsubmit = async (event) => {
  event.preventDefault()
  const building = current
  if (!building) return
  el('boardDialog').close()
  try {
    await post(`/api/buildings/${encodeURIComponent(building.id)}/close`)
    toast(`${building.name} is boarded up. Nothing was deleted.`)
    drawnShape = ''
    goHome()
  } catch (error) { oops(error) }
}

/** What has been taken off the skyline, and the way back. */
function paintBoarded(boardedUp = []) {
  const box = el('boarded')
  box.classList.toggle('hidden', boardedUp.length === 0)
  if (boardedUp.length === 0) return
  box.innerHTML =
    `<span class="cut-role">Boarded up</span>` +
    boardedUp
      .map(
        (building) => `<span class="boarded-one">${esc(building.name)}
          <button type="button" class="ghost" data-reopen="${esc(building.id)}">Bring it back</button>
        </span>`,
      )
      .join('')

  for (const button of box.querySelectorAll('[data-reopen]')) {
    button.onclick = async () => {
      try {
        const { building } = await post(`/api/buildings/${encodeURIComponent(button.getAttribute('data-reopen'))}/reopen`)
        toast(`${building.name} is back on the skyline.`, 'good')
        drawnShape = ''
        await refreshCity()
      } catch (error) { oops(error) }
    }
  }
}

/**
 * Which room you are standing in.
 *
 * The bar was six buttons carrying `role="tab"` and nothing else: no
 * `aria-selected` anywhere in the page, no panel that claimed to belong to one,
 * and no arrow keys — so a screen reader announced six identical buttons and
 * never said which was current, and a keyboard had to press Tab six times to
 * get past a bar that is supposed to be one stop.
 *
 * `focus` is passed only when the move came from the keyboard. Clicking a tab
 * has already put focus where the person meant it.
 */
function selectTab(name, { focus = false } = {}) {
  view.tab = name
  // Opening your post is reading it.
  if (name === 'mail' && view.building) {
    post(`/api/buildings/${encodeURIComponent(view.building)}/mail/read`)
      .then(() => badge('badgeMail', 0))
      .catch(() => {})
  }
  for (const tab of el('tabs').querySelectorAll('.tab')) {
    const on = tab.dataset.tab === name
    tab.classList.toggle('on', on)
    tab.setAttribute('aria-selected', String(on))
    // A roving tabindex: the bar is one stop, and the arrows move within it.
    tab.tabIndex = on ? 0 : -1
    if (on && focus) tab.focus()
  }
  for (const pane of document.querySelectorAll('.pane')) {
    pane.classList.toggle('hidden', pane.dataset.pane !== name)
  }
}
for (const tab of el('tabs').querySelectorAll('.tab')) {
  tab.onclick = () => selectTab(tab.dataset.tab)
}

// Left and right walk the bar; Home and End go to either end of it. The same
// order the digits use, which is the order they are standing in.
el('tabs').addEventListener('keydown', (event) => {
  const move = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' }[event.key]
  if (move === undefined) return
  event.preventDefault()
  const at = Math.max(0, TABS.indexOf(view.tab))
  const to = move === 'first' ? 0
    : move === 'last' ? TABS.length - 1
    : (at + move + TABS.length) % TABS.length
  selectTab(TABS[to], { focus: true })
})

/**
 * Where breaking ground reports a refusal.
 *
 * It used to report it twice, in the notice bar and in a toast — both of them
 * outside the open dialog and underneath its own scrim — while the field that
 * caused it said nothing. The daemon is specific about which of the two is
 * wrong, so the message is printed under that one and the field is marked.
 */
const GROUND_FIELDS = [
  { field: 'gPathField', slot: 'gPathError', input: 'gPath', about: /director|workspace|folder|path|is a file/i },
  { field: 'gNameField', slot: 'gNameError', input: 'gName', about: /name|called/i },
]

function clearGroundErrors() {
  for (const { field, slot } of GROUND_FIELDS) {
    el(field).classList.remove('wrong')
    el(slot).classList.add('hidden')
    el(slot).textContent = ''
  }
  el('gFormError').classList.add('hidden')
  el('gFormError').textContent = ''
}

function groundRefused(message) {
  clearGroundErrors()
  const which = GROUND_FIELDS.find((one) => one.about.test(message))
  if (!which) {
    el('gFormError').textContent = message
    el('gFormError').classList.remove('hidden')
    return
  }
  el(which.field).classList.add('wrong')
  el(which.slot).textContent = message
  el(which.slot).classList.remove('hidden')
  el(which.input).focus()
  el(which.input).select()
}

el('groundCancel').onclick = () => el('groundDialog').close()
el('groundForm').onsubmit = async (event) => {
  event.preventDefault()
  clearGroundErrors()
  try {
    const building = await post('/api/buildings', {
      name: el('gName').value.trim(),
      workspace: el('gPath').value.trim(),
      charter: el('gCharter').value.trim() || undefined,
    })
    el('groundDialog').close()
    el('groundForm').reset()
    // A warning is not a failure, but it is also not something to say for three
    // and a half seconds and then take away.
    if (building.warning) { el('notice').classList.add('quiet'); notice('Worth knowing', building.warning) }
    else toast(`${building.name} — ground broken.`, 'good')
    drawnShape = ''
    await refreshCity()
    // Straight to the one thing that makes it do anything.
    openBuilding(building.id, 'hire')
  } catch (error) {
    // The dialog is still open and still holds what was typed, so the answer
    // goes in it rather than to a bar the scrim is covering.
    groundRefused(error.message)
  }
}

el('hireForm').onsubmit = async (event) => {
  event.preventDefault()
  try {
    const floor = await post(`/api/buildings/${encodeURIComponent(view.building)}/hire`, {
      role: el('hRole').value,
      name: el('hName').value.trim() || undefined,
    })
    el('hName').value = ''
    toast(`${floor.name} joins as ${floor.role}. The building grows a storey.`, 'good')
    drawnShape = ''
    await refreshBuilding()
  } catch (error) { oops(error) }
}

/**
 * Putting a goal to a building.
 *
 * The box used to be cleared and the tab switched *before* the request went
 * out, so a 409, a 422 or a budget refusal left you on another tab with an
 * empty box and a toast that vanished in three and a half seconds — the
 * sentence you had typed was simply gone. There was no `disabled` either, so a
 * second Enter fired a second POST that 409'd against the first.
 *
 * Clear on success only. Disabled while it is in the air.
 */
let sendingGoal = false

el('goalForm').onsubmit = async (event) => {
  event.preventDefault()
  const goal = el('goalText').value.trim()
  if (!goal || !view.building || sendingGoal) return

  sendingGoal = true
  el('goalGo').disabled = true
  el('goalGo').textContent = 'Sending…'
  try {
    await post(`/api/buildings/${encodeURIComponent(view.building)}/goal`, { goal })
    el('goalText').value = ''
    // It is running now whatever the last refresh thought, so the box stays
    // shut until one comes back and says otherwise.
    if (current) current.working = true
    selectTab('work')
  } catch (error) {
    oops(error)
  } finally {
    sendingGoal = false
    el('goalGo').textContent = 'Send'
    el('goalGo').disabled = Boolean(current?.working)
  }
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
  .catch(() => {})

// The ladder, fetched once. Nothing on the screen waits for it: a blurb that
// arrives a beat late is better than a building screen that does.
api('/api/tiers')
  .then(({ tiers }) => {
    ladder = tiers
    if (current) {
      el('bBlurb').textContent = blurbOf(current.tier)
      paintNextForm(current)
    }
  })
  .catch(() => {})

// ── the live stream ────────────────────────────────────────────────────────

const LOUD = new Set([
  'goal-started', 'goal-finished', 'hired', 'ground-broken', 'curated', 'decided',
  'boarded-up', 'reopened',
])
/** Events that mean the drawing itself is now wrong, not just the numbers. */
const RESHAPES = new Set(['hired', 'ground-broken'])

/**
 * What each event is called on screen.
 *
 * The feed printed the event's own name — `goal-started`, `ground-broken`,
 * `schedule-skipped` — which are identifiers this code passes between its own
 * functions, and the only place in the product where one reached a person. A
 * log is still a log: short, monospace, newest first. That is not a reason to
 * show somebody a hyphenated symbol and expect them to read it as a word.
 *
 * A kind with no entry here keeps its own name rather than disappearing, so
 * one added tomorrow is visible and merely ugly.
 */
const SAID = {
  'goal-started': 'Set to work',
  'goal-finished': 'Came back',
  'goal-failed': 'Stopped',
  'ground-broken': 'Broke ground',
  hired: 'Taken on',
  curated: 'Archives tidied',
  scheduled: 'Standing order set',
  'schedule-due': 'Standing order due',
  'schedule-skipped': 'Standing order skipped',
  'bridge-changed': 'Discord',
  bridge: 'Discord',
  asked: 'Asked',
  answered: 'Answered',
  looking: 'Reading',
  progress: 'Working',
  posted: 'Post',
  step: 'Step',
}

/** Events whose detail is already a whole sentence. A prefix would say it twice. */
const SPEAKS_FOR_ITSELF = new Set(['recovered', 'decided', 'ticker-failed', 'boarded-up', 'reopened'])

/** The chip in the corner, which should only ever claim what is true. */
function live(state, said) {
  el('live').className = `live ${state}`
  el('live').lastElementChild.textContent = said
}

let stream = null

function openStream() {
  stream?.close()
  stream = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
  stream.onopen = () => { if (!blocked) live('on', 'live') }
  stream.onerror = () => {
    // A stream that has been refused will never come back on its own, and
    // saying "reconnecting" about it is the app being wrong out loud.
    if (!blocked) live('off', 'reconnecting')
  }
  stream.onmessage = onEvent
}

/**
 * A goal has come back, told honestly.
 *
 * This used to be one green toast reading "Finished." whatever happened —
 * including after a run in which no floor did any work at all, which is the
 * product lying at its single most important moment. The daemon already sends
 * how many tasks were worked and how many are outstanding, and that is enough
 * to tell the cases apart without inventing anything.
 */
function cameBack(event) {
  const did = Number(event.data?.worked ?? 0)
  const left = Number(event.data?.outstanding ?? 0)
  const spent = Number(event.data?.tokens ?? 0)

  if (did > 0) {
    toast(`Came back — ${plural(did, 'task')} worked${spent ? `, ${tokens(spent)} tokens` : ''}.`, 'good')
    return
  }
  // Nothing was done. That is not a success and it is not quite a failure, and
  // it is the outcome a new owner hits most, so it gets the surface that stays.
  el('notice').classList.add('quiet')
  notice(
    'It came back having done nothing',
    event.detail ? clip(event.detail, 200) : 'No floor picked anything up.',
    left ? `${plural(left, 'task')} still queued — the Work tab has them.` : undefined,
  )
}

function onEvent(message) {
  const event = JSON.parse(message.data)

  const tone = event.kind === 'goal-failed' ? 'bad' : LOUD.has(event.kind) ? 'hi' : 'lit'
  if (event.kind === 'tool') {
    // A tool call is a thing a floor did on the way, so it is indented under
    // the line it belongs to rather than given a heading of its own.
    say(`· ${event.detail}`, 'tool', event.at)
  } else if (SPEAKS_FOR_ITSELF.has(event.kind)) {
    say(event.detail ?? SAID[event.kind] ?? event.kind, tone, event.at)
  } else {
    const said = SAID[event.kind] ?? event.kind
    say(event.detail ? `${said} — ${event.detail}` : said, tone, event.at)
  }

  // The concierge says what it is opening as it goes.
  if (event.kind === 'looking' && el('askGo').disabled) {
    const step = String(event.detail ?? '').replace(/_/g, ' ')
    if (step && looking.at(-1) !== step) looking.push(step)
    const line = el('answer').querySelector('.answering')
    if (line) line.innerHTML = `<span class="spin"></span>${esc(looking.slice(-3).join(' · '))}`
  }

  if (event.kind === 'goal-finished') cameBack(event)
  if (event.kind === 'goal-failed') {
    /*
     * The daemon works out *why* a goal stopped and *what to do about it*, and
     * this used to throw both away and print the headline alone.
     *
     * That is the worst possible moment to be terse. A first goal that stops
     * for want of a credential is the exact failure this app was abandoned
     * over, and what the owner got was a red bar reading "Help Center could not
     * start." and nothing else — no cause, no remedy, and no way on. Both
     * fields are already computed, already tested, and already on the event.
     */
    const why = event.data?.why
    const remedy = event.data?.remedy
    const said = event.data?.headline ?? event.detail ?? 'That goal stopped.'
    oops(new Trouble(why ? `${said} ${why}` : said, remedy))
    // When the cause is that nothing can answer, the remedy is a dialog rather
    // than a sentence, so offer the dialog.
    if (event.data?.verdict === 'could-not-start') offerProviders()
  }
  if (event.kind === 'asked') toast('Something needs your say-so.')

  // What the building is doing right now, in its own words.
  if (view.screen === 'building' && event.building === view.building) {
    if (event.kind === 'progress' || event.kind === 'step') workingSays(event.detail)
    if (event.kind === 'tool') workingSays(`using ${clip(event.detail ?? '', 40)}`)
    // Seeing it start is the only way we can honestly count from it.
    if (event.kind === 'goal-started') { workingSince = Date.now(); showWorking(true, current) }
    if (event.kind === 'goal-finished' || event.kind === 'goal-failed') showWorking(false)
  }

  if (event.kind === 'posted' && view.screen === 'building') paintMail().catch(() => {})
  if (event.kind === 'bridge' || event.kind === 'bridge-changed') paintBridge().catch(() => {})
  if (RESHAPES.has(event.kind)) drawnShape = ''
  // Tool chatter arrives many times a second; refreshing on it would mean a
  // request per tool call and a page that never settles.
  if (event.kind === 'tool' || event.kind === 'step') return

  if (view.screen === 'city') refreshCity().catch(() => {})
  else if (view.screen === 'building' && (!event.building || event.building === view.building)) {
    refreshBuilding().catch(() => {})
  }
}

/**
 * A differently-shaped hole needs the drawing cut again.
 *
 * The window was the only thing watched, and it is not the only thing that
 * changes the shape of that hole: the frame takes what is left after the strip
 * below it, so opening the concierge's answer or the round shortens the city
 * without the window moving at all. The drawing stayed the ratio it was cut to
 * and shrank to a postage stamp in the middle of a wide band.
 *
 * Watching the frame itself covers the window too, so there is one rule rather
 * than a list of things that happen to resize it. Debounced: a drag fires this
 * a hundred times, and each one is a round trip.
 */
let resizeTimer
let refitBox = ''
const refit = () => {
  // The observer fires on our own redraw as well as on a real change, and a
  // drawing wide enough to want a scrollbar changes the height of the box it
  // is measured against. Comparing the box we would ask for against the one we
  // last asked for stops that becoming a loop between two sizes.
  const box = cityBox()
  const asking = `${box.width}×${box.height}`
  if (asking === refitBox) return
  refitBox = asking
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (view.screen === 'city') refreshCity().catch(() => {})
  }, 220)
}
window.addEventListener('resize', refit)
new ResizeObserver(refit).observe(el('cityScroll'))

// A slow poll behind the stream, because a dropped connection should not leave
// the numbers frozen until somebody clicks something.
setInterval(() => {
  if (document.hidden || blocked) return
  if (view.screen === 'city') refreshCity().catch(() => {})
  else if (view.screen === 'building') refreshBuilding().catch(() => {})
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

openStream()
wireParallax()
goHome()
