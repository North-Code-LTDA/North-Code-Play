import React, { useState, useEffect, useRef } from 'react';
import {
  buildDirectImageUrl,
  diagnoseImageUrl,
  isDebugImagesEnabled,
} from '../utils/mediaUtils';

export interface MediaImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: unknown;
  serverUrl?: string | null;
  itemId?: string | number;
  itemName?: string;
  priority?: boolean;
}

type ImageStatus = 'empty' | 'loading' | 'loaded' | 'retrying' | 'failed';

/**
 * Standardized remote image component for channel logos, movie posters, series covers, and backdrops.
 *
 * Requirements enforced:
 * 1. Cleanly separates address resolution from loading state.
 * 2. Employs explicit lifecycle states: 'empty', 'loading', 'loaded', 'retrying', 'failed'.
 * 3. Never renders `<img src="">` for empty sources (avoids invalid document requests).
 * 4. Eliminates "Sem Imagem" placeholders and broken image icons: preserves the reserved container
 *    and background cleanly without visual artifacts or card size shifts.
 * 5. Natural image loading without short premature timeouts.
 * 6. Exactly ONE retry after ~2000ms using the exact same URL upon initial onError.
 * 7. After a second failure, the area remains cleanly empty without native browser broken image indicators.
 * 8. Resets retry budget and cancels pending timers on unmount or when source/serverUrl changes.
 * 9. Normal React re-renders do not reset retry budget or create retry loops.
 * 10. Discrete, detailed diagnostic reporting via `window.ncDebugImages(true)`.
 */
export function MediaImage({
  src,
  serverUrl,
  alt = '',
  className = '',
  loading,
  priority = false,
  itemId,
  itemName,
  onError,
  onLoad,
  ...rest
}: MediaImageProps) {
  // Resolve direct provider URL without proxy
  const resolvedUrl = buildDirectImageUrl(src, serverUrl);

  // Status & retry count state
  const [status, setStatus] = useState<ImageStatus>(() => (resolvedUrl ? 'loading' : 'empty'));
  const [attempt, setAttempt] = useState(0);

  // Track identity of current source to detect changes
  const currentKey = `${itemId ?? ''}_${resolvedUrl ?? ''}`;
  const prevKeyRef = useRef(currentKey);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronously reset retry state when source or server changes
  if (prevKeyRef.current !== currentKey) {
    prevKeyRef.current = currentKey;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setAttempt(0);
    setStatus(resolvedUrl ? 'loading' : 'empty');
  }

  // Cancel any scheduled retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const isFirstFailure = attempt === 0;

    if (isFirstFailure) {
      setStatus('retrying');

      if (isDebugImagesEnabled()) {
        const diag = diagnoseImageUrl(src, serverUrl);
        console.group(
          `%c[NC Image Diagnostic] ⚠️ 1ª Falha ao carregar imagem: ${itemName || alt || 'sem nome'}`,
          'color: #f59e0b; font-weight: bold;'
        );
        console.log('Item ID:', itemId ?? 'N/A');
        console.log('Nome do item:', itemName || alt || 'N/A');
        console.log('URL original:', src);
        console.log('URL resolvida:', resolvedUrl);
        console.log('Status: Primeira falha (agendando retentativa única em 2s com a mesma URL)');
        console.log('Classificação:', diag.diffCategory, diag.notes);
        console.log(
          '%c[Diagnóstico de Rede vs Frontend]%c\n' +
          '• O frontend controla: resolução da URL (preservada literalmente), ciclo de vida do componente e 1 retentativa pontual após 2s.\n' +
          '• O que depende do provedor/rede:\n' +
          '  - ERR_NAME_NOT_RESOLVED: o domínio da logo/capa não possui entrada DNS válida ou expirou no provedor.\n' +
          '  - ERR_BLOCKED_BY_ORB (Opaque Response Blocking): o servidor do provedor respondeu com tipo MIME inválido (ex: erro HTML em vez de imagem) ou sem cabeçalhos de imagem válidos.\n' +
          '  - Mixed Content (HTTP em página HTTPS): navegadores bloqueiam requisições HTTP inseguras quando o frontend roda sob HTTPS.\n' +
          '  - HTTP 404 / 403 / 502: verifique a requisição na aba "Network" (Rede) das Ferramentas de Desenvolvedor para inspecionar os cabeçalhos reais.',
          'color: #38bdf8; font-weight: bold;',
          'color: inherit;'
        );
        console.groupEnd();
      }

      // Schedule exactly ONE retry after ~2000ms using the exact same URL (no query mutations)
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (isDebugImagesEnabled()) {
          console.log(`[NC Image Diagnostic] 🔄 Executando retentativa única para: ${itemName || alt || resolvedUrl}`);
        }
        setAttempt(1);
        setStatus('loading');
      }, 2000);
    } else {
      // Second failure: definitive failure
      setStatus('failed');

      if (isDebugImagesEnabled()) {
        console.group(
          `%c[NC Image Diagnostic] ❌ Falha definitiva após retentativa: ${itemName || alt || 'sem nome'}`,
          'color: #ef4444; font-weight: bold;'
        );
        console.log('Item ID:', itemId ?? 'N/A');
        console.log('URL resolvida tentada:', resolvedUrl);
        console.log('Status: Falha definitiva (área mantida reservada e vazia sem ícone quebrado)');
        console.groupEnd();
      }
    }

    onError?.(e);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setStatus('loaded');
    onLoad?.(e);
  };

  // If source is empty, invalid, or failed definitively:
  // Render an empty reserved area preserving the layout and background classes without an <img> tag.
  // This avoids invalid requests to current page, prevents native broken image icons, and preserves layout.
  if (!resolvedUrl || status === 'empty' || status === 'failed') {
    return (
      <div
        className={className}
        aria-label={alt || itemName || undefined}
        role={alt || itemName ? 'img' : undefined}
      />
    );
  }

  const effectiveLoading = priority ? 'eager' : loading;

  // While loading or retrying, the <img> is hidden via opacity-0 to prevent native broken icons
  // while retaining natural browser network fetching.
  return (
    <img
      key={`${currentKey}_attempt_${attempt}`}
      src={resolvedUrl}
      alt={alt}
      loading={effectiveLoading}
      className={`${className} ${status === 'loaded' ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
      onError={handleImageError}
      onLoad={handleImageLoad}
      {...rest}
    />
  );
}
