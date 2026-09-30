import React, { useState } from 'react';
import {
  buildDirectImageUrl,
  FALLBACK_IMAGE_DATA_URI,
  diagnoseImageUrl,
  isDebugImagesEnabled,
} from '../utils/mediaUtils';

export interface MediaImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  serverUrl?: string | null;
  fallbackSrc?: string;
  itemId?: string | number;
  itemName?: string;
  priority?: boolean;
}

/**
 * Shared image component for channel logos, movie posters, series covers, and backdrops.
 * Safely resolves direct image URLs without proxy dependencies, prevents stale error states
 * across channel changes, and includes comparative diagnostic reporting when debug mode is enabled.
 */
export function MediaImage({
  src,
  serverUrl,
  fallbackSrc = FALLBACK_IMAGE_DATA_URI,
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
  const cacheKey = `${itemId ?? ''}_${src ?? ''}_${serverUrl ?? ''}`;
  const [prevKey, setPrevKey] = useState(cacheKey);
  const [hasError, setHasError] = useState(false);

  // Synchronously reset error state when source, server or item identity changes
  if (prevKey !== cacheKey) {
    setPrevKey(cacheKey);
    setHasError(false);
  }

  const targetUrl = hasError
    ? fallbackSrc
    : buildDirectImageUrl(src, serverUrl);

  const effectiveLoading = priority ? 'eager' : loading;

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (!hasError) {
      setHasError(true);
    }

    if (isDebugImagesEnabled()) {
      const img = e.currentTarget;
      const diag = diagnoseImageUrl(src, serverUrl);
      console.group(
        `%c[NC Image Diagnostic] Falha ao carregar logo/capa: ${itemName || alt || 'sem nome'}`,
        'color: #ef4444; font-weight: bold;'
      );
      console.log('Item ID:', itemId ?? 'N/A');
      console.log('Nome do item:', itemName || alt || 'N/A');
      console.log('Valor bruto (API stream_icon/cover):', src);
      console.log('URL efetivamente tentada:', targetUrl);
      console.log(
        'URL que o navegador antigo abriria (<img src={bruto}>):',
        diag.legacyBrowserResolution
      );
      console.log('URL foi alterada pelo normalizador?:', diag.wasModifiedByNormalizer ? 'SIM (ALERTA!)' : 'NÃO (Intacta)');
      console.log('Estado DOM da tag <img>:', {
        currentSrc: img.currentSrc,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        loading: img.loading,
        hasOnErrorOccurred: true,
      });
      console.log('Classificação comparativa:', {
        categoria: diag.diffCategory,
        explicacao: diag.notes,
      });
      console.log(
        '%c[Observação de Rede / HTTP]%c O evento onError do elemento <img> não expõe o status HTTP (como 404, 403, DNS ou Mixed Content). Verifique a requisição na aba "Network" (Rede) das Ferramentas de Desenvolvedor para inspecionar os cabeçalhos e status HTTP reais.',
        'color: #f59e0b; font-weight: bold;',
        'color: inherit; font-weight: normal;'
      );
      console.groupEnd();
    }

    onError?.(e);
  };

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    onLoad?.(e);
  };

  return (
    <img
      src={targetUrl}
      alt={alt}
      loading={effectiveLoading}
      className={className}
      onError={handleError}
      onLoad={handleLoad}
      {...rest}
    />
  );
}
