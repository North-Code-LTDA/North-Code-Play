import React from 'react';
import { useXtreamVod, useXtreamCredentials } from '../context/XtreamContext';
import { CatalogShowcaseView } from '../components/CatalogShowcaseView';

export interface MoviesViewProps {
  onPlay: (
    url: string,
    title: string,
    startAt?: number,
    streamId?: string | number,
    contentType?: 'live' | 'movie' | 'episode',
    channelName?: string,
    programTitle?: string,
    onNext?: () => void,
    onPrevious?: () => void
  ) => void;
  searchQuery?: string;
  isPaused?: boolean;
}

export const MoviesView = React.memo(function MoviesView({
  onPlay,
  searchQuery = '',
  isPaused = false,
}: MoviesViewProps) {
  const { credentials } = useXtreamCredentials();
  const {
    vodCategories,
    vodStreams,
    allVodStreams,
    loadingVod,
    vodError,
    vodCategoriesStatus,
    vodCatalogStatus,
    vodCategoriesError,
    fetchVodCategories,
    fetchVodStreams,
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
      vodCategoriesStatus={vodCategoriesStatus}
      vodCatalogStatus={vodCatalogStatus}
      vodCategoriesError={vodCategoriesError}
      fetchVodCategories={fetchVodCategories}
      fetchVodStreams={fetchVodStreams}
    />
  );
});
