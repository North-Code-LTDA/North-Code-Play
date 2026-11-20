import assert from 'node:assert';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Watchdog de segurança para evitar travamentos em ambiente simulado
const watchdog = setTimeout(() => {
  console.error('TIMEOUT: test-login-config excedeu 20s');
  process.exit(1);
}, 20000);
watchdog.unref();

// ============================================================================
// 1. Ambiente DOM enxuto e determinístico (sem servidores ou credenciais reais)
// ============================================================================
const windowInstance = new Window({
  url: 'http://localhost:3000',
  width: 1280,
  height: 720,
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).window = windowInstance;
(globalThis as any).document = windowInstance.document;
Object.defineProperty(globalThis, 'navigator', {
  value: windowInstance.navigator,
  writable: true,
  configurable: true,
});
(globalThis as any).HTMLElement = windowInstance.HTMLElement;
(globalThis as any).HTMLButtonElement = windowInstance.HTMLButtonElement;
(globalThis as any).HTMLInputElement = windowInstance.HTMLInputElement;
(globalThis as any).HTMLImageElement = windowInstance.HTMLImageElement;
(globalThis as any).Element = windowInstance.Element;
(globalThis as any).Node = windowInstance.Node;
(globalThis as any).SVGElement = windowInstance.SVGElement;
(globalThis as any).Event = windowInstance.Event;
(globalThis as any).CustomEvent = windowInstance.CustomEvent;
(globalThis as any).KeyboardEvent = windowInstance.KeyboardEvent;
(globalThis as any).MouseEvent = windowInstance.MouseEvent;
(globalThis as any).MutationObserver = windowInstance.MutationObserver;
(globalThis as any).localStorage = windowInstance.localStorage;
(globalThis as any).sessionStorage = windowInstance.sessionStorage;
(globalThis as any).URL = windowInstance.URL;
(globalThis as any).Blob = windowInstance.Blob;
(globalThis as any).getComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);

(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

(globalThis as any).IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};

const matchMediaStub = (query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
(globalThis as any).matchMedia = matchMediaStub;
(windowInstance as any).matchMedia = matchMediaStub;

let rafIdCounter = 1;
const rafTimers = new Map<number, NodeJS.Timeout>();
const rafCallback = (cb: FrameRequestCallback) => {
  const id = rafIdCounter++;
  const timer = setTimeout(() => {
    rafTimers.delete(id);
    cb(performance.now());
  }, 16);
  rafTimers.set(id, timer);
  return id;
};
const cancelRafCallback = (id: number) => {
  const timer = rafTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    rafTimers.delete(id);
  }
};
(globalThis as any).requestAnimationFrame = rafCallback;
(globalThis as any).cancelAnimationFrame = cancelRafCallback;
(windowInstance as any).requestAnimationFrame = rafCallback;
(windowInstance as any).cancelAnimationFrame = cancelRafCallback;

(globalThis as any).fetch = async () =>
  new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const htmlProto = windowInstance.HTMLElement.prototype as any;
htmlProto.animate = undefined;
(windowInstance.Element.prototype as any).animate = undefined;
htmlProto.scrollIntoView = function () {};
htmlProto.scrollTo = function (options?: any, y?: number) {
  if (typeof options === 'object' && options !== null) {
    if (typeof options.top === 'number') this.scrollTop = options.top;
    if (typeof options.left === 'number') this.scrollLeft = options.left;
  } else if (typeof options === 'number') {
    this.scrollLeft = options;
    if (typeof y === 'number') this.scrollTop = y;
  }
};

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  } as DOMRect;
}

htmlProto.getBoundingClientRect = function (this: HTMLElement): DOMRect {
  if (this.hasAttribute('hidden') || this.getAttribute('aria-hidden') === 'true') {
    return makeRect(0, 0, 0, 0);
  }
  if (this.getAttribute('data-config-section') === 'account') {
    return makeRect(80, 120, 900, 220);
  }
  if (this.getAttribute('data-config-section') === 'presentation') {
    return makeRect(80, 380, 900, 160);
  }
  if (this.getAttribute('data-config-primary') === 'true') {
    return makeRect(540, 440, 200, 46);
  }
  if (this.hasAttribute('data-nav-item') || this.tagName === 'BUTTON' || this.tagName === 'INPUT') {
    return makeRect(100, 200, 200, 46);
  }
  return makeRect(0, 0, 1280, 720);
};

// ============================================================================
// 2. Imports dinâmicos após o bootstrap do DOM
// ============================================================================
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { MotionConfig } = await import('motion/react');
const { ConfigView } = await import('../src/views/ConfigView');
const { Login } = await import('../src/pages/Login');
const { XtreamCredentialsContext } = await import('../src/context/XtreamContext');
const { XtreamService } = await import('../src/services/xtreamService');
const tvEnvironmentModule = await import('../src/platform/tvEnvironment');
const { APP_VERSION, APP_COMMIT, formatCommitShort } = await import('../src/version');
const { CREDENTIALS_KEY } = await import('../src/utils/accountUtils');
const {
  NavigationProvider,
  moveSpatialFocus,
  setNavMode,
  invalidateCandidateCache,
} = await import('../src/navigation');

async function flush(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function mount(element: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(MotionConfig, { reducedMotion: 'always' }, element)
    );
  });
  return { container, root };
}

function unmount(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
  invalidateCandidateCache();
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const prevValue = input.value;
  const setter = Object.getOwnPropertyDescriptor(
    windowInstance.HTMLInputElement.prototype,
    'value'
  )?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  const tracker = (input as any)._valueTracker;
  if (tracker) {
    tracker.setValue(prevValue);
  }
  input.dispatchEvent(new windowInstance.Event('input', { bubbles: true }));
}

const SYNTHETIC_CREDS = {
  playlistName: 'Sala Principal',
  serverUrl: 'http://secret-provider.synthetic.local:8080',
  username: 'demo_subscriber',
  password: 'synthetic_password_123',
  allowed_output_formats: ['m3u8', 'ts'],
};

let passed = 0;
function pass(msg: string) {
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

const originalAuthenticate = XtreamService.authenticate;

console.log('=== North Code Play — Validação Direcionada de Login e Configurações ===');

try {
  // --------------------------------------------------------------------------
  // Cenário 1: ConfigView — Hierarquia comercial e ausência de dados técnicos/URL
  // --------------------------------------------------------------------------
  console.log('\n[1/5] ConfigView: ordem comercial e remoção de URL do Servidor e dados técnicos');
  window.localStorage.clear();
  tvEnvironmentModule.cancelDisplayPreview();
  setNavMode('pointer');

  (XtreamService as any).authenticate = async () => ({
    user_info: {
      username: SYNTHETIC_CREDS.username,
      status: 'Active',
      exp_date: '1924905600', // 31/12/2030
      active_cons: '1',
      max_connections: '3',
      allowed_output_formats: ['m3u8', 'ts'],
    },
    server_info: { url: 'secret-provider.synthetic.local' },
  });

  {
    const { container, root } = mount(
      React.createElement(
        XtreamCredentialsContext.Provider,
        { value: { credentials: SYNTHETIC_CREDS } },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(ConfigView, { focusTarget: 'presentation', focusRequestId: 1 })
        )
      )
    );
    await flush(40);

    const text = container.textContent || '';
    assert(text.includes('Configurações'), 'Título Configurações deve existir');
    assert(text.includes('Informações da Conta'), 'Seção Informações da Conta deve existir');
    assert(text.includes('Apresentação e Tamanho da Interface'), 'Seção Apresentação deve existir');
    assert(text.includes(SYNTHETIC_CREDS.username), 'Usuário conectado deve aparecer');
    assert(text.includes('Ativa'), 'Status da conta ativa deve aparecer');
    assert(text.includes('1 / 3'), 'Conexões ativas e limite devem aparecer');

    const accountSec = container.querySelector('[data-config-section="account"]');
    const presSec = container.querySelector('[data-config-section="presentation"]');
    assert(accountSec && presSec, 'Ambas as seções principais devem possuir identificadores');
    assert(
      Boolean(accountSec!.compareDocumentPosition(presSec!) & Node.DOCUMENT_POSITION_FOLLOWING),
      'Informações da Conta deve aparecer ANTES de Apresentação na ordem do DOM'
    );

    // Remoções obrigatórias
    assert(!text.includes('URL do Servidor'), 'Rótulo URL do Servidor NÃO deve aparecer em Configurações');
    assert(!text.includes(SYNTHETIC_CREDS.serverUrl), 'Valor de credentials.serverUrl NÃO deve aparecer em Configurações');
    assert(!text.includes('secret-provider.synthetic.local'), 'Host do provedor NÃO deve aparecer em Configurações');
    assert(!text.includes(':8080'), 'Porta do provedor NÃO deve aparecer em Configurações');
    assert(!text.includes(SYNTHETIC_CREDS.password), 'Senha NÃO deve aparecer em Configurações');
    assert(!text.includes('Informações do aplicativo'), 'Seção Informações do aplicativo NÃO deve aparecer');
    assert(!text.includes('Identificação do Build'), 'Identificação do Build NÃO deve aparecer');
    assert(!text.includes('Formatos do Provedor'), 'Formatos do Provedor NÃO deve aparecer');
    assert(!text.includes('Reprodução 100% Direta no Navegador'), 'Texto técnico de arquitetura NÃO deve aparecer');
    assert(!text.includes(APP_COMMIT), 'Hash de commit NÃO deve aparecer');
    assert(!text.includes(formatCommitShort(APP_COMMIT)), 'Commit curto NÃO deve aparecer');
    assert(!text.includes(`v${APP_VERSION}`), 'Versão interna NÃO deve aparecer');

    // Sem foco agressivo em modo ponteiro e scroll mantido no topo
    const scrollEl = container.querySelector<HTMLElement>('[data-scroll-container="true"]');
    assert.strictEqual(scrollEl?.scrollTop ?? 0, 0, 'Abrir Configurações deve manter scroll no topo');
    assert.strictEqual(
      document.activeElement,
      document.body,
      'No modo mouse/ponteiro não deve forçar foco automático agressivo'
    );

    unmount(root, container);
    pass('ConfigView exibe apenas Cabeçalho -> Informações da Conta -> Apresentação, sem URL do Servidor ou dados técnicos');
  }

  // --------------------------------------------------------------------------
  // Cenário 2: ConfigView — Erro temporário não bloqueia Apresentação
  // --------------------------------------------------------------------------
  console.log('\n[2/5] ConfigView: falha temporária na consulta da conta não bloqueia Apresentação');
  (XtreamService as any).authenticate = async () => {
    throw new Error('Provedor temporariamente indisponível');
  };

  {
    const { container, root } = mount(
      React.createElement(
        XtreamCredentialsContext.Provider,
        { value: { credentials: SYNTHETIC_CREDS } },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(ConfigView, { focusTarget: 'account', focusRequestId: 2 })
        )
      )
    );
    await flush(40);

    const alertEl = container.querySelector('[role="alert"]');
    assert(
      alertEl && (alertEl.textContent || '').includes('Provedor temporariamente indisponível'),
      'Mensagem de erro da conta deve ser exibida com role="alert"'
    );
    const adjustBtn = container.querySelector<HTMLButtonElement>('button[data-config-primary="true"]');
    assert(adjustBtn, 'Botão Ajustar apresentação deve permanecer acessível mesmo quando a consulta da conta falha');

    unmount(root, container);
    pass('Erro de consulta ao provedor mantém seção de Apresentação 100% acessível');
  }

  // --------------------------------------------------------------------------
  // Cenário 3: ConfigView — DisplaySetupModal (preview, cancelamento, persistência e restauração de foco)
  // --------------------------------------------------------------------------
  console.log('\n[3/5] ConfigView: DisplaySetupModal, cancelamento, persistência e restauração de foco');
  (XtreamService as any).authenticate = async () => ({
    user_info: { username: SYNTHETIC_CREDS.username, status: 'Active', exp_date: 'null' },
    server_info: {},
  });

  {
    const { container, root } = mount(
      React.createElement(
        XtreamCredentialsContext.Provider,
        { value: { credentials: SYNTHETIC_CREDS } },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(ConfigView, { focusTarget: 'presentation', focusRequestId: 3 })
        )
      )
    );
    await flush(40);

    const openBtn = container.querySelector<HTMLButtonElement>('button[data-config-primary="true"]')!;
    assert(openBtn, 'Botão Ajustar apresentação deve existir');

    // Abrir -> TV -> 90% -> Voltar -> Cancelar sem salvar
    act(() => openBtn.click());
    await flush(30);
    assert(document.querySelector('[data-display-setup-modal="true"]'), 'DisplaySetupModal deve abrir');

    act(() => (document.querySelector('[data-device-choice="tv"]') as HTMLButtonElement).click());
    await flush(25);
    act(() => (document.querySelector('[data-tv-adjust-size="true"]') as HTMLButtonElement).click());
    await flush(25);
    act(() => (document.querySelector('[data-scale-preset="90"]') as HTMLButtonElement).click());
    await flush(25);
    assert.strictEqual(tvEnvironmentModule.getDisplayPreferencesSnapshot().mode, 'default', 'Preview não deve persistir antes de confirmar');

    act(() => (document.querySelector('[data-calibration-back="true"]') as HTMLButtonElement).click());
    await flush(25);
    act(() => (document.querySelector('[data-device-cancel="true"]') as HTMLButtonElement).click());
    await flush(30);
    assert.strictEqual(document.querySelector('[data-display-setup-modal="true"]'), null, 'Modal deve fechar ao cancelar');
    assert.strictEqual(tvEnvironmentModule.getDisplayPreferencesSnapshot().mode, 'default', 'Cancelamento deve preservar modo default');
    assert.strictEqual(document.activeElement, openBtn, 'Fechar modal deve restaurar foco no botão de origem');

    // Reabrir -> TV -> 85% -> Confirmar -> Persistir e exibir Calibrar escala (85%)
    act(() => openBtn.click());
    await flush(30);
    act(() => (document.querySelector('[data-device-choice="tv"]') as HTMLButtonElement).click());
    await flush(25);
    act(() => (document.querySelector('[data-tv-adjust-size="true"]') as HTMLButtonElement).click());
    await flush(25);
    act(() => (document.querySelector('[data-scale-preset="85"]') as HTMLButtonElement).click());
    await flush(25);
    act(() => (document.querySelector('[data-calibration-confirm="true"]') as HTMLButtonElement).click());
    await flush(30);

    const savedSnap = tvEnvironmentModule.getDisplayPreferencesSnapshot();
    assert.strictEqual(savedSnap.mode, 'tv', 'Confirmação deve persistir modo TV');
    assert.strictEqual(savedSnap.tvScale, 85, 'Confirmação deve persistir escala 85%');
    assert((container.textContent || '').includes('Calibrar escala (85%)'), 'Botão Calibrar escala deve refletir a escala salva (85%)');
    assert.strictEqual(document.activeElement, openBtn, 'Confirmar modal deve restaurar foco no botão Ajustar apresentação');

    unmount(root, container);
    pass('DisplaySetupModal preserva prévia temporária, cancelamento, persistência e restauração de foco');
  }

  // --------------------------------------------------------------------------
  // Cenário 4: ConfigView — Foco e navegação D-Pad na nova ordem (Conta -> Apresentação -> Conta)
  // --------------------------------------------------------------------------
  console.log('\n[4/5] ConfigView: foco D-Pad na nova ordem (Informações da Conta <-> Apresentação)');
  setNavMode('remote');

  {
    const { container, root } = mount(
      React.createElement(
        XtreamCredentialsContext.Provider,
        { value: { credentials: SYNTHETIC_CREDS } },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(ConfigView, { focusTarget: 'account', focusRequestId: 4 })
        )
      )
    );
    await flush(40);

    const accountEl = container.querySelector<HTMLElement>('[data-config-account-focus="true"]');
    const primaryBtn = container.querySelector<HTMLButtonElement>('button[data-config-primary="true"]');
    assert(accountEl && primaryBtn, 'Elementos focáveis de Conta e Apresentação devem existir');
    assert.strictEqual(document.activeElement, accountEl, 'Em modo D-Pad, foco inicial posiciona em Informações da Conta (topo)');

    act(() => {
      moveSpatialFocus('down');
    });
    assert.strictEqual(document.activeElement, primaryBtn, 'Seta para baixo avança de Informações da Conta para Ajustar apresentação');

    act(() => {
      moveSpatialFocus('up');
    });
    assert.strictEqual(document.activeElement, accountEl, 'Seta para cima retorna de Ajustar apresentação para Informações da Conta');

    unmount(root, container);
    pass('Navegação D-Pad percorre Conta -> Apresentação -> Conta mantendo foco visível e sem prisão');
  }

  // --------------------------------------------------------------------------
  // Cenário 5: Login — Formulário completo, URL preservada, M3U, Avatar Picker e Autenticação
  // --------------------------------------------------------------------------
  console.log('\n[5/5] Login: URL preservada, parse M3U, Avatar Picker (Escape/foco), senha e autenticação');
  window.localStorage.clear();
  setNavMode('pointer');

  const authCalls: any[] = [];
  let shouldRejectAuth = true;
  (XtreamService as any).authenticate = async (creds: any) => {
    authCalls.push(creds);
    if (shouldRejectAuth) {
      throw new Error('Credenciais inválidas');
    }
    return {
      user_info: {
        username: creds.username,
        status: 'Active',
        allowed_output_formats: ['m3u8', 'ts'],
      },
      server_info: { url: 'iptv.synthetic.local' },
    };
  };

  {
    const { container, root } = mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        React.createElement(
          NavigationProvider,
          null,
          React.createElement(
            Routes,
            null,
            React.createElement(Route, { path: '/', element: React.createElement(Login) }),
            React.createElement(Route, {
              path: '/home',
              element: React.createElement('div', { 'data-home-landed': 'true' }, 'Home OK'),
            })
          )
        )
      )
    );
    await flush(40);

    const playlistInput = container.querySelector<HTMLInputElement>('#playlistName')!;
    const serverInput = container.querySelector<HTMLInputElement>('#serverUrl')!;
    const userInput = container.querySelector<HTMLInputElement>('#username')!;
    const passInput = container.querySelector<HTMLInputElement>('#password')!;
    const avatarTrigger = container.querySelector<HTMLButtonElement>('[data-avatar-trigger="true"]')!;
    const togglePassBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Mostrar senha"]')!;
    const submitBtn = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    assert(
      playlistInput && serverInput && userInput && passInput && avatarTrigger && togglePassBtn && submitBtn,
      'Todos os campos e controles essenciais do Login devem estar presentes'
    );
    assert.strictEqual(passInput.type, 'password', 'Senha deve iniciar oculta por padrão');
    assert.strictEqual(submitBtn.disabled, true, 'Botão Entrar deve iniciar desabilitado sem credenciais');

    // Alternar mostrar/ocultar senha
    act(() => togglePassBtn.click());
    assert.strictEqual(passInput.type, 'text', 'Botão mostrar senha deve exibir texto');
    const hidePassBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Ocultar senha"]')!;
    assert(hidePassBtn, 'Rótulo acessível deve atualizar para Ocultar senha');
    act(() => hidePassBtn.click());
    assert.strictEqual(passInput.type, 'password', 'Botão ocultar senha deve voltar a ocultar');

    // Avatar Picker: abrir -> 9 opções -> Escape fecha e restaura foco -> reabrir e selecionar opção 2
    act(() => {
      avatarTrigger.focus();
      avatarTrigger.click();
    });
    await flush(40);
    const pickerEl = container.querySelector('[data-avatar-picker="true"]');
    assert(pickerEl, 'Avatar Picker deve abrir');
    assert.strictEqual(pickerEl!.querySelectorAll('[data-avatar-option]').length, 9, 'Avatar Picker deve preservar todas as 9 opções');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush(250);
    assert.strictEqual(container.querySelector('[data-avatar-picker="true"]'), null, 'Tecla Escape deve fechar Avatar Picker');
    assert.strictEqual(document.activeElement, avatarTrigger, 'Fechar Avatar Picker deve restaurar foco no botão de origem');

    act(() => avatarTrigger.click());
    await flush(40);
    const opt2 = container.querySelector<HTMLButtonElement>('[data-avatar-option="2"]')!;
    act(() => opt2.click());
    await flush(250);
    assert.strictEqual(container.querySelector('[data-avatar-picker="true"]'), null, 'Selecionar avatar deve fechar o seletor');
    assert.strictEqual(document.activeElement, avatarTrigger, 'Selecionar avatar deve restaurar foco no botão de origem');

    // Parse automático de link M3U no campo URL do Servidor
    act(() => {
      setNativeInputValue(
        serverInput,
        'http://iptv.synthetic.local:8080/get.php?username=m3u_user&password=m3u_pass&type=m3u_plus'
      );
    });
    await flush(25);
    assert.strictEqual(serverInput.value, 'http://iptv.synthetic.local:8080', 'URL do Servidor deve normalizar link M3U mantendo host e porta');
    assert.strictEqual(userInput.value, 'm3u_user', 'Parse M3U deve preencher usuário');
    assert.strictEqual(passInput.value, 'm3u_pass', 'Parse M3U deve preencher senha');
    assert.strictEqual(submitBtn.disabled, false, 'Botão Entrar deve habilitar após preenchimento');

    // Submissão com erro do provedor
    const form = container.querySelector('form')!;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(40);
    const errAlert = container.querySelector('[role="alert"]');
    assert(errAlert && (errAlert.textContent || '').includes('Credenciais inválidas'), 'Erro de autenticação deve ser exibido com role="alert"');

    // Submissão com sucesso -> salva sessão (com serverUrl e allowed_output_formats) e navega para /home
    shouldRejectAuth = false;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(50);

    assert.strictEqual(authCalls.length, 2, 'XtreamService.authenticate deve ser chamado nas submissões');
    assert(container.querySelector('[data-home-landed="true"]'), 'Login bem-sucedido deve navegar para /home');
    const savedRaw = window.localStorage.getItem(CREDENTIALS_KEY);
    assert(
      savedRaw &&
        savedRaw.includes('http://iptv.synthetic.local:8080') &&
        savedRaw.includes('m3u8'),
      'Sessão persistida deve manter serverUrl e allowed_output_formats intactos'
    );

    unmount(root, container);
    pass('Login preserva URL do Servidor, extração M3U, Avatar Picker acessível, mensagens de erro e fluxo de autenticação');
  }
} finally {
  clearTimeout(watchdog);
  (XtreamService as any).authenticate = originalAuthenticate;
  rafTimers.forEach((t) => clearTimeout(t));
  rafTimers.clear();
}

console.log(`\n✅ Todos os ${passed} blocos de validação de Login e Configurações passaram com sucesso!`);
process.exit(0);
