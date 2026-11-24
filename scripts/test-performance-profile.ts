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
const { HorizontalRow, parseElementScaleFactor } = await import('../src/components/HorizontalRow');
const { VideoPlayer } = await import('../src/components/VideoPlayer');
const { HeroBanner } = await import('../src/components/HeroBanner');
const { DetailsModalShell } = await import('../src/components/DetailsModalShell');
const { TopHeader } = await import('../src/components/TopHeader');
const { FavoritesView } = await import('../src/views/FavoritesView');
const { getFavoritesKey, setStoredFavorites } = await import('../src/utils/accountUtils');
const { notifyAccountSubscribers } = await import('../src/hooks/useFavorites');
const { getHeroBannerItems } = await import('../src/utils/catalogIndex');

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

  // 17. Fases 4 e 5: Regras CSS cirúrgicas cobrem itens selecionados e preservam spinners, player e contrastes essenciais
  await runCase(
    '17. Fases 4 e 5: Regras CSS cirúrgicas cobrem Live TV, Catálogos, Favoritos, Header, Detalhes, Config, Calibração e Login restritas a Lite + remote sem afetar spinners ou player',
    async () => {
      const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
      const phase4Index = cssContent.indexOf('Phase 4/5: Surgical Cosmetic Animation Deactivation');
      const phase5Index = cssContent.indexOf('Phase 5/5: Final Visual Optimization in Lite Mode');
      assert.ok(phase4Index !== -1, 'Bloco CSS da Fase 4 deve existir em src/index.css');
      assert.ok(phase5Index !== -1, 'Bloco CSS da Fase 5 deve existir em src/index.css');
      const phase4CommentStart = cssContent.lastIndexOf('/*', phase4Index);
      const phase4And5Block = cssContent.slice(phase4CommentStart !== -1 ? phase4CommentStart : phase4Index);
      const phase4And5RulesOnly = phase4And5Block.replace(/\/\*[\s\S]*?\*\//g, '');

      const phase5CommentStart = cssContent.lastIndexOf('/*', phase5Index);
      const phase5RulesOnly = cssContent
        .slice(phase5CommentStart !== -1 ? phase5CommentStart : phase5Index)
        .replace(/\/\*[\s\S]*?\*\//g, '');

      // Todos os seletores das Fases 4 e 5 devem exigir Lite + remote simultaneamente
      const selectorLines = phase4And5RulesOnly
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('html['));
      assert.ok(selectorLines.length >= 40, 'Deve conter regras cirúrgicas das Fases 4 e 5');
      for (const line of selectorLines) {
        assert.ok(
          line.startsWith('html[data-performance-mode="lite"][data-nav-mode="remote"] '),
          `Regra Fases 4/5 deve exigir Lite + remote: ${line}`
        );
      }

      // Live TV (TV-01..TV-06)
      assert.ok(phase4And5RulesOnly.includes('.nc-tv-channel-fav'), 'Deve cobrir TV-01 (.nc-tv-channel-fav)');
      assert.ok(phase4And5RulesOnly.includes('[data-row-scroll-prev="true"]'), 'Deve cobrir TV-02 e setas de carrossel');
      assert.ok(phase4And5RulesOnly.includes('[data-row-scroll-prev="true"] svg'), 'Deve cobrir TV-03 (drop-shadow das setas)');
      assert.ok(phase4And5RulesOnly.includes('[data-live-variants-row="true"] button'), 'Deve cobrir TV-04 (SD/HD/FHD)');
      assert.ok(phase4And5RulesOnly.includes('[data-live-badge="true"] .animate-pulse'), 'Deve cobrir TV-05 (ponto AO VIVO)');

      // Fase 4: Catálogos (CAT-09, CAT-10), Favoritos, Header, Detalhes, Config/Calibração e Login
      assert.ok(phase4And5RulesOnly.includes('.nc-card-title'), 'Deve cobrir CAT-09 (.nc-card-title)');
      assert.ok(phase4And5RulesOnly.includes('.nc-card-play-overlay'), 'Deve cobrir CAT-10 (.nc-card-play-overlay)');
      assert.ok(phase4And5RulesOnly.includes('.nc-card-play-badge'), 'Deve cobrir CAT-10 (.nc-card-play-badge)');
      assert.ok(phase4And5RulesOnly.includes('.nc-fav-card-img'), 'Deve cobrir escala de imagem nos Favoritos');
      assert.ok(phase4And5RulesOnly.includes('.nc-top-header-account-btn svg'), 'Deve cobrir chevron do menu de conta');
      assert.ok(phase4And5RulesOnly.includes('[data-categories-trigger="true"] svg'), 'Deve cobrir chevron de categorias');
      assert.ok(phase4And5RulesOnly.includes('.nc-tv-season-btn svg'), 'Deve cobrir chevron de temporadas');
      assert.ok(phase4And5RulesOnly.includes('.nc-tv-episode-card'), 'Deve cobrir cards de episódio');
      assert.ok(phase4And5RulesOnly.includes('.nc-lite-instant-modal'), 'Deve cobrir modais de confirmação/erro');
      assert.ok(phase4And5RulesOnly.includes('[data-device-choices="true"] [data-device-choice]'), 'Deve cobrir escolhas de dispositivo');

      // Fase 5: simplificação seletiva de degradês/sombras, calibração sem interpolação e foco branco sem blur 20px
      assert.ok(phase5RulesOnly.includes('[data-hero-scrim-secondary="true"]'), 'Fase 5 deve ocultar apenas o scrim secundário redundante do Hero');
      assert.ok(phase5RulesOnly.includes('[data-hero-scrim-primary="true"]'), 'Fase 5 deve preservar e reforçar o scrim primário de contraste do Hero');
      assert.ok(phase5RulesOnly.includes('[data-details-scrim-secondary="true"]'), 'Fase 5 deve consolidar degradês redundantes nos detalhes');
      assert.ok(phase5RulesOnly.includes('[data-details-scrim-primary="true"]'), 'Fase 5 deve preservar scrim primário de leitura nos detalhes');
      assert.ok(phase5RulesOnly.includes('[data-sample-icon="true"]'), 'Fase 5 deve remover interpolação em data-sample-icon no Lite');
      assert.ok(phase5RulesOnly.includes('[data-sample-text="true"]'), 'Fase 5 deve remover interpolação em data-sample-text no Lite');
      assert.ok(phase5RulesOnly.includes('[data-sample-subtext="true"]'), 'Fase 5 deve remover interpolação em data-sample-subtext no Lite');
      assert.ok(phase5RulesOnly.includes('[data-calibration-slider-fill="true"]'), 'Fase 5 deve remover interpolação do preenchimento do slider no Lite');
      assert.ok(phase5RulesOnly.includes('outline: 2px solid #ffffff !important;'), 'Fase 5 deve preservar contorno branco visível de foco');

      // Exclusões obrigatórias preservadas (TV-07 spinners, player, degradês de pôster)
      assert.ok(!phase4And5RulesOnly.includes('animate-spin'), 'TV-07: não deve desativar spinners funcionais (.animate-spin)');
      assert.ok(!phase4And5RulesOnly.includes('.nc-player-ctrl-btn'), 'Não deve alterar botões do player');
      assert.ok(!phase4And5RulesOnly.includes('bg-gradient-to-'), 'Não deve desativar degradês de contraste de pôsteres indiscriminadamente');

      // Verifica condicionamento cirúrgico de HorizontalRow, HeroBanner e Login
      const horizontalRowSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/HorizontalRow.tsx'),
        'utf8'
      );
      assert.ok(
        horizontalRowSrc.includes('whileTap={isLiteActive ? undefined : { scale: 0.97 }}'),
        'HorizontalRow deve desativar whileTap apenas no Lite e preservar { scale: 0.97 } no Completo'
      );
      const heroBannerSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/HeroBanner.tsx'),
        'utf8'
      );
      assert.ok(
        heroBannerSrc.includes('8000') && heroBannerSrc.includes('isAutoRotationSuspended'),
        'HeroBanner deve suspender auto-rotação de 8000ms apenas no Lite e preservá-la no Completo'
      );
      const loginSrc = fs.readFileSync(
        path.resolve(process.cwd(), 'src/pages/Login.tsx'),
        'utf8'
      );
      assert.ok(
        loginSrc.includes('data-login-lite-motion={isLiteActive ? \'true\' : \'false\'}') &&
          loginSrc.includes('data-avatar-picker-lite-motion={isLiteActive ? \'true\' : \'false\'}'),
        'Login deve condicionar animações Motion exclusivamente ao isLiteActive'
      );
    }
  );

  // 18. Fases 4 e 5: Motion em HeroBanner/DetailsModalShell/ConfigView e suspensão da auto-rotação do HeroBanner só no Lite efetivo
  await runCase(
    '18. Fases 4 e 5: HeroBanner suspende auto-rotação (sem setInterval) só no Lite preservando índice, DetailsModalShell e ConfigView desativam Motion só no Lite e alternam Lite <-> Completo',
    async () => {
      const heroItems = [
        {
          stream_id: 101,
          name: 'Filme Destaque A',
          stream_icon: 'https://cdn.example.com/poster-a.jpg',
          cover: 'https://cdn.example.com/poster-a.jpg',
          rating: '8.7',
          plot: 'Sinopse A',
        },
        {
          stream_id: 102,
          name: 'Filme Destaque B',
          stream_icon: 'https://cdn.example.com/poster-b.jpg',
          cover: 'https://cdn.example.com/poster-b.jpg',
          rating: '9.1',
          plot: 'Sinopse B',
        },
      ];

      let heroPlayCalls = 0;
      let heroInfoCalls = 0;
      let modalCloseCalls = 0;
      let capturedHeroTick: (() => void) | null = null;
      const activeHeroIntervals = new Set<any>();
      const origSetInterval = globalThis.setInterval;
      const origWindowSetInterval = window.setInterval;
      const origClearInterval = globalThis.clearInterval;
      const origWindowClearInterval = window.clearInterval;
      const interceptSetInterval = ((fn: TimerHandler, delay?: number, ...args: any[]) => {
        const handle = origSetInterval(fn as any, delay, ...args);
        if (delay === 8000 && typeof fn === 'function') {
          capturedHeroTick = fn as () => void;
          activeHeroIntervals.add(handle);
        }
        return handle;
      }) as typeof setInterval;
      const interceptClearInterval = ((handle: any) => {
        activeHeroIntervals.delete(handle);
        return origClearInterval(handle);
      }) as typeof clearInterval;
      (globalThis as any).setInterval = interceptSetInterval;
      (window as any).setInterval = interceptSetInterval;
      (globalThis as any).clearInterval = interceptClearInterval;
      (window as any).clearInterval = interceptClearInterval;

      const host = document.createElement('div');
      document.body.appendChild(host);
      const root: Root = createRoot(host);

      const renderShowcaseAndModal = async () => {
        await act(async () => {
          root.render(
            React.createElement(
              XtreamProvider,
              { credentials: null },
              React.createElement(
                NavigationProvider,
                null,
                React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(HeroBanner, {
                    items: heroItems,
                    onPlay: () => {
                      heroPlayCalls += 1;
                    },
                    onInfo: () => {
                      heroInfoCalls += 1;
                    },
                    isPaused: false,
                    domain: 'movies',
                  }),
                  React.createElement(
                    DetailsModalShell,
                    {
                      titleId: 'test-details-title',
                      modalType: 'movie',
                      onClose: () => {
                        modalCloseCalls += 1;
                      },
                    },
                    React.createElement('h1', { id: 'test-details-title' }, 'Filme Teste')
                  ),
                  React.createElement(ConfigView)
                )
              )
            )
          );
        });
        await flush();
      };

      try {
        // Cenário A: Web + TV + remote -> Full (animações e auto-rotação de 8000ms preservadas)
        setAndroidPlatformOverrideForDpadTest(false);
        confirmDisplayPreferences('tv', 85);
        setNavMode('remote');
        initPerformanceProfile();
        await renderShowcaseAndModal();

        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-lite-motion'),
          'false',
          'Web deve preservar animações Motion do HeroBanner'
        );
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-autorotate'),
          'active',
          'Web deve manter auto-rotação do HeroBanner ativa'
        );
        assert.strictEqual(
          activeHeroIntervals.size,
          1,
          'Web deve registrar exatamente 1 setInterval(8000) do HeroBanner'
        );
        assert.strictEqual(
          host.querySelector('[data-details-modal="movie"]')?.getAttribute('data-details-lite-motion'),
          'false',
          'Web deve preservar animações Motion do DetailsModalShell'
        );
        assert.strictEqual(
          host.querySelector('[data-config-lite-motion]')?.getAttribute('data-config-lite-motion'),
          'false',
          'Web deve preservar animações Motion do ConfigView'
        );

        // Avança 1 slide no modo Completo para testar preservação de índice ao entrar no Lite
        const firstSlideTitle = host.querySelector('.nc-tv-hero-title')?.textContent?.trim() || '';
        assert.ok(
          firstSlideTitle === 'Filme Destaque A' || firstSlideTitle === 'Filme Destaque B',
          `Título inicial do HeroBanner inválido: "${firstSlideTitle}"`
        );
        assert.ok(capturedHeroTick, 'HeroBanner deve agendar auto-rotação no modo Completo');
        act(() => {
          capturedHeroTick!();
        });
        await flush();
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
          '1',
          'HeroBanner deve avançar para o slide 1 no modo Completo'
        );

        // Cenário B: Android + celular/tablet (default) + remote -> Full (animações e auto-rotação preservadas)
        act(() => {
          setAndroidPlatformOverrideForDpadTest(true);
          confirmDisplayPreferences('default', 85);
          setNavMode('remote');
          resetPerformanceProfileCacheForTest();
          initPerformanceProfile();
        });
        await renderShowcaseAndModal();

        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-lite-motion'),
          'false',
          'Android celular/tablet (default) deve preservar animações Motion'
        );
        assert.strictEqual(
          activeHeroIntervals.size,
          1,
          'Android celular/tablet (default) deve preservar auto-rotação do HeroBanner'
        );

        // Cenário C: Android + TV + pointer -> Full (animações e auto-rotação preservadas)
        act(() => {
          confirmDisplayPreferences('tv', 85);
          setNavMode('pointer');
        });
        await flush();
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-lite-motion'),
          'false',
          'Android TV em pointer deve preservar animações Motion'
        );
        assert.strictEqual(
          activeHeroIntervals.size,
          1,
          'Android TV em pointer deve preservar auto-rotação do HeroBanner'
        );

        // Cenário D: Android + TV + remote + auto -> Lite ativo (desativa Motion e suspende setInterval preservando índice 1)
        act(() => {
          setNavMode('remote');
        });
        await flush();

        assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-lite-motion'),
          'true',
          'HeroBanner deve ativar modo Motion instantâneo no Lite efetivo'
        );
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-autorotate'),
          'paused-lite',
          'HeroBanner deve sinalizar suspensão de auto-rotação no Lite efetivo'
        );
        assert.strictEqual(
          activeHeroIntervals.size,
          0,
          'HeroBanner não deve manter setInterval(8000) ativo no Lite efetivo'
        );
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
          '1',
          'Entrar no Lite não deve reiniciar o índice atual do HeroBanner'
        );
        assert.ok(
          host.querySelector('[data-hero-scrim-primary="true"]'),
          'HeroBanner deve preservar scrim primário de contraste no Lite'
        );
        assert.strictEqual(
          host.querySelector('[data-details-modal="movie"]')?.getAttribute('data-details-lite-motion'),
          'true',
          'DetailsModalShell deve ativar modo Motion instantâneo no Lite efetivo'
        );
        assert.strictEqual(
          host.querySelector('[data-config-lite-motion]')?.getAttribute('data-config-lite-motion'),
          'true',
          'ConfigView deve ativar modo Motion instantâneo no Lite efetivo'
        );

        // Testa ações do HeroBanner e abertura/fechamento do DetailsModalShell no Lite
        const playBtn = host.querySelector<HTMLButtonElement>('[data-hero-action="play"]')!;
        const infoBtn = host.querySelector<HTMLButtonElement>('[data-hero-action="info"]')!;
        const closeBtn = host.querySelector<HTMLButtonElement>('[data-details-close="true"]')!;
        act(() => {
          playBtn.click();
          infoBtn.click();
          closeBtn.click();
        });
        assert.strictEqual(heroPlayCalls, 1, 'Botão Assistir do HeroBanner deve funcionar no Lite');
        assert.strictEqual(heroInfoCalls, 1, 'Botão Mais informações do HeroBanner deve funcionar no Lite');
        assert.strictEqual(modalCloseCalls, 1, 'Botão fechar do DetailsModalShell deve funcionar no Lite');

        // Alterna Lite -> Completo -> restaura auto-rotação sem reiniciar índice 1 e avança normalmente
        capturedHeroTick = null;
        act(() => {
          setPerformanceProfilePreference('full');
        });
        await flush();
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-lite-motion'),
          'false'
        );
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-autorotate'),
          'active'
        );
        assert.strictEqual(
          activeHeroIntervals.size,
          1,
          'Voltar ao modo Completo deve restaurar o setInterval(8000) do HeroBanner'
        );
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
          '1',
          'Voltar ao modo Completo não deve reiniciar o índice atual antes do próximo tick'
        );
        act(() => {
          capturedHeroTick!();
        });
        await flush();
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-index'),
          '0',
          'Auto-rotação restaurada no modo Completo deve avançar normalmente'
        );
        assert.strictEqual(
          host.querySelector('[data-details-modal="movie"]')?.getAttribute('data-details-lite-motion'),
          'false'
        );
        assert.strictEqual(
          host.querySelector('[data-config-lite-motion]')?.getAttribute('data-config-lite-motion'),
          'false'
        );

        act(() => {
          setPerformanceProfilePreference('lite');
        });
        await flush();
        assert.strictEqual(
          host.querySelector('[data-hero-stage="true"]')?.getAttribute('data-hero-lite-motion'),
          'true'
        );
        assert.strictEqual(
          activeHeroIntervals.size,
          0,
          'Reativar Lite deve cancelar o setInterval(8000) do HeroBanner novamente'
        );

        // Verifica que há exatamente 3 listeners (1 HeroBanner + 1 DetailsModalShell + 1 ConfigView)
        assert.strictEqual(
          getPerformanceProfileSubscriptionCountsForTest().listeners,
          3,
          'Apenas componentes de topo devem assinar performanceProfile (sem assinaturas duplicadas)'
        );
      } finally {
        (globalThis as any).setInterval = origSetInterval;
        (window as any).setInterval = origWindowSetInterval;
        (globalThis as any).clearInterval = origClearInterval;
        (window as any).clearInterval = origWindowClearInterval;
        await act(async () => {
          root.unmount();
        });
        host.remove();
      }

      assert.strictEqual(
        getPerformanceProfileSubscriptionCountsForTest().listeners,
        0,
        'Todos os listeners devem ser limpos após desmontagem'
      );
    }
  );

  // 19. Fase 4: Header/menus, Favoritos, Calibração e zero assinaturas em cards individuais funcionam no Lite
  await runCase(
    '19. Fase 4: Menus do TopHeader (com orientação final do chevron), Favoritos e Calibração funcionam normalmente no Lite sem assinaturas em cards',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      // 19a. TopHeader: abre/fecha menu de conta preservando orientação rotate-180 no chevron
      const headerHost = document.createElement('div');
      document.body.appendChild(headerHost);
      const headerRoot: Root = createRoot(headerHost);
      let isAccountOpen = false;
      const renderHeader = async () => {
        await act(async () => {
          headerRoot.render(
            React.createElement(
              NavigationProvider,
              null,
              React.createElement(TopHeader, {
                currentView: 'inicio',
                onSelectSection: () => {},
                onSelectAccountAction: () => {},
                searchQuery: '',
                onSearchQueryChange: () => {},
                isSearchOpen: false,
                onOpenSearch: () => {},
                onCloseSearch: () => {},
                isAccountMenuOpen: isAccountOpen,
                onToggleAccountMenu: () => {
                  isAccountOpen = !isAccountOpen;
                },
                onCloseAccountMenu: () => {
                  isAccountOpen = false;
                },
                username: 'Teste',
              })
            )
          );
        });
        await flush();
      };

      try {
        await renderHeader();
        const trigger = headerHost.querySelector<HTMLButtonElement>('[data-header-account-trigger="true"]')!;
        assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
        assert.ok(
          !trigger.querySelector('svg')?.getAttribute('class')?.includes('rotate-180'),
          'Chevron fechado não deve estar rotacionado'
        );

        act(() => {
          trigger.click();
        });
        await renderHeader();

        assert.strictEqual(trigger.getAttribute('aria-expanded'), 'true');
        assert.ok(
          headerHost.querySelector('[data-header-account-menu="true"]'),
          'Menu de conta deve abrir normalmente no Lite'
        );
        assert.ok(
          trigger.querySelector('svg')?.getAttribute('class')?.includes('rotate-180'),
          'Chevron aberto deve preservar orientação final rotate-180 no Lite'
        );
      } finally {
        await act(async () => {
          headerRoot.unmount();
        });
        headerHost.remove();
      }

      // 19b. Favoritos: renderiza e remove favorito normalmente no Lite (zero assinaturas por card)
      const favCreds = {
        playlistName: 'Lista Teste',
        serverUrl: 'http://demo.local:8080',
        username: 'tester',
        password: 'secret',
      };
      const favStorageKey = getFavoritesKey(favCreds.serverUrl, favCreds.username);
      setStoredFavorites(favStorageKey, [
        { id: 'fav-1', type: 'movie', name: 'Filme Favorito 1', cover: '' },
        { id: 'fav-3', type: 'movie', name: 'Filme Favorito 2', cover: '' },
        { id: 'fav-2', type: 'live', name: 'Canal Favorito 1', cover: '' },
      ]);
      notifyAccountSubscribers(favStorageKey);
      const favHost = document.createElement('div');
      document.body.appendChild(favHost);
      const favRoot: Root = createRoot(favHost);
      try {
        await act(async () => {
          favRoot.render(
            React.createElement(
              XtreamProvider,
              { credentials: favCreds },
              React.createElement(
                NavigationProvider,
                null,
                React.createElement(FavoritesView, {
                  onPlay: () => {},
                })
              )
            )
          );
        });
        await flush();

        // 2 fileiras HorizontalRow (Canais + Filmes) com 3 cards = exatamente 2 listeners (1 por fileira, 0 por card individual)
        assert.strictEqual(
          getPerformanceProfileSubscriptionCountsForTest().listeners,
          2,
          'FavoritesView deve manter no máximo 1 assinatura por HorizontalRow e zero assinaturas por card individual'
        );
        const cardsBefore = favHost.querySelectorAll('[data-favorite-card="true"]').length;
        assert.strictEqual(cardsBefore, 3, 'Favoritos devem renderizar normalmente no Lite');

        const removeBtn = favHost.querySelector<HTMLButtonElement>('[data-favorite-remove="true"]')!;
        act(() => {
          removeBtn.click();
        });
        await flush();
        const cardsAfter = favHost.querySelectorAll('[data-favorite-card="true"]').length;
        assert.strictEqual(cardsAfter, 2, 'Remoção de favorito deve funcionar normalmente no Lite');
      } finally {
        await act(async () => {
          favRoot.unmount();
        });
        favHost.remove();
      }

      // 19c. ConfigView + DisplaySetupModal: abre calibração, escolhe 90% e confirma no Lite
      const cfgMounted = await mountConfigView();
      try {
        const calibrateBtn = Array.from(
          cfgMounted.host.querySelectorAll<HTMLButtonElement>('button')
        ).find((b) => b.textContent?.includes('Calibrar escala'));
        assert.ok(calibrateBtn, 'Botão Calibrar escala deve estar disponível em modo TV');
        act(() => {
          calibrateBtn.click();
        });
        await flush();

        const slider = cfgMounted.host.querySelector<HTMLElement>('[data-calibration-slider="true"]');
        const confirmBtn = cfgMounted.host.querySelector<HTMLButtonElement>('[data-calibration-confirm="true"]');
        assert.ok(slider && confirmBtn, 'Modal de calibração deve abrir normalmente no Lite');

        act(() => {
          slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });
        await flush();
        act(() => {
          confirmBtn.click();
        });
        await flush();

        assert.strictEqual(
          getDisplayPreferencesSnapshot().tvScale,
          90,
          'Calibração de escala deve continuar salvando corretamente no Lite'
        );
      } finally {
        await cfgMounted.unmount();
      }
    }
  );

  // 20. Fase 5: HorizontalRow desativa whileTap apenas no Lite (1 assinatura por fileira), mantém escala estática ao segurar OK e preserva foco na alternância Lite <-> Completo
  await runCase(
    '20. Fase 5: HorizontalRow desativa whileTap só no Lite (1 assinatura por fileira), não altera escala ao segurar OK e preserva foco ao alternar Lite <-> Completo',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      const items = Array.from({ length: 24 }, (_, idx) => ({
        stream_id: 500 + idx,
        name: `Filme Catálogo ${idx + 1}`,
        stream_icon: `https://cdn.example.com/vod-${idx + 1}.jpg`,
        cover: `https://cdn.example.com/vod-${idx + 1}.jpg`,
        rating: '8.4',
      }));

      // Verifica que os títulos do Hero derivam estritamente do catálogo acessível nas fileiras
      const derivedHero = getHeroBannerItems(items, []);
      assert.ok(derivedHero.length > 0, 'HeroBanner deve derivar títulos do catálogo');
      const catalogIds = new Set(items.map((it) => it.stream_id));
      for (const h of derivedHero) {
        assert.ok(
          catalogIds.has(h.stream_id),
          'Todo título do HeroBanner deve continuar acessível nas fileiras do catálogo'
        );
      }

      let clickedItems: any[] = [];
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root: Root = createRoot(host);

      try {
        await act(async () => {
          root.render(
            React.createElement(
              XtreamProvider,
              { credentials: null },
              React.createElement(
                NavigationProvider,
                null,
                React.createElement(HorizontalRow, {
                  title: 'Filmes em Destaque',
                  items,
                  type: 'vod',
                  virtualize: true,
                  onItemClick: (it) => {
                    clickedItems.push(it);
                  },
                })
              )
            )
          );
        });
        await flush();

        // Exatamente 1 assinatura por fileira (nunca por card individual)
        assert.strictEqual(
          getPerformanceProfileSubscriptionCountsForTest().listeners,
          1,
          'HorizontalRow deve assinar performanceProfile uma única vez por fileira'
        );

        const cards = Array.from(host.querySelectorAll<HTMLElement>('[data-row-card-index]'));
        assert.ok(cards.length >= 4, 'HorizontalRow deve renderizar cards virtualizados no Lite');
        for (const c of cards) {
          assert.strictEqual(
            c.getAttribute('data-tap-scale'),
            'off',
            'Cards em HorizontalRow devem desativar whileTap no Lite efetivo'
          );
        }

        // Foca o primeiro card e simula manter OK/Enter pressionado em modo remote (D-pad) sem alterar escala
        const firstCard = cards[0];
        act(() => {
          firstCard.focus();
        });
        await flush();
        assert.strictEqual(document.activeElement, firstCard, 'Card deve receber foco D-pad no Lite');

        act(() => {
          firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await flush();

        assert.strictEqual(getNavMode(), 'remote', 'Tecla OK/Enter deve manter navMode em remote');
        assert.strictEqual(
          document.documentElement.getAttribute('data-performance-mode'),
          'lite',
          'Tecla OK/Enter deve manter Perfil Lite ativo'
        );
        assert.strictEqual(
          parseElementScaleFactor(firstCard),
          1,
          'Card não deve sofrer salto de escala ao manter OK/Enter pressionado no Lite'
        );
        assert.ok(
          !(firstCard.style.transform || '').includes('0.97'),
          'Card não deve aplicar scale(0.97) no Lite'
        );

        assert.strictEqual(
          clickedItems.length,
          1,
          'Tecla OK/Enter no card deve continuar acionando onItemClick no Lite'
        );

        // Seleção/clique continua operando normalmente
        act(() => {
          firstCard.click();
        });
        assert.strictEqual(clickedItems.length, 2, 'Clique/seleção do card deve continuar funcionando no Lite');

        // Alternar Lite -> Completo -> Lite preserva o mesmo elemento focado sem desmontar o card
        act(() => {
          setPerformanceProfilePreference('full');
        });
        await flush();
        assert.strictEqual(
          document.activeElement,
          firstCard,
          'Alternar de Lite para Completo não deve perder o foco atual do card'
        );
        assert.strictEqual(
          firstCard.getAttribute('data-tap-scale'),
          'on',
          'Modo Completo deve restaurar whileTap nos cards'
        );

        act(() => {
          setPerformanceProfilePreference('lite');
        });
        await flush();
        assert.strictEqual(
          document.activeElement,
          firstCard,
          'Alternar de Completo para Lite não deve perder o foco atual do card'
        );
        assert.strictEqual(
          firstCard.getAttribute('data-tap-scale'),
          'off',
          'Voltar para Lite em modo remote deve desativar whileTap novamente'
        );

        // Android mobile (default) restaura whileTap dinamicamente via mudança de apresentação
        act(() => {
          confirmDisplayPreferences('default', 85);
        });
        await flush();
        assert.strictEqual(
          host.querySelector('[data-row-card-index]')?.getAttribute('data-tap-scale'),
          'on',
          'Android mobile (default) deve preservar whileTap nos cards'
        );

        // Plataforma Web (sessão independente) preserva whileTap ativo mesmo em apresentação tv + remote
        await act(async () => {
          root.unmount();
        });
        const webRoot: Root = createRoot(host);
        try {
          setAndroidPlatformOverrideForDpadTest(false);
          confirmDisplayPreferences('tv', 85);
          setNavMode('remote');
          resetPerformanceProfileCacheForTest();
          initPerformanceProfile();

          await act(async () => {
            webRoot.render(
              React.createElement(
                XtreamProvider,
                { credentials: null },
                React.createElement(
                  NavigationProvider,
                  null,
                  React.createElement(HorizontalRow, {
                    title: 'Filmes em Destaque',
                    items,
                    type: 'vod',
                    virtualize: true,
                    onItemClick: () => {},
                  })
                )
              )
            );
          });
          await flush();
          assert.strictEqual(
            host.querySelector('[data-row-card-index]')?.getAttribute('data-tap-scale'),
            'on',
            'Web deve preservar whileTap nos cards'
          );
        } finally {
          await act(async () => {
            webRoot.unmount();
          });
        }
      } finally {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      }
    }
  );

  // 21. Fase 5: Calibração TV (50% a 125% em passos de 5%, D-pad Esquerda/Direita, presets, amostra e slider fill)
  await runCase(
    '21. Fase 5: Calibração de escala TV preserva 50%-125% em passos de 5%, D-pad, presets e atualização imediata da amostra e slider no Lite',
    async () => {
      setAndroidPlatformOverrideForDpadTest(true);
      confirmDisplayPreferences('tv', 85);
      syncDocumentDisplayAttributes();
      setNavMode('remote');
      initPerformanceProfile();
      assert.strictEqual(document.documentElement.getAttribute('data-performance-mode'), 'lite');

      const cfgMounted = await mountConfigView();
      try {
        const calibrateBtn = Array.from(
          cfgMounted.host.querySelectorAll<HTMLButtonElement>('button')
        ).find((b) => b.textContent?.includes('Calibrar escala'))!;
        assert.ok(calibrateBtn, 'Botão Calibrar escala deve existir');

        act(() => {
          calibrateBtn.click();
        });
        await flush();

        const slider = cfgMounted.host.querySelector<HTMLElement>('[data-calibration-slider="true"]')!;
        const sampleBox = cfgMounted.host.querySelector<HTMLElement>('[data-calibration-sample="true"]')!;
        const sampleIcon = cfgMounted.host.querySelector<HTMLElement>('[data-sample-icon="true"]')!;
        const sampleText = cfgMounted.host.querySelector<HTMLElement>('[data-sample-text="true"]')!;
        const sampleSubtext = cfgMounted.host.querySelector<HTMLElement>('[data-sample-subtext="true"]')!;
        const sliderFill = cfgMounted.host.querySelector<HTMLElement>('[data-calibration-slider-fill="true"]')!;

        assert.ok(
          slider && sampleBox && sampleIcon && sampleText && sampleSubtext && sliderFill,
          'Elementos da amostra e preenchimento do slider devem existir na calibração'
        );
        assert.strictEqual(slider.getAttribute('aria-valuemin'), '50');
        assert.strictEqual(slider.getAttribute('aria-valuemax'), '125');
        assert.strictEqual(slider.getAttribute('aria-valuenow'), '85');

        // D-pad ArrowLeft em passos de 5% até 50% (8 passos para testar clamp em 50%)
        for (let i = 0; i < 8; i++) {
          act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
          });
        }
        await flush();
        assert.strictEqual(slider.getAttribute('aria-valuenow'), '50', 'Escala deve limitar em 50%');
        assert.strictEqual(sampleBox.getAttribute('data-sample-scale'), '50');
        assert.strictEqual(sampleIcon.style.width, '22px', 'Ícone da amostra deve atualizar para 50% (22px)');
        assert.strictEqual(sampleText.style.fontSize, '9px', 'Texto da amostra deve atualizar para 50% (9px)');
        assert.strictEqual(sliderFill.style.width, '0%', 'Preenchimento do slider deve ir a 0% em 50%');

        // D-pad ArrowRight em passos de 5% até 125% (16 passos para testar clamp em 125%)
        for (let i = 0; i < 16; i++) {
          act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          });
        }
        await flush();
        assert.strictEqual(slider.getAttribute('aria-valuenow'), '125', 'Escala deve limitar em 125%');
        assert.strictEqual(sampleBox.getAttribute('data-sample-scale'), '125');
        assert.strictEqual(sampleIcon.style.width, '55px', 'Ícone da amostra deve atualizar para 125% (55px)');
        assert.strictEqual(sampleText.style.fontSize, '22.5px', 'Texto da amostra deve atualizar para 125% (22.5px)');
        assert.strictEqual(sliderFill.style.width, '100%', 'Preenchimento do slider deve ir a 100% em 125%');

        // Retorno via ArrowLeft até 90% + confirmação (sem presets redundantes)
        assert.strictEqual(
          cfgMounted.host.querySelector('[data-calibration-reset="true"]'),
          null,
          'Preset Sugerido (85%) não deve existir'
        );
        assert.strictEqual(
          cfgMounted.host.querySelector('[data-calibration-preset-90="true"]'),
          null,
          'Preset Escolher 90% não deve existir'
        );
        const confirmBtn = cfgMounted.host.querySelector<HTMLButtonElement>('[data-calibration-confirm="true"]')!;

        for (let i = 0; i < 7; i++) {
          act(() => {
            slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
          });
        }
        await flush();
        assert.strictEqual(slider.getAttribute('aria-valuenow'), '90', 'Slider deve ajustar para 90% via D-pad');

        act(() => {
          confirmBtn.click();
        });
        await flush();
        assert.strictEqual(getDisplayPreferencesSnapshot().tvScale, 90, 'Confirmar calibração deve persistir 90%');
      } finally {
        await cfgMounted.unmount();
      }
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
