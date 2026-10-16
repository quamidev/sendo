import { CheckIcon } from "lucide-react";
import type { DemoStage } from "@/components/demo/use-demo-conversation";
import { home } from "@/lib/i18n/dictionaries/home";
import type { Lang } from "@/lib/i18n/langs";
import { cn } from "@/lib/utils";

const ACTIVE_STEP: Record<DemoStage, number> = { idle: 0, sent: 1, replied: 2 };

/**
 * The home stage's step strip (AC-ST-8): 1 write on the phone → 2 the agent replies → 3 your team
 * sees it. Driven by `useDemoConversation(lang).stage`; earlier steps show as done.
 */
export function StageSteps({
  lang,
  stage,
  className,
}: {
  lang: Lang;
  stage: DemoStage;
  className?: string;
}) {
  const active = ACTIVE_STEP[stage];
  return (
    <ol
      data-testid="stage-steps"
      data-stage={stage}
      className={cn("grid border-b md:grid-cols-3", className)}
    >
      {home[lang].stage.steps.map((text, index) => {
        const current = index === active;
        const done = index < active;
        return (
          <li
            key={text}
            aria-current={current ? "step" : undefined}
            data-state={current ? "current" : done ? "done" : "todo"}
            className={cn(
              "relative flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] leading-tight",
              index > 0 && "border-t md:border-t-0 md:border-l",
              current ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {/* MOTION.md (SNL-4.4) #2: the highlight fades between steps (opacity only). */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-0 bg-whatsapp/45 transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                current ? "opacity-100" : "opacity-0",
              )}
            />
            <span
              aria-hidden
              className={cn(
                "relative grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium tabular-nums",
                current
                  ? "bg-whatsapp-strong text-white dark:text-neutral-950"
                  : done
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3" strokeWidth={3} /> : index + 1}
            </span>
            <span className="relative text-pretty">{text}</span>
          </li>
        );
      })}
    </ol>
  );
}
