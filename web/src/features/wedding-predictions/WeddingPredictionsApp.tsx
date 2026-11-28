import { useEffect, useMemo, useState, type ReactNode } from "react"
import { QRCodeSVG } from "qrcode.react"
import { ArrowLeft, BarChart3, Check, Clock3, Coins, Heart, Lock, LockOpen, Plus, Sparkles, Trophy, Users } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import "./wedding-predictions.css"

type Outcome = "over" | "under"
type Market = { id: string; category: string; title: string; description: string; overLabel: string; underLabel: string; status: "open" | "locked" | "resolved"; result: Outcome | ""; prices: Record<Outcome, number>; volume: number; resolvedAt: string }
type Position = { id: string; marketId: string; outcome: Outcome; credits: number; price: number; shares: number; potentialPayout: number; settled: boolean; won: boolean | null; payout: number }
type RoomState = { code: string; coupleName: string; eventDate: string; joinUrl: string; playerCount: number; totalVolume: number; markets: Market[]; leaders: Array<{ id: string; name: string; balance: number; picks: number }>; player: { id: string; name: string; balance: number; positions: Position[] } | null }

const templates = [
  ["Wild cards", "Will a guest trip on the dance floor after the bar opens?", "Yes, a tumble", "Everyone stays up"],
  ["Fashion", "Will someone break a heel or dress shoe?", "Yes, shoe down", "All shoes survive"],
  ["Fashion", "Will there be a dress or outfit emergency?", "Yes, emergency", "No wardrobe drama"],
  ["Wild cards", "Will the newlyweds have a visible disagreement?", "Yes, a moment", "Harmony all night"],
  ["Speeches", "Will any speech last over 5 minutes?", "Over 5 minutes", "Under 5 minutes"],
  ["Reception", "Will someone request the Chicken Dance?", "Yes, it happens", "No chance"],
]

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || "Something went wrong.")
  return payload as T
}

function useLiveRoom(code: string, playerToken = "") {
  const [state, setState] = useState<RoomState | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!code) return
    const params = new URLSearchParams(playerToken ? { playerToken } : {})
    request<RoomState>(`/api/wedding-predictions/rooms/${code}?${params}`).then(setState).catch((reason) => setError(reason.message))
    const source = new EventSource(`/api/wedding-predictions/rooms/${code}/events?${params}`)
    source.addEventListener("state", (event) => { setState(JSON.parse((event as MessageEvent).data)); setError("") })
    source.onerror = () => setError((current) => current || "Reconnecting to the wedding room…")
    return () => source.close()
  }, [code, playerToken])
  return { state, setState, error, setError }
}

function WeddingHeader({ state, host = false }: { state: RoomState; host?: boolean }) {
  return <header className="wedding-header"><div><a className="wedding-back" href="/games"><ArrowLeft /> Games</a><span className="wedding-eyebrow">{host ? "Host controls" : "Wedding predictions"}</span><h1>{state.coupleName}</h1><p>{state.eventDate || "The big day"} · Room <strong>{state.code}</strong></p></div><div className="wedding-room-stats"><Badge variant="outline"><Users /> {state.playerCount} guests</Badge><Badge variant="outline"><Coins /> {state.totalVolume.toLocaleString()} played</Badge></div></header>
}

function MarketCard({ market, onPick, hostActions }: { market: Market; onPick?: (outcome: Outcome) => void; hostActions?: ReactNode }) {
  return <Card className={`prediction-card is-${market.status}`}>
    <CardHeader><div className="prediction-meta"><Badge variant="secondary">{market.category}</Badge><Badge variant={market.status === "open" ? "default" : "outline"}>{market.status}</Badge></div><CardTitle>{market.title}</CardTitle><CardDescription>{market.description}</CardDescription></CardHeader>
    <CardContent><div className="outcome-grid">
      {(["over", "under"] as Outcome[]).map((outcome) => <button type="button" key={outcome} className={`outcome-button${market.result === outcome ? " is-winner" : ""}`} disabled={!onPick || market.status !== "open"} onClick={() => onPick?.(outcome)}><span>{outcome === "over" ? market.overLabel : market.underLabel}</span><strong>{market.prices[outcome]}¢</strong><small>{market.prices[outcome]}% crowd chance</small>{market.result === outcome && <Check />}</button>)}
    </div><Progress className="market-progress" value={market.prices.over} /><div className="market-volume">{market.volume.toLocaleString()} wedding credits traded</div></CardContent>
    {hostActions && <CardFooter className="host-market-actions">{hostActions}</CardFooter>}
  </Card>
}

function JoinView({ code }: { code: string }) {
  const savedToken = window.localStorage.getItem(`wedding-predictions:${code}:player`) || ""
  const { state, setState, error, setError } = useLiveRoom(code, savedToken)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<{ market: Market; outcome: Outcome } | null>(null)
  const [credits, setCredits] = useState(50)
  const [tab, setTab] = useState("markets")

  async function join() {
    setBusy(true); setError("")
    try {
      const result = await request<{ playerToken: string; state: RoomState }>(`/api/wedding-predictions/rooms/${code}/join`, { method: "POST", body: JSON.stringify({ name, playerToken: savedToken }) })
      window.localStorage.setItem(`wedding-predictions:${code}:player`, result.playerToken)
      window.location.reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to join.") } finally { setBusy(false) }
  }

  async function placePick() {
    if (!selection) return
    setBusy(true); setError("")
    try {
      const next = await request<RoomState>(`/api/wedding-predictions/rooms/${code}/bet`, { method: "POST", body: JSON.stringify({ playerToken: savedToken, marketId: selection.market.id, outcome: selection.outcome, credits }) })
      setState(next); setSelection(null); setTab("picks")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to place your pick.") } finally { setBusy(false) }
  }

  if (!state) return <Loading message={error || "Opening the wedding room…"} />
  if (!state.player) return <main className="wedding-shell wedding-center"><Card className="wedding-entry"><CardHeader><span className="wedding-mark"><Heart /></span><CardTitle>{state.coupleName}</CardTitle><CardDescription>Room {state.code} · You get 1,000 fake wedding credits. No real money, just bragging rights.</CardDescription></CardHeader><CardContent><Label htmlFor="guest-name">Your name</Label><Input id="guest-name" autoFocus maxLength={28} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) void join() }} />{error && <p className="wedding-error">{error}</p>}</CardContent><CardFooter><Button size="lg" className="w-full" disabled={busy || !name.trim()} onClick={() => void join()}><Sparkles /> Join with 1,000 credits</Button></CardFooter></Card></main>

  const selectedPrice = selection ? selection.market.prices[selection.outcome] : 50
  const potentialPayout = Math.round((credits / selectedPrice) * 100)
  return <main className="wedding-shell"><WeddingHeader state={state} /><div className="wedding-wallet"><div><span>Your wallet</span><strong><Coins /> {state.player.balance.toLocaleString()}</strong></div><p>Fake credits only · bragging rights are very real</p></div>{error && <p className="wedding-notice">{error}</p>}
    <Tabs value={tab} onValueChange={setTab} className="wedding-tabs"><TabsList><TabsTrigger value="markets">Markets</TabsTrigger><TabsTrigger value="picks">My picks ({state.player.positions.length})</TabsTrigger><TabsTrigger value="leaders">Leaderboard</TabsTrigger></TabsList>
      <TabsContent value="markets"><section className="prediction-grid">{state.markets.map((market) => <MarketCard key={market.id} market={market} onPick={(outcome) => { setCredits(Math.min(50, state.player!.balance)); setSelection({ market, outcome }) }} />)}</section></TabsContent>
      <TabsContent value="picks"><section className="positions-list">{state.player.positions.length ? state.player.positions.slice().reverse().map((position) => { const market = state.markets.find((entry) => entry.id === position.marketId); return <Card key={position.id} className="position-row"><CardContent><div><Badge variant={position.settled ? position.won ? "default" : "secondary" : "outline"}>{position.settled ? position.won ? "Won" : "Lost" : "Live"}</Badge><h3>{market?.title}</h3><p>{position.outcome === "over" ? market?.overLabel : market?.underLabel} at {position.price}¢</p></div><div className="position-value"><span>{position.credits} played</span><strong>{position.settled ? `${position.payout} paid` : `${position.potentialPayout} possible`}</strong></div></CardContent></Card> }) : <EmptyPicks />}</section></TabsContent>
      <TabsContent value="leaders"><Card className="leaderboard"><CardHeader><CardTitle><Trophy /> Wedding leaderboard</CardTitle><CardDescription>Ranked by current available credits.</CardDescription></CardHeader><CardContent>{state.leaders.map((leader, index) => <div className="leader-row" key={leader.id}><span className="leader-rank">{index + 1}</span><strong>{leader.name}</strong><span>{leader.picks} picks</span><b>{leader.balance.toLocaleString()}</b></div>)}</CardContent></Card></TabsContent>
    </Tabs>
    <Dialog open={Boolean(selection)} onOpenChange={(open) => !open && setSelection(null)}><DialogContent><DialogHeader><DialogTitle>Place your prediction</DialogTitle><DialogDescription>{selection?.market.title}</DialogDescription></DialogHeader>{selection && <div className="bet-ticket"><Badge>{selection.outcome === "over" ? selection.market.overLabel : selection.market.underLabel}</Badge><div className="bet-math"><span>Current price <b>{selectedPrice}¢</b></span><span>Possible payout <b>{potentialPayout} credits</b></span></div><Label htmlFor="bet-credits">Wedding credits</Label><Input id="bet-credits" type="number" min={10} step={10} max={state.player.balance} value={credits} onChange={(event) => setCredits(Math.max(0, Math.floor(Number(event.target.value))))} /><div className="quick-bets">{[25, 50, 100, 250].filter((amount) => amount <= state.player!.balance).map((amount) => <Button key={amount} type="button" size="sm" variant="outline" onClick={() => setCredits(amount)}>{amount}</Button>)}</div></div>}<DialogFooter><Button variant="outline" onClick={() => setSelection(null)}>Cancel</Button><Button disabled={busy || credits < 10 || credits > state.player.balance} onClick={() => void placePick()}><Coins /> Confirm {credits} credits</Button></DialogFooter></DialogContent></Dialog>
  </main>
}

function HostView({ code }: { code: string }) {
  const hostToken = code ? (new URLSearchParams(window.location.search).get("token") || window.localStorage.getItem(`wedding-predictions:${code}:host`) || "") : ""
  const { state, error, setError } = useLiveRoom(code)
  const [coupleName, setCoupleName] = useState("Natalie & Byron")
  const [eventDate, setEventDate] = useState("")
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState({ category: "Wedding moments", title: "", description: "", overLabel: "Yes", underLabel: "No" })

  async function createRoom() {
    setBusy(true); setError("")
    try {
      const result = await request<{ code: string; hostToken: string }>("/api/wedding-predictions/rooms", { method: "POST", body: JSON.stringify({ coupleName, eventDate }) })
      window.localStorage.setItem(`wedding-predictions:${result.code}:host`, result.hostToken)
      window.location.assign(`/games/wedding-predictions/host/${result.code}?token=${encodeURIComponent(result.hostToken)}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create room.") } finally { setBusy(false) }
  }

  async function hostAction(action: string, marketId = "", outcome?: Outcome) {
    setBusy(true); setError("")
    try {
      await request<RoomState>(`/api/wedding-predictions/rooms/${code}/host`, { method: "POST", headers: { "X-Wedding-Host-Token": hostToken }, body: JSON.stringify({ action, marketId, outcome, ...(action === "create" ? draft : {}) }) })
      if (action === "create") { setCreateOpen(false); setDraft({ category: "Wedding moments", title: "", description: "", overLabel: "Yes", underLabel: "No" }) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Host action failed.") } finally { setBusy(false) }
  }

  if (!code) return <main className="wedding-shell wedding-center"><Card className="wedding-entry"><CardHeader><span className="wedding-mark"><Heart /></span><CardTitle>Create a wedding market</CardTitle><CardDescription>You'll receive a private admin link for creating and settling predictions. Guests join with a four-digit code.</CardDescription></CardHeader><CardContent className="host-create-fields"><Label htmlFor="couple">Couple</Label><Input id="couple" value={coupleName} onChange={(event) => setCoupleName(event.target.value)} /><Label htmlFor="date">Wedding date or label</Label><Input id="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} placeholder="Saturday, June 12" />{error && <p className="wedding-error">{error}</p>}</CardContent><CardFooter><Button className="w-full" size="lg" disabled={busy || !coupleName.trim()} onClick={() => void createRoom()}><Sparkles /> Create room</Button></CardFooter></Card></main>
  if (!state) return <Loading message={error || "Opening host controls…"} />
  return <main className="wedding-shell"><WeddingHeader state={state} host /><section className="host-top"><Card className="join-card"><CardHeader><CardTitle>Guest join code</CardTitle><CardDescription>Ask guests to scan or visit the link.</CardDescription></CardHeader><CardContent><QRCodeSVG value={state.joinUrl} size={176} level="M" marginSize={2} /><strong>{state.code}</strong><p>{state.joinUrl}</p></CardContent></Card><Card className="host-summary"><CardHeader><CardTitle><BarChart3 /> Live room</CardTitle></CardHeader><CardContent><div><strong>{state.playerCount}</strong><span>Guests</span></div><div><strong>{state.totalVolume.toLocaleString()}</strong><span>Credits played</span></div><div><strong>{state.markets.filter((market) => market.status === "open").length}</strong><span>Open markets</span></div></CardContent><CardFooter><Button size="lg" onClick={() => setCreateOpen(true)}><Plus /> Create prediction</Button></CardFooter></Card></section>{error && <Alert variant="destructive"><AlertTitle>Host action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <section className="prediction-grid host-predictions">{state.markets.map((market) => <MarketCard key={market.id} market={market} hostActions={<>{market.status === "open" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void hostAction("lock", market.id)}><Lock /> Lock</Button>}{market.status === "locked" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void hostAction("reopen", market.id)}><LockOpen /> Reopen</Button>}{market.status !== "resolved" && <><Button size="sm" disabled={busy} onClick={() => void hostAction("resolve", market.id, "over")}><Check /> {market.overLabel} won</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void hostAction("resolve", market.id, "under")}><Check /> {market.underLabel} won</Button></>}</>} />)}</section>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="create-market-dialog"><DialogHeader><DialogTitle>Create a prediction</DialogTitle><DialogDescription>Use a quick idea or write any wedding moment. Avoid naming a guest in an embarrassing prediction.</DialogDescription></DialogHeader><div className="template-list">{templates.map(([category, title, overLabel, underLabel]) => <button key={title} type="button" onClick={() => setDraft({ category, title, description: "", overLabel, underLabel })}><span>{category}</span>{title}</button>)}</div><div className="market-fields"><Label htmlFor="market-category">Category</Label><Input id="market-category" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} /><Label htmlFor="market-title">Question</Label><Input id="market-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Will…?" /><Label htmlFor="market-description">How it is judged</Label><Input id="market-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="A clear rule prevents arguments later." /><div className="answer-fields"><div><Label htmlFor="answer-one">First answer</Label><Input id="answer-one" value={draft.overLabel} onChange={(event) => setDraft((current) => ({ ...current, overLabel: event.target.value }))} /></div><div><Label htmlFor="answer-two">Second answer</Label><Input id="answer-two" value={draft.underLabel} onChange={(event) => setDraft((current) => ({ ...current, underLabel: event.target.value }))} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={busy || !draft.title.trim() || !draft.overLabel.trim() || !draft.underLabel.trim()} onClick={() => void hostAction("create")}><Plus /> Open prediction</Button></DialogFooter></DialogContent></Dialog>
  </main>
}

function EmptyPicks() { return <Card className="empty-picks"><CardContent><Clock3 /><h2>No picks yet</h2><p>Choose an outcome in Markets and put some wedding credits behind it.</p></CardContent></Card> }
function Loading({ message }: { message: string }) { return <main className="wedding-shell wedding-center"><div className="wedding-loading"><Heart /><p>{message}</p><Button variant="ghost" asChild><a href="/games"><ArrowLeft /> Games</a></Button></div></main> }

export default function WeddingPredictionsApp() {
  const parts = window.location.pathname.split("/").filter(Boolean)
  const host = parts[2] === "host"
  const code = String(parts[host ? 3 : 2] || "").replace(/\D/g, "").slice(0, 4)
  const [joinCode, setJoinCode] = useState("")
  const validCode = useMemo(() => joinCode.replace(/\D/g, "").slice(0, 4), [joinCode])
  if (host) return <HostView code={code} />
  if (code) return <JoinView code={code} />
  return <main className="wedding-shell wedding-center"><Card className="wedding-entry"><CardHeader><span className="wedding-mark"><Heart /></span><CardTitle>Wedding Predictions</CardTitle><CardDescription>Enter the four-digit room code. All bets use fake wedding credits—never real money.</CardDescription></CardHeader><CardContent><Label htmlFor="wedding-code">Room code</Label><Input id="wedding-code" className="room-code-input" inputMode="numeric" maxLength={4} value={validCode} onChange={(event) => setJoinCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && validCode.length === 4) window.location.assign(`/games/wedding-predictions/${validCode}`) }} /></CardContent><CardFooter className="entry-actions"><Button size="lg" disabled={validCode.length !== 4} onClick={() => window.location.assign(`/games/wedding-predictions/${validCode}`)}>Join wedding</Button><Button variant="ghost" asChild><a href="/games/wedding-predictions/host">I'm the host</a></Button></CardFooter></Card></main>
}

