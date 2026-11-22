# Cuidados da Vó — como colocar no ar

App para a família organizar quem fica com a vó (manhã, tarde, noite) e controlar os remédios.
Funciona no iPhone e no Android, sem loja de apps e sem custo.

- **GitHub Pages**: hospeda o app (o "site").
- **Firebase**: guarda os dados e garante que só a família tenha acesso.

Tempo total: uns 20 minutos, uma vez só.

---

## 1. Firebase (banco de dados)

1. Entre em <https://console.firebase.google.com> com sua conta Google.
2. **Criar um projeto** → nome, por exemplo `cuidados-vo` → pode desativar o Google Analytics → Criar.
3. **Login anônimo**: menu *Criação* → **Authentication** → *Vamos começar* → aba *Método de login* → **Anônimo** → Ativar → Salvar.
   (Ninguém precisa criar senha: quem digita o código da família entra.)
4. **Banco de dados**: menu *Criação* → **Firestore Database** → *Criar banco de dados*
   → local `southamerica-east1 (São Paulo)` → **modo de produção** → Criar.
5. **Regras**: ainda no Firestore, aba **Regras** → apague tudo, cole o conteúdo do arquivo `firestore.rules` → **Publicar**.
6. **Código da família**: aba **Dados** → *Iniciar coleção*
   - ID da coleção: `config`
   - ID do documento: `familia`
   - Campo: `codigo`, tipo `string`, valor: invente um código, ex. `vo-maria-2026`
   - Salvar.
   *Esse é o código que você vai mandar para a família. Para trocar depois, é só editar aqui.*
7. **Pegar a configuração**: ícone de engrenagem ⚙️ → *Configurações do projeto* → lá embaixo, *Seus apps* → ícone **`</>`** (Web)
   → apelido `cuidados` → *Registrar app*. Vai aparecer um bloco `const firebaseConfig = { ... }`.
8. Abra o arquivo **`config.js`** e troque `firebase: null,` pelo conteúdo entre as chaves, assim:

```js
  firebase: {
    apiKey: "AIza...",
    authDomain: "cuidados-vo.firebaseapp.com",
    projectId: "cuidados-vo",
    storageBucket: "cuidados-vo.firebasestorage.app",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abc123"
  },
```

> A `apiKey` do Firebase não é secreta, pode ficar no GitHub público. Quem protege os dados são as regras e o código da família.

## 2. GitHub Pages (hospedagem)

1. Em <https://github.com/new> crie um repositório **público**, ex. `cuidados-vo`.
2. Clique em *uploading an existing file* e arraste **todos os arquivos e a pasta `icons`** deste projeto → *Commit changes*.
3. No repositório: **Settings** → **Pages** → *Source*: `Deploy from a branch` → Branch `main`, pasta `/ (root)` → Save.
4. Em 1 ou 2 minutos o app estará em: `https://SEU-USUARIO.github.io/cuidados-vo/`

## 3. Mandar para a família

Mensagem sugerida para o WhatsApp:

> Fiz um app para organizarmos os cuidados da vó 🧡
> Link: https://SEU-USUARIO.github.io/cuidados-vo/
> Código da família: **vo-maria-2026**
>
> **iPhone**: abra o link no **Safari** → botão Compartilhar (quadrado com setinha) → *Adicionar à Tela de Início*.
> **Android**: abra no **Chrome** → três pontinhos → *Instalar app* (ou *Adicionar à tela inicial*).
> Depois é só abrir pelo ícone, colocar seu nome e o código.

No iPhone, entre **pelo ícone da tela inicial** (e não pelo Safari) na primeira vez, porque o app instalado
guarda o login separado do Safari.

---

## Como usar

- **Hoje**: quem está com a vó agora, o próximo turno, remédios pendentes e últimos recados.
- **Escala**: escolha o dia, toque em *Vou ficar neste turno*, ajuste até que horas pode ficar.
  Dá para repetir toda semana. Cores: 🟢 coberto · 🟠 falta parte do horário · 🔴 ninguém.
  O botão *Enviar escala da semana* gera o texto pronto para o grupo do WhatsApp.
- **Remédios**: cadastre cada remédio com horário fixo (ex. 08:00 e 20:00) ou "quando precisar" (ex. dipirona se dor,
  mínimo 6h entre doses). Quem der o remédio toca **Dei ✓** — todo mundo vê na hora quem deu e a que horas.
  O app não deixa duas pessoas marcarem a mesma dose e avisa se o intervalo mínimo ainda não passou.
- **Recados**: para passar o plantão (como ela dormiu, se comeu, se sentiu dor, o que falta comprar).

Funciona sem internet também: o que for marcado offline é enviado quando a conexão voltar.

## Mudar alguma coisa

- Nome da vó e horários dos turnos: arquivo `config.js`.
- Depois de editar no GitHub, o app atualiza sozinho nos celulares (pode precisar fechar e abrir de novo).

## Testar no computador

Sem preencher o Firebase o app abre em **modo demonstração** (dados só no aparelho). Para abrir localmente:

```
python -m http.server 8000
```

e acesse <http://localhost:8000>.
