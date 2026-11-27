import { useEffect, useMemo, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ImageIcon, Pause, Play, RotateCcw, Volume2, VolumeX, Users } from "lucide-react"
import "./loteria.css"

type Language = "es" | "en"
type GameStatus = "lobby" | "countdown" | "playing" | "paused" | "won" | "ended"

type LoteriaCard = {
  id: string
  nameEs: string
  nameEn: string
  image: string
  originalImage?: string
  symbol: string
}

type RoomState = {
  code: string
  status: GameStatus
  round: number
  intervalSeconds: number
  countdownSeconds: number
  joinUrl: string
  tvUrl: string
  playerCount: number
  players: Array<{ id: string; name: string; queued: boolean; connected: boolean }>
  cards: LoteriaCard[]
  currentCard: LoteriaCard | null
  recentCards: LoteriaCard[]
  calledCardIds: string[]
  nextCallAt: number | null
  winner: null | { playerId: string; name: string; line: number[]; cardIds: string[] }
  endedReason: string
  player: null | {
    id: string
    name: string
    queued: boolean
    board: LoteriaCard[]
    marks: string[]
    claimMessage: string
  }
}

const text = {
  es: {
    title: "Lotería de la Fiesta",
    scan: "Escanea para entrar",
    instructions: "Escanea para entrar. Toca las cartas que coincidan en tu tabla. Completa una línea y toca ¡Lotería!",
    join: "Entrar a la sala",
    code: "Código de sala",
    name: "Tu nombre",
    enter: "Entrar",
    claim: "¡Lotería!",
    waiting: "Esperando al anfitrión",
    queued: "La ronda ya empezó. Puedes mirar y jugarás en la próxima ronda.",
    current: "Carta actual",
    next: "Siguiente carta",
    recent: "Últimas cartas",
    players: "Jugadores",
    sound: "Activar sonido",
    soundOn: "Sonido activado",
    host: "Control del anfitrión",
    create: "Crear sala",
    start: "Iniciar",
    pause: "Pausar",
    resume: "Continuar",
    newRound: "Nueva ronda",
    interval: "Segundos entre cartas",
    tv: "Abrir pantalla de TV",
    won: "¡Lotería!",
    ended: "Ronda terminada",
    connecting: "Conectando…",
    marked: "Marcada",
    round: "Ronda"
  },
  en: {
    title: "Fiesta Lotería",
    scan: "Scan to join",
    instructions: "Scan to join. Tap matching cards on your board. Complete a line and tap Lotería!",
    join: "Join the room",
    code: "Room code",
    name: "Your name",
    enter: "Join",
    claim: "Lotería!",
    waiting: "Waiting for the host",
    queued: "This round already started. Watch now and play in the next round.",
    current: "Current card",
    next: "Next card",
    recent: "Recent calls",
    players: "Players",
    sound: "Enable sound",
    soundOn: "Sound enabled",
    host: "Host controls",
    create: "Create room",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    newRound: "New round",
    interval: "Seconds between cards",
    tv: "Open TV display",
    won: "Lotería!",
    ended: "Round ended",
    connecting: "Connecting…",
    marked: "Marked",
    round: "Round"
  }
} as const

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
  return result
}

function useClock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function useRoom(code: string, playerToken = "") {
  const [state, setState] = useState<RoomState | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!code) return
    const params = new URLSearchParams(playerToken ? { playerToken } : {})
    const roomPath = `/api/loteria/rooms/${encodeURIComponent(code)}?${params}`
    let cancelled = false
    let fallbackTimer: number | undefined
    const loadSnapshot = async () => {
      try {
        const next = await request<RoomState>(roomPath)
        if (!cancelled) {
          setState(next)
          setError("")
        }
      } catch {
        if (!cancelled) setError("Reconectando…")
      }
    }
    void loadSnapshot()
    const source = new EventSource(`/api/loteria/rooms/${encodeURIComponent(code)}/events?${params}`)
    source.addEventListener("state", (event) => {
      setState(JSON.parse((event as MessageEvent<string>).data) as RoomState)
      setError("")
      if (fallbackTimer !== undefined) {
        window.clearInterval(fallbackTimer)
        fallbackTimer = undefined
      }
    })
    source.onopen = () => setError("")
    source.onerror = () => {
      setError("Reconectando…")
      void loadSnapshot()
      fallbackTimer ??= window.setInterval(() => void loadSnapshot(), 2_000)
    }
    return () => {
      cancelled = true
      source.close()
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer)
    }
  }, [code, playerToken])
  return { state, setState, error }
}

function LanguageButton({ language, onChange }: { language: Language; onChange: (value: Language) => void }) {
  return <Button className="loteria-language" variant="outline" onClick={() => onChange(language === "es" ? "en" : "es")}>
    {language === "es" ? "English" : "Español"}
  </Button>
}

function CardFace({ card, marked = false, called = false, compact = false, winning = false, onClick }: {
  card: LoteriaCard
  marked?: boolean
  called?: boolean
  compact?: boolean
  winning?: boolean
  onClick?: () => void
}) {
  const [showOriginal, setShowOriginal] = useState(false)
  const content = <>
    <span className="loteria-card-art" style={{ backgroundImage: `url(${card.image})` }} aria-hidden="true">
      <span>{card.symbol}</span>
    </span>
    <strong>{card.nameEs}</strong>
    {marked && <span className="loteria-bean" aria-hidden="true">●</span>}
  </>
  const className = `loteria-card${marked ? " is-marked" : ""}${called ? " is-called" : ""}${compact ? " is-compact" : ""}${winning ? " is-winning" : ""}`
  const face = onClick
    ? <button type="button" className={className} onClick={onClick} aria-pressed={marked}>{content}</button>
    : <div className={className}>{content}</div>
  return <div className={`loteria-card-shell${compact ? " is-compact" : ""}`}>
    {face}
    {card.originalImage && <>
      <button type="button" className="loteria-original-photo" onClick={() => setShowOriginal(true)} aria-label={`Ver foto original de ${card.nameEs}`} title="Ver foto original"><ImageIcon /></button>
      <Dialog open={showOriginal} onOpenChange={setShowOriginal}>
        <DialogContent className="loteria-original-dialog">
          <DialogHeader><DialogTitle>Foto original · {card.nameEs}</DialogTitle><DialogDescription>La foto familiar que inspiró esta carta.</DialogDescription></DialogHeader>
          <img src={card.originalImage} alt={`Foto original de ${card.nameEs}`} />
        </DialogContent>
      </Dialog>
    </>}
  </div>
}

function Countdown({ state, language }: { state: RoomState; language: Language }) {
  const now = useClock()
  const seconds = state.nextCallAt ? Math.max(0, Math.ceil((state.nextCallAt - now) / 1000)) : 0
  if (state.status === "paused") return <div className="loteria-countdown"><Pause /> {language === "es" ? "Pausado" : "Paused"}</div>
  if (!state.nextCallAt) return null
  return <div className="loteria-countdown"><span>{text[language].next}</span><strong>{seconds}</strong></div>
}

function Winner({ state }: { state: RoomState }) {
  if (!state.winner) return null
  const cards = state.winner.cardIds.map((id) => state.cards.find((card) => card.id === id)).filter(Boolean) as LoteriaCard[]
  return <div className="loteria-winner" role="status">
    <p>¡Lotería!</p>
    <h1>{state.winner.name}</h1>
    <div className="loteria-winning-line">{cards.map((card) => <CardFace key={card.id} card={card} compact winning />)}</div>
  </div>
}

function TvView({ code }: { code: string }) {
  const [language, setLanguage] = useState<Language>("es")
  const [sound, setSound] = useState(false)
  const { state, error } = useRoom(code)
  const spokenCard = useRef("")
  useEffect(() => {
    if (!sound || !state?.currentCard) return
    const currentCard = state.currentCard
    const speechId = `${state.round}:${currentCard.id}`
    if (spokenCard.current === speechId) return
    const speakInSpanish = () => {
      const spanishVoices = window.speechSynthesis.getVoices().filter((voice) => /^es(?:[-_]|$)/i.test(voice.lang))
      if (!spanishVoices.length) return false
      const feminineVoice = /sabina|paulina|dalia|m[oó]nica|helena|ximena|laura|luciana|paloma|soledad|female|mujer/i
      const voice = spanishVoices.find((candidate) => /^es[-_]MX$/i.test(candidate.lang) && feminineVoice.test(candidate.name))
        || spanishVoices.find((candidate) => feminineVoice.test(candidate.name))
        || spanishVoices.find((candidate) => /^es[-_]MX$/i.test(candidate.lang))
        || spanishVoices[0]
      const lockKey = `loteria:${code}:spoken:${speechId}`
      const lastSpokenAt = Number(window.localStorage.getItem(lockKey) || 0)
      spokenCard.current = speechId
      if (Date.now() - lastSpokenAt < 30_000) return true
      window.localStorage.setItem(lockKey, String(Date.now()))
      const utterance = new SpeechSynthesisUtterance(currentCard.nameEs)
      utterance.voice = voice
      utterance.lang = voice.lang
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      return true
    }
    if (speakInSpanish()) return
    window.speechSynthesis.addEventListener("voiceschanged", speakInSpanish, { once: true })
    return () => window.speechSynthesis.removeEventListener("voiceschanged", speakInSpanish)
  }, [code, sound, state?.currentCard, state?.round])
  if (!state) return <Loading message={error || text[language].connecting} />
  const t = text[language]
  return <main className="loteria-shell loteria-tv">
    <LanguageButton language={language} onChange={setLanguage} />
    <header className="loteria-tv-header"><div><span className="loteria-kicker">{t.round} {state.round}</span><h1>{t.title}</h1></div><Badge className="loteria-room-code">{state.code}</Badge></header>
    {state.winner ? <Winner state={state} /> : state.status === "lobby" ? <section className="loteria-lobby-grid">
      <Card className="loteria-qr-card"><CardHeader><CardTitle>{t.scan}</CardTitle><CardDescription>{t.instructions}</CardDescription></CardHeader><CardContent><QRCodeSVG value={state.joinUrl || `${window.location.origin}/loteria/${state.code}`} size={280} level="M" marginSize={2} /><div className="loteria-join-code">{state.code}</div></CardContent></Card>
      <Players state={state} language={language} />
    </section> : <section className="loteria-call-stage">
      <div className="loteria-current"><span className="loteria-kicker">{t.current}</span>{state.currentCard ? <CardFace card={state.currentCard} /> : <div className="loteria-ready-pulse">{state.countdownSeconds}</div>}<Countdown state={state} language={language} /></div>
      <aside><Players state={state} language={language} /><h2>{t.recent}</h2><div className="loteria-history">{state.recentCards.slice(1).map((card) => <CardFace key={card.id} card={card} compact />)}</div></aside>
    </section>}
    {state.status === "ended" && <div className="loteria-ended"><h2>{t.ended}</h2><p>{state.endedReason}</p></div>}
    <Button className="loteria-sound" variant="outline" onClick={() => setSound((value) => !value)}>{sound ? <Volume2 /> : <VolumeX />}{sound ? t.soundOn : t.sound}</Button>
  </main>
}

function Players({ state, language }: { state: RoomState; language: Language }) {
  return <Card className="loteria-players"><CardHeader><CardTitle><Users /> {text[language].players} ({state.playerCount})</CardTitle></CardHeader><CardContent><div className="loteria-player-list">{state.players.map((player) => <Badge key={player.id} variant={player.queued ? "outline" : "secondary"}>{player.name}{player.queued ? " · próxima" : ""}</Badge>)}</div></CardContent></Card>
}

function JoinLanding() {
  const [language, setLanguage] = useState<Language>("es")
  const [code, setCode] = useState("")
  const t = text[language]
  return <main className="loteria-shell loteria-center"><LanguageButton language={language} onChange={setLanguage} /><Card className="loteria-entry-card"><CardHeader><span className="loteria-logo">✦</span><CardTitle>{t.title}</CardTitle><CardDescription>{t.instructions}</CardDescription></CardHeader><CardContent><Label htmlFor="room-code">{t.code}</Label><Input id="room-code" inputMode="numeric" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="1234" /><Button size="lg" disabled={code.length !== 4} onClick={() => window.location.assign(`/loteria/${code}`)}>{t.enter}</Button></CardContent></Card></main>
}

function PlayerView({ code }: { code: string }) {
  const [language, setLanguage] = useState<Language>("es")
  const [name, setName] = useState("")
  const [token, setToken] = useState(() => window.localStorage.getItem(`loteria:${code}:player`) || "")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const { state, setState, error } = useRoom(code, token)
  const t = text[language]

  async function join() {
    setBusy(true); setMessage("")
    try {
      const result = await request<{ playerToken: string; state: RoomState }>(`/api/loteria/rooms/${code}/join`, { method: "POST", body: JSON.stringify({ name, playerToken: token }) })
      window.localStorage.setItem(`loteria:${code}:player`, result.playerToken)
      setToken(result.playerToken)
      setState(result.state)
    } catch (joinError) { setMessage(joinError instanceof Error ? joinError.message : "No se pudo entrar.") } finally { setBusy(false) }
  }

  async function mark(cardId: string) {
    setMessage("")
    try {
      const next = await request<RoomState>(`/api/loteria/rooms/${code}/mark`, { method: "POST", body: JSON.stringify({ playerToken: token, cardId }) })
      setState(next)
    } catch (markError) { setMessage(markError instanceof Error ? markError.message : "No se pudo marcar.") }
  }

  async function claim() {
    setMessage("")
    try {
      const result = await request<{ valid: boolean; reason?: string; state: RoomState }>(`/api/loteria/rooms/${code}/claim`, { method: "POST", body: JSON.stringify({ playerToken: token }) })
      setState(result.state)
      setMessage(result.valid ? "¡Lotería válida!" : result.reason || "La línea todavía no está completa.")
    } catch (claimError) { setMessage(claimError instanceof Error ? claimError.message : "No se pudo revisar el reclamo.") }
  }

  function switchPlayer() {
    window.localStorage.removeItem(`loteria:${code}:player`)
    setToken("")
    setName("")
    setMessage("")
    setState((current) => current ? { ...current, player: null } : current)
  }

  if (!state) return <Loading message={error || t.connecting} />
  if (!state.player) return <main className="loteria-shell loteria-center"><LanguageButton language={language} onChange={setLanguage} /><Card className="loteria-entry-card"><CardHeader><span className="loteria-logo">{state.code}</span><CardTitle>{t.join}</CardTitle><CardDescription>{t.instructions}</CardDescription></CardHeader><CardContent><Label htmlFor="player-name">{t.name}</Label><Input id="player-name" autoFocus maxLength={28} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) void join() }} /><Button size="lg" disabled={busy || !name.trim()} onClick={() => void join()}>{t.enter}</Button>{message && <p className="loteria-message is-error">{message}</p>}</CardContent></Card></main>
  const called = new Set(state.calledCardIds)
  const marks = new Set(state.player.marks)
  return <main className="loteria-shell loteria-phone"><LanguageButton language={language} onChange={setLanguage} /><header><div><span className="loteria-kicker">{t.round} {state.round} · {state.code}</span><h1>{state.player.name}</h1><button type="button" className="loteria-switch-player" onClick={switchPlayer}>{language === "es" ? "Cambiar jugador" : "Switch player"}</button></div>{state.currentCard && <div className="loteria-phone-call"><span>{state.currentCard.symbol}</span><strong>{language === "es" ? state.currentCard.nameEs : state.currentCard.nameEn}</strong></div>}</header>
    {state.winner && <Winner state={state} />}
    {state.player.queued ? <Card className="loteria-queued"><CardHeader><CardTitle>{t.waiting}</CardTitle><CardDescription>{t.queued}</CardDescription></CardHeader><CardContent><Players state={state} language={language} /></CardContent></Card> : <>
      <Countdown state={state} language={language} />
      <section className="loteria-board" aria-label="Lotería board">{state.player.board.map((card) => <CardFace key={card.id} card={card} marked={marks.has(card.id)} called={called.has(card.id)} onClick={() => void mark(card.id)} />)}</section>
      <Button className="loteria-claim" disabled={!(["playing", "paused"] as GameStatus[]).includes(state.status) || Boolean(state.winner)} onClick={() => void claim()}>{t.claim}</Button>
    </>}
    {(message || state.player.claimMessage) && <p className={`loteria-message${(message || state.player.claimMessage).includes("válida") ? " is-success" : " is-error"}`}>{message || state.player.claimMessage}</p>}
  </main>
}

function HostView({ initialCode, initialToken }: { initialCode: string; initialToken: string }) {
  const [language, setLanguage] = useState<Language>("es")
  const [code, setCode] = useState(initialCode)
  const [hostToken, setHostToken] = useState(initialToken)
  const [intervalSeconds, setIntervalSeconds] = useState(8)
  const [message, setMessage] = useState("")
  const { state, setState } = useRoom(code)
  const t = text[language]

  async function createRoom() {
    try {
      const result = await request<{ code: string; hostToken: string; state: RoomState }>("/api/loteria/rooms", { method: "POST", body: JSON.stringify({ intervalSeconds }) })
      setCode(result.code); setHostToken(result.hostToken); setState(result.state)
      window.localStorage.setItem(`loteria:${result.code}:host`, result.hostToken)
      window.history.replaceState({}, "", `/loteria/host/${result.code}?token=${encodeURIComponent(result.hostToken)}`)
    } catch (createError) { setMessage(createError instanceof Error ? createError.message : "No se pudo crear la sala.") }
  }

  async function action(actionName: "start" | "pause" | "resume" | "new-round") {
    setMessage("")
    try {
      const next = await request<RoomState>(`/api/loteria/rooms/${code}/host`, { method: "POST", headers: { "X-Loteria-Host-Token": hostToken }, body: JSON.stringify({ action: actionName, intervalSeconds }) })
      setState(next)
    } catch (actionError) { setMessage(actionError instanceof Error ? actionError.message : "No se pudo completar la acción.") }
  }

  if (!code) return <main className="loteria-shell loteria-center"><LanguageButton language={language} onChange={setLanguage} /><Card className="loteria-entry-card"><CardHeader><span className="loteria-logo">✦</span><CardTitle>{t.host}</CardTitle><CardDescription>Crea una sala privada y abre la pantalla de TV.</CardDescription></CardHeader><CardContent><Label htmlFor="initial-interval">{t.interval}</Label><Input id="initial-interval" type="number" min={3} max={30} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} /><Button size="lg" onClick={() => void createRoom()}>{t.create}</Button>{message && <p className="loteria-message is-error">{message}</p>}</CardContent></Card></main>
  if (!state) return <Loading message={t.connecting} />
  return <main className="loteria-shell loteria-host"><LanguageButton language={language} onChange={setLanguage} /><header><div><span className="loteria-kicker">{t.round} {state.round}</span><h1>{t.host}</h1></div><div className="loteria-host-code">{state.code}</div></header>
    <section className="loteria-host-grid"><Card><CardHeader><CardTitle>Estado: {state.status}</CardTitle><CardDescription>{state.playerCount} {t.players.toLowerCase()}</CardDescription></CardHeader><CardContent className="loteria-host-actions"><Button size="lg" disabled={state.status !== "lobby"} onClick={() => void action("start")}><Play /> {t.start}</Button><Button size="lg" variant="outline" disabled={!(["countdown", "playing"] as GameStatus[]).includes(state.status)} onClick={() => void action("pause")}><Pause /> {t.pause}</Button><Button size="lg" variant="outline" disabled={state.status !== "paused"} onClick={() => void action("resume")}><Play /> {t.resume}</Button><Button size="lg" variant="secondary" onClick={() => void action("new-round")}><RotateCcw /> {t.newRound}</Button></CardContent></Card>
      <Card><CardHeader><CardTitle>{t.interval}</CardTitle><CardDescription>3–30 segundos</CardDescription></CardHeader><CardContent><Input type="range" min={3} max={30} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} /><strong className="loteria-interval-value">{intervalSeconds}s</strong><Button variant="outline" asChild><a href={`/loteria/tv/${state.code}`} target="_blank" rel="noreferrer">{t.tv}</a></Button></CardContent></Card>
      <Players state={state} language={language} /></section>
    {message && <p className="loteria-message is-error">{message}</p>}
    {state.winner && <Winner state={state} />}
  </main>
}

function Loading({ message }: { message: string }) {
  return <main className="loteria-shell loteria-center"><div className="loteria-loading"><span>✦</span><p>{message}</p></div></main>
}

export default function LoteriaApp() {
  const path = window.location.pathname.split("/").filter(Boolean)
  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  if (path[1] === "tv") return <TvView code={String(path[2] || "").toUpperCase()} />
  if (path[1] === "host") {
    const code = String(path[2] || "").toUpperCase()
    const token = query.get("token") || (code ? window.localStorage.getItem(`loteria:${code}:host`) : "") || ""
    return <HostView initialCode={code} initialToken={token} />
  }
  if (path[1]) return <PlayerView code={String(path[1]).toUpperCase()} />
  return <JoinLanding />
}
