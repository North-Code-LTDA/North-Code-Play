export let lastFocusedItemId: string | null = null;
let lastUpPressTime = 0; // Timer para a barra de pesquisa

export function initTvNavigation() {
  // Evita duplicar o listener
  if ((window as any).__tvNavInitialized) return;
  (window as any).__tvNavInitialized = true;

  window.addEventListener('keydown', (e) => {
    const active = document.activeElement as HTMLElement;
    if (!active) return;

    // 1. ARMADILHA DA PESQUISA
    if (active.tagName === 'INPUT') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const heroBtn = document.querySelector('.hero-btn') as HTMLElement;
        const firstRow = document.querySelector('.horizontal-row-container .tv-focus') as HTMLElement;
        if (heroBtn) heroBtn.focus();
        else if (firstRow) firstRow.focus();
      }
      if (e.key !== 'Enter' && e.key !== 'Escape') return; 
    }

    // 2. MEMÓRIA E CLIQUE
    if (e.key === 'Enter') {
      if (active.hasAttribute('data-tv-id')) lastFocusedItemId = active.getAttribute('data-tv-id');
      active.click();
      return;
    }

    // 3. BOTÃO VOLTAR
    if (e.key === 'Backspace' || e.key === 'Escape') {
      e.preventDefault();
      const backBtn = document.querySelector('.btn-close, button[aria-label="Voltar"], .lucide-arrow-left') as HTMLElement;
      const actualBtn = backBtn?.closest('button') || backBtn;

      if (actualBtn) {
        actualBtn.click();
        setTimeout(() => {
          if (lastFocusedItemId) {
            const toFocus = document.querySelector(`[data-tv-id="${lastFocusedItemId}"]`) as HTMLElement;
            if (toFocus) {
              toFocus.focus();
              toFocus.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }, 300);
      } else {
        const sidebar = document.querySelector('[data-tv-zone="sidebar"] .tv-focus') as HTMLElement;
        if (sidebar) sidebar.focus();
      }
      return;
    }

    // 4. MOTOR DE ZONAS (O Segredo da Navegação)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const isSidebar = active.closest('[data-tv-zone="sidebar"]');
      const isHero = active.classList.contains('hero-btn') || active.classList.contains('info-btn');
      const row = active.closest('.horizontal-row-container');

      // --- ZONA 1: SIDEBAR ---
      if (isSidebar) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') {
          return; // TRAVA MÁXIMA: Não faz nada se apertar pra esquerda na Sidebar
        } else if (e.key === 'ArrowRight') {
          const heroBtn = document.querySelector('.hero-btn') as HTMLElement;
          const firstRow = document.querySelector('.horizontal-row-container .tv-focus') as HTMLElement;
          if (heroBtn) heroBtn.focus();
          else if (firstRow) firstRow.focus();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const items = Array.from(document.querySelectorAll('[data-tv-zone="sidebar"] .tv-focus')) as HTMLElement[];
          const idx = items.indexOf(active);
          if (e.key === 'ArrowDown' && idx < items.length - 1) items[idx + 1].focus();
          if (e.key === 'ArrowUp' && idx > 0) items[idx - 1].focus();
        }
        return;
      }

      e.preventDefault(); // Impede o scroll padrão da web em outras zonas

      // --- ZONA 2: HERO BANNER ---
      if (isHero) {
        if (e.key === 'ArrowLeft') {
          if (active.classList.contains('info-btn')) {
            (document.querySelector('.hero-btn') as HTMLElement)?.focus();
          } else {
            (document.querySelector('[data-tv-zone="sidebar"] .tv-focus') as HTMLElement)?.focus();
          }
        } else if (e.key === 'ArrowRight') {
          if (active.classList.contains('hero-btn')) {
            (document.querySelector('.info-btn') as HTMLElement)?.focus();
          }
        } else if (e.key === 'ArrowDown') {
          const firstRowItem = document.querySelector('.horizontal-row-container .tv-focus') as HTMLElement;
          if (firstRowItem) {
            firstRowItem.focus();
            firstRowItem.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          }
        } else if (e.key === 'ArrowUp') {
          // RESISTÊNCIA DA PESQUISA (Duplo Clique)
          const now = Date.now();
          if (now - lastUpPressTime < 500) {
            const searchInput = document.querySelector('input[type="text"]') as HTMLElement;
            if (searchInput) searchInput.focus();
          } else {
            lastUpPressTime = now;
            window.scrollTo({ top: 0, behavior: 'smooth' }); // Força subir se a página escondeu o banner
          }
        }
        // Garante que o banner sempre apareça por completo quando tiver foco
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
        return;
      }

      // --- ZONA 3: PRATELEIRAS ---
      if (row) {
        if (e.key === 'ArrowLeft') {
          const items = Array.from(row.querySelectorAll('.tv-focus')) as HTMLElement[];
          const idx = items.indexOf(active);
          if (idx > 0) {
            items[idx - 1].focus();
            items[idx - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          } else {
            (document.querySelector('[data-tv-zone="sidebar"] .tv-focus') as HTMLElement)?.focus();
          }
        } else if (e.key === 'ArrowRight') {
          const items = Array.from(row.querySelectorAll('.tv-focus')) as HTMLElement[];
          const idx = items.indexOf(active);
          if (idx < items.length - 1) {
            items[idx + 1].focus();
            items[idx + 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const allRows = Array.from(document.querySelectorAll('.horizontal-row-container'));
          const rowIdx = allRows.indexOf(row as HTMLElement);
          
          let targetRow = null;
          if (e.key === 'ArrowUp') {
            if (rowIdx > 0) targetRow = allRows[rowIdx - 1];
            else {
              const heroBtn = document.querySelector('.hero-btn') as HTMLElement;
              if (heroBtn) {
                heroBtn.focus();
                window.scrollTo({ top: 0, behavior: 'smooth' }); // Sobe a página pro Banner!
              }
              return;
            }
          } else if (e.key === 'ArrowDown') {
            if (rowIdx < allRows.length - 1) targetRow = allRows[rowIdx + 1];
          }

          if (targetRow) {
            const activeRect = active.getBoundingClientRect();
            const targetItems = Array.from(targetRow.querySelectorAll('.tv-focus')) as HTMLElement[];
            let closest = targetItems[0];
            let minDist = Infinity;
            
            targetItems.forEach(item => {
              const r = item.getBoundingClientRect();
              const dist = Math.abs((r.left + r.width/2) - (activeRect.left + activeRect.width/2));
              if (dist < minDist) { minDist = dist; closest = item; }
            });
            
            if (closest) {
              closest.focus();
              closest.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
          }
        }
        return;
      }
    }
  });
}
