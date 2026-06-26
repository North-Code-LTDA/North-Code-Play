export let lastFocusedItemId: string | null = null;

export function initTvNavigation() {
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement as HTMLElement;
    if (!active) return;

    // 1. ARMADILHA DA PESQUISA
    if (active.tagName === 'INPUT') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const firstContent = document.querySelector('.hero-btn, .horizontal-row-container .tv-focus, .grid-container .tv-focus') as HTMLElement;
        if (firstContent) firstContent.focus();
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
        // Tenta restaurar a memória após a tela remontar
        setTimeout(() => {
          if (lastFocusedItemId) {
            const toFocus = document.querySelector(`[data-tv-id="${lastFocusedItemId}"]`) as HTMLElement;
            if (toFocus) {
              toFocus.focus();
              toFocus.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return;
            }
          }
        }, 300);
      } else {
        // Vai para a Sidebar apenas se já estiver na página inicial/raiz
        const sidebar = document.querySelector('[data-tv-zone="sidebar"] .tv-focus') as HTMLElement;
        if (sidebar) sidebar.focus();
      }
      return;
    }

    // 4. MOTOR ESTRUTURAL
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const isSidebar = active.closest('[data-tv-zone="sidebar"]');
      const row = active.closest('.horizontal-row-container');
      const isHero = active.classList.contains('hero-btn') || active.classList.contains('info-btn');
      
      // --- ZONA: SIDEBAR (Início, Filmes, etc) ---
      if (isSidebar) {
        e.preventDefault();
        if (e.key === 'ArrowRight') {
          // Sai da Sidebar para o Banner ou Primeira Linha
          const heroBtn = document.querySelector('.hero-btn') as HTMLElement;
          const firstRow = document.querySelector('.horizontal-row-container .tv-focus, .grid-container .tv-focus') as HTMLElement;
          if (heroBtn) {
             heroBtn.focus();
             window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (firstRow) {
             firstRow.focus();
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const items = Array.from(document.querySelectorAll('[data-tv-zone="sidebar"] .tv-focus')) as HTMLElement[];
          const idx = items.indexOf(active);
          if (e.key === 'ArrowDown' && idx < items.length - 1) items[idx + 1].focus();
          if (e.key === 'ArrowUp' && idx > 0) items[idx - 1].focus();
        }
        return;
      }

      // --- ZONA: MAIN CONTENT ---
      e.preventDefault();
      
      // HERO BANNER
      if (isHero) {
        if (e.key === 'ArrowLeft') {
          if (active.classList.contains('info-btn')) {
            (document.querySelector('.hero-btn') as HTMLElement)?.focus();
          } else {
            (document.querySelector('[data-tv-zone="sidebar"] .tv-focus') as HTMLElement)?.focus();
          }
        } else if (e.key === 'ArrowRight') {
          // Garante que o Assistir vá para o Mais Info
          if (active.classList.contains('hero-btn')) {
            (document.querySelector('.info-btn') as HTMLElement)?.focus();
          }
        } else if (e.key === 'ArrowDown') {
          const firstRowItem = document.querySelector('.horizontal-row-container .tv-focus') as HTMLElement;
          if (firstRowItem) {
            firstRowItem.focus();
            // Scrolla para o centro ignorando o topo
            firstRowItem.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          }
        } else if (e.key === 'ArrowUp') {
          // Só vai pra pesquisa se o usuário quiser MUITO subir mais
          const searchInput = document.querySelector('input[type="text"]') as HTMLElement;
          if (searchInput) {
             searchInput.focus();
             window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
        return;
      }

      // PRATELEIRAS HORIZONTAIS
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
            if (rowIdx > 0) {
              targetRow = allRows[rowIdx - 1];
            } else {
              // NOVIDADE: Chegou na primeira prateleira e apertou pra cima. Vai pro banner e rola TUDO pro topo!
              const heroBtn = document.querySelector('.hero-btn') as HTMLElement;
              if (heroBtn) {
                heroBtn.focus();
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
              }
              return;
            }
          } else if (e.key === 'ArrowDown') {
            if (rowIdx < allRows.length - 1) targetRow = allRows[rowIdx + 1];
          }

          if (targetRow) {
            // Acha o filme na prateleira alvo que está mais próximo visualmente (Eixo X)
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

      // GRIDS E COMPONENTES GENÉRICOS (Fallback Geométrico Aperfeiçoado)
      const rect = active.getBoundingClientRect();
      const allFocusable = Array.from(document.querySelectorAll('.tv-focus')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el !== active;
      }) as HTMLElement[];

      let bestMatch: HTMLElement | null = null;
      let minDistance = Infinity;

      allFocusable.forEach(candidate => {
        const cRect = candidate.getBoundingClientRect();
        const candidateZone = candidate.getAttribute('data-tv-zone') || candidate.closest('[data-tv-zone]')?.getAttribute('data-tv-zone');
        const currentZone = active.getAttribute('data-tv-zone') || active.closest('[data-tv-zone]')?.getAttribute('data-tv-zone');
        
        // Regras de Bloqueio
        if (currentZone === 'main' && candidateZone === 'sidebar' && e.key !== 'ArrowLeft') return; 
        if (candidate.tagName === 'INPUT' && e.key !== 'ArrowUp') return; 

        // Centro dos elementos
        const cx1 = rect.left + rect.width / 2;
        const cy1 = rect.top + rect.height / 2;
        const cx2 = cRect.left + cRect.width / 2;
        const cy2 = cRect.top + cRect.height / 2;
        
        const dx = Math.abs(cx1 - cx2);
        const dy = Math.abs(cy1 - cy2);

        let isValid = false;
        let distance = 0;

        if (e.key === 'ArrowRight') { isValid = cx2 >= cx1; distance = dx + dy * 5; }
        else if (e.key === 'ArrowLeft') { isValid = cx2 <= cx1; distance = dx + dy * 5; }
        else if (e.key === 'ArrowDown') { isValid = cy2 >= cy1; distance = dy + dx * 5; }
        else if (e.key === 'ArrowUp') { isValid = cy2 <= cy1; distance = dy + dx * 5; }

        if (isValid && distance < minDistance) {
          minDistance = distance;
          bestMatch = candidate;
        }
      });

      if (bestMatch) {
        (bestMatch as HTMLElement).focus();
        (bestMatch as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }

    }
  });
}
