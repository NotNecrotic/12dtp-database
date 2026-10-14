/**
 * Shared types across the project.
 */

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
  poster: string | null;
  background: string | null;
  genres: string[];
  collections: string[];
  countries: string[];
  people: PlexPerson[];
}

export interface PlexPerson {
  name: string;
  role: string;
}

export interface PlexLibrary {
  id: number;
  title: string;
  type: "movie" | "show";
  collections: string[];
  items: PlexLibraryItem[];
}
