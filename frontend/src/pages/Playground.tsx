import { useEffect, useRef, useState } from "react";

import { CacheSetting } from "../components/cache";
import { AdvancedSettings, Composer } from "../components/composer";
import { StorageMeter } from "../components/game";
import { UserBubble } from "../components/rich";
import { AssistantMessage, emptySlotView, ModelPicker, useEndpointDefault } from "../components/run";
import { Icon } from "../components/icons";
import { Collapse, EmptyState, ErrorNote, IconTile, RunOptions } from "../components/ui";
import { UsageMini, UsageSummary } from "../components/usage";
import { useT } from "../i18n";
import { useCredentials } from "../stores/credentials";
import { useDraft } from "../stores/draft";
import { ScopeContext } from "../stores/gameStorage";
import { buildExport, downloadJson } from "../stores/history";
import { usePlayground, type ChatTurn } from "../stores/runs";
import type { HistoryMessage } from "../types";

/** History entries opened in the editor carry plain conversation text only. */
function pairsFromConversation(conversation: HistoryMessage[], model: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i + 1 < conversation.length; i += 2) {
    turns.push({ id: `h${i}`, text: conversation[i]!.content, result: { ...emptySlotView(model), output: conversation[i + 1]!.content } });
  }
  return turns;
}

export default function Playground() {
  const t = useT();
  // All state lives in the store, so a run keeps going while you visit other pages.
  const s = usePlayground();
  const setEndpoint = (endpointId: string) => s.setForm({ endpointId });
  const endpoints = useEndpointDefault(s.endpointId, setEndpoint);
  const endpoint = endpoints.find((e) => e.id === s.endpointId);
  const models = useCredentials((st) => st.models[s.endpointId]);
  const live = s.running ? s.slots[0] : undefined;

  // "Open in editor" from History
  const take = useDraft((st) => st.take);
  const load = s.load;
  useEffect(() => {
    const d = take("playground");
    if (d) load(d);
  }, [take, load]);

  // Follow the streaming answer — unless you scrolled up to read.
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      nearBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [live?.output.length, s.turns.length, s.pendingText]);

  const selected = models?.find((m) => m.id === s.model);
  // Vision is automatic when an image is attached.
  const needed = s.mode === "image_gen" ? "image_gen" : s.drafts.some((d) => d.kind === "image") ? "vision" : "chat";
  const mismatch = selected && !selected.capabilities.includes(needed);
  const turns = s.turns.length ? s.turns : pairsFromConversation(s.conversation, s.model);
  const lastTurnError = s.turns.at(-1)?.requestError;
  const empty = turns.length === 0 && !s.running;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const customized = !!s.system.trim() || Object.values(s.params).some((v) => v !== undefined);

  return (
    <ScopeContext.Provider value="playground">
      <div className="flex min-h-[calc(100vh-7rem)] flex-col">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <IconTile name="chat" />
          <h1 className="text-2xl font-semibold tracking-tight text-gradient">{t("playground.title")}</h1>
          {s.model && (
            <span key={s.model} className="badge animate-scale-in bg-sky-950/60 font-mono text-sky-200">
              <span className={`h-1.5 w-1.5 rounded-full ${s.running ? "animate-pulse bg-sky-400" : "bg-emerald-400"}`} />
              {s.model}
            </span>
          )}
          <span className="flex-1" />
          {s.lastEntry && (
            <button
              type="button"
              className="btn-ghost py-1 text-xs"
              onClick={() => s.lastEntry && downloadJson(`run-${s.lastEntry.id}.json`, buildExport([s.lastEntry]))}
            >
              <Icon name="download" size={14} /> {t("common.export")}
            </button>
          )}
          {!empty && !s.running && (
            <button type="button" className="btn-secondary animate-scale-in py-1 text-xs" onClick={s.newChat}>
              <Icon name="plus" size={14} /> {t("playground.newChat")}
            </button>
          )}
        </div>

        <div className="flex-1 space-y-5 pb-6">
          {empty && (
            <div className="flex min-h-[38vh] items-center justify-center">
              <EmptyState icon="sparkles" title={t("playground.emptyTitle")} hint={t("playground.emptyHint")}>
                {(["game", "anim", "explain", "code"] as const).map((k, i) => (
                  <button
                    key={k}
                    type="button"
                    className="chip animate-fade-up"
                    style={{ animationDelay: `${150 + i * 60}ms` }}
                    onClick={() => s.setForm({ prompt: t(`suggest.${k}`) })}
                  >
                    <Icon name={k === "game" ? "play" : k === "anim" ? "sparkles" : k === "code" ? "code" : "chat"} size={13} className="text-sky-400" />
                    {t(`suggest.${k}`)}
                  </button>
                ))}
              </EmptyState>
            </div>
          )}
          {turns.map((turn) => (
            <div key={turn.id} className="animate-fade-up space-y-3">
              <UserBubble text={turn.text} />
              <AssistantMessage result={turn.result} requestError={turn.requestError} />
            </div>
          ))}
          {s.running && live && (
            <div className="animate-fade-up space-y-3">
              {s.pendingText && <UserBubble text={s.pendingText} />}
              <AssistantMessage result={live} />
            </div>
          )}
          {!s.running && s.error && s.error !== lastTurnError && <ErrorNote code={s.error} />}
          <div ref={bottom} />
        </div>

        {/* Composer + every setting below it, pinned to the bottom like a chat app. */}
        <div className="glass sticky bottom-0 z-20 -mx-4 border-t px-4 pt-3 pb-4 lg:-mx-8 lg:px-8">
          <Composer
            text={s.prompt}
            onText={(prompt) => s.setForm({ prompt })}
            drafts={s.drafts}
            onDrafts={(drafts) => s.setForm({ drafts })}
            mode={s.mode}
            onMode={(mode) => s.setForm({ mode })}
            running={s.running}
            canSend={!!endpoint && !!s.model.trim() && (!!s.prompt.trim() || s.drafts.length > 0)}
            onSend={() => void s.run()}
            onStop={s.stop}
            sendLabel={t("composer.send")}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ModelPicker inline need={needed} endpointId={s.endpointId} onEndpoint={setEndpoint} model={s.model} onModel={(model) => s.setForm({ model })} />
            <button
              type="button"
              aria-expanded={settingsOpen}
              className={`btn-secondary py-1.5 text-xs ${settingsOpen ? "border-sky-700 bg-sky-950/40 text-sky-200" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Icon name="settings" size={14} className={`transition-transform duration-500 ${settingsOpen ? "rotate-90" : ""}`} />
              {t("playground.settings")}
              {customized && <span className="h-1.5 w-1.5 animate-pop rounded-full bg-sky-400" />}
            </button>
            <UsageMini usage={s.usage} />
          </div>
          {mismatch && <p className="mt-1.5 text-xs text-amber-300">{t("playground.capabilityMismatch", { mode: t(`mode.${needed}`) })}</p>}
          <Collapse open={settingsOpen}>
            <div className="mt-3 max-h-[45vh] space-y-3 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <AdvancedSettings
                defaultOpen
                mode={s.mode}
                system={s.system}
                onSystem={(system) => s.setForm({ system })}
                params={s.params}
                onParams={(params) => s.setForm({ params })}
                timeoutS={s.timeoutS}
                onTimeout={(timeoutS) => s.setForm({ timeoutS })}
                imageSize={s.imageSize}
                onImageSize={(imageSize) => s.setForm({ imageSize })}
              />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <RunOptions />
                <StorageMeter scope="playground" onClear={s.clearCache} disabled={s.running} />
                <CacheSetting />
              </div>
              <UsageSummary usage={s.usage} onReset={s.resetUsage} />
              <p className="text-[11px] text-slate-500">{t("notice.billing")}</p>
            </div>
          </Collapse>
        </div>
      </div>
    </ScopeContext.Provider>
  );
}
