export interface PlexLibraryItem {
  id: number;
  libraryId: number;
  ratingKey: string;
  title: string;
  type: "movie" | "show" | "episode";
  year?: number;
  summary?: string;
  contentRating?: string;
  studio?: string;
  seasonCount?: number;
  episodeCount?: number;
  show?: number;
  season?: number;
  episode?: number;
}

export interface PlexLibrary {
  id: number;
  title: string;
  type: "movie" | "show";
  items: PlexLibraryItem[];
}
