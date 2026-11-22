import { criarStore } from "./store.js";

// ---------------- Configuração e utilidades ----------------
const CFG = window.APP_CONFIG || {};
const VO = CFG.nomeDaVo || "Vó";
const TURNOS = CFG.turnos;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deYmd = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
const somaDias = (s, n) => { const d = deYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const hoje = () => ymd(new Date());
const agoraHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const fmtDia = (s) => { const d = deYmd(s); return `${DIAS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const rotuloDia = (s) =>
  s === hoje() ? "Hoje" : s === somaDias(hoje(), 1) ? "Amanhã" : s === somaDias(hoje(), -1) ? "Ontem" : fmtDia(s);
const quando = (ts) => {
  const d = new Date(ts), dia = ymd(d), h = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (dia === hoje()) return `hoje às ${h}`;
  if (dia === somaDias(hoje(), -1)) return `ontem às ${h}`;
  return `${fmtDia(dia)} às ${h}`;
};
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ---------------- Estado ----------------
const S = {
  aba: lsGet("vo-aba") || "hoje",
  diaEscala: hoje(),
  diaRem: hoje(),
  escala: [], remedios: [], doses: [], recados: [],
};
let store, perfil;

// ---------------- Início ----------------
async function iniciar() {
  try {
    store = await criarStore(CFG.firebase);
  } catch (e) {
    console.error(e);
    $("#app").innerHTML = `<div class="entrada"><p>Não foi possível conectar. Verifique a internet e tente de novo.</p>
      <button class="btn primario" onclick="location.reload()">Tentar de novo</button></div>`;
    return;
  }
  perfil = store.perfil;
  document.title = `Cuidados da ${VO}`;
  if (!perfil) return telaEntrada();
  ligar();
}

function ligar() {
  const desde = somaDias(hoje(), -14);
  store.watch("escala", desde, (d) => { S.escala = d; render(); });
  store.watch("remedios", null, (d) => { S.remedios = d.sort((a, b) => a.nome.localeCompare(b.nome)); render(); });
  store.watch("doses", desde, (d) => { S.doses = d; render(); });
  store.watch("recados", somaDias(hoje(), -30), (d) => { S.recados = d.sort((a, b) => b.em - a.em); render(); });
  render();
  setInterval(render, 60_000); // atualiza "atrasado", turno atual etc.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
}

function telaEntrada(erro = "") {
  $("#app").innerHTML = `
    <div class="entrada">
      <div class="logo">♥</div>
      <h1>Cuidados da ${esc(VO)}</h1>
      <p class="cinza">Escala de quem fica com a ${esc(VO)} e controle dos remédios, para toda a família.</p>
      <form id="fEntrar" class="form">
        <label>Seu nome<input name="nome" required maxlength="30" autocomplete="given-name" placeholder="Ex.: Ana"></label>
        ${store.demo ? "" : `<label>Código da família<input name="codigo" required autocapitalize="off" autocomplete="off" placeholder="Peça para quem organizou"></label>`}
        ${erro ? `<p class="msg-erro">${esc(erro)}</p>` : ""}
        <button class="btn primario grande">Entrar</button>
      </form>
      ${store.demo ? `<p class="faixa-demo">Modo demonstração: os dados ficam só neste aparelho.</p>` : ""}
    </div>`;
  $("#fEntrar").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.target.querySelector("button").disabled = true;
    try {
      perfil = await store.entrar(String(f.get("nome")).trim(), String(f.get("codigo") || "").trim());
      $("#app").innerHTML = "";
      ligar();
    } catch (err) {
      telaEntrada(err.message);
    }
  };
}

// ---------------- Escala ----------------
// minutos desde o início do turno (lida com o turno da noite que passa da meia-noite)
const rel = (t, ini) => { let x = min(t) - min(ini); if (x < 0) x += 1440; return x; };
const duracao = (t) => rel(t.fim, t.ini) || 1440;
const pessoasDo = (data, turno) => {
  const t = TURNOS.find((x) => x.id === turno);
  return S.escala.filter((p) => p.data === data && p.turno === turno)
    .sort((a, b) => rel(a.inicio, t.ini) - rel(b.inicio, t.ini));
};

function lacunas(t, pessoas) {
  const dur = duracao(t);
  const iv = pessoas.map((p) => {
    let a = rel(p.inicio, t.ini), b = rel(p.fim, t.ini);
    if (a >= dur) a = 0;           // chegou antes do turno começar
    if (b <= a || b > dur) b = dur; // fica até o fim (ou passa dele)
    return [a, b];
  }).sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let cur = 0;
  for (const [a, b] of iv) { if (a > cur) gaps.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < dur) gaps.push([cur, dur]);
  return gaps.map(([a, b]) => `${hm(min(t.ini) + a)}–${hm(min(t.ini) + b)}`);
}

function statusTurno(t, pessoas) {
  if (!pessoas.length) return { cls: "vazio", texto: "Ninguém ainda" };
  const g = lacunas(t, pessoas);
  if (!g.length) return { cls: "ok", texto: "Coberto ✓" };
  return { cls: "parcial", texto: `Falta ${g[0]}${g.length > 1 ? ` +${g.length - 1}` : ""}` };
}

function turnoAtual() {
  const n = min(agoraHM()), h = hoje();
  for (const t of TURNOS) {
    const a = min(t.ini), b = min(t.fim);
    const dentro = a < b ? n >= a && n < b : n >= a || n < b;
    if (dentro) return { t, data: a >= b && n < b ? somaDias(h, -1) : h };
  }
  return { t: TURNOS[0], data: h };
}
function proximoTurno({ t, data }) {
  const i = TURNOS.indexOf(t);
  return i < TURNOS.length - 1 ? { t: TURNOS[i + 1], data } : { t: TURNOS[0], data: somaDias(data, 1) };
}

function cardTurno(t, data, rotulo = "") {
  const ps = pessoasDo(data, t.id);
  const st = statusTurno(t, ps);
  return `<section class="card turno t-${st.cls}">
    <div class="turno-topo">
      <div><span class="turno-icone">${t.icone}</span> <b>${esc(rotulo || t.nome)}</b> <span class="cinza">${t.ini}–${t.fim}</span></div>
      <span class="selo s-${st.cls}">${esc(st.texto)}</span>
    </div>
    ${ps.map((p) => `
      <div class="pessoa">
        <div class="pessoa-info"><b>${esc(p.nome)}</b> <span class="horas">${p.inicio} às ${p.fim}</span>
          ${p.obs ? `<div class="obs">${esc(p.obs)}</div>` : ""}</div>
        <button class="btn-icone" data-acao="editarEscala" data-id="${p.id}" aria-label="Editar">✏️</button>
      </div>`).join("")}
    <button class="btn secundario" data-acao="novaEscala" data-data="${data}" data-turno="${t.id}">+ Vou ficar neste turno</button>
  </section>`;
}

function vEscala() {
  const h = hoje();
  const dias = Array.from({ length: 22 }, (_, i) => somaDias(h, i - 1));
  return `
    <div class="tira-dias" id="tira">
      ${dias.map((d) => `
        <button class="chip-dia ${d === S.diaEscala ? "sel" : ""}" data-acao="selDia" data-d="${d}">
          <span>${d === h ? "Hoje" : DIAS[deYmd(d).getDay()]}</span><b>${deYmd(d).getDate()}</b>
          <span class="pontos">${TURNOS.map((t) => `<i class="p-${statusTurno(t, pessoasDo(d, t.id)).cls}"></i>`).join("")}</span>
        </button>`).join("")}
    </div>
    <p class="legenda"><i class="p-ok"></i> coberto <i class="p-parcial"></i> falta parte <i class="p-vazio"></i> ninguém</p>
    <h2 class="secao">${rotuloDia(S.diaEscala)} <small class="cinza">${fmtDia(S.diaEscala)}</small></h2>
    ${TURNOS.map((t) => cardTurno(t, S.diaEscala)).join("")}
    <button class="btn secundario largo" data-acao="compartilharEscala">📤 Enviar escala da semana no WhatsApp</button>`;
}

function textoEscala() {
  const linhas = [`*Escala da ${VO}* 🧡`, ""];
  for (let i = 0; i < 7; i++) {
    const d = somaDias(hoje(), i);
    linhas.push(`*${fmtDia(d)}*`);
    for (const t of TURNOS) {
      const ps = pessoasDo(d, t.id);
      const st = statusTurno(t, ps);
      const quem = ps.length ? ps.map((p) => `${p.nome} (${p.inicio}–${p.fim})`).join(", ") : "⚠️ ninguém ainda";
      linhas.push(`${t.icone} ${t.nome}: ${quem}${st.cls === "parcial" ? ` ⚠️ falta ${lacunas(t, ps).join(", ")}` : ""}`);
    }
    linhas.push("");
  }
  linhas.push(location.href.split("#")[0]);
  return linhas.join("\n");
}

function modalEscala({ id, data, turno }) {
  const p = id ? S.escala.find((x) => x.id === id) : null;
  const t = TURNOS.find((x) => x.id === (p?.turno || turno));
  const dia = p?.data || data;
  const nomes = [...new Set([perfil.nome, ...S.escala.map((x) => x.nome)])];
  abrirModal(`
    <h2>${t.icone} ${t.nome} · ${rotuloDia(dia)}</h2>
    <form id="fEsc" class="form">
      <label>Quem vai ficar<input name="nome" list="lnomes" required maxlength="30" value="${esc(p?.nome || perfil.nome)}"></label>
      <datalist id="lnomes">${nomes.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="linha2">
        <label>Chega às<input type="time" name="inicio" required value="${p?.inicio || t.ini}"></label>
        <label>Fica até<input type="time" name="fim" required value="${p?.fim || t.fim}"></label>
      </div>
      <label>Observação (opcional)<input name="obs" maxlength="80" value="${esc(p?.obs || "")}" placeholder="Ex.: vou dormir lá"></label>
      ${p ? "" : `<label>Repetir toda ${DIAS[deYmd(dia).getDay()]}
        <select name="rep"><option value="0">Não repetir</option><option value="4">Pelas próximas 4 semanas</option><option value="8">Pelas próximas 8 semanas</option></select></label>`}
      <div class="acoes">
        ${p ? `<button type="button" class="btn perigo" data-acao="removerEscala" data-id="${p.id}">Remover</button>` : ""}
        <button type="button" class="btn" data-acao="fechar">Cancelar</button>
        <button class="btn primario">Salvar</button>
      </div>
    </form>`);
  $("#fEsc").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const base = {
      turno: t.id, nome: String(f.get("nome")).trim(), inicio: f.get("inicio"), fim: f.get("fim"),
      obs: String(f.get("obs") || "").trim(), uid: perfil.uid, em: Date.now(),
    };
    if (p) return salvar(store.set("escala", p.id, { ...base, data: dia }), "Escala atualizada");
    const rep = Number(f.get("rep") || 0);
    const ops = [store.add("escala", { ...base, data: dia })];
    for (let i = 1; i <= rep; i++) ops.push(store.add("escala", { ...base, data: somaDias(dia, 7 * i) }));
    salvar(Promise.all(ops), rep ? `Anotado por ${rep + 1} semanas` : "Anotado na escala ✓");
  };
}

// ---------------- Remédios ----------------
const ativos = (data) => S.remedios.filter((r) => r.ativo !== false && (!r.desde || data >= r.desde) && (!r.ate || data <= r.ate));
const doseId = (data, r, h) => `${data}_${r.id}_${h.replace(":", "")}`;
const doseDe = (data, r, h) => S.doses.find((d) => d.id === doseId(data, r, h));
const slots = (data) =>
  ativos(data).filter((r) => r.tipo !== "sos")
    .flatMap((r) => (r.horarios || []).map((h) => ({ r, h })))
    .sort((a, b) => a.h.localeCompare(b.h) || a.r.nome.localeCompare(b.r.nome));

function statusSlot(data, r, h) {
  const d = doseDe(data, r, h);
  if (d) return { cls: "dado", texto: `✓ ${esc(d.nome)} deu às ${d.hora}`, d };
  const hj = hoje();
  if (data < hj) return { cls: "atrasado", texto: "Não foi marcado" };
  if (data > hj) return { cls: "futuro", texto: "" };
  const n = min(agoraHM()), m = min(h);
  if (n > m + 60) return { cls: "atrasado", texto: "Atrasado — ainda não foi marcado" };
  if (n >= m - 30) return { cls: "agora", texto: "Hora de dar" };
  return { cls: "futuro", texto: "" };
}

const contarAtrasados = () => slots(hoje()).filter(({ r, h }) => statusSlot(hoje(), r, h).cls === "atrasado").length;

function linhaSlot(data, { r, h }) {
  const s = statusSlot(data, r, h);
  return `<div class="dose d-${s.cls}">
    <div class="dose-hora">${h}</div>
    <div class="dose-info"><b>${esc(r.nome)}</b>${r.dose ? ` <span class="cinza">${esc(r.dose)}</span>` : ""}
      ${s.texto ? `<div class="dose-status">${s.texto}</div>` : ""}</div>
    ${s.d
      ? `<button class="btn-icone" data-acao="desfazerDose" data-id="${s.d.id}" aria-label="Desmarcar">↩️</button>`
      : data > hoje() ? "" : `<button class="btn dar" data-acao="darDose" data-rid="${r.id}" data-h="${h}" data-data="${data}">Dei ✓</button>`}
  </div>`;
}

const ultimaDose = (r) => S.doses.filter((d) => d.remedioId === r.id).sort((a, b) => b.em - a.em)[0];
function liberadoEm(r) {
  const u = ultimaDose(r);
  if (!u || !r.intervalo) return null;
  const t = u.em + r.intervalo * 3600_000;
  return t > Date.now() ? t : null;
}

function cardSos(data, r) {
  const u = ultimaDose(r);
  const lib = liberadoEm(r);
  const doDia = S.doses.filter((d) => d.remedioId === r.id && d.data === data).sort((a, b) => a.em - b.em);
  return `<section class="card sos ${lib ? "bloq" : ""}">
    <div class="turno-topo"><div><b>${esc(r.nome)}</b> ${r.dose ? `<span class="cinza">${esc(r.dose)}</span>` : ""}</div>
      <span class="selo">se precisar${r.intervalo ? ` · a cada ${r.intervalo}h` : ""}</span></div>
    ${r.obs ? `<div class="obs">ℹ️ ${esc(r.obs)}</div>` : ""}
    <p>${u ? `Última vez: <b>${esc(u.nome)}</b> deu ${quando(u.em)}` : "Ainda não foi dado."}</p>
    ${lib ? `<p class="alerta">⛔ Só pode dar de novo a partir de <b>${quando(lib)}</b></p>` : ""}
    ${doDia.length ? `<div class="hist">${rotuloDia(data)}: ${doDia.map((d) => `<span class="tag">${d.hora} · ${esc(d.nome)}
        <button class="x" data-acao="desfazerDose" data-id="${d.id}" aria-label="Desmarcar">×</button></span>`).join("")}</div>` : ""}
    ${data === hoje() ? `<button class="btn ${lib ? "" : "primario"}" data-acao="darDose" data-rid="${r.id}" data-data="${data}">Dei agora</button>` : ""}
  </section>`;
}

function navDia(chave, d) {
  return `<div class="nav-dia">
    <button class="btn-icone" data-acao="mudaDia" data-k="${chave}" data-n="-1" aria-label="Dia anterior">‹</button>
    <button class="nav-centro" data-acao="mudaDia" data-k="${chave}" data-n="0"><b>${rotuloDia(d)}</b><small>${fmtDia(d)}</small></button>
    <button class="btn-icone" data-acao="mudaDia" data-k="${chave}" data-n="1" aria-label="Próximo dia">›</button>
  </div>`;
}

function vRemedios() {
  const d = S.diaRem;
  const sl = slots(d);
  const sos = ativos(d).filter((r) => r.tipo === "sos");
  return `${navDia("diaRem", d)}
    <h2 class="secao">Horários fixos</h2>
    ${sl.length ? `<div class="card lista">${sl.map((x) => linhaSlot(d, x)).join("")}</div>` : `<p class="vazio">Nenhum remédio com horário fixo neste dia.</p>`}
    ${sos.length ? `<h2 class="secao">Quando precisar</h2>${sos.map((r) => cardSos(d, r)).join("")}` : ""}
    <h2 class="secao">Lista de remédios</h2>
    <div class="card lista">
      ${S.remedios.map((r) => `
        <div class="rem-linha ${r.ativo === false ? "inativo" : ""}">
          <div><b>${esc(r.nome)}</b> ${r.dose ? `<span class="cinza">${esc(r.dose)}</span>` : ""}
            <div class="cinza pequeno">${r.tipo === "sos" ? `Quando precisar${r.intervalo ? `, mínimo ${r.intervalo}h entre doses` : ""}` : (r.horarios || []).join(" · ")}
            ${r.ate ? ` · até ${fmtDia(r.ate)}` : ""}${r.ativo === false ? " · suspenso" : ""}</div></div>
          <button class="btn-icone" data-acao="editarRemedio" data-id="${r.id}" aria-label="Editar">✏️</button>
        </div>`).join("") || `<p class="vazio">Nenhum remédio cadastrado ainda.</p>`}
    </div>
    <button class="btn primario largo" data-acao="novoRemedio">+ Cadastrar remédio</button>`;
}

function modalDarDose({ rid, h, data }) {
  const r = S.remedios.find((x) => x.id === rid);
  if (!r) return;
  const sos = r.tipo === "sos";
  if (!sos && doseDe(data, r, h)) return toast("Alguém já marcou este remédio.");
  const lib = sos ? liberadoEm(r) : null;
  const u = sos ? ultimaDose(r) : null;
  abrirModal(`
    <h2>Confirmar remédio</h2>
    <p class="grande"><b>${esc(r.nome)}</b> ${esc(r.dose || "")}</p>
    ${r.obs ? `<p class="obs">ℹ️ ${esc(r.obs)}</p>` : ""}
    ${sos ? "" : `<p>Horário previsto: <b>${h}</b> · ${rotuloDia(data)}</p>`}
    ${lib ? `<p class="alerta">⚠️ ${esc(u.nome)} já deu ${quando(u.em)}. O intervalo mínimo é de ${r.intervalo}h (liberado ${quando(lib)}). Confira antes de dar.</p>` : ""}
    <form id="fDose" class="form">
      <label>Que horas você deu?<input type="time" name="hora" required value="${agoraHM()}"></label>
      <div class="acoes">
        <button type="button" class="btn" data-acao="fechar">Cancelar</button>
        <button class="btn primario">Confirmar que dei</button>
      </div>
    </form>`);
  $("#fDose").onsubmit = (e) => {
    e.preventDefault();
    const hora = new FormData(e.target).get("hora");
    const dia = sos ? hoje() : data;
    const doc = {
      data: dia, remedioId: r.id, remedioNome: r.nome, horario: sos ? null : h, hora,
      nome: perfil.nome, uid: perfil.uid, em: new Date(`${dia}T${hora}`).getTime(),
    };
    salvar(sos ? store.add("doses", doc) : store.criar("doses", doseId(data, r, h), doc), "Anotado! ✓");
  };
}

function modalRemedio({ id }) {
  const r = id ? S.remedios.find((x) => x.id === id) : { tipo: "fixo", horarios: ["08:00"] };
  const campoHora = (v) => `<div class="hora-item"><input type="time" name="h" value="${v}" required>
    <button type="button" class="btn-icone" data-acao="tirarHora" aria-label="Tirar horário">×</button></div>`;
  abrirModal(`
    <h2>${id ? "Editar remédio" : "Novo remédio"}</h2>
    <form id="fRem" class="form">
      <label>Nome do remédio<input name="nome" required maxlength="40" value="${esc(r.nome || "")}" placeholder="Ex.: Dipirona"></label>
      <label>Dose<input name="dose" maxlength="40" value="${esc(r.dose || "")}" placeholder="Ex.: 1 comprimido 500mg"></label>
      <fieldset class="tipo">
        <label class="radio"><input type="radio" name="tipo" value="fixo" ${r.tipo !== "sos" ? "checked" : ""}> Horário fixo</label>
        <label class="radio"><input type="radio" name="tipo" value="sos" ${r.tipo === "sos" ? "checked" : ""}> Só quando precisar (dor, febre…)</label>
      </fieldset>
      <div id="blocoFixo">
        <span class="rotulo">Horários</span>
        <div id="horas">${(r.horarios?.length ? r.horarios : ["08:00"]).map(campoHora).join("")}</div>
        <button type="button" class="btn secundario" data-acao="maisHora">+ horário</button>
      </div>
      <label id="blocoSos">Intervalo mínimo entre doses (horas)
        <input type="number" name="intervalo" min="0" max="48" step="1" value="${r.intervalo ?? 6}"></label>
      <label>Tomar até (opcional)<input type="date" name="ate" value="${r.ate || ""}"></label>
      <label>Observação (opcional)<input name="obs" maxlength="100" value="${esc(r.obs || "")}" placeholder="Ex.: dar depois de comer"></label>
      ${id ? `<label class="radio"><input type="checkbox" name="suspenso" ${r.ativo === false ? "checked" : ""}> Suspenso (não aparece nos horários)</label>` : ""}
      <div class="acoes">
        ${id ? `<button type="button" class="btn perigo" data-acao="removerRemedio" data-id="${id}">Excluir</button>` : ""}
        <button type="button" class="btn" data-acao="fechar">Cancelar</button>
        <button class="btn primario">Salvar</button>
      </div>
    </form>`);
  const form = $("#fRem");
  const ajustaTipo = () => {
    const sos = form.tipo.value === "sos";
    $("#blocoFixo").hidden = sos;
    $("#blocoSos").hidden = !sos;
    form.querySelectorAll('[name="h"]').forEach((i) => (i.required = !sos));
  };
  form.querySelectorAll('[name="tipo"]').forEach((i) => (i.onchange = ajustaTipo));
  ajustaTipo();
  ACOES.maisHora = () => $("#horas").insertAdjacentHTML("beforeend", campoHora("12:00"));
  ACOES.tirarHora = (_, el) => { if (form.querySelectorAll('[name="h"]').length > 1) el.closest(".hora-item").remove(); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const tipo = f.get("tipo");
    const doc = {
      nome: String(f.get("nome")).trim(), dose: String(f.get("dose") || "").trim(), tipo,
      horarios: tipo === "sos" ? [] : [...new Set(f.getAll("h").filter(Boolean))].sort(),
      intervalo: tipo === "sos" ? Number(f.get("intervalo") || 0) : null,
      ate: f.get("ate") || null, obs: String(f.get("obs") || "").trim(),
      ativo: !f.get("suspenso"), desde: r.desde || hoje(), em: Date.now(),
    };
    salvar(id ? store.set("remedios", id, doc) : store.add("remedios", doc), "Remédio salvo ✓");
  };
}

// ---------------- Recados ----------------
const cardRecado = (m) => `<div class="card recado">
  <div class="recado-topo"><b>${esc(m.nome)}</b> <span class="cinza pequeno">${quando(m.em)}</span>
    ${m.uid === perfil.uid ? `<button class="btn-icone pequeno" data-acao="removerRecado" data-id="${m.id}" aria-label="Apagar">🗑️</button>` : ""}</div>
  <p>${esc(m.texto).replace(/\n/g, "<br>")}</p></div>`;

const vRecados = () => `
  <button class="btn primario largo" data-acao="novoRecado">+ Deixar recado</button>
  <p class="cinza pequeno">Use para passar o plantão: como ela dormiu, se comeu, se sentiu dor, o que está faltando em casa…</p>
  ${S.recados.map(cardRecado).join("") || `<p class="vazio">Nenhum recado ainda.</p>`}`;

function modalRecado() {
  abrirModal(`<h2>Novo recado</h2>
    <form id="fRec" class="form">
      <textarea name="texto" rows="5" required maxlength="1000" placeholder="Ex.: Ela dormiu bem, almoçou tudo. Acabou a pomada."></textarea>
      <div class="acoes"><button type="button" class="btn" data-acao="fechar">Cancelar</button><button class="btn primario">Enviar</button></div>
    </form>`);
  $("#fRec").onsubmit = (e) => {
    e.preventDefault();
    const texto = String(new FormData(e.target).get("texto")).trim();
    if (!texto) return;
    salvar(store.add("recados", { texto, nome: perfil.nome, uid: perfil.uid, data: hoje(), em: Date.now() }), "Recado enviado ✓");
  };
}

// ---------------- Hoje ----------------
function vHoje() {
  const at = turnoAtual(), px = proximoTurno(at);
  const h = hoje();
  const sl = slots(h);
  const pend = sl.filter(({ r, h: hr }) => !doseDe(h, r, hr));
  const sos = ativos(h).filter((r) => r.tipo === "sos");
  return `
    <h2 class="secao">Com a ${esc(VO)} agora</h2>
    ${cardTurno(at.t, at.data, `Agora · ${at.t.nome}`)}
    <h2 class="secao">Próximo turno</h2>
    ${cardTurno(px.t, px.data, `${px.data !== h ? rotuloDia(px.data) + " · " : ""}${px.t.nome}`)}
    <h2 class="secao">Remédios de hoje ${sl.length ? `<span class="contador">${sl.length - pend.length} de ${sl.length} dados</span>` : ""}</h2>
    ${sl.length
      ? `<div class="card lista">${pend.map((x) => linhaSlot(h, x)).join("") || `<p class="tudo-ok">✓ Todos os remédios de hoje já foram dados</p>`}</div>`
      : `<p class="vazio">Nenhum remédio cadastrado. <button class="link" data-acao="aba" data-aba="remedios">Cadastrar</button></p>`}
    ${sos.map((r) => cardSos(h, r)).join("")}
    <h2 class="secao">Recados recentes</h2>
    ${S.recados.slice(0, 3).map(cardRecado).join("") || `<p class="vazio">Nenhum recado ainda.</p>`}
    <button class="btn secundario largo" data-acao="novoRecado">+ Deixar recado</button>`;
}

// ---------------- Perfil ----------------
function modalPerfil() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  abrirModal(`<h2>Seu perfil</h2>
    <form id="fPerf" class="form">
      <label>Seu nome<input name="nome" required maxlength="30" value="${esc(perfil.nome)}"></label>
      <div class="acoes"><button type="button" class="btn" data-acao="fechar">Fechar</button><button class="btn primario">Salvar</button></div>
    </form>
    <h3>Instalar no celular</h3>
    <p class="pequeno">${ios
      ? "No iPhone: abra este link no <b>Safari</b>, toque em <b>Compartilhar</b> (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>."
      : "No Android: no Chrome, toque nos <b>três pontinhos</b> e depois em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>."}</p>
    ${store.demo ? `<h3>Modo demonstração</h3><p class="pequeno">Os dados ficam só neste aparelho. Para a família toda usar junto, configure o Firebase (veja o LEIAME).</p>
      <button class="btn perigo" data-acao="apagarDemo">Apagar dados de teste</button>` : ""}`);
  $("#fPerf").onsubmit = async (e) => {
    e.preventDefault();
    const nome = String(new FormData(e.target).get("nome")).trim();
    try { perfil = await store.entrar(nome, perfil.codigo); fecharModal(); render(); toast("Nome atualizado"); }
    catch (err) { toast(err.message); }
  };
}

// ---------------- Ações (cliques) ----------------
const ACOES = {
  aba: ({ aba }) => { S.aba = aba; lsSet("vo-aba", aba); render(); window.scrollTo(0, 0); },
  perfil: () => modalPerfil(),
  fechar: () => fecharModal(),
  selDia: ({ d }) => { S.diaEscala = d; render(); },
  mudaDia: ({ k, n }) => { S[k] = Number(n) === 0 ? hoje() : somaDias(S[k], Number(n)); render(); },
  novaEscala: (d) => modalEscala(d),
  editarEscala: (d) => modalEscala(d),
  removerEscala: ({ id }) => { if (confirm("Remover esta pessoa da escala?")) salvar(store.remover("escala", id), "Removido da escala"); },
  compartilharEscala: async () => {
    const texto = textoEscala();
    try {
      if (navigator.share) await navigator.share({ text: texto });
      else { await navigator.clipboard.writeText(texto); toast("Escala copiada! Cole no WhatsApp."); }
    } catch (e) { if (e?.name !== "AbortError") toast("Não foi possível compartilhar."); }
  },
  darDose: (d) => modalDarDose(d),
  desfazerDose: ({ id }) => {
    if (confirm("Desmarcar este remédio? Faça isso só se marcou por engano.")) salvar(store.remover("doses", id), "Desmarcado");
  },
  novoRemedio: () => modalRemedio({}),
  editarRemedio: (d) => modalRemedio(d),
  removerRemedio: ({ id }) => {
    if (confirm("Excluir este remédio da lista? (Se for só uma pausa, prefira marcar como suspenso.)")) salvar(store.remover("remedios", id), "Remédio excluído");
  },
  novoRecado: () => modalRecado(),
  removerRecado: ({ id }) => { if (confirm("Apagar este recado?")) salvar(store.remover("recados", id), "Recado apagado"); },
  apagarDemo: () => { if (confirm("Apagar todos os dados de teste?")) { store.apagarTudo(); fecharModal(); toast("Dados apagados"); } },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-acao]");
  if (!el) return;
  const fn = ACOES[el.dataset.acao];
  if (fn) { e.preventDefault(); fn({ ...el.dataset }, el); }
});

// ---------------- Render ----------------
function shell() {
  const abas = [["hoje", "🏠", "Hoje"], ["escala", "📅", "Escala"], ["remedios", "💊", "Remédios"], ["recados", "📝", "Recados"]];
  return `
    <header class="topo">
      <div><div class="titulo">Cuidados da ${esc(VO)}</div><div class="sub" id="subtitulo"></div></div>
      <button class="perfil" data-acao="perfil">👤 <span id="nomePerfil"></span></button>
    </header>
    ${store.demo ? `<div class="faixa-demo">Modo demonstração · dados só neste aparelho</div>` : ""}
    <main id="conteudo"></main>
    <nav class="abas">${abas.map(([id, ic, nome]) =>
      `<button class="aba" data-acao="aba" data-aba="${id}"><span class="ic">${ic}</span>${nome}<span class="badge" id="badge-${id}" hidden></span></button>`).join("")}
    </nav>`;
}

function render() {
  if (!perfil) return;
  if (!$("#conteudo")) $("#app").innerHTML = shell();
  const tira = $("#tira");
  const scroll = tira ? tira.scrollLeft : null;
  const views = { hoje: vHoje, escala: vEscala, remedios: vRemedios, recados: vRecados };
  $("#conteudo").innerHTML = (views[S.aba] || vHoje)();
  if (scroll !== null && $("#tira")) $("#tira").scrollLeft = scroll;
  document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === S.aba));
  $("#nomePerfil").textContent = perfil.nome;
  const d = new Date();
  $("#subtitulo").textContent = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const atr = contarAtrasados();
  const b = $("#badge-remedios");
  b.hidden = !atr; b.textContent = atr;
}

// ---------------- Modal e avisos ----------------
function abrirModal(html) {
  const m = $("#modal");
  m.innerHTML = `<div class="modal-corpo">${html}</div>`;
  if (!m.open) m.showModal();
}
function fecharModal() { const m = $("#modal"); if (m.open) m.close(); }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// Fecha o modal na hora (funciona mesmo sem internet: o Firebase envia quando a conexão voltar)
function salvar(promessa, msgOk) {
  fecharModal();
  toast(msgOk);
  Promise.resolve(promessa).catch((e) => {
    console.error(e);
    toast(e?.message === "existe" ? "⚠️ Alguém já tinha marcado este remédio. Não dê de novo!" : "Erro ao salvar. Tente de novo.");
  });
}

// ---------------- PWA ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

iniciar();
