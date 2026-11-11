import React from 'react';
import { useXtreamSeries, useXtreamCredentials } from '../context/XtreamContext';
import { CatalogShowcaseView } from '../components/CatalogShowcaseView';

export interface SeriesViewProps {
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

export const SeriesView = React.memo(function SeriesView({
  onPlay,
  searchQuery = '',
  isPaused = false,
}: SeriesViewProps) {
  const { credentials } = useXtreamCredentials();
  const {
    seriesCategories,
    seriesStreams,
    allSeriesStreams,
    loadingSeries,
    seriesError,
    seriesCategoriesStatus,
    seriesCatalogStatus,
    seriesCategoriesError,
    fetchSeriesCategories,
    fetchSeriesStreams,
  } = useXtreamSeries();

  return (
    <CatalogShowcaseView
      section="series"
      credentials={credentials}
      searchQuery={searchQuery}
      isPaused={isPaused}
      onPlay={onPlay}
      seriesCategories={seriesCategories}
      seriesStreams={seriesStreams}
      allSeriesStreams={allSeriesStreams}
      loadingSeries={loadingSeries}
      seriesError={seriesError}
      seriesCategoriesStatus={seriesCategoriesStatus}
      seriesCatalogStatus={seriesCatalogStatus}
      seriesCategoriesError={seriesCategoriesError}
      fetchSeriesCategories={fetchSeriesCategories}
      fetchSeriesStreams={fetchSeriesStreams}
    />
  );
});
