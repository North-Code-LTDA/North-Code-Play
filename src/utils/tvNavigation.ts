export function initTvNavigation() {
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement as HTMLElement;
    
    // Ignore if typing in input
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      activeEl?.click();
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Escape') {
      e.preventDefault();
      const closeBtn = document.querySelector('.btn-close') as HTMLElement;
      if (closeBtn) {
        closeBtn.click();
      } else {
        const sidebarItems = document.querySelectorAll('[data-tv-zone="sidebar"] .tv-focus');
        if (sidebarItems.length > 0) {
          (sidebarItems[0] as HTMLElement).focus();
        }
      }
      return;
    }

    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
    if (!isArrow) return;
    
    e.preventDefault();

    const focusableEls = Array.from(document.querySelectorAll('.tv-focus')).filter((el): el is HTMLElement => {
      const htmlEl = el as HTMLElement;
      // Check if visible
      return htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0 && window.getComputedStyle(htmlEl).visibility !== 'hidden';
    });

    if (focusableEls.length === 0) return;

    if (!activeEl || !focusableEls.includes(activeEl)) {
      focusableEls[0].focus();
      return;
    }

    const activeRect = activeEl.getBoundingClientRect();
    const activeZone = activeEl.getAttribute('data-tv-zone');

    let bestMatch: HTMLElement | null = null;
    let minDistance = Infinity;

    for (const el of focusableEls) {
      if (el === activeEl) continue;

      const rect = el.getBoundingClientRect();
      const elZone = el.getAttribute('data-tv-zone');

      // Prevent ArrowLeft from main zone leaking to sidebar zone if requested
      if (e.key === 'ArrowLeft' && activeZone === 'main' && elZone === 'sidebar') {
        // We don't consider this element
        continue;
      }

      let dx = 0;
      let dy = 0;
      let validDirection = false;

      // Calculate centers
      const activeCx = activeRect.left + activeRect.width / 2;
      const activeCy = activeRect.top + activeRect.height / 2;
      const elCx = rect.left + rect.width / 2;
      const elCy = rect.top + rect.height / 2;

      if (e.key === 'ArrowRight' && elCx > activeCx) {
        dx = elCx - activeCx;
        dy = elCy - activeCy;
        validDirection = true;
      } else if (e.key === 'ArrowLeft' && elCx < activeCx) {
        dx = activeCx - elCx;
        dy = elCy - activeCy;
        validDirection = true;
      } else if (e.key === 'ArrowDown' && elCy > activeCy) {
        dx = elCx - activeCx;
        dy = elCy - activeCy;
        validDirection = true;
      } else if (e.key === 'ArrowUp' && elCy < activeCy) {
        dx = elCx - activeCx;
        dy = activeCy - elCy;
        validDirection = true;
      }

      if (validDirection) {
        // Distance calculation with weight to prefer straight lines
        const primaryDist = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? Math.abs(dx) : Math.abs(dy);
        const secondaryDist = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
        
        // Increase penalty for secondary distance to enforce straight lines
        const distance = Math.sqrt(Math.pow(primaryDist, 2) + Math.pow(secondaryDist * 3, 2));

        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = el;
        }
      }
    }

    if (bestMatch) {
      bestMatch.focus();
      bestMatch.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
}
