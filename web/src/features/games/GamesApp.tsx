import { ArrowLeft, BarChart3, Gamepad2, Heart, PartyPopper, Trophy, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import WeddingPredictionsApp from "../wedding-predictions/WeddingPredictionsApp"
import "./games.css"

function GamesHub() {
  return <main className="games-hub">
    <header className="games-hero">
      <span className="games-kicker"><Gamepad2 /> DataPlus Games</span>
      <h1>Pick a game. Bring the room together.</h1>
      <p>Multiplayer party games made for a shared screen and everyone's phone.</p>
    </header>
    <section className="games-grid">
      <Card className="game-card game-card-wedding">
        <CardHeader><span className="game-icon"><Heart /></span><CardTitle>Wedding Predictions</CardTitle><CardDescription>Trade fake wedding credits on speeches, tears, dance-floor mishaps, fashion emergencies, and anything the host dreams up.</CardDescription></CardHeader>
        <CardContent className="game-card-actions"><Button asChild size="lg"><a href="/games/wedding-predictions"><BarChart3 /> Join a room</a></Button><Button asChild size="lg" variant="outline"><a href="/games/wedding-predictions/host"><Trophy /> Host game</a></Button></CardContent>
      </Card>
      <Card className="game-card game-card-loteria">
        <CardHeader><span className="game-icon"><PartyPopper /></span><CardTitle>Lotería</CardTitle><CardDescription>Classic Mexican picture bingo with live calling, phone boards, and a TV view for the whole party.</CardDescription></CardHeader>
        <CardContent className="game-card-actions"><Button asChild size="lg"><a href="/loteria"><Users /> Join a room</a></Button><Button asChild size="lg" variant="outline"><a href="/loteria/host"><Trophy /> Host game</a></Button></CardContent>
      </Card>
    </section>
    <Button variant="ghost" asChild className="games-back"><a href="/"><ArrowLeft /> Back to DataPlus</a></Button>
  </main>
}

export default function GamesApp() {
  return window.location.pathname.startsWith("/games/wedding-predictions") ? <WeddingPredictionsApp /> : <GamesHub />
}

