import React from 'react';
import {
  useXtreamVod,
  useXtreamCredentials,
  useXtreamSession,
} from '../context/XtreamContext';
import { CatalogShowcaseView } from '../components/CatalogShowcaseView';
import { OnPlayMediaHandler } from '../components/player/types';

export interface MoviesViewProps {
  onPlay: OnPlayMediaHandler;
  searchQuery?: string;
  isPaused?: boolean;
}

export const MoviesView = React.memo(function MoviesView({
  onPlay,
  searchQuery = '',
  isPaused = false,
}: MoviesViewProps) {
  const { credentials } = useXtreamCredentials();
  const { sessionReady } = useXtreamSession();
  const {
    vodCategories,
    vodStreams,
    allVodStreams,
    loadingVod,
    vodError,
    vodCategoryError,
    vodCategoriesStatus,
    vodCatalogStatus,
    vodCategoryStatus,
    vodCategoriesError,
    fetchVodCategories,
    fetchVodStreams,
    isVodCategoryLoaded,
    getVodCategoryStreams,
    getPartialVodStreamsForSearch,
  } = useXtreamVod();

  return (
    <CatalogShowcaseView
      section="movies"
      credentials={credentials}
      searchQuery={searchQuery}
      isPaused={isPaused}
      onPlay={onPlay}
      vodCategories={vodCategories}
      vodStreams={vodStreams}
      allVodStreams={allVodStreams}
      loadingVod={loadingVod}
      vodError={vodError}
      vodCategoryError={vodCategoryError}
      vodCategoriesStatus={vodCategoriesStatus}
      vodCatalogStatus={vodCatalogStatus}
      vodCategoryStatus={vodCategoryStatus}
      vodCategoriesError={vodCategoriesError}
      fetchVodCategories={fetchVodCategories}
      fetchVodStreams={fetchVodStreams}
      isVodCategoryLoaded={isVodCategoryLoaded}
      getVodCategoryStreams={getVodCategoryStreams}
      getPartialVodStreamsForSearch={getPartialVodStreamsForSearch}
      sessionReady={sessionReady}
    />
  );
});
