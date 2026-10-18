const CANDIDATES = 4;
const YAROSLAV = 3;

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env) {
    const H = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
    };
    const send = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });

    const path = new URL(req.url).pathname;
    const isAdmin = !!env.ADMIN_KEY && req.headers.get("X-Admin-Key") === env.ADMIN_KEY;
    const load = async () => JSON.parse((await env.VOTES.get("votes")) || "[]");
    const save = (v) => env.VOTES.put("votes", JSON.stringify(v));
    let body = {};
    if (req.method === "POST") { try { body = await req.json(); } catch (e) {} }

    if (path === "/api/results" && req.method === "GET") {
      const votes = await load();
      const counts = Array(CANDIDATES).fill(0);
      votes.forEach(v => { counts[v.c]++; });
      return send({ counts, total: votes.length });
    }

    if (path === "/api/vote" && req.method === "POST") {
      const c = body.c;
      if (!Number.isInteger(c) || c < 0 || c >= CANDIDATES) return send({ error: "Неверный кандидат" }, 400);
      if (c === YAROSLAV && !isAdmin) return send({ error: "Оплата взноса временно недоступна." }, 403);
      const votes = await load();
      const rec = { id: crypto.randomUUID(), c, t: Date.now() };
      if (isAdmin) {
        rec.admin = true;
      } else {
        const voter = String(body.voter || "");
        if (voter.length < 8) return send({ error: "Нет идентификатора избирателя" }, 400);
        rec.v = voter;
        if (env.STRICT_IP === "1") rec.ip = await sha(req.headers.get("CF-Connecting-IP") || "");
        if (votes.some(x => !x.admin && (x.v === rec.v || (rec.ip && x.ip === rec.ip)))) {
          return send({ error: "Вы уже голосовали" }, 409);
        }
      }
      votes.push(rec);
      await save(votes);
      return send({ ok: true });
    }

    if (path.startsWith("/api/admin/")) {
      if (!isAdmin) return send({ error: "Нет доступа" }, 403);
      if (path === "/api/admin/votes" && req.method === "GET") {
        const votes = await load();
        return send({ votes: votes.map(v => ({ id: v.id, c: v.c, t: v.t, admin: !!v.admin })) });
      }
      if (path === "/api/admin/delete" && req.method === "POST") {
        const votes = (await load()).filter(v => v.id !== body.id);
        await save(votes);
        return send({ ok: true });
      }
      if (path === "/api/admin/reset" && req.method === "POST") {
        await save([]);
        return send({ ok: true });
      }
    }
    return send({ error: "Не найдено" }, 404);
  },
};
