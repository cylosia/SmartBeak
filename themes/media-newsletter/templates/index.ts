
import Archive from './archive';
import Article from './article';
import Author from './author';
import Bestof from './bestof';
import Comparison from './comparison';
import Guide from './guide';
import Landing from './landing';
import Location from './location';
import Post from './post';
import Review from './review';
import Service from './service';

export {
  Archive as ArchiveTemplate,
  Article as ArticleTemplate,
  Author as AuthorTemplate,
  Bestof as BestOfTemplate,
  Comparison as ComparisonTemplate,
  Guide as GuideTemplate,
  Landing as LandingTemplate,
  Location as LocationTemplate,
  Post as PostTemplate,
  Review as ReviewTemplate,
  Service as ServiceTemplate,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const templateMap: Record<string, any> = {
  article: Article,
  guide: Guide,
  review: Review,
  comparison: Comparison,
  bestof: Bestof,
  service: Service,
  location: Location,
  post: Post,
  landing: Landing,
  archive: Archive,
  author: Author,
};

export default {
  ArchiveTemplate: Archive,
  ArticleTemplate: Article,
  AuthorTemplate: Author,
  BestOfTemplate: Bestof,
  ComparisonTemplate: Comparison,
  GuideTemplate: Guide,
  LandingTemplate: Landing,
  LocationTemplate: Location,
  PostTemplate: Post,
  ReviewTemplate: Review,
  ServiceTemplate: Service,
};
