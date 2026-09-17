export interface PlexLibraryItem {
  ratingKey: string;
  key: string;
  type: "movie" | "show" | "episode";
  title: string;
  year?: number;
  thumb?: string;
  art?: string;
  duration?: number;
  addedAt?: number;
  updatedAt?: number;
  viewCount?: number;
  viewOffset?: number;
  libraryKey?: number;
  libraryTitle?: string;
}

export interface PlexLibrary {
  id: number;
  title: string;
  type: "movie" | "show";
  items: PlexLibraryItem[];
}
