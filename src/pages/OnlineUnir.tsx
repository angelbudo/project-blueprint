import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlayerIdentity } from "@/hooks/usePlayerIdentity";
import { joinRoom } from "@/online/rooms.functions";
import { Loader2, ArrowLeft, LogIn, Settings } from "lucide-react";

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </main>
  );
}

export default function OnlineUnirPage() {
  return (
    <ClientOnly fallback={<Loading />}><UnirSala /></ClientOnly>
  );
}

function UnirSala() {
  const navigate = useNavigate();
  const { deviceId, name, hasName, ready } = usePlayerIdentity();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <Loading />;

  const cleanCode = code.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);

  const handleJoin = async () => {
    if (!hasName) { setError("Cal introduir un nom a Ajustes abans d'unir-se"); return; }
    if (cleanCode.length !== 6) { setError("El codi ha de tindre 6 caràcters"); return; }
    setSubmitting(true);
    setError(null);
    try {
      await joinRoom({ data: { code: cleanCode, deviceId, name } });
      navigate(`/online/sala/${cleanCode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperat");
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-5 py-8">
      <div className="w-full max-w-md flex flex-col gap-5">
        <button type="button" onClick={() => navigate("/")} className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <ArrowLeft className="w-3 h-3" /> Inici
        </button>

        <header className="text-center">
          <h1 className="font-display font-black italic text-gold text-3xl">Unir-se a una taula</h1>
          <p className="mt-1 text-sm text-muted-foreground">Introdueix el codi que t'ha passat l'amfitrió</p>
        </header>

        {!hasName && (
          <section className="wood-surface border-2 border-destructive/50 rounded-2xl p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-foreground">Cal configurar el teu nom abans d'unir-te.</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/ajustes")} className="border-primary/40">
              <Settings className="w-3 h-3 mr-1" /> Ajustes
            </Button>
          </section>
        )}

        <section className="wood-surface border-2 border-primary/40 rounded-2xl p-4 flex flex-col gap-2">
          <label className="text-[11px] font-display tracking-widest uppercase text-primary/85">
            Codi de la taula
          </label>
          <Input
            value={cleanCode}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD23"
            maxLength={6}
            className="text-center font-display font-black text-2xl tracking-[0.3em] uppercase h-14"
            autoCapitalize="characters"
            autoComplete="off"
          />
        </section>

        {error && <p className="text-xs text-destructive text-center">{error}</p>}

        <Button
          size="lg"
          className="h-14 bg-primary text-primary-foreground hover:bg-primary/90 font-display font-bold text-lg gold-glow"
          onClick={handleJoin}
          disabled={submitting || !hasName || cleanCode.length !== 6}
        >
          {submitting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <LogIn className="w-5 h-5 mr-2" />}
          Entrar a la taula
        </Button>
      </div>
    </main>
  );
}
