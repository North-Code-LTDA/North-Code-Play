# North Code Play — Estabilização Integrada de Navegação, Apresentação Responsiva para TV e Foco

Entrega integrada para corrigir a entrada e percurso por controle/teclado na tela de Configurações, unificar a navegação entre temporadas e episódios nas Séries, corrigir a visibilidade e rolagem progressiva das sinopses, adaptar os detalhes de filmes e séries a viewports compactas de TV (como `961 × 541`), sincronizar de forma determinística a detecção automática de TV, isolar o foco inicial do player em relação aos submenus de configurações/diagnóstico e equilibrar o ciclo de vida da memória de foco ao assistir episódios.

## User Review & Critical Decisions

> [!IMPORTANT]
> As decisões abaixo consolidam as escolhas confirmadas e os limites arquiteturais obrigatórios para esta entrega.

- **Decisão Confirmada 1 — Retorno em Configurações**: Ao pressionar Voltar (`Escape` / `Back`) com o foco dentro das opções da tela de Configurações (Apresentação, Densidade ou Diagnóstico), o foco retorna ao botão **Configurações** na barra lateral mantendo a seção aberta; um segundo Voltar a partir da barra lateral retorna para **Início**.
- **Decisão Confirmada 2 — Troca de Temporada em Séries**: Ao selecionar outra temporada com `Enter`/`OK` no controle ou teclado, o foco permanece no botão da temporada selecionada (garantindo que nunca caia em um episódio desmontado), permitindo descer ao primeiro episódio disponível com Seta para Baixo.
- **Preservação de Escopo**: Nenhuma alteração em serviços de rede, autenticação, catálogo Xtream, URLs de mídia, fallback de canais, histórico, favoritos ou dependências. Sem zoom global (`zoom`), `transform: scale` no app inteiro ou larguras fixas artificiais (`1920px`).

---

## 1. Overview & Core Concept

- **What It Does**: Harmoniza o motor de navegação espacial, o gerenciamento de foco por camadas e o layout responsivo do modo TV para que todas as telas — incluindo Configurações, Detalhes de Filmes/Séries e Controles/Submenus do Player — funcionem de forma fluida tanto em televisores Android TV (com viewports CSS reduzidos pelo DPR nativo) quanto em navegadores desktop e móveis.
- **Target Audience / Persona**: Usuários assistindo conteúdos via controle remoto em Android TV / TV Box (WebView empacotada) e usuários em computadores ou dispositivos móveis utilizando teclado, mouse ou toque.
- **Key Value**: Elimina armadilhas de foco (como ficar preso na barra lateral ao abrir Configurações, não conseguir entrar nos episódios a partir das temporadas ou perder o foco do menu de qualidade do player) e garante que banners, sinopses e listas de episódios caibam e rolem perfeitamente em telas de TV de baixa altura CSS.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Fluxo de Configurações por Controle/Teclado**: O usuário seleciona **Configurações** na barra lateral e pressiona `Enter`/`OK` (ou Seta Direita). O foco entra uma única vez na opção ativa de **Apresentação** (`Automática`, `TV` ou `Padrão`). Com Cima/Baixo e Esquerda/Direita, percorre **Apresentação**, **Densidade no modo TV** e o botão **Ver diagnóstico da tela**, com rolagem automática que revela o card completo. Pressionar Seta Esquerda na primeira coluna ou Voltar devolve o foco ao item **Configurações** da barra lateral sem fechar a seção.
  2. **Fluxo de Temporadas, Episódios e Sinopses**: Ao abrir os detalhes de uma série ou filme, o cabeçalho, a sinopse, o botão de favoritos, a faixa horizontal de temporadas e a lista de episódios compartilham o mesmo percurso vertical contínuo. Focar a sinopse posiciona sua caixa na área visível (sem forçar `scrollTop = 0` indevidamente), permitindo ler textos longos com Cima/Baixo antes de avançar para o próximo controle. Da temporada ativa, Seta para Baixo alcança o primeiro episódio; do primeiro episódio, Seta para Cima retorna à temporada ativa.
  3. **Fluxo de Reprodução de Episódios e Retorno em Camadas**: Ao reproduzir um episódio (ou avançar para próximo/anterior) e fechar o player, o foco e a posição de rolagem retornam exatamente ao episódio assistido usando estado local da tela de detalhes; ao fechar a tela de detalhes, a memória global restaura o foco no card da série na grade principal, sem acúmulo de entradas órfãs.
  4. **Fluxo de Menus Internos do Player**: Ao abrir **Configurações** ou **Diagnóstico** dentro do player, o temporizador de auto-ocultação é pausado e o efeito de foco inicial do player não é reexecutado, mantendo o foco estável dentro do menu e seus submenus mesmo durante eventos de reprodução ou buffering.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Interface cinematográfica escura de alto contraste, com superfícies neutras profundas (`--color-nc-bg: #000000`, `--color-nc-bg-card: #141414`, `--color-nc-bg-input: #1a1a1a`) e destaque branco nítido (`#ffffff`) para leitura à distância em TV.
  - *Typography & Hierarchy*: Tipografia limpa com hierarquia adaptativa em modo TV — títulos de detalhes escalonados proporcionalmente (`clamp(1.35rem, 2.6vw, 2.25rem)`) e metadados em linha com números tabulares (`tabular-nums`).
  - *Component Styling & Layout*: No modo TV (`data-display-mode="tv"`), os banners de detalhes de filmes e séries reduzem sua altura mínima (`clamp(180px, 38vh, 320px)` conforme a densidade), aplicam `min-w-0` e `min-h-0` na cadeia flex/grid e utilizam grades responsivas (`auto-fill` / `minmax`) calibradas por densidade (`compact`, `normal`, `comfortable`) para nunca estourar horizontalmente nem comprimir a área útil em viewports como `961 × 541`.
- **Interactive Feedback & Motion**: Contorno de foco branco sólido de alto contraste (`2px solid #ffffff`) sem escala, rolagem suave sincronizada com os limites do contêiner e transições imediatas entre submenus.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Unificação da Zona Lógica em Detalhes de Séries**:
  - *Chosen Approach*: Remover a zona isolada `episodes` da lista de episódios para que cabeçalho, sinopse, favoritos, abas de temporada e episódios participem da mesma progressão vertical de blocos dentro do modal de detalhes, preservando `data-nav-row="true"` nas temporadas.
  - *Why*: Permite que o navegador espacial transite naturalmente entre a aba de temporada selecionada e o primeiro episódio (e vice-versa) sem listeners manuais em cada item.
  - *Alternatives Considered*: Adicionar regras de exceção hardcoded para uma zona `episodes` ou listeners individuais por episódio, o que fragmentaria a manutenção.
- **Decision 2 — Memória de Foco Local para Episódios vs. Global para Modais**:
  - *Chosen Approach*: Gerenciar o ID do episódio e o `scrollTop` da lista exclusivamente em referências locais da tela de detalhes da série (inclusive quando `scrollTop === 0`), reservando a pilha global `pushFocusMemory`/`popFocusMemory` apenas para a abertura e o fechamento do modal de detalhes em direção ao card da série.
  - *Why*: Evita que múltiplos episódios assistidos empilhem elementos na memória global ou consumam prematuramente a referência do card da série.
- **Decision 3 — Ciclo Controlado de Detecção Nativa de TV**:
  - *Chosen Approach*: Centralizar no `NavigationProvider` e no módulo de ambiente um ciclo idempotente que sincroniza imediatamente na montagem, revalida no retorno de visibilidade/foco da janela (`visibilitychange` / `focus`) e executa um número finito e curto de verificações iniciais caso a ponte `WebToApk.isTv()` seja injetada logo após o carregamento inicial, cancelando tudo no cleanup.
  - *Why*: Garante que o modo TV entre em vigor automaticamente sem exigir visita à tela de Configurações e sem criar polling infinito.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   NavigationProvider & Ambiente de TV                       │
│  ┌───────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ Ciclo de Detecção (tvEnvironment) │  │ Navegador Espacial & BackStack │  │
│  │ • Preferência: auto | tv | default│  │ • Zonas: sidebar | content     │  │
│  │ • Sync inicial + visibility/focus │  │ • Blocos verticais & fileiras  │  │
│  │ • Retry curto finito e idempotente│  │ • Rolagem progressiva sinopse  │  │
│  └─────────────────┬─────────────────┘  └────────────────┬───────────────┘  │
└────────────────────┼─────────────────────────────────────┼──────────────────┘
                     │                                     │
       ┌─────────────┴─────────────┐         ┌─────────────┴─────────────┐
       ▼                           ▼         ▼                           ▼
┌──────────────────────┐  ┌──────────────────────────┐  ┌─────────────────────┐
│   Tela Principal &   │  │ Detalhes Filmes & Séries │  │    VideoPlayer &    │
│    Configurações     │  │ • Layout TV responsivo   │  │   Menus Internos    │
│ • Zona content ativa │  │   (banners adaptativos)  │  │ • Foco de entrada   │
│ • Autofoco único na  │  │ • Sinopse sem top-anchor │  │   desacoplado de    │
│   entrada por remoto │  │ • Temporadas ↔ Episódios │  │   scheduleAutoHide  │
│ • Back → Sidebar     │  │ • Foco local de episódio │  │ • Pausa auto-hide   │
│   mantendo seção     │  │   + Memória global card  │  │   com menu aberto   │
└──────────────────────┘  └──────────────────────────┘  └─────────────────────┘
```

- **Data Model & State**:
  - **Estado de Apresentação TV**: `{ modePreference: 'auto' | 'tv' | 'default', density: 'compact' | 'normal' | 'comfortable', effectiveMode: 'tv' | 'default', origin: 'auto' | 'manual', webToApkTv: { detected, available } }`, sincronizado com `document.documentElement.dataset` apenas quando houver mudança efetiva de valor.
  - **Estado de Foco de Episódio (Local à Série)**: `lastEpisodeIdRef` (`string | null`), `savedEpisodeScrollTopRef` (`number | null`, suportando `0`), e `restoreTimerRef` cancelável na desmontagem.
- **Interactive Component & State Mapping**:
  - **Entrada e Retorno em Configurações**: O contêiner declara `data-nav-zone="content"`. Na montagem em modo `remote`, um efeito controlado por ref (`hasInitializedFocusRef`) foca uma única vez o botão selecionado em `config-display-mode`. Ao pressionar Voltar com foco em `ConfigView`, o handler de seção em `Home` move o foco para o botão `Configurações` na barra lateral mantendo a tela aberta.
  - **Rolagem e Visibilidade da Sinopse**: Remove `data-scroll-top-anchor="true"` da sinopse de séries (mantendo-o apenas nos controles de cabeçalho/topo explícito). Ao receber foco, `ensureElementScrolledIntoView` posiciona o bloco da sinopse dentro da área visível do contêiner e `tryScrollFocusedSynopsis` permite rolar internamente ou pelo contêiner pai em passos progressivos até o fim do texto antes de passar ao controle adjacente.
  - **Estabilidade de Foco no Player**: O efeito de entrada em camada cheia (`isPlayerInFullLayer`) depende apenas da transição real de entrada no player (guardada por ref), sem depender de `scheduleAutoHide`. Abrir `showSettings` ou `showDiagnostics` pausa o timer de inatividade e preserva o foco dentro do menu ativo.
