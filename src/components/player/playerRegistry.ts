/**
 * Manages active player instances so global keyboard shortcuts
 * and fullscreen state do not bleed between multiple mounted player instances.
 */

let activePlayerId: string | null = null;
const registeredPlayerIds = new Set<string>();

export function registerPlayer(id: string): () => void {
  registeredPlayerIds.add(id);
  activePlayerId = id;
  return () => {
    registeredPlayerIds.delete(id);
    if (activePlayerId === id) {
      activePlayerId = registeredPlayerIds.size > 0 
        ? Array.from(registeredPlayerIds)[registeredPlayerIds.size - 1] 
        : null;
    }
  };
}

export function setActivePlayer(id: string): void {
  if (registeredPlayerIds.has(id)) {
    activePlayerId = id;
  }
}

export function getActivePlayerId(): string | null {
  return activePlayerId;
}

export function isPlayerActive(
  id: string,
  isFs: boolean,
  isFocused: boolean
): boolean {
  if (isFs || isFocused) return true;
  if (!activePlayerId) return true;
  return activePlayerId === id;
}
