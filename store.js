// Camada de dados: Firebase (uso real) ou localStorage (modo demonstração).
// As duas têm a mesma interface:
//   perfil, entrar(nome, codigo), watch(col, desde, cb), set(col, id, dado),
//   criar(col, id, dado) [falha se já existir], add(col, dado), remover(col, id)

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const PERFIL_KEY = "vo-cuidados-perfil";

const lerJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const gravarJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export async function criarStore(config) {
  return config ? criarFirebase(config) : criarLocal();
}

// ---------------- Modo demonstração ----------------
function criarLocal() {
  const KEY = "vo-cuidados-demo";
  let dados = lerJSON(KEY) || {};
  const ouvintes = [];
  const lista = (col, desde) =>
    Object.entries(dados[col] || {})
      .map(([id, d]) => ({ id, ...d }))
      .filter((d) => !desde || d.data >= desde);
  const avisar = () => ouvintes.forEach((o) => o.cb(lista(o.col, o.desde)));
  const salvar = () => { gravarJSON(KEY, dados); setTimeout(avisar, 0); };
  window.addEventListener("storage", (e) => { if (e.key === KEY) { dados = lerJSON(KEY) || {}; avisar(); } });
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const store = {
    demo: true,
    perfil: lerJSON(PERFIL_KEY),
    async entrar(nome) {
      const perfil = { uid: store.perfil?.uid || novoId(), nome, codigo: "" };
      gravarJSON(PERFIL_KEY, perfil);
      store.perfil = perfil;
      return perfil;
    },
    watch(col, desde, cb) {
      const o = { col, desde, cb };
      ouvintes.push(o);
      setTimeout(() => cb(lista(col, desde)), 0);
      return () => ouvintes.splice(ouvintes.indexOf(o), 1);
    },
    async set(col, id, d) { (dados[col] ||= {})[id] = d; salvar(); },
    async criar(col, id, d) {
      if (dados[col]?.[id]) throw new Error("existe");
      (dados[col] ||= {})[id] = d; salvar();
    },
    async add(col, d) { const id = novoId(); (dados[col] ||= {})[id] = d; salvar(); return id; },
    async remover(col, id) { if (dados[col]) delete dados[col][id]; salvar(); },
    apagarTudo() { dados = {}; salvar(); },
  };
  return store;
}

// ---------------- Firebase ----------------
async function criarFirebase(config) {
  const [{ initializeApp }, fa, fs] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(config);
  const auth = fa.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }

  await auth.authStateReady();
  if (!auth.currentUser) await fa.signInAnonymously(auth);
  const uid = auth.currentUser.uid;

  // Perfil: tenta o servidor; se estiver sem internet, usa o que ficou salvo no aparelho.
  let perfil = null;
  const salvo = lerJSON(PERFIL_KEY);
  try {
    const s = await fs.getDoc(fs.doc(db, "membros", uid));
    if (s.exists()) perfil = { uid, ...s.data() };
  } catch {
    if (salvo?.uid === uid) perfil = salvo;
  }
  if (perfil) gravarJSON(PERFIL_KEY, perfil);

  const traduzir = (e) => {
    if (e?.code === "permission-denied") return new Error("sem-permissao");
    return e;
  };

  const store = {
    demo: false,
    perfil,
    async entrar(nome, codigo) {
      try {
        await fs.setDoc(fs.doc(db, "membros", uid), { nome, codigo, em: Date.now() });
      } catch (e) {
        if (e?.code === "permission-denied") throw new Error("Código da família incorreto.");
        throw new Error("Não foi possível entrar. Verifique a internet.");
      }
      const p = { uid, nome, codigo };
      gravarJSON(PERFIL_KEY, p);
      store.perfil = p;
      return p;
    },
    watch(col, desde, cb) {
      let q = fs.collection(db, col);
      if (desde) q = fs.query(q, fs.where("data", ">=", desde));
      return fs.onSnapshot(
        q,
        (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => console.error("watch", col, e)
      );
    },
    set: (col, id, d) => fs.setDoc(fs.doc(db, col, id), d).catch((e) => { throw traduzir(e); }),
    // As regras do Firestore não permitem sobrescrever uma dose já registrada,
    // então se duas pessoas marcarem ao mesmo tempo, a segunda recebe erro.
    criar: (col, id, d) => fs.setDoc(fs.doc(db, col, id), d).catch((e) => {
      throw e?.code === "permission-denied" ? new Error("existe") : e;
    }),
    add: (col, d) => fs.addDoc(fs.collection(db, col), d).then((r) => r.id).catch((e) => { throw traduzir(e); }),
    remover: (col, id) => fs.deleteDoc(fs.doc(db, col, id)).catch((e) => { throw traduzir(e); }),

    // Chave pessoal usada pela automação de presença (Atalhos / MacroDroid)
    async chavePresenca() {
      const ref = fs.doc(db, "chaves", uid);
      const s = await fs.getDoc(ref);
      if (s.exists() && s.data().token) return s.data().token;
      const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
      await fs.setDoc(ref, { token });
      return token;
    },

    // Registra este celular para receber avisos (Firebase Cloud Messaging)
    async ativarAvisos(vapidKey, nome) {
      const m = await import(FB + "firebase-messaging.js");
      if (!(await m.isSupported())) throw new Error("este navegador não aceita avisos");
      const reg = await navigator.serviceWorker.ready;
      const token = await m.getToken(m.getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
      if (!token) throw new Error("o celular não gerou o registro de avisos");
      await fs.setDoc(fs.doc(db, "aparelhos", uid), { nome, tokens: fs.arrayUnion(token), em: Date.now() }, { merge: true });
      return token;
    },
  };
  return store;
}
