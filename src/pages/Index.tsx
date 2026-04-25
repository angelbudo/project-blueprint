import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, Trash2, Users, LogIn, Settings as SettingsIcon, Wifi } from "lucide-react";
import { hasSavedMatch, clearSavedMatch } from "@/hooks/useTrucMatch";
import { loadSettings, resolveInitialMano } from "@/lib/gameSettings";
import { useMyActiveRooms } from "@/online/useMyActiveRooms";
import { useT } from "@/i18n/useT";

const Index = () => {
  const navigate = useNavigate();
  const t = useT();
  const [hasSaved, setHasSaved] = useState(false);
  const { rooms: activeOnlineRooms } = useMyActiveRooms();
  const [startSearch, setStartSearch] = useState<{ cames: number; mano: number; targetCama: number }>({
    cames: 2,
    mano: 0,
    targetCama: 12,
  });

  useEffect(() => {
    setHasSaved(hasSavedMatch());
    const s = loadSettings();
    setStartSearch({
      cames: s.cames,
      mano: resolveInitialMano(s.mano),
      targetCama: s.targetCama,
    });
  }, []);

  const baseQS = `cames=${startSearch.cames}&mano=${startSearch.mano}&targetCama=${startSearch.targetCama}`;
  const newGameLink = `/partida?${baseQS}`;
  const resumeLink = `/partida?${baseQS}&resume=1`;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md flex flex-col items-center gap-7">
        <header className="text-center">
          <h1 className="font-display font-black italic text-gold text-5xl leading-none normal-case">{t("home.title.line1")}</h1>
          <h1 className="font-display font-black italic text-gold text-5xl leading-none normal-case">{t("home.title.line2")}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </header>

        {activeOnlineRooms.length > 0 && (
          <section className="w-full flex flex-col gap-2">
            {activeOnlineRooms.map((room) => (
              <Button
                key={room.id}
                asChild
                size="lg"
                className="w-full h-12 bg-team-nos text-white hover:bg-team-nos/90 font-display font-bold"
              >
                <Link to={`/online/partida/${room.code}`}>
                  <Wifi className="w-4 h-4 mr-2" />
                  {t("home.resume_online", { code: room.code })}
                </Link>
              </Button>
            ))}
            <p className="self-center text-[11px] text-muted-foreground text-center">
              {t("home.online_in_progress")}
            </p>
          </section>
        )}

        {hasSaved && (
          <section className="w-full flex flex-col gap-2">
            <Button asChild size="lg" className="w-full h-12 bg-accent text-accent-foreground hover:bg-accent/90 font-display font-bold">
              <Link to={resumeLink}>
                <RotateCcw className="w-4 h-4 mr-2" />
                {t("home.continue_last")}
              </Link>
            </Button>
            <button
              type="button"
              onClick={() => { clearSavedMatch(); setHasSaved(false); }}
              className="self-center inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {t("home.delete_saved")}
            </button>
          </section>
        )}

        <Button
          asChild
          size="lg"
          className="w-full h-14 bg-primary text-primary-foreground hover:bg-primary/90 font-display font-bold text-lg gold-glow"
          onClick={() => clearSavedMatch()}
        >
          <Link to={newGameLink}>
            <Play className="w-5 h-5 mr-2" />
            {hasSaved ? t("home.start_new") : t("home.start")}
          </Link>
        </Button>

        <Button asChild size="lg" variant="outline" className="w-full h-12 border-2 border-primary/60 text-primary hover:bg-primary/10 font-display font-bold">
          <Link to="/ajustes">
            <SettingsIcon className="w-4 h-4 mr-2" />
            {t("home.settings")}
          </Link>
        </Button>

        <div className="w-full flex items-center gap-2 my-1">
          <span className="flex-1 h-px bg-primary/20" />
          <span className="text-[10px] font-display tracking-widest uppercase text-primary/60">{t("home.divider_friends")}</span>
          <span className="flex-1 h-px bg-primary/20" />
        </div>

        <div className="w-full grid grid-cols-1 gap-2">
          <Button asChild size="lg" variant="outline" className="h-12 border-2 border-gold/70 text-gold hover:bg-gold/10 font-display font-bold">
            <Link to="/online/lobby">
              <Users className="w-4 h-4 mr-2" />
              {t("home.see_tables")}
            </Link>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild size="lg" variant="outline" className="h-12 border-2 border-team-nos/60 text-team-nos hover:bg-team-nos/10 font-display font-bold">
              <Link to="/online/nou">
                <Users className="w-4 h-4 mr-2" />
                {t("home.create_table")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 border-2 border-primary/60 text-primary hover:bg-primary/10 font-display font-bold">
              <Link to="/online/unir">
                <LogIn className="w-4 h-4 mr-2" />
                {t("home.join_with_code")}
              </Link>
            </Button>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground/70 text-center max-w-xs">
          {t("home.fixed_teams")}
        </p>
      </div>
    </main>
  );
};

export default Index;
