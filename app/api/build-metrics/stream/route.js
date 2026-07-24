import { readLatestBuildMetrics } from "../../../../src/server/buildMetricsDb.js";
import { subscribeBuildMetricsSnapshots } from "../../../../src/server/buildMetricsStream.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const encoder = new TextEncoder();
  let heartbeat;
  let unsubscribe = () => {};
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (eventName, data) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        send("snapshot", await readLatestBuildMetrics());
      } catch {
        send("snapshot", {
          configured: true,
          source: "postgres",
          state: "unavailable",
          stages: [],
          bundles: [],
          assetTypes: [],
          recentRuns: [],
        });
      }

      unsubscribe = subscribeBuildMetricsSnapshots((snapshot) => send("snapshot", snapshot));
      heartbeat = setInterval(() => send("ping", { at: new Date().toISOString() }), 15_000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
