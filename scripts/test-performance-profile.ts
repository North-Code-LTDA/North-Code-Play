import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Watchdog de segurança para evitar travamentos em ambiente simulado
const watchdog = setTimeout(() => {
  console.error('TIMEOUT: test-performance-profile excedeu 20s');
  process.exit(1);
}, 20000);
watchdog.unref();

// ============================================================================
// 1. Ambiente DOM enxuto e determinístico (happy-dom)
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
(globalThis as any).HTMLVideoElement = windowInstance.HTMLVideoElement;
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
(windowInstance as any).requestAnimationFrame = rafCallback;
(globalThis as any).cancelAnimationFrame = cancelRafCallback;
(windowInstance as any).cancelAnimationFrame = cancelRafCallback;

const htmlProto = windowInstance.HTMLElement.prototype as any;
htmlProto.animate = undefined;
if (!htmlProto.scrollIntoView) {
  htmlProto.scrollIntoView = () => {};
}

// Stub mínimo de mídia para VideoPlayer em cenário de verificação de handlers
const videoProto = windowInstance.HTMLMediaElement?.prototype as any;
if (videoProto) {
  videoProto.play = () => Promise.resolve();
  videoProto.pause = () => {};
  videoProto.load = () => {};
}

// ============================================================================
// 2. Importações após bootstrap DOM
// ============================================================================
const { MotionConfig } = await import('motion/react');
const { setAndroidPlatformOverrideForDpadTest } = await import(
  '../src/navigation/navigationPlatformPolicy'
);
const {
  STORAGE_KEY_DISPLAY_PREFS,
  confirmDisplayPreferences,
  getDisplayPreferencesSnapshot,
  syncDocumentDisplayAttributes,
} = await import('../src/platform/tvEnvironment');
const {
  STORAGE_KEY_PERFORMANCE_PROFILE,
  initPerformanceProfile,
  getPerformanceProfileSnapshot,
  setPerformanceProfilePreference,
  syncDocumentPerformanceAttributes,
  subscribePerformanceProfile,
  resetPerformanceProfileCacheForTest,
  getPerformanceProfileSubscriptionCountsForTest,
} = await import('../src/platform/performanceProfile');
const { NavigationProvider, setNavMode, getNavMode, executeBackAction } = await import(
  '../src/navigation'
);
const { XtreamProvider } = await import('../src/context/XtreamContext');
const { ConfigView } = await import('../src/views/ConfigView');
const { HorizontalRow } = await import('../src/components/HorizontalRow');
const { VideoPlayer } = await import('../src/components/VideoPlayer');

async function flush(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function resetAllState() {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-performance-mode');
  document.documentElement.removeAttribute('data-display-mode');
  document.documentElement.style.removeProperty('font-size');
  document.documentElement.style.removeProperty('--nc-ui-scale');
  document.documentElement.style.removeProperty('--nc-ui-scale-pct');
  document.documentElement.style.removeProperty('--nc-rem-compensation');
  setAndroidPlatformOverrideForDpadTest(null);
  resetPerformanceProfileCacheForTest();
  setNavMode('pointer');
}

async function mountConfigView(): Promise<{
  host: HTMLDivElement;
  unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  await act(async () => {
    root.render(
      React.createElement(
        MotionConfig,
        { reducedMotion: 'always' },
        React.createElement(
          XtreamProvider,
          { credentials: null },
          React.createElement(
            NavigationProvider,
            null,
            React.createElement(ConfigView)
          )
        )
      )
    );
  });
  await flush();

  return {
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

// ============================================================================
// 3. Execução dos cenários direcionados do Perfil Lite (Fase 1/5)
// ============================================================================
async function runTests() {
  let passed = 0;
  const runCase = async (name: string, fn: () => Promise<void>) => {
    resetAllState();
    await fn();
    passed += 1;
    console.log(`  [OK] ${name}`);
  };

  console.log('Executando suite direcionada do Perfil Lite (test-performance-profile)...');

  // 1. Web + qualquer navMode (pointer e remote) -> sempre full
  await runCase(
    '1. Web + qualquer navMode (pointer e remote) resolve sempre para full e oculta seção Desempenho visual',
    async () => {
      setAndroidPlatformOverrideForDpadTest(false);
      confirmDisplayPreferences('tv', 80);
      window.localStorage.setItem(
        STORAGE_KEY_PERFORMANCE_PROFILE,
        JSON.stringify({ version: 1, preference: 'lite' })
      );
      resetPerformanceProfileCacheForTest();

      setNavMode('pointer');
      const snapPointer = initPerformanceProfile();
      assert.strictEqual(snapPointer.isAndroidApk, false);
      assert.strictEqual(snapPointer.navMode, 'pointer');
      assert.strictEqual(snapPointer.effectiveMode, 'full', 'Web + pointer deve ser full');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      setNavMode('remote');
      const snapRemote = getPerformanceProfileSnapshot();
      assert.strictEqual(snapRemote.navMode, 'remote');
      assert.strictEqual(snapRemote.effectiveMode, 'full', 'Web + remote deve continuar full');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      const mounted = await mountConfigView();
      try {
        assert.strictEqual(
          mounted.host.querySelector('[data-config-section="performance"]'),
          null,
          'Seção Desempenho visual não deve aparecer na Web'
        );
        assert.ok(
          mounted.host.querySelector('[data-config-section="account"]'),
          'Seção de Conta deve ser preservada'
        );
        assert.ok(
          mounted.host.querySelector('[data-config-section="presentation"]'),
          'Seção de Apresentação deve ser preservada'
        );
      } finally {
        await mounted.unmount();
      }
    }
  );

  // 2. Android + default + pointer -> full
  await runCase(
    '2. APK Android + apresentação default + pointer resolve para full (auto, lite e full)',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('default', 85);
      syncDocumentDisplayAttributes();
      setNavMode('pointer');

      const snapAuto = initPerformanceProfile();
      assert.strictEqual(snapAuto.displayEffectiveMode, 'default');
      assert.strictEqual(snapAuto.navMode, 'pointer');
      assert.strictEqual(snapAuto.effectiveMode, 'full');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      setPerformanceProfilePreference('lite');
      const snapLite = getPerformanceProfileSnapshot();
      assert.strictEqual(snapLite.preference, 'lite', 'Preferência manual lite deve ser mantida');
      assert.strictEqual(snapLite.effectiveMode, 'full', 'Android + default + pointer deve permanecer full');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      setPerformanceProfilePreference('full');
      assert.strictEqual(getPerformanceProfileSnapshot().effectiveMode, 'full');
    }
  );

  // 3. Android + default + remote -> full (inclusive com auto ou lite manual)
  await runCase(
    '3. APK Android + apresentação default + remote resolve para full mesmo com auto ou lite manual',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('default', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');

      const snapAuto = initPerformanceProfile();
      assert.strictEqual(snapAuto.displayEffectiveMode, 'default');
      assert.strictEqual(snapAuto.navMode, 'remote');
      assert.strictEqual(snapAuto.effectiveMode, 'full');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      setPerformanceProfilePreference('lite');
      const snapManualLite = getPerformanceProfileSnapshot();
      assert.strictEqual(snapManualLite.preference, 'lite');
      assert.strictEqual(
        snapManualLite.effectiveMode,
        'full',
        'Sem apresentação TV ativa, lite manual não pode ativar modo lite'
      );
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      // Ao confirmar apresentação TV estando em remote, ativa lite automaticamente
      confirmDisplayPreferences('tv', 90);
      assert.strictEqual(getPerformanceProfileSnapshot().effectiveMode, 'lite');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      // Ao voltar para apresentação default, retorna para full preservando a preferência salva
      confirmDisplayPreferences('default', 90);
      const snapBack = getPerformanceProfileSnapshot();
      assert.strictEqual(snapBack.preference, 'lite');
      assert.strictEqual(snapBack.effectiveMode, 'full');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
    }
  );

  // 4. Android + tv + pointer + auto -> full
  await runCase(
    '4. APK Android + apresentação tv + pointer + auto resolve para full',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('pointer');

      const snap = initPerformanceProfile();
      assert.strictEqual(snap.isAndroidApk, true);
      assert.strictEqual(snap.displayEffectiveMode, 'tv');
      assert.strictEqual(snap.navMode, 'pointer');
      assert.strictEqual(snap.preference, 'auto');
      assert.strictEqual(snap.effectiveMode, 'full');
      assert.strictEqual(snap.isLiteActive, false);
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
    }
  );

  // 5. Android + tv + remote + auto -> lite
  await runCase(
    '5. APK Android + apresentação tv + remote + auto resolve para lite',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');

      const snap = initPerformanceProfile();
      assert.strictEqual(snap.isAndroidApk, true);
      assert.strictEqual(snap.displayEffectiveMode, 'tv');
      assert.strictEqual(snap.navMode, 'remote');
      assert.strictEqual(snap.preference, 'auto');
      assert.strictEqual(snap.effectiveMode, 'lite');
      assert.strictEqual(snap.isLiteActive, true);
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
    }
  );

  // 6 e 7. Android + tv + remote + full -> full e Android + tv + remote + lite -> lite (via ConfigView)
  await runCase(
    '6/7. APK Android + apresentação tv + remote respeita escolha manual full e lite no ConfigView',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();

      const mounted = await mountConfigView();
      try {
        const perfSection = mounted.host.querySelector('[data-config-section="performance"]');
        assert.ok(perfSection, 'Seção Desempenho visual deve aparecer no APK Android');

        const autoBtn = perfSection.querySelector<HTMLButtonElement>('[data-performance-option="auto"]');
        const liteBtn = perfSection.querySelector<HTMLButtonElement>('[data-performance-option="lite"]');
        const fullBtn = perfSection.querySelector<HTMLButtonElement>('[data-performance-option="full"]');
        assert.ok(autoBtn && liteBtn && fullBtn, 'Todas as 3 opções devem existir');
        assert.strictEqual(autoBtn.getAttribute('aria-checked'), 'true');
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        assert.ok(
          perfSection.querySelector('[data-performance-active-label="true"]')?.textContent?.includes('Lite')
        );

        // 6. Escolha manual de Completo em TV + remote -> full
        act(() => {
          fullBtn.click();
        });
        await flush();
        assert.strictEqual(fullBtn.getAttribute('aria-checked'), 'true');
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        assert.ok(
          perfSection.querySelector('[data-performance-active-label="true"]')?.textContent?.includes('Completo')
        );

        // 7. Escolha manual de Lite em TV + remote -> lite
        act(() => {
          liteBtn.click();
        });
        await flush();
        assert.strictEqual(liteBtn.getAttribute('aria-checked'), 'true');
        assert.strictEqual(liteBtn.getAttribute('data-selected'), 'true');
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        assert.ok(
          perfSection.querySelector('[data-performance-active-label="true"]')?.textContent?.includes('Lite')
        );

        // Volta reversível para Automático (em TV + remote -> lite)
        act(() => {
          autoBtn.click();
        });
        await flush();
        assert.strictEqual(autoBtn.getAttribute('aria-checked'), 'true');
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
      } finally {
        await mounted.unmount();
      }
    }
  );

  // 8. Android + tv + pointer + lite -> full, preservando preferência manual e restaurando ao voltar para remote
  await runCase(
    '8. APK Android + tv + pointer + lite resolve para full preservando preferência manual e restaura lite ao voltar para remote',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('pointer');
      initPerformanceProfile();

      const mounted = await mountConfigView();
      try {
        const perfSection = mounted.host.querySelector('[data-config-section="performance"]')!;
        const liteBtn = perfSection.querySelector<HTMLButtonElement>('[data-performance-option="lite"]')!;

        act(() => {
          liteBtn.click();
        });
        await flush();

        const storedRaw = window.localStorage.getItem(STORAGE_KEY_PERFORMANCE_PROFILE);
        assert.ok(storedRaw && storedRaw.includes('"lite"'), 'Preferência manual lite deve ficar salva');
        assert.strictEqual(liteBtn.getAttribute('aria-checked'), 'true', 'Seleção visual deve refletir lite');
        assert.strictEqual(getPerformanceProfileSnapshot().effectiveMode, 'full');
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        assert.ok(
          perfSection.querySelector('[data-performance-active-label="true"]')?.textContent?.includes('Completo'),
          'Indicador Ativo agora deve exibir Completo enquanto em pointer'
        );

        // Ao retornar para navegação por controle remoto, lite ativa automaticamente
        act(() => {
          setNavMode('remote');
        });
        await flush();
        assert.strictEqual(getPerformanceProfileSnapshot().preference, 'lite');
        assert.strictEqual(getPerformanceProfileSnapshot().effectiveMode, 'lite');
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        assert.ok(
          perfSection.querySelector('[data-performance-active-label="true"]')?.textContent?.includes('Lite'),
          'Indicador Ativo agora deve restaurar para Lite ao voltar para remote'
        );
      } finally {
        await mounted.unmount();
      }
    }
  );

  // 9. Alternar pointer -> remote -> pointer atualiza atributo raiz corretamente
  await runCase(
    '9. Alternar pointer -> remote -> pointer atualiza data-performance-mode corretamente (full -> lite -> full)',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('pointer');
      initPerformanceProfile();

      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      setNavMode('remote');
      assert.strictEqual(getNavMode(), 'remote');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      setNavMode('pointer');
      assert.strictEqual(getNavMode(), 'pointer');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');

      setNavMode('remote');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
    }
  );

  // 10. Repetir remote -> remote não gera mutação no DOM nem notificação redundante
  await runCase(
    '10. Repetir remote -> remote não gera mutação em data-performance-mode nem notificação redundante de listeners',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      let listenerCalls = 0;
      const unsubscribe = subscribePerformanceProfile(() => {
        listenerCalls += 1;
      });

      let domAttributeWrites = 0;
      const docEl = document.documentElement;
      const originalSetAttribute = docEl.setAttribute.bind(docEl);
      docEl.setAttribute = ((name: string, value: string) => {
        if (name === 'data-performance-mode') {
          domAttributeWrites += 1;
        }
        return originalSetAttribute(name, value);
      }) as typeof docEl.setAttribute;

      try {
        for (let i = 0; i < 20; i++) {
          setNavMode('remote');
          const changed = syncDocumentPerformanceAttributes();
          assert.strictEqual(changed, false);
        }

        assert.strictEqual(
          domAttributeWrites,
          0,
          'Repetir remote -> remote não pode escrever no atributo DOM data-performance-mode'
        );
        assert.strictEqual(
          listenerCalls,
          0,
          'Repetir remote -> remote não pode disparar listeners do perfil de desempenho'
        );
      } finally {
        docEl.setAttribute = originalSetAttribute;
        unsubscribe();
      }
    }
  );

  // 11. Preferência persiste após remontagem e reinicialização fria simulada + fallback sem localStorage
  await runCase(
    '11. Preferência persiste após remontagem e reinicialização fria simulada, e funciona sem localStorage',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      setNavMode('remote');
      initPerformanceProfile();

      setPerformanceProfilePreference('lite');
      const storedRaw = window.localStorage.getItem(STORAGE_KEY_PERFORMANCE_PROFILE);
      assert.ok(storedRaw && storedRaw.includes('"lite"'), 'Preferência deve ser salva em chave independente');

      // Simula reinicialização fria limpando cache em memória e removendo atributo DOM
      document.documentElement.removeAttribute('data-performance-mode');
      resetPerformanceProfileCacheForTest();
      const rebootSnap = initPerformanceProfile();
      assert.strictEqual(rebootSnap.preference, 'lite');
      assert.strictEqual(rebootSnap.effectiveMode, 'lite');
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      // Remontagem do ConfigView deve refletir opção salva
      const mounted = await mountConfigView();
      try {
        const liteBtn = mounted.host.querySelector<HTMLButtonElement>('[data-performance-option="lite"]');
        assert.strictEqual(liteBtn?.getAttribute('aria-checked'), 'true');
      } finally {
        await mounted.unmount();
      }

      // Simula localStorage indisponível lançando erro
      const originalStorage = window.localStorage;
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError: storage disabled');
        },
      });
      try {
        const persisted = setPerformanceProfilePreference('full');
        assert.strictEqual(persisted, false, 'Sem storage retorna persisted=false sem lançar exceção');
        assert.strictEqual(getPerformanceProfileSnapshot().preference, 'full');
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
      } finally {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          value: originalStorage,
        });
      }
    }
  );

  // 12. Alternar Lite/Completo e pointer/remote não altera escala da TV nem chave de preferências de apresentação
  await runCase(
    '12. Alternar Lite/Completo e pointer/remote não altera escala da TV, tokens --nc-ui-scale nem localStorage de apresentação',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 75);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();

      const beforeDisplayRaw = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);
      const beforeDisplaySnap = getDisplayPreferencesSnapshot();
      const beforeUiScale = document.documentElement.style.getPropertyValue('--nc-ui-scale');
      const beforeUiScalePct = document.documentElement.style.getPropertyValue('--nc-ui-scale-pct');
      const beforeFontSize = document.documentElement.style.fontSize;

      setPerformanceProfilePreference('full');
      setPerformanceProfilePreference('lite');
      setNavMode('pointer');
      setNavMode('remote');
      setPerformanceProfilePreference('auto');

      const afterDisplayRaw = window.localStorage.getItem(STORAGE_KEY_DISPLAY_PREFS);
      const afterDisplaySnap = getDisplayPreferencesSnapshot();
      assert.strictEqual(afterDisplayRaw, beforeDisplayRaw, 'Chave de display não pode ser alterada');
      assert.strictEqual(afterDisplaySnap.mode, beforeDisplaySnap.mode);
      assert.strictEqual(afterDisplaySnap.tvScale, 75);
      assert.strictEqual(afterDisplaySnap.effectiveTvScale, 75);
      assert.strictEqual(afterDisplaySnap.uiScaleFactor, beforeDisplaySnap.uiScaleFactor);
      assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale'), beforeUiScale);
      assert.strictEqual(document.documentElement.style.getPropertyValue('--nc-ui-scale-pct'), beforeUiScalePct);
      assert.strictEqual(document.documentElement.style.fontSize, beforeFontSize);
      assert.strictEqual(document.documentElement.getAttribute('data-display-mode'), 'tv');
    }
  );

  // 13. Foco D-Pad continua visível e regras CSS permanecem estritamente condicionadas
  await runCase(
    '13. Regras CSS do modo Lite mantêm foco branco visível, restringem escopo sem seletores genéricos globais e preservam controles funcionais',
    async () => {
      const cssPath = path.resolve(process.cwd(), 'src/index.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      const liteBlockIndex = cssContent.indexOf('Visual Performance Profile: Lite Mode');
      assert.ok(liteBlockIndex !== -1, 'Bloco CSS do modo Lite deve existir em src/index.css');
      const liteBlock = cssContent.slice(liteBlockIndex);

      assert.ok(
        !/\*\s*\{[^}]*(animation|transition)\s*:\s*none/i.test(cssContent),
        'CSS não deve conter regra global indiscriminada * { animation/transition: none }'
      );
      assert.ok(
        !/html\[data-performance-mode="lite"\](?:\[data-nav-mode="remote"\])?\s+(?:button|input|select|textarea|a|\[tabindex\]|\[data-nav-item="true"\])(?:\s|,|:)/i.test(
          liteBlock
        ),
        'Bloco Lite não deve aplicar regras genéricas a button/input/select/textarea/a/[tabindex]/[data-nav-item]'
      );
      assert.ok(
        !liteBlock.includes('.nc-player-ctrl-btn'),
        'Bloco Lite não deve alterar seletores dos botões do player'
      );
      assert.ok(
        liteBlock.includes('html[data-performance-mode="lite"] .nc-card-visual-layer'),
        'Deve conter otimização condicional para .nc-card-visual-layer'
      );
      assert.ok(
        liteBlock.includes(
          'html[data-performance-mode="lite"][data-nav-mode="remote"] .nc-live-horizontal-card[data-card-focused="true"] .nc-card-visual-layer'
        ),
        'Deve cobrir cards horizontais da TV ao Vivo no modo Lite'
      );
      assert.ok(
        liteBlock.includes(
          'html[data-performance-mode="lite"][data-nav-mode="remote"] .nc-showcase-card,'
        ),
        'Deve restringir desativação de transições de foco aos componentes específicos de navegação visual'
      );
      assert.ok(
        liteBlock.includes('border: 2px solid #ffffff;'),
        'Deve preservar borda branca visível nos cards focados sem ampliação'
      );
      assert.ok(
        cssContent.includes('outline: 2px solid #ffffff !important;'),
        'Deve preservar contorno branco de foco D-Pad nas regras originais e específicas'
      );
      assert.ok(
        liteBlock.includes(
          'html[data-performance-mode="lite"][data-nav-mode="remote"] [data-scroll-container="true"]'
        ) && liteBlock.includes('scroll-behavior: auto !important;'),
        'Deve desativar scroll-behavior: smooth apenas em modo Lite + remote'
      );
      assert.ok(
        liteBlock.includes('html[data-performance-mode="lite"] .nc-card-visual-layer img'),
        'Deve reduzir transição cosmética de opacidade das imagens dos cards sem alterar estado loaded'
      );
    }
  );

  // 14. Cards conservam dimensões, atributos de navegação e virtualização entre Full e Lite
  await runCase(
    '14. Cards em HorizontalRow conservam dimensões, atributos de navegação e contagem virtualizada em Lite e Completo',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();

      const items = Array.from({ length: 60 }, (_, idx) => ({
        stream_id: idx + 1,
        name: `Filme Teste ${idx + 1}`,
        cover: '',
        rating: '8.5',
      }));

      const clickedNames: string[] = [];
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root: Root = createRoot(host);

      try {
        await act(async () => {
          root.render(
            React.createElement(
              MotionConfig,
              { reducedMotion: 'always' },
              React.createElement(
                XtreamProvider,
                { credentials: null },
                React.createElement(HorizontalRow, {
                  title: 'Destaques',
                  items,
                  type: 'movie',
                  rowIndex: 0,
                  onItemClick: (item) => clickedNames.push(item.name),
                  virtualize: true,
                })
              )
            )
          );
        });
        await flush();

        const captureCardSnapshot = () => {
          const cards = Array.from(host.querySelectorAll<HTMLElement>('[data-showcase-card="true"]'));
          return {
            count: cards.length,
            firstClass: cards[0]?.className ?? '',
            firstVisualClass: cards[0]?.querySelector('[data-card-visual="true"]')?.className ?? '',
            firstNavItem: cards[0]?.getAttribute('data-nav-item'),
            firstRowIdx: cards[0]?.getAttribute('data-row-card-index'),
            firstVirtualIdx: cards[0]?.getAttribute('data-virtual-index'),
          };
        };

        setPerformanceProfilePreference('full');
        await flush();
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'full');
        const snapFull = captureCardSnapshot();

        setPerformanceProfilePreference('lite');
        await flush();
        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        const snapLite = captureCardSnapshot();

        assert.ok(snapFull.count > 0 && snapFull.count < items.length, 'Virtualização horizontal deve permanecer ativa');
        assert.deepStrictEqual(snapLite, snapFull, 'Modo Lite não pode alterar dimensões, classes, atributos ou contagem virtualizada dos cards');
        assert.strictEqual(snapLite.firstNavItem, 'true');
        assert.strictEqual(snapLite.firstRowIdx, '0');
        assert.strictEqual(snapLite.firstVirtualIdx, '0');
        assert.ok(snapLite.firstClass.includes('nc-showcase-card'));
        assert.ok(snapLite.firstVisualClass.includes('nc-card-visual-layer'));

        const firstCard = host.querySelector<HTMLElement>('[data-showcase-card="true"]')!;
        act(() => {
          firstCard.click();
        });
        assert.deepStrictEqual(clickedNames, ['Filme Teste 1']);
      } finally {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      }
    }
  );

  // 15. Controles do player e fluxo de navegação continuam intactos
  await runCase(
    '15. Perfil Lite não interfere nos handlers de Back ou controle do VideoPlayer',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();
      setPerformanceProfilePreference('lite');
      syncDocumentPerformanceAttributes();
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      let backCalled = 0;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root: Root = createRoot(host);

      try {
        await act(async () => {
          root.render(
            React.createElement(
              MotionConfig,
              { reducedMotion: 'always' },
              React.createElement(
                XtreamProvider,
                { credentials: null },
                React.createElement(
                  NavigationProvider,
                  null,
                  React.createElement(VideoPlayer, {
                    embedded: false,
                    streamUrl: '',
                    title: 'Canal de Teste',
                    contentType: 'live',
                    onBack: () => {
                      backCalled += 1;
                    },
                  })
                )
              )
            )
          );
        });
        await flush();

        let handled = false;
        act(() => {
          handled = executeBackAction();
        });
        await flush();

        assert.strictEqual(handled, true, 'Handler FULLSCREEN_PLAYER deve continuar consumindo Back normalmente no modo Lite');
        assert.strictEqual(backCalled, 1, 'Callback onBack do VideoPlayer deve ser executado normalmente no modo Lite');
      } finally {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      }
    }
  );

  // 16. Sem duplicação de assinaturas em múltiplas inicializações/montagens/remontagens e sem polling
  await runCase(
    '16. Sem duplicação de assinaturas globais após múltiplas inicializações e remontagens, e sem polling',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      setNavMode('remote');

      // Chamar initPerformanceProfile repetidas vezes
      initPerformanceProfile();
      initPerformanceProfile();
      initPerformanceProfile();

      // Montar e desmontar ConfigView várias vezes
      for (let i = 0; i < 3; i++) {
        const mounted = await mountConfigView();
        assert.strictEqual(
          getPerformanceProfileSubscriptionCountsForTest().listeners,
          1,
          'Cada montagem ativa de ConfigView deve manter exatamente 1 listener'
        );
        await mounted.unmount();
      }

      const counts = getPerformanceProfileSubscriptionCountsForTest();
      assert.strictEqual(counts.display, 1, 'Deve existir no máximo 1 assinatura global de display preferences');
      assert.strictEqual(counts.navMode, 1, 'Deve existir no máximo 1 assinatura global de navMode');
      assert.strictEqual(counts.listeners, 0, 'Todos os listeners de componentes desmontados devem ser removidos');

      // Garante ausência de polling (setInterval) ou listeners de tecla/ponteiro próprios em performanceProfile.ts
      const profileSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/platform/performanceProfile.ts'),
        'utf8'
      );
      assert.ok(!profileSource.includes('setInterval'), 'performanceProfile.ts não deve usar polling com setInterval');
      assert.ok(
        !profileSource.includes('addEventListener'),
        'performanceProfile.ts não deve registrar novos listeners de teclado/ponteiro no window/document'
      );
    }
  );

  clearTimeout(watchdog);
  console.log(`\nSucesso: ${passed} blocos de cenários passaram em test-performance-profile.`);
  process.exit(0);
}

runTests().catch((err) => {
  clearTimeout(watchdog);
  console.error('FALHA em test-performance-profile:', err);
  process.exit(1);
});
