import { useEffect, useMemo, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { ImageIcon, Maximize2, Pause, Pencil, Play, RotateCcw, Save, Volume2, VolumeX, Users } from "lucide-react"
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
  enabledCardIds: string[]
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

type PublicRoom = {
  code: string
  status: GameStatus
  round: number
  playerCount: number
  joinUrl: string
  createdAt: string
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

class RequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new RequestError(result.error || `Request failed (${response.status})`, response.status)
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
      } catch (loadError) {
        if (cancelled) return
        if (loadError instanceof RequestError && loadError.status === 404) {
          window.location.replace(`/loteria?expired=${encodeURIComponent(code)}`)
          return
        }
        setError("Reconectando…")
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
  const [showArtwork, setShowArtwork] = useState(false)
  const content = <>
    <span className="loteria-card-art" style={{ backgroundImage: `url(${card.image})` }}>
      <img src={card.image} alt="" aria-hidden="true" />
      {!card.originalImage && <span>{card.symbol}</span>}
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
      <button type="button" className="loteria-original-photo" onClick={() => setShowArtwork(true)} aria-label={`Ampliar ${card.nameEs}`} title="Ampliar carta"><ImageIcon /></button>
      <Dialog open={showArtwork} onOpenChange={setShowArtwork}>
        <DialogContent className="loteria-original-dialog">
          <DialogHeader><DialogTitle>{card.nameEs}</DialogTitle><DialogDescription>Vista ampliada de la carta.</DialogDescription></DialogHeader>
          <img className="loteria-card-preview-art" src={card.image} alt={`Carta ${card.nameEs}`} />
          <details className="loteria-card-preview-original"><summary><ImageIcon /> Ver foto original</summary><img src={card.originalImage} alt={`Foto original de ${card.nameEs}`} /></details>
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
  const [rooms, setRooms] = useState<PublicRoom[]>([])
  const [roomsLoading, setRoomsLoading] = useState(true)
  const expiredCode = useMemo(() => new URLSearchParams(window.location.search).get("expired") || "", [])
  const t = text[language]
  useEffect(() => {
    let cancelled = false
    const loadRooms = async () => {
      try {
        const result = await request<{ rooms: PublicRoom[] }>("/api/loteria/rooms")
        if (!cancelled) setRooms(result.rooms)
      } catch {
        if (!cancelled) setRooms([])
      } finally {
        if (!cancelled) setRoomsLoading(false)
      }
    }
    void loadRooms()
    const timer = window.setInterval(() => void loadRooms(), 5_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])
  const statusLabel = (status: GameStatus) => language === "es"
    ? ({ lobby: "Esperando", countdown: "Comenzando", playing: "Jugando", paused: "Pausada", won: "Ganador", ended: "Terminada" } as const)[status]
    : ({ lobby: "Waiting", countdown: "Starting", playing: "Playing", paused: "Paused", won: "Winner", ended: "Ended" } as const)[status]
  return <main className="loteria-shell loteria-center loteria-landing"><LanguageButton language={language} onChange={setLanguage} /><div className="loteria-landing-content">{expiredCode && <p className="loteria-message is-error">{language === "es" ? `La sala ${expiredCode} ya terminó. Elige una sala activa o escribe otro código.` : `Room ${expiredCode} has ended. Choose an active room or enter another code.`}</p>}<Card className="loteria-entry-card"><CardHeader><span className="loteria-logo">✦</span><CardTitle>{t.title}</CardTitle><CardDescription>{t.instructions}</CardDescription></CardHeader><CardContent><Label htmlFor="room-code">{t.code}</Label><Input id="room-code" inputMode="numeric" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="1234" /><Button size="lg" disabled={code.length !== 4} onClick={() => window.location.assign(`/loteria/${code}`)}>{t.enter}</Button></CardContent></Card><section className="loteria-active-rooms" aria-live="polite"><h2>{language === "es" ? "Salas activas" : "Active rooms"}</h2>{roomsLoading ? <p>{t.connecting}</p> : rooms.length ? <div className="loteria-room-list">{rooms.map((room) => <Card key={room.code} className="loteria-room-option"><CardContent><div><strong>{room.code}</strong><span>{statusLabel(room.status)} · {language === "es" ? "Ronda" : "Round"} {room.round} · {room.playerCount} {room.playerCount === 1 ? (language === "es" ? "jugador" : "player") : (language === "es" ? "jugadores" : "players")}</span></div><Button asChild><a href={`/loteria/${room.code}`}>{language === "es" ? "Entrar" : "Join"}</a></Button></CardContent></Card>)}</div> : <p>{language === "es" ? "No hay salas activas ahora." : "There are no active rooms right now."}</p>}</section></div></main>
}

function TvLanding() {
  const [language, setLanguage] = useState<Language>("es")
  const [code, setCode] = useState("")
  return <main className="loteria-shell loteria-center"><LanguageButton language={language} onChange={setLanguage} /><Card className="loteria-entry-card"><CardHeader><span className="loteria-logo">TV</span><CardTitle>{language === "es" ? "Pantalla de TV" : "TV display"}</CardTitle><CardDescription>{language === "es" ? "Escribe el código de 4 dígitos de la sala." : "Enter the room's 4-digit code."}</CardDescription></CardHeader><CardContent><Label htmlFor="tv-room-code">{text[language].code}</Label><Input id="tv-room-code" autoFocus inputMode="numeric" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && code.length === 4) window.location.assign(`/tv/${code}`) }} placeholder="1234" /><Button size="lg" disabled={code.length !== 4} onClick={() => window.location.assign(`/tv/${code}`)}>{language === "es" ? "Abrir TV" : "Open TV"}</Button></CardContent></Card></main>
}

function PlayerView({ code }: { code: string }) {
  const [language, setLanguage] = useState<Language>("es")
  const [name, setName] = useState("")
  const [token, setToken] = useState(() => window.localStorage.getItem(`loteria:${code}:player`) || "")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const { state, setState, error } = useRoom(code, token)
  const t = text[language]

  useEffect(() => {
    if (!message || message.includes("válida")) return
    const timer = window.setTimeout(() => setMessage(""), 3_000)
    return () => window.clearTimeout(timer)
  }, [message])

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
      setMessage("")
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
  const [deckSettingsOpen, setDeckSettingsOpen] = useState(false)
  const [previewCard, setPreviewCard] = useState<LoteriaCard | null>(null)
  const [cardNameEs, setCardNameEs] = useState("")
  const [cardNameEn, setCardNameEn] = useState("")
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

  async function setCardEnabled(cardId: string, enabled: boolean) {
    if (!state) return
    const enabledIds = new Set(state.enabledCardIds)
    if (enabled) enabledIds.add(cardId); else enabledIds.delete(cardId)
    setMessage("")
    try {
      const next = await request<RoomState>(`/api/loteria/rooms/${code}/host`, { method: "POST", headers: { "X-Loteria-Host-Token": hostToken }, body: JSON.stringify({ action: "set-cards", enabledCardIds: [...enabledIds] }) })
      setState(next)
    } catch (cardError) { setMessage(cardError instanceof Error ? cardError.message : "No se pudieron actualizar las cartas.") }
  }

  function openCardPreview(card: LoteriaCard) {
    setCardNameEs(card.nameEs)
    setCardNameEn(card.nameEn)
    setDeckSettingsOpen(false)
    setPreviewCard(card)
  }

  async function saveCardName() {
    if (!state || !previewCard) return
    setMessage("")
    try {
      const next = await request<RoomState>(`/api/loteria/rooms/${code}/host`, { method: "POST", headers: { "X-Loteria-Host-Token": hostToken }, body: JSON.stringify({ action: "set-card-name", cardId: previewCard.id, nameEs: cardNameEs, nameEn: cardNameEn }) })
      setState(next)
      const updated = next.cards.find((card) => card.id === previewCard.id)
      if (updated) setPreviewCard(updated)
    } catch (cardError) { setMessage(cardError instanceof Error ? cardError.message : "No se pudo cambiar el nombre.") }
  }

  function closeCardPreview() {
    setPreviewCard(null)
    window.setTimeout(() => setDeckSettingsOpen(true), 0)
  }

  if (!code) return <main className="loteria-shell loteria-center"><LanguageButton language={language} onChange={setLanguage} /><Card className="loteria-entry-card"><CardHeader><span className="loteria-logo">✦</span><CardTitle>{t.host}</CardTitle><CardDescription>Crea una sala privada y abre la pantalla de TV.</CardDescription></CardHeader><CardContent><Label htmlFor="initial-interval">{t.interval}</Label><Input id="initial-interval" type="number" min={3} max={30} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} /><Button size="lg" onClick={() => void createRoom()}>{t.create}</Button>{message && <p className="loteria-message is-error">{message}</p>}</CardContent></Card></main>
  if (!state) return <Loading message={t.connecting} />
  return <main className="loteria-shell loteria-host"><LanguageButton language={language} onChange={setLanguage} /><header><div><span className="loteria-kicker">{t.round} {state.round}</span><h1>{t.host}</h1></div><div className="loteria-host-code">{state.code}</div></header>
    <section className="loteria-host-grid"><Card><CardHeader><CardTitle>Estado: {state.status}</CardTitle><CardDescription>{state.playerCount} {t.players.toLowerCase()}</CardDescription></CardHeader><CardContent className="loteria-host-actions"><Button size="lg" disabled={state.status !== "lobby"} onClick={() => void action("start")}><Play /> {t.start}</Button><Button size="lg" variant="outline" disabled={!(["countdown", "playing"] as GameStatus[]).includes(state.status)} onClick={() => void action("pause")}><Pause /> {t.pause}</Button><Button size="lg" variant="outline" disabled={state.status !== "paused"} onClick={() => void action("resume")}><Play /> {t.resume}</Button><Button size="lg" variant="secondary" onClick={() => void action("new-round")}><RotateCcw /> {t.newRound}</Button></CardContent></Card>
      <Card><CardHeader><CardTitle>{t.interval}</CardTitle><CardDescription>3–30 segundos</CardDescription></CardHeader><CardContent><Input type="range" min={3} max={30} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} /><strong className="loteria-interval-value">{intervalSeconds}s</strong><Button variant="outline" asChild><a href={`/tv/${state.code}`} target="_blank" rel="noreferrer">{t.tv}</a></Button></CardContent></Card>
      <Players state={state} language={language} />
      <Card className="loteria-deck-settings"><CardHeader><CardTitle>{language === "es" ? "Cartas de esta sala" : "Cards in this room"}</CardTitle><CardDescription>{state.enabledCardIds.length} de {state.cards.length} {language === "es" ? "activadas · mínimo 16 · solo se cambia antes de iniciar" : "enabled · minimum 16 · change before starting"}</CardDescription></CardHeader><CardContent><Button className="loteria-deck-settings-button" variant="outline" onClick={() => setDeckSettingsOpen(true)}><ImageIcon /> {language === "es" ? "Configurar cartas" : "Configure cards"}</Button></CardContent></Card></section>
    <Dialog open={deckSettingsOpen} onOpenChange={setDeckSettingsOpen}>
      <DialogContent className="loteria-deck-settings-dialog">
        <DialogHeader><DialogTitle>{language === "es" ? "Cartas de esta sala" : "Cards in this room"}</DialogTitle><DialogDescription>{state.enabledCardIds.length} de {state.cards.length} {language === "es" ? "activadas · activa un mínimo de 16" : "enabled · enable at least 16"}</DialogDescription></DialogHeader>
        <div className="loteria-deck-grid">{state.cards.map((card) => {
        const enabled = state.enabledCardIds.includes(card.id)
        return <div key={card.id} className={`loteria-deck-option${enabled ? " is-enabled" : ""}`}><button type="button" className="loteria-deck-preview" onClick={() => openCardPreview(card)} aria-label={`${language === "es" ? "Ampliar" : "Preview"} ${card.nameEs}`}><span className="loteria-deck-thumb" style={{ backgroundImage: `url(${card.image})` }}>{!card.originalImage && card.symbol}</span><span><strong>{language === "es" ? card.nameEs : card.nameEn}</strong><small>{enabled ? (language === "es" ? "Activada" : "Enabled") : (language === "es" ? "Desactivada" : "Disabled")}</small></span><Maximize2 aria-hidden="true" /></button><button type="button" className="loteria-card-name-button" disabled={state.status !== "lobby"} onClick={() => openCardPreview(card)} aria-label={`${language === "es" ? "Editar nombre de" : "Edit name for"} ${card.nameEs}`}><Pencil /></button><Switch size="sm" checked={enabled} disabled={state.status !== "lobby"} onCheckedChange={(checked) => void setCardEnabled(card.id, checked)} aria-label={`${enabled ? "Desactivar" : "Activar"} ${card.nameEs}`} /></div>
      })}</div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(previewCard)} onOpenChange={(open) => { if (!open) closeCardPreview() }}>
      <DialogContent className="loteria-card-preview-dialog">
        {previewCard && <>
          <DialogHeader><DialogTitle>{language === "es" ? previewCard.nameEs : previewCard.nameEn}</DialogTitle><DialogDescription>{language === "es" ? "Vista ampliada de la carta" : "Full-size card preview"}</DialogDescription></DialogHeader>
          <img className="loteria-card-preview-art" src={previewCard.image} alt={`${language === "es" ? "Carta" : "Card"} ${previewCard.nameEs}`} />
          <div className="loteria-card-name-editor"><div><Label htmlFor="loteria-name-es">Nombre en español</Label><Input id="loteria-name-es" value={cardNameEs} maxLength={48} disabled={state.status !== "lobby"} onChange={(event) => setCardNameEs(event.target.value)} /></div><div><Label htmlFor="loteria-name-en">Nombre en inglés</Label><Input id="loteria-name-en" value={cardNameEn} maxLength={48} disabled={state.status !== "lobby"} onChange={(event) => setCardNameEn(event.target.value)} /></div><Button disabled={state.status !== "lobby" || !cardNameEs.trim()} onClick={() => void saveCardName()}><Save /> {language === "es" ? "Guardar nombre" : "Save name"}</Button></div>
          {previewCard.originalImage && <details className="loteria-card-preview-original"><summary><ImageIcon /> {language === "es" ? "Ver foto original" : "View original photo"}</summary><img src={previewCard.originalImage} alt={`${language === "es" ? "Foto original de" : "Original photo for"} ${previewCard.nameEs}`} /></details>}
        </>}
      </DialogContent>
    </Dialog>
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
  if (path[0] === "tv") return path[1] ? <TvView code={String(path[1]).toUpperCase()} /> : <TvLanding />
  if (path[1] === "tv") return <TvView code={String(path[2] || "").toUpperCase()} />
  if (path[1] === "host") {
    const code = String(path[2] || "").toUpperCase()
    const token = query.get("token") || (code ? window.localStorage.getItem(`loteria:${code}:host`) : "") || ""
    return <HostView initialCode={code} initialToken={token} />
  }
  if (path[1]) return <PlayerView code={String(path[1]).toUpperCase()} />
  return <JoinLanding />
}
