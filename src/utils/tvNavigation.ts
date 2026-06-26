export let lastFocusedItemId: string | null = null;

export function initTvNavigation() {
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement as HTMLElement;

    // 1. ARMADILHA DO INPUT (Pesquisa)
    if (active.tagName === 'INPUT') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Foge do input para o conteúdo principal
        const mainFocus = document.querySelector('[data-tv-zone="main"] .tv-focus, .hero-btn') as HTMLElement;
        if (mainFocus) mainFocus.focus();
      }
      if (e.key !== 'Enter' && e.key !== 'Escape') return; // Deixa digitar livremente
    }

    // 2. GRAVAR MEMÓRIA (Enter)
    if (e.key === 'Enter') {
      if (active.hasAttribute('data-tv-id')) {
        lastFocusedItemId = active.getAttribute('data-tv-id');
      }
      active.click();
      return;
    }

    // 3. BOTÃO VOLTAR (Backspace/Escape)
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

    // 4. NAVEGAÇÃO ESPACIAL
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const currentZone = active.getAttribute('data-tv-zone') || active.closest('[data-tv-zone]')?.getAttribute('data-tv-zone');

      // ISOLAMENTO ESTRITO (Não vaza do contêiner horizontal)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const rowContainer = active.closest('.horizontal-row-container, .grid-container');
        if (rowContainer) {
          const items = Array.from(rowContainer.querySelectorAll('.tv-focus')) as HTMLElement[];
          const currentIndex = items.indexOf(active);
          if (e.key === 'ArrowRight' && currentIndex < items.length - 1) {
            items[currentIndex + 1].focus();
            items[currentIndex + 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
            items[currentIndex - 1].focus();
            items[currentIndex - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
          return; // Interrompe para não vazar pra sidebar ou outra categoria
        }
      }

      // GEOMETRIA PARA PULAR DE CATEGORIAS (Cima/Baixo)
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
        
        // Regras de Bloqueio
        if (currentZone === 'main' && candidateZone === 'sidebar' && e.key !== 'ArrowLeft') return; // Só vai pra sidebar se não tiver na grid
        if (candidate.tagName === 'INPUT' && e.key !== 'ArrowUp') return; // Só acha o Search se for pra cima

        // Centro dos elementos
        const cx1 = rect.left + rect.width / 2;
        const cy1 = rect.top + rect.height / 2;
        const cx2 = cRect.left + cRect.width / 2;
        const cy2 = cRect.top + cRect.height / 2;
        
        const dx = Math.abs(cx1 - cx2);
        const dy = Math.abs(cy1 - cy2);

        let isValid = false;
        let distance = 0;

        // Multiplicadores pesados para impedir "Drift Diagonal"
        if (e.key === 'ArrowRight') { isValid = cRect.left >= rect.right - 10; distance = dx + dy * 10; }
        else if (e.key === 'ArrowLeft') { isValid = cRect.right <= rect.left + 10; distance = dx + dy * 10; }
        else if (e.key === 'ArrowDown') { isValid = cRect.top >= rect.bottom - 10; distance = dy + dx * 10; }
        else if (e.key === 'ArrowUp') { isValid = cRect.bottom <= rect.top + 10; distance = dy + dx * 10; }

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
