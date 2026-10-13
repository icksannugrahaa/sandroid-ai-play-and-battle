/** Live usage of a workspace's 50 MB session budget (run results + game saves). */
import { gameBytes, SESSION_LIMIT_BYTES, useGameStorage, type Scope } from "./gameStorage";
import { arenaBytes, playgroundBytes, useArena, usePlayground } from "./runs";

export function useScopeUsage(scope: Exclude<Scope, "history">): { used: number; limit: number; full: boolean } {
  const own = scope === "playground" ? usePlayground((s) => playgroundBytes(s)) : useArena((s) => arenaBytes(s));
  const games = useGameStorage((s) => gameBytes(s.data[scope]));
  const used = own + games;
  return { used, limit: SESSION_LIMIT_BYTES, full: used >= SESSION_LIMIT_BYTES };
}
