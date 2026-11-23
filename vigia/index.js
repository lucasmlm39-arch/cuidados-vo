// Vigia de avisos — roda no GitHub Actions a cada ~10 minutos (grátis).
// Lê escala, remédios, doses e presença no Firestore e envia notificações
// pelo Firebase Cloud Messaging (também grátis no plano Spark).
//
// Precisa do segredo FIREBASE_SERVICE_ACCOUNT no GitHub (veja o LEIAME.md).

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

// ---------- Configuração (lida do mesmo config.js do app) ----------
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8"), ctx);
const CFG = ctx.window.APP_CONFIG;
const TURNOS = CFG.turnos;
const VO = CFG.nomeDaVo || "Vó";
const APP_URL = CFG.appUrl;
const FUSO = "-03:00"; // horário de Brasília (sem horário de verão)
const TZ = "America/Sao_Paulo";

const SIMULAR = process.argv.includes("--simular"); // só mostra, não envia

// ---------- Datas ----------
function agoraLocal(ms) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const instante = (data, hm) => new Date(`${data}T${hm}:00${FUSO}`).getTime();
const somaDias = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const MIN = 60_000, HORA = 60 * MIN, DIA = 24 * HORA;
const normNome = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const ms = (t) => (t && t.toMillis ? t.toMillis() : t || 0);

// Início e fim (absolutos) de uma pessoa na escala
function intervaloEscala(e) {
  const t = TURNOS.find((x) => x.id === e.turno);
  let ini = instante(e.data, e.inicio);
  // turno da noite: horários depois da meia-noite pertencem ao dia seguinte
  if (t && min(t.ini) > min(t.fim) && min(e.inicio) < min(t.fim) + 1) ini += DIA;
  let fim = instante(e.data, e.fim);
  while (fim <= ini) fim += DIA;
  return { ini, fim };
}

// Mesma lógica do app para achar horários descobertos num turno
function lacunas(t, pessoas) {
  const rel = (x) => { let v = min(x) - min(t.ini); if (v < 0) v += 1440; return v; };
  const dur = rel(t.fim) || 1440;
  const iv = pessoas.map((p) => {
    let a = rel(p.inicio), b = rel(p.fim);
    if (a >= dur) a = 0;
    if (b <= a || b > dur) b = dur;
    return [a, b];
  }).sort((x, y) => x[0] - y[0]);
  const g = []; let cur = 0;
  for (const [a, b] of iv) { if (a > cur) g.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < dur) g.push([cur, dur]);
  return g.map(([a, b]) => `${hm(min(t.ini) + a)}–${hm(min(t.ini) + b)}`);
}

async function main() {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = getFirestore();
  const fcm = getMessaging();

  const agora = Date.now();
  const { data: hoje, hm: hmAgora } = agoraLocal(agora);
  const ontem = somaDias(hoje, -1), amanha = somaDias(hoje, 1);
  console.log(`Agora: ${hoje} ${hmAgora}`);

  const lerTudo = async (col, q) => (await (q || db.collection(col)).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const [remedios, doses, escala, aparelhos, presenca, membros, enviadosLista] = await Promise.all([
    lerTudo("remedios"),
    lerTudo("doses", db.collection("doses").where("data", ">=", ontem)),
    lerTudo("escala", db.collection("escala").where("data", ">=", ontem)),
    lerTudo("aparelhos"),
    lerTudo("presenca"),
    lerTudo("membros"),
    lerTudo("enviados", db.collection("enviados").where("em", ">=", agora - 3 * DIA)),
  ]);
  const enviados = new Set(enviadosLista.map((e) => e.id));
  const dosesIds = new Set(doses.map((d) => d.id));
  const nomeDoUid = Object.fromEntries(membros.map((m) => [m.id, m.nome]));

  // ---------- Quem recebe ----------
  const tokensDe = (filtroNome) => {
    const set = new Set();
    for (const a of aparelhos) if (!filtroNome || filtroNome(normNome(a.nome))) (a.tokens || []).forEach((t) => set.add(t));
    return [...set];
  };
  const escalaAtiva = escala.map((e) => ({ ...e, ...intervaloEscala(e) }));
  const noTurno = new Set(escalaAtiva.filter((e) => e.ini <= agora && agora < e.fim).map((e) => normNome(e.nome)));
  const paraTurno = () => {
    const t = noTurno.size ? tokensDe((n) => noTurno.has(n)) : [];
    return t.length ? t : tokensDe(); // ninguém no turno (ou sem avisos ativos) → todos
  };
  const paraTodos = () => tokensDe();

  const avisos = []; // { chave, tokens, titulo, corpo }

  // ---------- 1. Remédios com horário fixo ----------
  for (const r of remedios) {
    if (r.tipo === "sos" || r.ativo === false) continue;
    for (const d of [ontem, hoje]) {
      if ((r.desde && d < r.desde) || (r.ate && d > r.ate)) continue;
      for (const h of r.horarios || []) {
        const t = instante(d, h);
        if (t > agora || t < agora - 3 * HORA) continue;
        const id = `${d}_${r.id}_${h.replace(":", "")}`;
        if (dosesIds.has(id)) continue;
        const nome = `${r.nome}${r.dose ? ` (${r.dose})` : ""}`;
        const atraso = agora - t;
        if (atraso >= HORA) {
          avisos.push({ chave: `atraso60_${id}`, tokens: paraTodos(), titulo: "🚨 Remédio atrasado 1 hora",
            corpo: `${nome} das ${h} ainda não foi marcado. Alguém pode conferir com quem está com a ${VO}?` });
        } else if (atraso >= 30 * MIN) {
          avisos.push({ chave: `atraso30_${id}`, tokens: paraTurno(), titulo: "⚠️ Remédio não marcado",
            corpo: `${nome} das ${h} ainda não foi marcado no app. Já deu?` });
        } else {
          avisos.push({ chave: `lembrete_${id}`, tokens: paraTurno(), titulo: "💊 Hora do remédio",
            corpo: `${nome} — ${h}. Marque "Dei ✓" no app depois de dar.` });
        }
      }
    }
  }

  // ---------- 2. Pessoa da escala que ainda não chegou ----------
  // (só para quem configurou a presença automática)
  const presencaPorNome = {};
  for (const p of presenca) {
    const n = normNome(nomeDoUid[p.id]);
    if (!n) continue;
    (presencaPorNome[n] ||= []).push(p);
  }
  for (const e of escalaAtiva) {
    const passou = agora - e.ini;
    if (passou < 30 * MIN || passou > 2 * HORA || agora >= e.fim) continue;
    const regs = presencaPorNome[normNome(e.nome)];
    if (!regs) continue; // não configurou presença → não dá para saber
    const chegou = regs.some((p) => p.estado === "chegou" && ms(p.chegouEm) >= e.ini - 3 * HORA);
    if (chegou) continue;
    avisos.push({ chave: `chegada_${e.id}_${e.data}`, tokens: paraTodos(), titulo: "🚪 Ainda não chegou",
      corpo: `${e.nome} estava na escala a partir das ${e.inicio} e ainda não chegou na casa da ${VO}.` });
  }

  // ---------- 3. Escala de amanhã com buracos (enviado a partir das 18:30) ----------
  if (hmAgora >= "18:30") {
    const problemas = [];
    for (const t of TURNOS) {
      const ps = escala.filter((e) => e.data === amanha && e.turno === t.id);
      if (!ps.length) problemas.push(`${t.nome}: ninguém`);
      else { const g = lacunas(t, ps); if (g.length) problemas.push(`${t.nome}: falta ${g.join(", ")}`); }
    }
    if (problemas.length) {
      avisos.push({ chave: `amanha_${amanha}`, tokens: paraTodos(), titulo: "📅 Escala de amanhã incompleta",
        corpo: `${problemas.join(" · ")}. Quem puder, marque no app.` });
    }
  }

  // ---------- 4. Boas-vindas para quem acabou de ativar os avisos ----------
  for (const a of aparelhos) {
    for (const tk of a.tokens || []) {
      const chave = `boasvindas_${crypto.createHash("sha1").update(tk).digest("hex").slice(0, 20)}`;
      avisos.push({ chave, tokens: [tk], titulo: "✅ Avisos ativados",
        corpo: `Pronto, ${a.nome || ""}! Você vai receber os avisos dos cuidados da ${VO} neste celular.`, semRegistroDeTempo: true });
    }
  }

  // ---------- Envio ----------
  let total = 0;
  for (const av of avisos) {
    if (enviados.has(av.chave)) continue;
    if (!av.tokens.length) { console.log(`(sem aparelhos) ${av.titulo} — ${av.corpo}`); continue; }
    console.log(`Enviando [${av.chave}] para ${av.tokens.length} aparelho(s): ${av.titulo} — ${av.corpo}`);
    total++;
    if (SIMULAR) continue;
    const res = await fcm.sendEachForMulticast({
      tokens: av.tokens,
      data: { title: av.titulo, body: av.corpo, url: APP_URL, tag: av.chave },
      webpush: {
        headers: { Urgency: "high", TTL: String(6 * 3600) },
        notification: { title: av.titulo, body: av.corpo, icon: `${APP_URL}icon-192.png`, tag: av.chave },
        fcmOptions: { link: APP_URL },
      },
    });
    // Remove aparelhos que não existem mais (app desinstalado, permissão retirada…)
    const mortos = [];
    res.responses.forEach((r, i) => {
      const c = r.error && r.error.code;
      if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token") mortos.push(av.tokens[i]);
      else if (r.error) console.log("  erro:", c, r.error.message);
    });
    for (const a of aparelhos) {
      const remover = (a.tokens || []).filter((t) => mortos.includes(t));
      if (remover.length) await db.collection("aparelhos").doc(a.id).update({ tokens: FieldValue.arrayRemove(...remover) });
    }
    // boas-vindas ficam registradas para sempre; os outros, 3 dias
    await db.collection("enviados").doc(av.chave).set({ em: av.semRegistroDeTempo ? agora + 3650 * DIA : agora });
  }
  console.log(`${total} aviso(s) novo(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
