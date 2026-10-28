# North Code Play — Navegação por Controle/Teclado e Prioridade SD na TV ao Vivo

## 1. Visão Geral do Escopo e Decisões Confirmadas

Esta entrega implementa duas melhorias acopladas de forma limpa à arquitetura atual do **North Code Play**, preservando integralmente o uso por mouse/toque, a persistência de credenciais, favoritos, histórico e a reprodução direta de mídia no navegador:

1. **Ponte de Runtime para Android TV / Capacitor (Sem alterar dependências):** A escuta do evento nativo de botão Voltar (`backButton` / `backbutton`) será feita via detecção dinâmica em runtime (`window.Capacitor?.Plugins?.App`), mantendo o `package.json` e o `package-lock.json` intocados.
2. **Prioridade Automática Estrita `SD → HD → FHD → 4K` na TV ao Vivo:** Tanto a escolha do stream primário do grupo quanto o início e o fallback automático tentarão sempre da resolução mais baixa disponível para a mais alta (`SD`, depois `HD`, `FHD` e `4K`), sem que a memória de sessão pule um stream `SD` ainda não tentado na rodada atual. A seleção manual de resolução permanece prioritária sobre os streams da resolução escolhida.
3. **Indicador Visual de Foco em Alto Contraste (Sem Escala):** Quando o modo de navegação por controle/teclado estiver ativo (`data-nav-mode="remote"`), o elemento focado exibirá uma borda branca nítida de alto contraste (`2px solid #ffffff` com `outline-offset`) sem transformação de escala (`scale`), evitando cortes de overflow e deslocamentos de layout.

---

## 2. Arquitetura e Fluxos de Interação

```
+-----------------------------------------------------------------------+
|                    Camada Modular de Navegação                        |
|  - Detector de Modo: Setas D-Pad -> "remote" | Mouse/Toque -> "pointer"|
|  - Motor Espacial 2D: Filtra elementos visíveis no escopo ativo       |
|  - Pilha de Foco & Escopos: Restaura o elemento de origem ao fechar   |
|  - Política Central de Voltar + Ponte Runtime Capacitor Android       |
+-----------------------------------------------------------------------+
          |                                       |
          v                                       v
+-----------------------------------+   +-------------------------------+
|    Fluxos de Telas e Catálogos    |   |  TV ao Vivo & VideoPlayer     |
|  - Login, Topo, Abas e Busca      |   |  - Ordem Auto: SD->HD->FHD->4K|
|  - Trilhos Horizontais e Grades   |   |  - 1º OK: Abre no Preview     |
|  - Detalhes (Filmes / Séries)     |   |  - 2º OK: Expande Tela Cheia  |
|  - Sem botões aninhados           |   |    (mesmo <video>, sem reload)|
+-----------------------------------+   +-------------------------------+
```

### 2.1. Navegação Espacial e Gerenciamento de Escopo
- **Alternância Automática de Modo:** O pressionamento de `ArrowUp`, `ArrowDown`, `ArrowLeft` ou `ArrowRight` ativa `document.documentElement.dataset.navMode = "remote"`. Eventos de `pointerdown` ou `touchstart` retornam imediatamente para `"pointer"`, ocultando o anel de foco de TV durante o uso por mouse ou toque.
- **Isolamento de Camada Ativa:** O motor espacial avalia apenas elementos interativos visíveis, habilitados e com dimensões reais dentro do escopo superior ativo (modal de detalhes, diálogo de retomada, player em tela cheia, menu móvel ou tela principal). Elementos de fundo ficam inacessíveis às setas enquanto um modal ou tela cheia estiver aberto.
- **Restauração de Foco e Rolagem Suave:** Ao abrir detalhes de um filme/série ou entrar em tela cheia, o elemento acionador é salvo na pilha de foco e restaurado imediatamente ao fechar. A movimentação por setas utiliza `scrollIntoView({ block: 'nearest', inline: 'nearest' })` para manter o card focado visível sem resetar o scroll da lista de categorias.
- **Busca Protegida contra Teclado Virtual Acidental:** Ao navegar com as setas pelo cabeçalho, a barra de busca recebe foco primeiro como um botão de acionamento. O campo de edição (`<input>`) só é ativado quando o usuário pressiona `OK`/`Enter` (ou clica com mouse/toque), evitando abrir o teclado virtual da TV durante uma simples passagem pelas abas. `Escape`/`Voltar` sai do modo de edição devolvendo o foco ao controle da busca.
- **Desaninhamento de Ações Secundárias:** Nos itens da lista de canais ao vivo e nos cards com botão de favorito, o controle principal de seleção e o botão de favoritar são irmãos independentes e focáveis, garantindo que `OK`/`Enter` no favorito nunca dispare a troca de canal ou abertura indevida.

### 2.2. Fluxo de TV ao Vivo (Duplo OK e Prioridade `SD → HD → FHD → 4K`)
- **Seleção Automática e Fallback:**
  - Na montagem dos grupos e na função de escolha de variante em modo automático, a ordem de prioridade passa a ser `['SD', 'HD', 'FHD', '4K']`.
  - Se um canal não possuir `SD`, a tentativa inicia na menor resolução seguinte disponível (`HD`, depois `FHD`, depois `4K`).
  - Se o stream atual falhar por erro fatal ou atingir o timeout de 28 segundos sem reproduzir, o fallback percorre primeiro os demais streams da mesma resolução ainda não tentados na rodada e, em seguida, sobe para a próxima resolução na ordem `SD → HD → FHD → 4K`, sem repetir streams já tentados.
  - Na escolha manual de resolução (ex.: `HD`), todos os streams `HD` são tentados antes de recorrer ao fallback automático `SD → HD → FHD → 4K`.
- **Fluxo de 1º OK (Preview) e 2º OK (Tela Cheia sem Reiniciar):**
  - Pressionar `OK`/`Enter` em um canal diferente seleciona o grupo e inicia a reprodução no player integrado (preview).
  - Pressionar `OK`/`Enter` novamente sobre o canal que já está selecionado (ou acionar o botão de expandir do preview) ativa o modo de tela cheia (`isEmbeddedFullscreen`) na mesma instância do `VideoPlayer`, preservando o elemento `<video>` em execução sem chamar `startVariantAttempt` novamente.

### 2.3. Conflito de Atalhos no Player e Política do Botão Voltar
- **Coordenação no `VideoPlayer`:**
  - No uso normal em desktop (modo `"pointer"`), os atalhos `ArrowLeft`/`ArrowRight` (seek), `ArrowUp`/`ArrowDown` (volume), `Space`/`Enter`, `F`, `M` e `Escape` continuam funcionando exatamente como hoje.
  - No modo `"remote"`, quando a barra de controles do player estiver oculta, pressionar `OK`/`Enter` ou qualquer seta revela os controles e posiciona o foco no botão principal (`Play/Pause`). Enquanto os controles estiverem visíveis e o foco estiver nos botões da barra, as setas navegam entre os controles do player (`Voltar`, `Play/Pause`, `Mute`, `Variantes`, `Tela Cheia`) sem disparar seek ou volume simultaneamente.
- **Hierarquia Centralizada do Botão Voltar (`Escape`, `Backspace` fora de inputs e `backButton` Capacitor):**
  1. Fechar edição ativa do campo de busca, menu de diagnóstico ou diálogo de confirmação de retomada;
  2. Sair da tela cheia da TV ao vivo retornando para o modo preview (mantendo o canal tocando);
  3. Fechar o player em tela cheia de Filme/Série/Episódio ou fechar o modal aberto de `MovieDetails` / `SeriesDetails`, restaurando o foco ao card de origem;
  4. Fechar o menu móvel lateral ou, na TV ao vivo, retornar o foco da área do player/canais para a coluna de categorias;
  5. Retornar das abas internas (`live`, `movies`, `series`, `favorites`, `config`) para a aba `inicio`;
  6. Na raiz (`inicio` ou `Login`), em ambiente nativo Capacitor Android, delegar para `App.exitApp()` — **jamais** executando logout ou limpando credenciais salvas.

---

## 3. Estética Visual e Indicador de Foco
- **Foco Exclusivo para Modo Controle/Teclado:** Escopado a `html[data-nav-mode="remote"]`, qualquer card, aba, categoria, episódio ou botão focado recebe `outline: 2px solid #ffffff`, `outline-offset: 2px` e sombra sutil de contraste (`0 0 0 4px rgba(0, 0, 0, 0.75)`), garantindo leitura imediata a 3 metros de distância sobre fundos escuros ou pôsteres claros.
- **Estabilidade Geométrica:** Nenhuma animação de escala (`transform: scale`) será aplicada pelo estado de foco, mantendo alinhamento rigoroso nas listas de canais, categorias e trilhos horizontais.

---

## 4. Verificação Automatizada Planejada
- Atualização e execução da suíte de verificação para cobrir:
  - Prioridade inicial `SD → HD → FHD → 4K` no agrupamento e no fallback automático da TV ao vivo;
  - Início na menor resolução disponível quando o grupo não tiver `SD`;
  - Prioridade de todos os streams da resolução escolhida manualmente antes do fallback geral;
  - Expansão para tela cheia no segundo `OK` sobre o canal ativo e troca de variante mantendo o mesmo elemento `<video>`;
  - Navegação espacial por setas entre abas, categorias, busca protegida, cards e detalhes com ativação única por `OK`/`Enter`;
  - Hierarquia do botão Voltar (tela cheia → preview, modal de detalhes → card de origem, seções → início) sem jamais efetuar logout.
