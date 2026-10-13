/**
 * Runs untrusted model code against test cases.
 *
 * SECURITY: the code runs in a Worker created INSIDE an <iframe sandbox="allow-scripts">
 * (opaque origin → no access to this app's storage, cookies or DOM). The worker can be
 * terminated, so infinite loops can't freeze the page; the iframe is removed afterwards.
 */
export interface TestCase {
  args: unknown[];
  expected: unknown;
}
export interface TestResult {
  ok: boolean;
  got?: string;
  error?: string;
}
export type RunReport = { results: TestResult[]; error?: string };

const WORKER = `
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
onmessage = (e) => {
  const { code, tests } = e.data;
  let solve;
  try {
    solve = new Function(code + "\\n;return typeof solve === 'function' ? solve : undefined;")();
  } catch (err) {
    postMessage({ error: "does not compile: " + String(err && err.message || err) });
    return;
  }
  if (typeof solve !== "function") { postMessage({ error: "no function named solve" }); return; }
  const results = tests.map((t) => {
    try {
      const out = solve(...JSON.parse(JSON.stringify(t.args)));
      return { ok: eq(out, t.expected), got: String(JSON.stringify(out)).slice(0, 120) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err).slice(0, 160) };
    }
  });
  postMessage({ results });
};`;

const HOST = `<!doctype html><script>
addEventListener("message", (e) => {
  const { code, tests, timeoutMs } = e.data;
  let w;
  try {
    w = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(WORKER)}], { type: "text/javascript" })));
  } catch (err) {
    parent.postMessage({ __sandroidTests: true, error: "workers unavailable: " + err }, "*");
    return;
  }
  const timer = setTimeout(() => { w.terminate(); parent.postMessage({ __sandroidTests: true, error: "timed out after " + timeoutMs + " ms (infinite loop or too slow)" }, "*"); }, timeoutMs);
  w.onmessage = (m) => { clearTimeout(timer); w.terminate(); parent.postMessage({ __sandroidTests: true, ...m.data }, "*"); };
  w.onerror = (m) => { clearTimeout(timer); w.terminate(); parent.postMessage({ __sandroidTests: true, error: String(m.message || "worker error") }, "*"); m.preventDefault(); };
  w.postMessage({ code, tests });
});
parent.postMessage({ __sandroidTests: true, ready: true }, "*");
</script>`;

export function runTests(code: string, tests: TestCase[], timeoutMs = 4000): Promise<RunReport> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.display = "none";
    frame.srcdoc = HOST;
    let settled = false;
    const finish = (r: RunReport) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(guard);
      frame.remove();
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !e.data?.__sandroidTests) return;
      if (e.data.ready) frame.contentWindow!.postMessage({ code, tests, timeoutMs }, "*");
      else
        finish({
          results: Array.isArray(e.data.results) ? e.data.results : [],
          error: e.data.error,
        });
    };
    const guard = setTimeout(() => finish({ results: [], error: "test runner did not respond" }), timeoutMs + 3000);
    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });
}
