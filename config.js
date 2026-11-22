// ============================================================
//  CONFIGURAÇÃO DO APP — este é o único arquivo que você edita
// ============================================================

window.APP_CONFIG = {
  // Como a família chama a avó (aparece no título do app)
  nomeDaVo: "Vó",

  // Turnos do dia. Pode mudar os horários se quiser.
  turnos: [
    { id: "manha", nome: "Manhã", icone: "☀️", ini: "07:00", fim: "13:00" },
    { id: "tarde", nome: "Tarde", icone: "🌤️", ini: "13:00", fim: "19:00" },
    { id: "noite", nome: "Noite", icone: "🌙", ini: "19:00", fim: "07:00" },
  ],

  // Cole aqui a configuração do Firebase (passo a passo no LEIAME.md).
  // Enquanto estiver null, o app roda em MODO DEMONSTRAÇÃO:
  // os dados ficam só no aparelho em que você está testando.
  firebase: {
    apiKey: "AIzaSyAnJ_3DAkqROw4_yesG06nxShw8hU8jg4A",
    authDomain: "sos-1303.firebaseapp.com",
    projectId: "sos-1303",
    storageBucket: "sos-1303.firebasestorage.app",
    messagingSenderId: "226388761525",
    appId: "1:226388761525:web:bf6f053bd736cd223217fc",
  },
};
