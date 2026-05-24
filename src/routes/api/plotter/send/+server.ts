// SvelteKit server endpoint: opens a TCP socket to the network plotter
// and streams the HPGL job. Most plotters accept raw TCP on port 9100 (JetDirect).
import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import net from "net";

const CONNECT_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS   = 30_000;

export const POST: RequestHandler = async ({ request }) => {
    let body: { hpgl?: string; host?: string; port?: number };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { hpgl, host, port } = body;
    if (!hpgl || typeof hpgl !== "string") {
        return json({ error: "Missing field: hpgl" }, { status: 400 });
    }
    if (!host || typeof host !== "string") {
        return json({ error: "Missing field: host" }, { status: 400 });
    }
    if (!port || typeof port !== "number" || port < 1 || port > 65535) {
        return json({ error: "Invalid field: port (must be 1–65535)" }, { status: 400 });
    }

    try {
        const bytesWritten = await tcpSend(hpgl, host, port);
        return json({ ok: true, bytesWritten });
    } catch (err: any) {
        const msg: string = err?.message ?? "TCP send failed";
        const status = msg.includes("ECONNREFUSED") ? 502
                     : msg.includes("ETIMEDOUT")    ? 504
                     : msg.includes("ENOTFOUND")    ? 502
                     : 500;
        return json({ error: msg }, { status });
    }
};

function tcpSend(hpgl: string, host: string, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let settled = false;
        let bytesWritten = 0;

        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            reject(err);
        };

        const connectTimer = setTimeout(
            () => fail(new Error(`ETIMEDOUT: connection to ${host}:${port} timed out`)),
            CONNECT_TIMEOUT_MS,
        );

        socket.on("error", fail);

        socket.connect(port, host, () => {
            clearTimeout(connectTimer);

            const writeTimer = setTimeout(
                () => fail(new Error(`ETIMEDOUT: write to ${host}:${port} timed out`)),
                WRITE_TIMEOUT_MS,
            );

            // Write the full HPGL string and gracefully close after flush
            socket.write(hpgl, "utf8", (writeErr) => {
                if (writeErr) { clearTimeout(writeTimer); fail(writeErr); return; }
                bytesWritten = Buffer.byteLength(hpgl, "utf8");
                socket.end(() => {
                    clearTimeout(writeTimer);
                    if (!settled) { settled = true; resolve(bytesWritten); }
                });
            });
        });
    });
}
