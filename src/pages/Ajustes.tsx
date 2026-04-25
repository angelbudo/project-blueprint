import { useNavigate } from "react-router-dom";
import { ClientOnly } from "@/components/ClientOnly";
import { Button } from "@/components/ui/button";
import { useGameSettings, type GameLanguage, type ManoSetting, TURN_TIMEOUT_OPTS, type BotHonesty } from "@/lib/gameSettings";
import type { BotDifficulty } from "@/game/profileAdaptation";
import { usePlayerIdentity } from "@/hooks/usePlayerIdentity";
import { useAdminPassword } from "@/hooks/useAdminPassword";
import { PlayerNameField } from "@/online/PlayerNameField";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Settings as SettingsIcon, Shuffle, Loader2, Check, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/useT";
import { FlagCircle } from "@/components/FlagCircle";

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </main>
  );
}

export default function AjustesPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Ajustes />
    </ClientOnly>
  );
}

function Ajustes() {
  const navigate = useNavigate();
  const t = useT();
  const { settings, update, ready } = useGameSettings();
  const { name, setName, ready: identityReady } = usePlayerIdentity();
  const { password: adminPassword, setPassword: setAdminPassword, ready: adminReady } = useAdminPassword();
  if (!ready || !identityReady || !adminReady) return <Loading />;

  const camesOpts = [
    { value: 1 as const, label: t("settings.cames.1"), hint: t("settings.cames.1.hint") },
    { value: 2 as const, label: t("settings.cames.2"), hint: t("settings.cames.2.hint") },
    { value: 3 as const, label: t("settings.cames.3"), hint: t("settings.cames.3.hint") },
  ];

  const piedrasOpts = [
    { value: 9 as const, label: t("settings.piedras.18"), hint: t("settings.piedras.18.hint") },
    { value: 12 as const, label: t("settings.piedras.24"), hint: t("settings.piedras.24.hint") },
  ];

  const langOpts: { value: GameLanguage; label: string }[] = [
    { value: "ca", label: t("settings.language.ca") },
    { value: "es", label: t("settings.language.es") },
  ];

  const manoOpts: { value: Exclude<ManoSetting, -1>; label: string }[] = [
    { value: 0, label: t("common.you") },
    { value: 1, label: t("common.bot_right") },
    { value: 2, label: t("common.partner") },
    { value: 3, label: t("common.bot_left") },
  ];

  const difficultyOpts: { value: BotDifficulty; label: string; hint: string }[] = [
    { value: "conservative", label: t("settings.difficulty.conservative"), hint: t("settings.difficulty.conservative.hint") },
    { value: "balanced", label: t("settings.difficulty.balanced"), hint: t("settings.difficulty.balanced.hint") },
    { value: "aggressive", label: t("settings.difficulty.aggressive"), hint: t("settings.difficulty.aggressive.hint") },
  ];

  const honestyOpts: { value: BotHonesty; label: string; hint: string }[] = [
    { value: "sincero", label: t("settings.honesty.sincero"), hint: t("settings.honesty.sincero.hint") },
    { value: "pillo", label: t("settings.honesty.pillo"), hint: t("settings.honesty.pillo.hint") },
    { value: "mentider", label: t("settings.honesty.mentider"), hint: t("settings.honesty.mentider.hint") },
  ];

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-5">
      <div className="w-full max-w-md flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="w-3 h-3" /> {t("common.back_home")}
        </button>

        <header className="text-center">
          <div className="inline-flex items-center justify-center gap-2">
            <SettingsIcon className="w-5 h-5 text-gold" />
            <h1 className="font-display font-black italic text-gold text-2xl">{t("settings.title")}</h1>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("settings.subtitle")}</p>
        </header>

        <Section title={t("settings.your_name")}>
          <PlayerNameField name={name} onChange={setName} label={t("settings.player_name_label")} />
          <p className="text-[10px] text-muted-foreground mt-1">{t("settings.player_name_hint")}</p>
        </Section>

        <Section title={t("settings.cames_to_win")}>
          <div className="grid grid-cols-3 gap-2">
            {camesOpts.map((o) => (
              <Chip key={o.value} selected={settings.cames === o.value} onClick={() => update({ cames: o.value })} label={o.label} hint={o.hint} />
            ))}
          </div>
        </Section>

        <Section title={t("settings.piedras_per_cama")}>
          <div className="grid grid-cols-2 gap-2">
            {piedrasOpts.map((o) => (
              <Chip key={o.value} selected={settings.targetCama === o.value} onClick={() => update({ targetCama: o.value })} label={o.label} hint={o.hint} />
            ))}
          </div>
        </Section>

        <Section title={t("settings.turn_timeout")}>
          <div className="grid grid-cols-4 gap-2">
            {TURN_TIMEOUT_OPTS.map((sec) => (
              <Chip
                key={sec}
                selected={settings.turnTimeoutSec === sec}
                onClick={() => update({ turnTimeoutSec: sec })}
                label={`${sec}s`}
                hint=""
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{t("settings.turn_timeout.hint")}</p>
        </Section>

        <Section title={t("settings.difficulty")}>
          <div className="grid grid-cols-3 gap-2">
            {difficultyOpts.map((o) => (
              <Chip key={o.value} selected={settings.botDifficulty === o.value} onClick={() => update({ botDifficulty: o.value })} label={o.label} hint={o.hint} />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{t("settings.difficulty.hint")}</p>
        </Section>

        <Section title={t("settings.honesty")}>
          <div className="grid grid-cols-3 gap-2">
            {honestyOpts.map((o) => (
              <Chip key={o.value} selected={settings.botHonesty === o.value} onClick={() => update({ botHonesty: o.value })} label={o.label} hint={o.hint} />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{t("settings.honesty.hint")}</p>
        </Section>

        <Section title={t("settings.language")}>
          <div className="grid grid-cols-2 gap-2">
            {langOpts.map((o) => (
              <Chip
                key={o.value}
                selected={settings.language === o.value}
                onClick={() => update({ language: o.value })}
                label={o.label}
                hint=""
                leading={<FlagCircle lang={o.value} size={20} />}
              />
            ))}
          </div>
        </Section>

        <Section title={t("settings.first_player")}>
          <div className="grid grid-cols-2 gap-2">
            {manoOpts.map((o) => (
              <Chip key={o.value} selected={settings.mano === o.value} onClick={() => update({ mano: o.value })} label={o.label} hint="" />
            ))}
          </div>
          <button
            type="button"
            onClick={() => update({ mano: -1 })}
            className={cn(
              "mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-display font-bold transition-all",
              settings.mano === -1
                ? "border-primary bg-primary/15 text-primary"
                : "border-primary/30 text-foreground/80 hover:border-primary/60",
            )}
          >
            <Shuffle className="w-4 h-4" /> {t("settings.first_player.random")}
          </button>
        </Section>

        <Section title={t("settings.admin")}>
          <div className="flex items-center gap-2">
            <ShieldCheck className={cn("w-4 h-4 shrink-0", adminPassword ? "text-team-nos" : "text-muted-foreground")} />
            <Input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder={t("settings.admin.placeholder")}
              autoComplete="off"
              className="bg-background/40 border-primary/30"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{t("settings.admin.hint")}</p>
        </Section>

        <Button size="default" className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-display font-bold" onClick={() => navigate("/")}>
          <Check className="w-4 h-4 mr-2" /> {t("common.done")}
        </Button>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="text-[10px] font-display tracking-widest uppercase text-primary/85">{title}</div>
      {children}
    </section>
  );
}

function Chip({
  selected,
  onClick,
  label,
  hint,
  leading,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  leading?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-md border px-2 py-1.5 text-center transition-all flex flex-col items-center gap-0.5 leading-tight",
        selected
          ? "border-primary bg-primary/15 text-primary"
          : "border-primary/25 bg-background/30 text-foreground/80 hover:border-primary/50 hover:bg-primary/10",
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-display font-bold text-xs">
        {leading}
        {label}
      </span>
      {hint && <span className="text-[9px] text-muted-foreground">{hint}</span>}
    </button>
  );
}
